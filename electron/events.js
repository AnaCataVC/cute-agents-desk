// @ts-check
/**
 * Turns hook reports into the state the window draws.
 *
 * Two responsibilities, kept apart on purpose: `events.jsonl` is the append-only truth of what
 * happened (and the central debugging tool for inspections), while the derived state is
 * a small object that can be rebuilt from that log at any time. Nothing reads the terminal
 * output to decide what an agent is doing.
 */

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths.js');
const conv = require('./conversations.js');
const { toolNameOf } = require('./tool-name.js');
const { drainJsonQueue, watchJsonQueue } = require('./json-queue.js');
const { readAccountsConfig, accountIdForCwd } = require('./accounts.js');

/** Check if an ISO timestamp occurred on the same calendar day (in local time). */
function isSameLocalDay(isoString, refDate = new Date()) {
  if (!isoString) return false;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return false;
  return d.getFullYear() === refDate.getFullYear() &&
    d.getMonth() === refDate.getMonth() &&
    d.getDate() === refDate.getDate();
}

/** How long a done/failed agent stays visible (in the live grid, in its conversation's
 * status.json) after it exits, before its record is dropped for good. Long enough to see the
 * final state; short enough that a long session spawning many short-lived workers does not grow
 * this map by one entry per agent ever spawned, for the app's entire lifetime. */
const TERMINAL_RETENTION_MS = 5 * 60 * 1000;

/**
 * Event → state. The mapping is the whole state machine, so it lives in one table instead of
 * a chain of ifs across the file.
 */
const STATE_BY_EVENT = {
  SessionStart: 'thinking',
  UserPromptSubmit: 'thinking',
  PreToolUse: 'tool',
  PostToolUse: 'thinking',
  SubagentStop: 'thinking',
  // Claude sends Notification when it is waiting on the person — permission, or an idle prompt.
  Notification: 'blocked',
  Stop: 'idle',
  // agy-only event names (MEASURED 2026-09-10, hooks.md): it has no SessionStart/Notification of
  // its own, so "just spawned" and "blocked on a person" cannot be told apart the way claude's
  // can — dormant for claude, which never sends these.
  PreInvocation: 'thinking',
  PostInvocation: 'thinking',
};

/** Tools that always need a person, whatever the permission mode says. Claude's Bash/WebFetch,
 * and agy's equivalent run_command — both are the one tool general enough to do almost anything. */
const ALWAYS_ASK = /^(Bash|WebFetch|run_command)$/;

/** A tool call as one line, which is what the card shows. */
function describeTool(payload) {
  const name = toolNameOf(payload);
  if (!name) return null;
  if (payload?.toolCall?.name) {
    const args = payload.toolCall.args || {};
    const detail = args.AbsolutePath || args.DirectoryPath || args.CommandLine || args.Query || '';
    return detail ? `${name} · ${detail}` : name;
  }
  const input = payload.tool_input || {};
  const detail = input.file_path || input.path || input.command || input.pattern || input.url || '';
  return detail ? `${name} · ${detail}` : name;
}

/**
 * Token and cost numbers arrive on the status line, whose exact shape has changed between CLI
 * versions. MEASURED, 2026-09-10, claude 2.1.267: the real payload nests everything under
 * `context_window` (`used_percentage` already 0-100, `context_window_size` the model's own cap —
 * 1M for Sonnet 5, not a fixed 200k), and there is no top-level `usage`/`token_usage`/
 * `exceeds_200k_tokens` — those were guesses from an older shape that this CLI no longer sends.
 */
function readUsage(payload) {
  if (!payload) return {};
  const cost = payload.cost || {};
  const ctx = payload.context_window || {};
  const tokens = (ctx.total_input_tokens || 0) + (ctx.total_output_tokens || 0) || undefined;
  return {
    tokens,
    contextUsed: ctx.used_percentage,
    contextCap: ctx.context_window_size,
    costUsd: cost.total_cost_usd,
    model: (payload.model && (payload.model.display_name || payload.model.id)) || undefined,
    sessionId: payload.session_id,
  };
}

