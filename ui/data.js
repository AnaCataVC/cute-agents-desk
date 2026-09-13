// @ts-check
/**
 * The seam. Today every getter returns the artboard's mock data; once the server exists
 * the same getters read `/api/*` and the SSE stream, and no component changes.
 *
 * Shapes here are the contract the components are written against, so they are the shapes
 * the server has to emit — not an accident of the mockup.
 */

/** @typedef {'thinking'|'tool'|'approval'|'blocked'|'idle'|'done'} AgentState */

/** State -> label and token. The single source for card border, timeline bar and graph edge. */
export const STATES = {
  thinking: { label: 'pensando', color: 'var(--state-thinking)' },
  tool: { label: 'herramienta', color: 'var(--state-tool)' },
  approval: { label: 'espera aprobación', color: 'var(--state-approval)' },
  blocked: { label: 'bloqueado', color: 'var(--state-blocked)' },
  idle: { label: 'idle', color: 'var(--state-idle)' },
  done: { label: 'entregado', color: 'var(--color-emerald-400)' },
};

export const LIVE = ['thinking', 'tool', 'approval', 'blocked'];

/** @type {object[]} conversations, real from the day they exist — no mock fallback to design against */
let liveConversations = [];
/** @param {object[]} conversations */
export function setLiveConversations(conversations) { liveConversations = conversations; }
export function getConversations() { return liveConversations; }

/** @type {object[]} retained write-mode worktrees — real from the day one exists, no mock to design against */
let liveWorktrees = [];
/** @param {object[]} worktrees */
export function setLiveWorktrees(worktrees) { liveWorktrees = worktrees; }
export function getWorktrees() { return liveWorktrees; }

/** @type {object[]|null} null until the real scan comes back; distinct from "scanned, found none" */
let liveAccounts = null;
/** @type {object[]|null} */
let liveRepos = null;

/** @param {{accounts: object[], repos: object[]}} data */
export function setLiveRepoData({ accounts, repos }) {
  liveAccounts = accounts;
  liveRepos = repos;
}

export function getAccounts() { return liveAccounts ?? []; }

export function setAccounts(accounts) { liveAccounts = accounts; }

export function updateAccountColor(accountId, color) {
  if (!liveAccounts) return;
  const acc = liveAccounts.find((a) => a.id === accountId);
  if (acc) acc.color = color;
}

export function updateAccountEditor(accountId, editor) {
  if (!liveAccounts) return;
  const acc = liveAccounts.find((a) => a.id === accountId);
  if (acc) acc.editor = editor;
}

/** @type {object[]|null} null until the first scan of the external schedulers comes back;
 * distinct from "scanned, found none" for the same reason liveAccounts/liveRepos use null. */
let liveScheduledTasks = null;
/** @param {object[]} tasks */
export function setLiveScheduledTasks(tasks) { liveScheduledTasks = tasks; }
export function getScheduledTasks() { return liveScheduledTasks ?? []; }

/** @returns {{name:string, index:number, accountId:string, folder:string, path?:string, relPath?:string, subfolder?:string, dirty:boolean, noRemote:boolean}[]} */
export function getRepos() {
  if (!liveRepos) return [];
  return liveRepos.map((r, i) => ({
    name: r.name,
    index: i,
    accountId: r.accountGh,
    folder: r.folder,
    path: r.path,
    relPath: r.relPath || r.name,
    subfolder: r.subfolder || '',
    dirty: r.dirty,
    noRemote: !r.remote,
    mismatch: r.mismatch,
    branch: r.branch,
  }));
}

/** The context window every engine is measured against. */
export const CONTEXT_CAP = 200000;

/* ---- the live half of the seam ----
   Agents are real from the day one exists, same as conversations and worktrees above -- no mock
   fallback to design against. Zero agents running is a legitimate, common state, not something
   to paper over with invented cards. */

/** @type {object[]} */
let liveAgents = [];
/** @type {Map<string, string[]>} */
const liveOutput = new Map();

/** Terminal escape sequences: pty.log keeps them, the panel must not show them. */
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][A-B0-2]|[\x00-\x1f\x7f-\x9f]/g;