class Registry {
  /** @param {(agents: object[]) => void} onChange */
  constructor(onChange) {
    this.onChange = onChange;
    /** @type {Map<string, Record<string, any>>} */
    this.agents = new Map();
    /** @type {Map<string, {close: () => void}>} */
    this.watchers = new Map();
    /** @type {Map<string, {close: () => void}>} the outbox watcher per agent, kept apart from
     * `watchers` (hook events) since register() now opens one of each per agent */
    this.outboxWatchers = new Map();
    /** @type {Map<string, {write: (t: string) => void, kill: () => void}>} live handles, kept
     * out of the published state — the token cap is the only reason the registry needs them */
    this.handles = new Map();
    this.completedUsage = {
      claude: { tokens: 0, costUsd: 0 },
      agy: { tokens: 0, costUsd: 0 },
    };
    this.completedAllTime = {
      claude: { tokens: 0, costUsd: 0 },
      agy: { tokens: 0, costUsd: 0 },
    };
    this.completedByAccount = {};
    this.completedByAccountAllTime = {};
    this.completedHourlySeries = Array(24).fill(0);
    /** @type {Map<string, Array<[string, string, string, string]>>} */
    this.threads = new Map();
    /** @type {Map<string, Array<{ state: string, start: number, end?: number }>>} */
    this.agentRuns = new Map();
    paths.ensure();
    this.loadTodayUsage();
  }

  /**
   * Record a chat/thread message for an agent.
   * @param {string} agentId
   * @param {'boss'|'sub'|'user'|'sys'|'tool'} kind
   * @param {string} who
   * @param {string} text
   */
  recordMessage(agentId, kind, who, text) {
    if (!agentId || !text) return;
    if (!this.threads.has(agentId)) this.threads.set(agentId, []);
    const list = this.threads.get(agentId);
    const now = new Date();
    const when = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    list.push([kind, who, when, String(text).trim()]);
    if (list.length > 200) list.shift();
  }

  getThreads() {
    const out = {};
    for (const [k, v] of this.threads) {
      out[k] = [...v];
    }
    return out;
  }

  /**
   * Record a state run interval for an agent.
   * @param {string} agentId
   * @param {string} state
   * @param {number} [timestamp]
   */
  recordStateRun(agentId, state, timestamp = Date.now()) {
    if (!agentId || !state) return;
    if (!this.agentRuns.has(agentId)) this.agentRuns.set(agentId, []);
    const runs = this.agentRuns.get(agentId);
    if (runs.length > 0) {
      const prev = runs[runs.length - 1];
      if (prev.state === state) return;
      if (!prev.end) prev.end = timestamp;
    }
    runs.push({ state, start: timestamp, end: undefined });
    if (runs.length > 100) runs.shift();
  }

  /**
   * Project state runs into the timeline structure expected by ui/timeline.js.
   * @param {number} [windowMinutes=30]
   */
  getTimelineData(windowMinutes = 30) {
    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;
    const windowStart = now - windowMs;

    const lanes = [];
    for (const [agentId, runs] of this.agentRuns) {
      const bars = [];
      for (const run of runs) {
        const runStart = run.start;
        const runEnd = run.end || now;
        if (runEnd < windowStart || runStart > now) continue;

        const effectiveStart = Math.max(runStart, windowStart);
        const effectiveEnd = Math.min(runEnd, now);
        const duration = effectiveEnd - effectiveStart;
        if (duration <= 0) continue;

        const fromPct = +(((effectiveStart - windowStart) / windowMs) * 100).toFixed(1);
        const lenPct = +((duration / windowMs) * 100).toFixed(1);
        if (lenPct > 0) {
          bars.push([run.state, fromPct, lenPct]);
        }
      }
      if (bars.length > 0 || this.agents.has(agentId)) {
        lanes.push({ agent: agentId, bars });
      }
    }

    return {
      window: `últimos ${windowMinutes} min`,
      ticks: [`-${windowMinutes}m`, `-${Math.round(windowMinutes * 0.66)}m`, `-${Math.round(windowMinutes * 0.33)}m`, 'ahora'],
      lanes,
    };
  }

  /**
   * @param {object} agent
   * @param {object} [opts]
   * @param {number} [opts.tokenCap]  absolute tokens for this agent; a budget the harness
   *   imposes, unrelated to the model's own context window (Sonnet 5's is 1M — far too large to
   *   double as a cost control). Undefined means uncapped.
   * @param {string} [opts.conversationId]  which conversation this worker belongs to, if any —
   *   what conversations.runningInConversation() counts against that conversation's own cap
   * @param {string} [opts.replyTo]  the coordinator's own agent id, when this agent is a worker
   *   spawned on that coordinator's behalf — what the UI shows as "responde a <coordinador>"
   * @param {string} [opts.role]  'coordinator' for the one agent per conversation that only
   *   delegates; absent (the default) means an ordinary worker
   */
  register(agent, opts = {}) {
    this.agents.set(agent.id, {
      id: agent.id,
      cwd: agent.cwd,
      repo: path.basename(agent.cwd),
      task: agent.task,
      engine: agent.engine,
      mode: agent.mode || opts.mode || 'write',
      model: agent.model || opts.model || null,
      effort: agent.effort || opts.effort || null,
      pid: agent.pid,
      state: 'spawning',
      tool: 'arrancando',
      tokens: 0,
      costUsd: 0,
      startedAt: Date.now(),
      raw: null,
      tokenCap: opts.tokenCap,
      conversationId: opts.conversationId,
      replyTo: opts.replyTo,
      role: opts.role,
      dependsOn: opts.dependsOn || [],
    });
    this.handles.set(agent.id, { write: agent.write, kill: agent.kill });
    this.watch(agent.id);
    this.watchOutbox(agent.id);
    this.append({ event: 'AgentSpawned', at: new Date().toISOString(), agentId: agent.id, payload: { cwd: agent.cwd, task: agent.task, pid: agent.pid, tokenCap: opts.tokenCap, replyTo: opts.replyTo, role: opts.role, mode: agent.mode || opts.mode || 'write', model: agent.model || opts.model || null, effort: agent.effort || opts.effort || null } });
    this.recordStateRun(agent.id, 'spawning');
    this.recordMessage(agent.id, 'sys', 'harness', `Sesión iniciada en ${path.basename(agent.cwd)}`);
    if (opts.replyTo) this.notifyCoordinator(opts.replyTo, agent.id, `arranco en ${path.basename(agent.cwd)}: ${agent.task}`);
    this.publish();
  }

  /**
   * The worker's half of "el canal de vuelta es simétrico" from the plan: three moments report
   * to the coordinator automatically, with no worker code involved (spawned, blocked, done), and
   * a fourth is the worker's own choice -- a free-form message it drops in its outbox, drained by
   * `drainOutbox()` below. All four end up typed into the coordinator's own live terminal, the
   * only side channel a running CLI has, same mechanism as the token-cap wrap-up nudge. A
   * coordinator that has already exited (its handle gone) simply gets nothing; there is no
   * session left to read it.
   * @param {string} coordinatorId @param {string} workerId @param {string} message
   */
  notifyCoordinator(coordinatorId, workerId, message) {
    this.recordMessage(coordinatorId, 'sub', workerId, message);
    this.recordMessage(workerId, 'sub', 'agente', message);
    this.handles.get(coordinatorId)?.write(`\n[trabajador ${workerId}] ${message}\r`);
  }

  /**
   * Watch the agent's mailbox. See `json-queue.js` for the drain mechanics shared with the
   * outbox and the coordinator's spawn-requests queue.
   * @param {string} id
   */
  watch(id) {
    const { inbox } = paths.agent(id);
    const watcher = watchJsonQueue(inbox, () => this.drain(id));
    this.watchers.set(id, watcher);
  }