/** @param {object[]} agents */
export function setLiveAgents(agents) {
  liveAgents = agents;
  // Otherwise a short-lived agent's 200-line buffer stays in memory forever, one entry per
  // agent ever spawned instead of per agent currently live.
  const liveIds = new Set(agents.map((a) => a.id));
  for (const id of liveOutput.keys()) if (!liveIds.has(id)) liveOutput.delete(id);
}

/** @param {string} id @param {string} chunk */
export function pushOutput(id, chunk) {
  const lines = liveOutput.get(id) || [];
  // The chunk can split a line anywhere, so it continues the last one instead of starting one.
  const tail = (lines.pop() || '') + chunk.replace(ANSI, '');
  liveOutput.set(id, [...lines, ...tail.split(/\r?\n/)].slice(-200));
}

/** @param {string} id */
export function getOutput(id) {
  return (liveOutput.get(id) || []).filter((line) => line.trim() !== '');
}

/**
 * The account owning a cwd, by the same folder table `accounts.js` builds from `accounts.json`
 * — matching against real account ids (`gh` logins) instead of an invented 'work'/'pers' stand-in
 * that no real account ever has, which made this comparison fail for every live agent.
 * @param {string} [cwd]
 */
function accountIdForCwd(cwd) {
  if (!cwd) return undefined;
  const normalized = cwd.replace(/\\/g, '/').toLowerCase();
  const owner = (liveAccounts || []).find((acc) => (acc.folders || [])
    .some((f) => normalized.startsWith(f.path.replace(/\\/g, '/').toLowerCase())));
  return owner?.id;
}

/**
 * A real agent in the shape the card reads. What the harness does not know yet at this stage
 * says so rather than being invented: a card showing a plausible branch it never checked is
 * worse than one showing a dash.
 */
function fromLive(a) {
  return {
    id: a.id,
    engine: a.engine === 'agy' ? 'agy cli' : 'claude cli',
    repo: a.repo,
    branch: '—',
    // The account belongs to the folder the repo lives in — the rule the whole dashboard is
    // built on.
    accountId: accountIdForCwd(a.cwd),
    state: a.state === 'spawning' ? 'thinking' : a.state,
    tokens: a.tokens || 0,
    tokenCap: a.tokenCap || liveConfig?.engines?.[a.engine === 'agy' ? 'agy' : 'claude']?.contextCap || CONTEXT_CAP,
    elapsed: a.elapsed || 0,
    boss: a.role === 'coordinator' ? 'coordinador de esta conversación' : (a.replyTo || 'sin coordinador'),
    tool: a.tool || '',
    messages: liveThreads[a.id]?.length || 0,
    ring: true,
    live: true,
    costUsd: a.costUsd || 0,
    task: a.task,
    model: a.model,
    effort: a.effort,
    mode: a.mode || 'write',
    conversationId: a.conversationId,
    role: a.role,
    replyTo: a.replyTo,
  };
}

/** Agents shown as cards on the dispatch tab. `ctxPct` is what the ring fills. */
export function getAgents() { return liveAgents.map(fromLive); }

let liveDelivered = [];
export function setLiveDelivered(list) { liveDelivered = Array.isArray(list) ? list : []; }

/** @type {() => object[]} tasks with a merged/drafted PR -- delivered tasks */
export function getDelivered() { return liveDelivered; }

/**
 * Synthesizes cohesive workflow groups for the radial graph in boss-graph.js from
 * live conversations, agents, and accounts.
 * @param {object[]} [agents]
 * @param {object[]} [conversations]
 * @param {object[]} [accounts]
 * @returns {object[]}
 */
export function synthesizeFlows(agents = [], conversations = [], accounts = []) {
  const flows = [];
  const handledAgentIds = new Set();

  for (const conv of conversations) {
    const roster = [];
    let coordinator = null;

    for (const a of agents) {
      const belongs = a.conversationId === conv.id || a.replyTo === conv.id;
      if (belongs) {
        handledAgentIds.add(a.id);
        if (a.role === 'coordinator') {
          coordinator = a;
        } else {
          roster.push({
            id: a.id,
            state: a.state || 'idle',
            repo: a.repo || '—',
            branch: a.branch || '—',
            tokens: a.tokens || 0,
            ctxPct: a.tokenCap > 0 ? Math.round(((a.tokens || 0) / a.tokenCap) * 100) : 0,
            costUsd: a.costUsd || 0,
            role: a.role || 'worker',
            task: a.task,
            tool: a.tool,
            dependsOn: a.dependsOn || [],
          });
        }
      }
    }

    const reposList = [...new Set(roster.map((r) => r.repo).filter((r) => r && r !== '—'))];
    const totalCost = roster.reduce((sum, r) => sum + (r.costUsd || 0), (coordinator?.costUsd || 0));

    let status = 'en espera';
    if (conv.status === 'archived' || conv.status === 'archivado') {
      status = 'archivado';
    } else if (roster.some((r) => r.state === 'blocked') || coordinator?.state === 'blocked') {
      status = 'bloqueado';
    } else if (roster.some((r) => LIVE.includes(r.state)) || (coordinator && LIVE.includes(coordinator.state))) {
      status = 'activo';
    } else if (roster.length > 0 && roster.every((r) => r.state === 'done')) {
      status = 'entregado';
    }

    const engines = new Set();
    if (coordinator?.engine) engines.add(coordinator.engine);
    for (const r of roster) {
      const fullAgent = agents.find((a) => a.id === r.id);
      if (fullAgent?.engine) engines.add(fullAgent.engine);
    }
    const engineLabel = engines.size === 0 ? 'claude cli' : (engines.size === 1 ? [...engines][0] : 'ambos');

    const accountId = coordinator?.accountId || roster.find((r) => {
      const fullAgent = agents.find((a) => a.id === r.id);
      return fullAgent?.accountId;
    })?.accountId || (accounts[0]?.id || '—');

    const links = [];
    for (const r of roster) {
      if (Array.isArray(r.dependsOn)) {
        for (const dep of r.dependsOn) {
          if (roster.some((other) => other.id === dep)) {
            links.push([dep, r.id]);
          }
        }
      }
    }

    flows.push({
      id: conv.id,
      name: conv.title || `Conversación ${conv.id}`,
      short: conv.title || conv.id,
      split: reposList.length > 1 ? 'por repo' : 'por tema',
      engine: engineLabel,
      accountId,
      repos: reposList.length ? reposList.join(', ') : (conv.topic || '—'),
      coordinator: coordinator ? {
        id: coordinator.id,
        state: coordinator.state || 'idle',
        tokens: coordinator.tokens || 0,
        tokenCap: coordinator.tokenCap || 0,
        ctxPct: coordinator.tokenCap > 0 ? Math.round(((coordinator.tokens || 0) / coordinator.tokenCap) * 100) : 0,
        costUsd: coordinator.costUsd || 0,
        tool: coordinator.tool || 'coordinando',
        task: coordinator.task,
        engine: coordinator.engine,
      } : null,
      roster,
      defined: conv.cap || 3,
      turns: `${roster.length + (coordinator ? 1 : 0)} turnos`,
      cost: Number((totalCost || 0).toFixed(2)),
      rate: roster.reduce((sum, r) => sum + (r.state === 'thinking' || r.state === 'tool' ? 120 : 0), 0),
      hooks: (roster.length + (coordinator ? 1 : 0)) * 3,
      loops: [],
      links,
      status,
    });
  }

  // Handle standalone agents not tied to any declared conversation
  const orphanAgents = agents.filter((a) => !handledAgentIds.has(a.id));
  if (orphanAgents.length > 0) {
    const orphanRoster = orphanAgents.filter((a) => a.role !== 'coordinator').map((a) => ({
      id: a.id,
      state: a.state || 'idle',
      repo: a.repo || '—',
      branch: a.branch || '—',
      tokens: a.tokens || 0,
      ctxPct: a.tokenCap > 0 ? Math.round(((a.tokens || 0) / a.tokenCap) * 100) : 0,
      costUsd: a.costUsd || 0,
      role: a.role || 'worker',
      task: a.task,
      tool: a.tool,
    }));
    const reposList = [...new Set(orphanRoster.map((r) => r.repo).filter((r) => r && r !== '—'))];
    const totalCost = orphanAgents.reduce((sum, a) => sum + (a.costUsd || 0), 0);
    const hasBlocked = orphanAgents.some((a) => a.state === 'blocked');
    const hasLive = orphanAgents.some((a) => LIVE.includes(a.state));

    flows.push({
      id: 'direct-dispatch',
      name: 'Sesiones directas',
      short: 'Sesiones directas',
      split: reposList.length > 1 ? 'por repo' : 'por tema',
      engine: 'claude / agy',
      accountId: orphanAgents[0]?.accountId || (accounts[0]?.id || '—'),
      repos: reposList.length ? reposList.join(', ') : 'despacho directo',
      roster: orphanRoster,
      defined: orphanAgents.length,
      turns: `${orphanAgents.length} turnos`,
      cost: Number((totalCost || 0).toFixed(2)),
      rate: orphanRoster.reduce((sum, r) => sum + (r.state === 'thinking' || r.state === 'tool' ? 120 : 0), 0),
      hooks: orphanAgents.length * 3,
      loops: [],
      links: [],
      status: hasBlocked ? 'bloqueado' : (hasLive ? 'activo' : 'en espera'),
    });
  }

  return flows;
}