  /** @param {string} id */
  drain(id) {
    const { inbox } = paths.agent(id);
    // The report is now in events.jsonl once applied, so the mailbox copy is redundant --
    // drainJsonQueue deletes it so the directory doesn't grow without bound.
    if (drainJsonQueue(inbox, (report) => this.apply(id, report))) this.publish();
  }

  /**
   * The fourth mailbox moment, and the only one not tied to a hook event: a worker reporting an
   * arbitrary, free-form message to its own coordinator, of its own accord.
   * @param {string} id
   */
  watchOutbox(id) {
    const { outbox } = paths.agent(id);
    const watcher = watchJsonQueue(outbox, () => this.drainOutbox(id));
    this.outboxWatchers.set(id, watcher);
  }

  /** @param {string} id */
  drainOutbox(id) {
    const { outbox } = paths.agent(id);
    drainJsonQueue(outbox, (body) => {
      if (!body || typeof body.message !== 'string') return false;
      const agent = this.agents.get(id);
      if (agent?.replyTo) {
        this.notifyCoordinator(agent.replyTo, id, `mensaje: ${body.message}`);
      } else {
        this.recordMessage(id, 'sub', 'agente', body.message);
        // A worker with nowhere to send this (e.g. a bare desk:spawn call) -- not an error, just
        // worth a line in events.jsonl so it isn't silently lost.
        this.note(id, 'OutboxDropped', { reason: 'no-coordinator', message: body.message });
      }
    });
  }

  /**
   * @param {string} id
   * @param {{event: string, at: string, payload: any}} report
   */
  apply(id, report) {
    const agent = this.agents.get(id);
    if (!agent) return;
    this.append({ ...report, agentId: id });

    if (report.event === 'Status') {
      Object.assign(agent, cleanUsage(readUsage(report.payload)));
      agent.raw = report.payload;
      this.enforceTokenCap(id, agent);
      this.publish();
      return;
    }

    const next = STATE_BY_EVENT[report.event];
    if (next) {
      agent.state = next;
      this.recordStateRun(id, next);
    }

    if (report.event === 'PreToolUse') {
      const tool = describeTool(report.payload);
      if (tool) {
        agent.tool = tool;
        this.recordMessage(id, 'tool', 'herramienta', tool);
      }
      if (ALWAYS_ASK.test(toolNameOf(report.payload))) {
        agent.state = 'approval';
        this.recordStateRun(id, 'approval');
      }
    }
    if (report.event === 'PostToolUse') {
      agent.tool = 'pensando';
      this.recordStateRun(id, 'thinking');
    }
    if (report.event === 'Notification' && report.payload?.message) {
      agent.tool = report.payload.message;
      this.recordMessage(id, 'sys', 'harness', `Esperando: ${report.payload.message}`);
      this.recordStateRun(id, 'blocked');
    }
    if (report.event === 'Stop') {
      agent.tool = 'turno terminado';
      this.recordStateRun(id, 'idle');
    }

    // "Cuando queda bloqueado" from the plan's three automatic moments — only Notification
    // (Claude waiting on a person) counts as blocked-and-worth-a-ping; ALWAYS_ASK's 'approval'
    // is a routine part of the turn, not the worker being stuck.
    if (report.event === 'Notification' && agent.replyTo) {
      this.notifyCoordinator(agent.replyTo, id, `bloqueado: ${agent.tool}`);
    }
  }

  /**
   * The cap the harness imposes, never one the agent can negotiate: a warning at 80% asks it to
   * wrap up on its own terms, but 100% kills the session outright rather than trusting it to
   * stop. Both thresholds are against the absolute token count, not the model's own context
   * window (irrelevant here — Sonnet 5's is 1M, useless as a cost control).
   * @param {string} id @param {Record<string, any>} agent
   */
  enforceTokenCap(id, agent) {
    const cap = agent.tokenCap;
    if (!cap || !agent.tokens || agent.state === 'failed') return;
    const handle = this.handles.get(id);
    const pct = (agent.tokens / cap) * 100;

    if (pct >= 100) {
      agent.state = 'failed';
      agent.failReason = 'token-cap';
      agent.tool = `tope de tokens alcanzado (${agent.tokens}/${cap})`;
      this.note(id, 'TokenCapExceeded', { tokens: agent.tokens, cap });
      handle?.kill();
      return;
    }
    if (pct >= 80 && !agent.tokenCapWarned) {
      agent.tokenCapWarned = true;
      this.note(id, 'TokenCapWarning', { tokens: agent.tokens, cap });
      // Typed as if a person had: the CLI has no side channel for "wrap up", only the prompt.
      handle?.write('Estas al 80% de tu tope de tokens. Cierra el turno ahora: deja el trabajo en un estado consistente y escribe tu resumen.\r');
    }
  }

  /** @param {string} id @param {number} code */
  exited(id, code) {
    const agent = this.agents.get(id);
    if (!agent) return;
    if (agent.tokens || agent.costUsd) {
      const eng = agent.engine === 'agy' ? 'agy' : 'claude';
      const tok = agent.tokens || 0;
      const cost = agent.costUsd || 0;
      this.completedUsage[eng].tokens += tok;
      this.completedUsage[eng].costUsd += cost;
      this.completedAllTime[eng].tokens += tok;
      this.completedAllTime[eng].costUsd += cost;

      const accounts = readAccountsConfig();
      const acc = accountIdForCwd(agent.cwd, accounts);
      if (acc) {
        if (!this.completedByAccount[acc]) {
          this.completedByAccount[acc] = { tokens: 0, costUsd: 0, claudeTokens: 0, agyTokens: 0 };
        }
        this.completedByAccount[acc].tokens += tok;
        this.completedByAccount[acc].costUsd += cost;
        if (eng === 'agy') this.completedByAccount[acc].agyTokens += tok;
        else this.completedByAccount[acc].claudeTokens += tok;

        if (!this.completedByAccountAllTime[acc]) {
          this.completedByAccountAllTime[acc] = { tokens: 0, costUsd: 0, claudeTokens: 0, agyTokens: 0 };
        }
        this.completedByAccountAllTime[acc].tokens += tok;
        this.completedByAccountAllTime[acc].costUsd += cost;
        if (eng === 'agy') this.completedByAccountAllTime[acc].agyTokens += tok;
        else this.completedByAccountAllTime[acc].claudeTokens += tok;
      }
    }
    if (agent.failReason === 'token-cap') {
      agent.tool = `sesión cerrada por tope de tokens (${agent.tokens}/${agent.tokenCap})`;
      this.recordStateRun(id, 'failed');
      this.recordMessage(id, 'sys', 'harness', `Sesión cerrada por tope de tokens (${agent.tokens}/${agent.tokenCap})`);
    } else {
      agent.state = code === 0 ? 'done' : 'failed';
      agent.tool = code === 0 ? 'sesión cerrada' : `salió con código ${code}`;
      this.recordStateRun(id, agent.state);
      this.recordMessage(id, 'sys', 'harness', code === 0 ? 'Sesión cerrada con éxito' : `Salió con código ${code}`);
    }
    // The third automatic moment: done or failed. Uses the coordinator's handle, not this
    // worker's own (deleted right below) — unrelated entries in the same map.
    if (agent.replyTo) this.notifyCoordinator(agent.replyTo, id, `${agent.state}: ${agent.tool}`);
    this.watchers.get(id)?.close();
    this.watchers.delete(id);
    this.outboxWatchers.get(id)?.close();
    this.outboxWatchers.delete(id);
    this.handles.delete(id);
    this.append({ event: 'AgentExited', at: new Date().toISOString(), agentId: id, payload: { code } });
    this.publish();
    // Kept in `this.agents` long enough for this publish (and status.json) to show the terminal
    // state, then dropped -- runningInConversation() already ignores done/failed agents, so this
    // is purely about not growing the map forever, not about the cap.
    setTimeout(() => {
      this.agents.delete(id);
      this.publish();
    }, TERMINAL_RETENTION_MS).unref();
  }