/** @type {object[]} */
let liveFlows = [];
/** @param {object[]} flows */
export function setLiveFlows(flows) { liveFlows = Array.isArray(flows) ? flows : []; }
/** Coordinators, each with the full roster it opened. */
export function getFlows() {
  if (liveFlows.length > 0) return liveFlows;
  return synthesizeFlows(getAgents(), getConversations(), getAccounts());
}

/** @type {Record<string, any[]>} */
let liveThreads = {};
/** @param {Record<string, any[]>} threads */
export function setLiveThreads(threads) { liveThreads = threads || {}; }
/** Thread messages, keyed by agent id. Authors: boss | sub | user | sys | tool. */
export function getThread(agentId) { return liveThreads[agentId] || []; }

/** Author -> colour pair for the thread bubbles. */
export const AUTHORS = {
  boss: { color: 'var(--who-boss)', bg: 'var(--who-boss-bg)', align: 'flex-start' },
  sub: { color: 'var(--who-agent)', bg: 'var(--who-agent-bg)', align: 'flex-start' },
  user: { color: 'var(--who-mine)', bg: 'var(--who-mine-bg)', align: 'flex-end' },
  sys: { color: 'var(--who-system)', bg: 'var(--who-system-bg)', align: 'flex-start' },
  tool: { color: 'var(--who-tool)', bg: 'var(--who-tool-bg)', align: 'flex-start' },
};

export const ENGINE_MODELS = {
  claude: ['sonnet', 'opus', 'haiku', 'claude-sonnet-4-6', 'claude-opus-4-6'],
  agy: [
    'gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low',
    'gemini-3.7-flash-high', 'gemini-3.7-flash-medium', 'gemini-3.7-flash-low',
    'gemini-3.6-flash-high', 'gemini-3.1-pro-high', 'claude-sonnet-4-6',
    'claude-opus-4-6-thinking', 'gpt-oss-120b-medium',
  ],
};

export const ENGINE_EFFORTS = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  agy: ['low', 'medium', 'high'],
};

export const ENGINE_MODES = {
  claude: [
    { id: 'write', label: 'Escribe · worktree aparte' },
    { id: 'plan', label: 'Planifica · sin worktree' },
    { id: 'auto', label: 'Auto · autónomo' },
    { id: 'read', label: 'Sólo lee · sin worktree' },
  ],
  agy: [
    { id: 'write', label: 'Escribe · directo' },
    { id: 'plan', label: 'Planifica · plan mode' },
    { id: 'read', label: 'Sólo lee · hook' },
  ],
};

/** Engines. `hooks` is what the CLI really reports, which drives the degraded card. */
export function getEngines() {
  const claudeCfg = liveConfig?.engines?.claude;
  const agyCfg = liveConfig?.engines?.agy;
  return [
    {
      id: 'claude', name: claudeCfg?.name || 'claude cli',
      command: claudeCfg?.command || 'claude [--model <m>] [--effort <e>] [--permission-mode <p>] --settings <agente>/settings.json',
      hooks: claudeCfg?.hooks || 'full', hooksLabel: claudeCfg?.hooksLabel || 'hooks completos',
      contextCap: claudeCfg?.contextCap ? `${Math.round(claudeCfg.contextCap / 1000)}k` : '200k',
      warnAt: claudeCfg?.warnAtPercent ? `${claudeCfg.warnAtPercent}%` : '80%',
      branchPrefix: claudeCfg?.branchPrefix || 'claude/',
    },
    {
      id: 'agy', name: agyCfg?.name || 'agy cli',
      command: agyCfg?.command || 'agy [--model <m>] [--effort <e>] [--mode <p>] --add-dir <repo>',
      hooks: agyCfg?.hooks || 'partial', hooksLabel: agyCfg?.hooksLabel || 'hooks parciales · sin SessionStart ni Notification',
      contextCap: agyCfg?.contextCap ? `${Math.round(agyCfg.contextCap / 1000)}k` : '200k',
      warnAt: agyCfg?.warnAtPercent ? `${agyCfg.warnAtPercent}%` : '80%',
      branchPrefix: agyCfg?.branchPrefix || 'agy/',
    },
  ];
}