  /**
   * Something the harness did by itself, rather than something the agent reported. Kept in the
   * same log as the agent's own events, because "who decided this" has to be answerable from
   * one file.
   * @param {string} id @param {string} kind @param {object} payload
   */
  note(id, kind, payload) {
    this.append({ event: kind, at: new Date().toISOString(), agentId: id, payload, by: 'harness' });
    this.publish();
  }

  /** @param {object} entry */
  append(entry) {
    try {
      fs.appendFileSync(paths.eventsLog, `${JSON.stringify(entry)}\n`);
    } catch { /* the log is a convenience, never a reason to lose the event in memory */ }
  }

  list() {
    return [...this.agents.values()].map((a) => ({
      ...a,
      elapsed: Math.round((Date.now() - a.startedAt) / 1000),
    }));
  }

  getUsage() {
    let claudeTokens = this.completedUsage.claude.tokens;
    let agyTokens = this.completedUsage.agy.tokens;
    let claudeCost = this.completedUsage.claude.costUsd;
    let agyCost = this.completedUsage.agy.costUsd;

    let allClaudeTokens = (this.completedAllTime?.claude?.tokens || 0);
    let allAgyTokens = (this.completedAllTime?.agy?.tokens || 0);
    let allClaudeCost = (this.completedAllTime?.claude?.costUsd || 0);
    let allAgyCost = (this.completedAllTime?.agy?.costUsd || 0);

    const accounts = readAccountsConfig();
    const byAccount = {};
    for (const [k, v] of Object.entries(this.completedByAccount || {})) {
      byAccount[k] = { ...v };
    }
    const byAccountAllTime = {};
    for (const [k, v] of Object.entries(this.completedByAccountAllTime || {})) {
      byAccountAllTime[k] = { ...v };
    }

    const series = [...(this.completedHourlySeries || Array(24).fill(0))];
    const currentHour = new Date().getHours();

    for (const a of this.agents.values()) {
      if (a.state === 'done' || a.state === 'failed') continue;
      const eng = a.engine === 'agy' ? 'agy' : 'claude';
      const tok = a.tokens || 0;
      const cost = a.costUsd || 0;
      if (eng === 'agy') {
        agyTokens += tok;
        agyCost += cost;
        allAgyTokens += tok;
        allAgyCost += cost;
      } else {
        claudeTokens += tok;
        claudeCost += cost;
        allClaudeTokens += tok;
        allClaudeCost += cost;
      }

      if (tok > 0 && currentHour >= 0 && currentHour < 24) {
        series[currentHour] = (series[currentHour] || 0) + Math.round(tok / 1000);
      }

      const accId = accountIdForCwd(a.cwd, accounts);
      if (accId) {
        if (!byAccount[accId]) byAccount[accId] = { tokens: 0, costUsd: 0, claudeTokens: 0, agyTokens: 0 };
        byAccount[accId].tokens += tok;
        byAccount[accId].costUsd += cost;
        if (eng === 'agy') byAccount[accId].agyTokens += tok;
        else byAccount[accId].claudeTokens += tok;

        if (!byAccountAllTime[accId]) byAccountAllTime[accId] = { tokens: 0, costUsd: 0, claudeTokens: 0, agyTokens: 0 };
        byAccountAllTime[accId].tokens += tok;
        byAccountAllTime[accId].costUsd += cost;
        if (eng === 'agy') byAccountAllTime[accId].agyTokens += tok;
        else byAccountAllTime[accId].claudeTokens += tok;
      }
    }

    return {
      claude: { tokens: claudeTokens, costUsd: claudeCost },
      agy: { tokens: agyTokens, costUsd: agyCost },
      total: { tokens: claudeTokens + agyTokens, costUsd: claudeCost + agyCost },
      allTime: {
        claude: { tokens: allClaudeTokens, costUsd: allClaudeCost },
        agy: { tokens: allAgyTokens, costUsd: allAgyCost },
        total: { tokens: allClaudeTokens + allAgyTokens, costUsd: allClaudeCost + allAgyCost },
      },
      byAccount,
      byAccountAllTime,
      series,
    };
  }