let liveSkills = null;
/** @param {any[]} skills */
export function setLiveSkills(skills) { liveSkills = Array.isArray(skills) ? skills : null; }

/** Skills installed per engine, read from each CLI's own skills directory. */
export function getEngineSkills() {
  if (liveSkills) return liveSkills;
  return [
    {
      engine: 'claude cli', color: 'var(--color-lilac)', path: '~/.claude/skills',
      installed: false, rows: [],
    },
    {
      engine: 'agy cli', color: 'var(--color-blue)', path: '~/.gemini/config/skills',
      installed: false, rows: [],
    },
    {
      engine: 'agy cli (builtin)', color: 'var(--color-blue)', path: '~/.gemini/antigravity-cli/builtin/skills',
      installed: false, rows: [],
    },
  ];
}

/** How a skill behaved inside one agent's session. */
export const SKILL_STATES = {
  usada: { color: 'var(--color-mint)', bg: 'var(--app-skill-used)' },
  cargada: { color: 'var(--color-lilac)', bg: 'var(--app-on-accent)' },
  disponible: { color: 'var(--color-dark-text-3)', bg: 'var(--color-dark-surface)' },
};

let liveAgentSkills = {};
/** @param {Record<string, any[]>} skills */
export function setLiveAgentSkills(skills) { liveAgentSkills = skills || {}; }
export function getAgentSkills(agentId) { return liveAgentSkills[agentId] || []; }

let liveConflicts = {};
/** @param {Record<string, string[]>} conflicts */
export function setLiveConflicts(conflicts) { liveConflicts = conflicts || {}; }
/** Files that clash with main. An agent cannot push until these are resolved. */
export function getConflicts() { return liveConflicts; }

let liveDiffs = {};
/** @param {Record<string, any>} diffs */
export function setLiveDiffs(diffs) { liveDiffs = diffs || {}; }
/**
 * Uncommitted work per agent, as the visualizer shows it.
 * `status` is where the work stands: sin commitear | commit sin empujar | con conflicto.
 */
export function getDiffs() { return liveDiffs; }

export const SERIES_NO_DATA_FROM = new Date().getHours() + 1;

let liveServerUsage = null;
/** @param {object} usage */
export function setLiveUsage(usage) { liveServerUsage = usage; }

let liveQuotas = null;
/** @param {object} quotas */
export function setLiveQuotas(quotas) { liveQuotas = quotas; }
export function getQuotas() { return liveQuotas; }

function fmtTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)} M`;
  if (n >= 1000) return `${Math.round(n / 1000)} k`;
  return `${n} `;
}

function fmtCost(c) {
  return `$${(c || 0).toFixed(2)}`;
}

/** The day's usage, per engine and per account. */
export function getUsage() {
  const agents = getAgents();

  let claudeTokens = liveServerUsage?.claude?.tokens ?? 0;
  let agyTokens = liveServerUsage?.agy?.tokens ?? 0;
  let claudeCost = liveServerUsage?.claude?.costUsd ?? 0;
  let agyCost = liveServerUsage?.agy?.costUsd ?? 0;

  if (!liveServerUsage) {
    for (const a of agents) {
      if (a.engine.includes('agy')) {
        agyTokens += (a.tokens || 0);
        agyCost += (a.costUsd || 0);
      } else {
        claudeTokens += (a.tokens || 0);
        claudeCost += (a.costUsd || 0);
      }
    }
  }

  const totalTokens = claudeTokens + agyTokens;
  const totalCost = claudeCost + agyCost;

  let rateClaude = 0;
  let rateAgy = 0;
  for (const a of agents) {
    if (a.state === 'thinking' || a.state === 'tool') {
      const mins = Math.max(0.2, (a.elapsed || 1) / 60);
      const r = Math.round((a.tokens || 0) / mins);
      if (a.engine.includes('agy')) rateAgy += r;
      else rateClaude += r;
    }
  }
  const rateTotal = rateClaude + rateAgy;

  let riskClaude = 0;
  let riskAgy = 0;
  for (const a of agents) {
    const pct = a.tokenCap > 0 ? (a.tokens / a.tokenCap) * 100 : 0;
    if (pct >= 85) {
      if (a.engine.includes('agy')) riskAgy++;
      else riskClaude++;
    }
  }

  const rawAccounts = getAccounts();
  const byAcc = new Map();
  for (const acc of rawAccounts) {
    const sAcc = liveServerUsage?.byAccount?.[acc.id];
    const sAllTime = liveServerUsage?.byAccountAllTime?.[acc.id];
    byAcc.set(acc.id, {
      tokens: sAcc?.tokens || 0,
      cost: sAcc?.costUsd || 0,
      claudeTokens: sAcc?.claudeTokens || 0,
      agyTokens: sAcc?.agyTokens || 0,
      allTimeTokens: sAllTime?.tokens || 0,
      allTimeCost: sAllTime?.costUsd || 0,
    });
  }
  if (!liveServerUsage) {
    for (const a of agents) {
      if (a.accountId && byAcc.has(a.accountId)) {
        const rec = byAcc.get(a.accountId);
        rec.tokens += (a.tokens || 0);
        rec.cost += (a.costUsd || 0);
        rec.allTimeTokens += (a.tokens || 0);
        rec.allTimeCost += (a.costUsd || 0);
        if (a.engine.includes('agy')) rec.agyTokens += (a.tokens || 0);
        else rec.claudeTokens += (a.tokens || 0);
      }
    }
  }

  const allTimeTotalTokens = liveServerUsage?.allTime?.total?.tokens || totalTokens;
  const accounts = rawAccounts.map((a) => {
    const rec = byAcc.get(a.id) || { tokens: 0, cost: 0, claudeTokens: 0, agyTokens: 0, allTimeTokens: 0, allTimeCost: 0 };
    const hasToday = rec.tokens > 0;
    const share = totalTokens > 0
      ? rec.tokens / totalTokens
      : (allTimeTotalTokens > 0 ? rec.allTimeTokens / allTimeTotalTokens : 0);
    const claudeShare = rec.tokens > 0
      ? rec.claudeTokens / rec.tokens
      : (rec.allTimeTokens > 0 ? (rec.claudeTokens / rec.allTimeTokens) : 0.5);
    return {
      name: a.name || a.id,
      color: a.color || 'var(--color-lilac)',
      tokens: fmtTokens(rec.tokens),
      cost: fmtCost(rec.cost),
      allTimeTokens: fmtTokens(rec.allTimeTokens),
      allTimeCost: fmtCost(rec.allTimeCost),
      hasToday,
      share,
      claude: fmtTokens(rec.claudeTokens),
      agy: fmtTokens(rec.agyTokens),
      claudeShare,
    };
  });

  let series = Array(24).fill(0);
  if (liveServerUsage?.series && Array.isArray(liveServerUsage.series) && liveServerUsage.series.length === 24) {
    series = liveServerUsage.series;
  } else if (totalTokens > 0) {
    const currentHour = new Date().getHours();
    series[currentHour] = Math.max(1, Math.round(totalTokens / 1000));
  }

  const claudeBudget = Math.min(1, claudeTokens / 1600000);
  const agyBudget = Math.min(1, agyTokens / 900000);

  return {
    today: {
      total: fmtTokens(totalTokens),
      claude: fmtTokens(claudeTokens),
      agy: fmtTokens(agyTokens),
    },
    cost: {
      total: fmtCost(totalCost),
      claude: fmtCost(claudeCost),
      agy: fmtCost(agyCost),
    },
    allTime: {
      total: fmtTokens(liveServerUsage?.allTime?.total?.tokens ?? totalTokens),
      cost: fmtCost(liveServerUsage?.allTime?.total?.costUsd ?? totalCost),
      claude: fmtTokens(liveServerUsage?.allTime?.claude?.tokens ?? claudeTokens),
      agy: fmtTokens(liveServerUsage?.allTime?.agy?.tokens ?? agyTokens),
    },
    rate: {
      total: rateTotal,
      claude: rateClaude,
      agy: rateAgy,
    },
    risk: {
      total: String(riskClaude + riskAgy),
      claude: String(riskClaude),
      agy: String(riskAgy),
    },
    series,
    budgets: [
      { engine: 'claude cli', used: claudeBudget, cap: '1.6 M', color: 'var(--color-lilac)' },
      { engine: 'agy cli', used: agyBudget, cap: '900 k', color: 'var(--color-blue)' },
    ],
    accounts,
  };

}

/** Mismatches: repo sits under one account's folder, git config says the other. */
export function getMismatches() {
  const repos = getRepos();
  const accounts = getAccounts();
  return repos.filter((r) => r.mismatch).map((r) => {
    const acc = accounts.find((a) => a.id === r.accountId);
    return {
      repo: r.name,
      detail: `${r.path} → ${r.email || '(sin email)'}`,
      fix: acc?.name || r.accountId,
    };
  });
}

export function getScanSummary() {
  const repos = getRepos();
  const accounts = getAccounts();
  const totalFolders = accounts.reduce((acc, a) => acc + (a.folders?.length || 0), 0);
  const dirtyCount = repos.filter((r) => r.dirty).length;
  const noRemoteCount = repos.filter((r) => r.noRemote).length;
  const mismatchedCount = repos.filter((r) => r.mismatch).length;
  return {
    folders: totalFolders,
    repos: repos.length,
    dirty: dirtyCount,
    noRemote: noRemoteCount,
    mismatched: mismatchedCount,
    when: repos.length ? 'escaneo en vivo' : 'sin escaneo',
    took: '—',
  };
}

let liveScanCandidates = [];
/** @param {any[]} candidates */
export function setLiveScanCandidates(candidates) { liveScanCandidates = Array.isArray(candidates) ? candidates : []; }
export function getScanCandidates() { return liveScanCandidates; }

let liveTimeline = null;
/** @param {object} tl */
export function setLiveTimeline(tl) { liveTimeline = tl; }

/** Timeline: one lane per agent, bars are state runs inside the window. */
export function getTimeline() {
  if (liveTimeline && Array.isArray(liveTimeline.lanes) && liveTimeline.lanes.length > 0) {
    return liveTimeline;
  }
  const agents = getAgents();
  if (agents.length === 0) {
    return { window: 'sesión actual', ticks: ['-30m', '-20m', '-10m', 'ahora'], lanes: [] };
  }
  return {
    window: 'sesión actual',
    ticks: ['-30m', '-20m', '-10m', 'ahora'],
    lanes: agents.map((a) => {
      const isLive = LIVE.includes(a.state);
      return {
        agent: a.id,
        bars: [[a.state || 'thinking', isLive ? 20 : 0, isLive ? 80 : 100]],
      };
    }),
  };
}

let liveConfig = null;
/** @param {Record<string, any>} config */
export function setLiveConfig(config) { liveConfig = config; }
export function getLiveConfig() { return liveConfig; }
export function updateLiveConfigKey(section, key, value) {
  if (!liveConfig) liveConfig = {};
  if (!liveConfig[section]) liveConfig[section] = {};
  liveConfig[section][key] = value;
}

export function getSummary() {
  const agents = getAgents();
  const maxParallel = Number(liveConfig?.exec?.maxParallel) || 5;
  return {
    repos: getRepos().length,
    accounts: getAccounts().length,
    coordinators: getFlows().filter((f) => f.status !== 'archivado').length,
    running: agents.filter((a) => a.state === 'thinking' || a.state === 'tool').length,
    maxParallel,
    blocked: agents.filter((a) => a.state === 'blocked').length,
    queued: 0,
  };
}

/** Settings shown in the config tabs, grouped exactly as the design groups them. */
export function getSettings() {
  const c = liveConfig?.coordinators || {};
  const e = liveConfig?.exec || {};
  const d = liveConfig?.deliver || {};
  const p = liveConfig?.perf || {};
  const a = liveConfig?.advanced || {};

  return {
    coordinators: [
      ['Sesiones que puede abrir', String(c.maxSessionsPerCoordinator ?? 3), 'coordinators', 'maxSessionsPerCoordinator'],
      ['Motor por defecto', c.defaultEngine ?? 'claude cli', 'coordinators', 'defaultEngine'],
      ['Preguntar antes de abrir sesiones', c.askBeforeSpawning ?? false, 'coordinators', 'askBeforeSpawning'],
      ['Permitir enlaces entre agentes', c.allowAgentLinks ?? false, 'coordinators', 'allowAgentLinks'],
      ['Reutilizar coordinador del mismo repo', c.reuseCoordinatorSameRepo ?? true, 'coordinators', 'reuseCoordinatorSameRepo'],
      ['Reportar al coordinador cada', c.reportInterval ?? 'herramienta', 'coordinators', 'reportInterval'],
      ['Archivar al entregar', c.archiveOnDeliver ?? true, 'coordinators', 'archiveOnDeliver'],
      ['Cerrar agentes idle tras', `${c.idleTimeoutMinutes ?? 15} min`, 'coordinators', 'idleTimeoutMinutes'],
    ],
    exec: [
      ['Sesiones en paralelo', String(e.maxParallel ?? 5), 'exec', 'maxParallel'],
      ['Marcar bloqueado sin avance', `${e.blockedTimeoutMinutes ?? 5} min`, 'exec', 'blockedTimeoutMinutes'],
      ['Pedir aprobación para push', e.requirePushApproval ?? true, 'exec', 'requirePushApproval'],
      ['Pedir aprobación para bash', e.requireBashApproval ?? true, 'exec', 'requireBashApproval'],
      ['Auto-aprobar lecturas', e.autoApproveReads ?? true, 'exec', 'autoApproveReads'],
    ],
    deliver: [
      ['PR siempre en borrador', d.draftPR ?? true, 'deliver', 'draftPR'],
      ['Bloquear push a main', d.blockPushToMain ?? true, 'deliver', 'blockPushToMain'],
      ['Adjuntar reporte al PR', d.attachReportToPR ?? true, 'deliver', 'attachReportToPR'],
      ['Un PR por repo', d.singlePRPerRepo ?? true, 'deliver', 'singlePRPerRepo'],
      ['Título del PR', d.prTitleTemplate ?? '<tipo>: <tarea>', 'deliver', 'prTitleTemplate'],
    ],
    perf: [
      ['Terminales montadas a la vez', String(p.maxMountedTerminals ?? 1), 'perf', 'maxMountedTerminals'],
      ['Scrollback por terminal', `${p.terminalScrollbackLines ?? 2000} líneas`, 'perf', 'terminalScrollbackLines'],
      ['Refresco de tarjetas', `${(p.cardRefreshIntervalMs ?? 1000) / 1000} s`, 'perf', 'cardRefreshIntervalMs'],
      ['Animaciones de estado', p.statusAnimations ?? true, 'perf', 'statusAnimations'],
      ['Ventana del timeline', `${p.timelineWindowMinutes ?? 30} min`, 'perf', 'timelineWindowMinutes'],
      ['Rotar el registro de eventos', `${p.eventLogRotationMb ?? 50} MB`, 'perf', 'eventLogRotationMb'],
    ],
    advanced: [
      ['Directorio del harness', a.harnessDir ?? '~/.cute-agents-desk', 'advanced', 'harnessDir'],
      ['Worktrees fuera del repo', a.worktreesOutsideRepo ?? true, 'advanced', 'worktreesOutsideRepo'],
      ['Sanear variables CLAUDE* al lanzar', a.sanitizeClaudeEnv ?? true, 'advanced', 'sanitizeClaudeEnv'],
      ['Aislar la configuración del agente', a.isolateAgentConfig ?? true, 'advanced', 'isolateAgentConfig'],
      ['Serializar operaciones remotas', a.serializeRemoteOps ?? true, 'advanced', 'serializeRemoteOps'],
      ['Reconciliar procesos al arrancar', a.reconcileOnStartup ?? true, 'advanced', 'reconcileOnStartup'],
      ['Protocolo de ventana', a.windowProtocol ?? 'app://desk', 'advanced', 'windowProtocol'],
      ['Instancia única de Electron', a.singleInstance ?? true, 'advanced', 'singleInstance'],
    ],
  };
}

export function getTerminalLines() {
  return [];
}