  loadTodayUsage() {
    try {
      if (!fs.existsSync(paths.eventsLog)) return;
      const lines = fs.readFileSync(paths.eventsLog, 'utf8').split('\n');
      const accounts = readAccountsConfig();
      const latestAgentStatusToday = new Map();
      const latestAgentStatusAllTime = new Map();
      const agentEngines = new Map();
      const agentAccounts = new Map();
      const hourlyTokens = Array(24).fill(0);
      const prevAgentHourlyTokens = new Map();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (!entry.at) continue;

          if (entry.event === 'AgentSpawned' && entry.agentId) {
            const isAgy = (entry.payload?.bin || entry.payload?.engine || '').includes('agy');
            agentEngines.set(entry.agentId, isAgy ? 'agy' : 'claude');
            if (entry.payload?.cwd) {
              const accId = accountIdForCwd(entry.payload.cwd, accounts);
              if (accId) agentAccounts.set(entry.agentId, accId);
            }
          }

          if (entry.agentId) {
            const parsedAt = Date.parse(entry.at) || Date.now();
            if (entry.event === 'AgentSpawned') {
              this.recordStateRun(entry.agentId, 'thinking', parsedAt);
              this.recordMessage(entry.agentId, 'sys', 'harness', `Sesión iniciada (${entry.payload?.task || ''})`);
            } else if (entry.event === 'PreToolUse') {
              const tDesc = describeTool(entry.payload);
              if (tDesc) this.recordMessage(entry.agentId, 'tool', 'herramienta', tDesc);
              this.recordStateRun(entry.agentId, 'tool', parsedAt);
            } else if (entry.event === 'PostToolUse') {
              this.recordStateRun(entry.agentId, 'thinking', parsedAt);
            } else if (entry.event === 'Notification') {
              this.recordStateRun(entry.agentId, 'blocked', parsedAt);
            } else if (entry.event === 'AgentExited') {
              const st = entry.payload?.code === 0 ? 'done' : 'failed';
              this.recordStateRun(entry.agentId, st, parsedAt);
              this.recordMessage(entry.agentId, 'sys', 'harness', entry.payload?.code === 0 ? 'Sesión cerrada con éxito' : `Salió con código ${entry.payload?.code}`);
            } else if (entry.event === 'UserInputInjected' && entry.payload?.text) {
              this.recordMessage(entry.agentId, 'user', 'tú', entry.payload.text);
            }
          }

          if (entry.event === 'Status' && entry.agentId && entry.payload) {
            const u = readUsage(entry.payload);
            const isToday = isSameLocalDay(entry.at);

            if (!agentAccounts.has(entry.agentId)) {
              const dirs = [
                ...(entry.payload.workspace?.added_dirs || []),
                entry.payload.workspace?.project_dir,
                entry.payload.workspace?.current_dir,
              ].filter(Boolean);
              for (const dir of dirs) {
                const accId = accountIdForCwd(dir, accounts);
                if (accId) {
                  agentAccounts.set(entry.agentId, accId);
                  break;
                }
              }
            }

            latestAgentStatusAllTime.set(entry.agentId, u);

            if (isToday) {
              latestAgentStatusToday.set(entry.agentId, u);

              const hour = new Date(entry.at).getHours();
              if (hour >= 0 && hour < 24 && u.tokens) {
                const prev = prevAgentHourlyTokens.get(entry.agentId) || 0;
                if (u.tokens > prev) {
                  hourlyTokens[hour] += (u.tokens - prev);
                  prevAgentHourlyTokens.set(entry.agentId, u.tokens);
                }
              }
            }
          }
        } catch { /* skip */ }
      }

      this.completedHourlySeries = hourlyTokens.map((t) => Math.round(t / 1000));

      this.completedUsage = {
        claude: { tokens: 0, costUsd: 0 },
        agy: { tokens: 0, costUsd: 0 },
      };
      this.completedByAccount = {};

      for (const [agentId, u] of latestAgentStatusToday) {
        const eng = agentEngines.get(agentId) || 'claude';
        this.completedUsage[eng].tokens += (u.tokens || 0);
        this.completedUsage[eng].costUsd += (u.costUsd || 0);

        const acc = agentAccounts.get(agentId);
        if (acc) {
          if (!this.completedByAccount[acc]) {
            this.completedByAccount[acc] = { tokens: 0, costUsd: 0, claudeTokens: 0, agyTokens: 0 };
          }
          this.completedByAccount[acc].tokens += (u.tokens || 0);
          this.completedByAccount[acc].costUsd += (u.costUsd || 0);
          if (eng === 'agy') this.completedByAccount[acc].agyTokens += (u.tokens || 0);
          else this.completedByAccount[acc].claudeTokens += (u.tokens || 0);
        }
      }

      this.completedAllTime = {
        claude: { tokens: 0, costUsd: 0 },
        agy: { tokens: 0, costUsd: 0 },
      };
      this.completedByAccountAllTime = {};

      for (const [agentId, u] of latestAgentStatusAllTime) {
        const eng = agentEngines.get(agentId) || 'claude';
        this.completedAllTime[eng].tokens += (u.tokens || 0);
        this.completedAllTime[eng].costUsd += (u.costUsd || 0);

        const acc = agentAccounts.get(agentId);
        if (acc) {
          if (!this.completedByAccountAllTime[acc]) {
            this.completedByAccountAllTime[acc] = { tokens: 0, costUsd: 0, claudeTokens: 0, agyTokens: 0 };
          }
          this.completedByAccountAllTime[acc].tokens += (u.tokens || 0);
          this.completedByAccountAllTime[acc].costUsd += (u.costUsd || 0);
          if (eng === 'agy') this.completedByAccountAllTime[acc].agyTokens += (u.tokens || 0);
          else this.completedByAccountAllTime[acc].claudeTokens += (u.tokens || 0);
        }
      }
    } catch { /* convenience only */ }
  }

  publish() {
    this.onChange(this.list(), this.getUsage(), this.getThreads(), this.getTimelineData());
    this.writeConversationStatuses();
  }

  /**
   * "status.json es su vista global, reescrita por el servidor en cada cambio" — a coordinator's
   * whole picture of its own workers, rewritten in full rather than patched so it can never drift
   * from what the registry actually knows. Grouped by conversationId; agents with none (today's
   * plain `desk:spawn` calls, and the coordinator's own record) write nothing.
   */
  writeConversationStatuses() {
    /** @type {Map<string, Record<string, object>>} */
    const byConversation = new Map();
    for (const agent of this.agents.values()) {
      if (!agent.conversationId) continue;
      if (!byConversation.has(agent.conversationId)) byConversation.set(agent.conversationId, {});
      byConversation.get(agent.conversationId)[agent.id] = {
        state: agent.state, tool: agent.tool, tokens: agent.tokens, task: agent.task, repo: agent.repo,
      };
    }
    for (const [conversationId, summary] of byConversation) {
      // A conversation folder can be gone by the time a lingering exited agent's record is still
      // in memory (e.g. deleted right after its last worker finished) — same rule as append():
      // this is a convenience view, never a reason to crash every future state update.
      try { conv.writeStatus(conversationId, summary); } catch { /* folder is gone; nothing to update */ }
    }
  }

  stopAll() {
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    for (const watcher of this.outboxWatchers.values()) watcher.close();
    this.outboxWatchers.clear();
  }
}

/** Drop the undefined keys so an absent status field never overwrites a value we already had. */
function cleanUsage(usage) {
  return Object.fromEntries(Object.entries(usage).filter(([, v]) => v !== undefined));
}

module.exports = { Registry };
