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

/** @type {object[]|null} null until the first scan of the external schedulers comes back;
 * distinct from "scanned, found none" for the same reason liveAccounts/liveRepos use null. */
let liveScheduledTasks = null;
/** @param {object[]} tasks */
export function setLiveScheduledTasks(tasks) { liveScheduledTasks = tasks; }
export function getScheduledTasks() { return liveScheduledTasks ?? []; }

/** @returns {{name:string, index:number, accountId:string, folder:string, dirty:boolean, noRemote:boolean}[]} */
export function getRepos() {
  if (!liveRepos) return [];
  return liveRepos.map((r, i) => ({
    name: r.name,
    index: i,
    accountId: r.accountGh,
    folder: r.folder,
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
    tokenCap: CONTEXT_CAP,
    elapsed: a.elapsed || 0,
    boss: a.role === 'coordinator' ? 'coordinador de esta conversación' : (a.replyTo || 'sin coordinador'),
    tool: a.tool || '',
    messages: 0,
    ring: true,
    live: true,
    costUsd: a.costUsd || 0,
    task: a.task,
    model: a.model,
    effort: a.effort,
    mode: a.mode || 'write',
  };
}

/** Agents shown as cards on the dispatch tab. `ctxPct` is what the ring fills. */
export function getAgents() { return liveAgents.map(fromLive); }

let liveDelivered = [];
export function setLiveDelivered(list) { liveDelivered = Array.isArray(list) ? list : []; }

/** @type {() => object[]} tasks with a merged/drafted PR -- delivered tasks */
export function getDelivered() { return liveDelivered; }

const agent = (id, repo, branch, accountId, state, tokens) => ({
  id, repo, branch, accountId, state, tokens, ctxPct: Math.round(tokens / CONTEXT_CAP * 100),
});

/** @type {object[]} */
let liveFlows = [];
/** @param {object[]} flows */
export function setLiveFlows(flows) { liveFlows = Array.isArray(flows) ? flows : []; }
/** Coordinators, each with the full roster it opened. */
export function getFlows() { return liveFlows; }

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
  return [
    {
      id: 'claude', name: 'claude cli',
      command: 'claude [--model <m>] [--effort <e>] [--permission-mode <p>] --settings <agente>/settings.json',
      hooks: 'full', hooksLabel: 'hooks completos',
      contextCap: '200k', warnAt: '85%', branchPrefix: 'claude/',
    },
    {
      id: 'agy', name: 'agy cli',
      command: 'agy [--model <m>] [--effort <e>] [--mode <p>] --add-dir <repo>',
      hooks: 'partial', hooksLabel: 'hooks parciales · sin SessionStart ni Notification',
      contextCap: '200k', warnAt: '85%', branchPrefix: 'agy/',
    },
  ];
}

/** Skills installed per engine, read from each CLI's own skills directory. */
export function getEngineSkills() {
  return [
    {
      engine: 'claude cli', color: 'var(--color-lilac)', path: '~/.claude/skills',
      rows: [
        ['dwh-designer', 'diseño y gobierno de tablas BigQuery', 'v3', 'siempre'],
        ['sql-queries', 'SQL por dialecto desde lenguaje natural', 'v2', 'siempre'],
        ['dashboard-finder', 'catálogo de reportes y dashboards', 'v1', 'siempre'],
        ['read-pdf', 'lectura y extracción de PDF', 'v4', 'a demanda'],
        ['pastel-tech-ds', 'sistema de diseño de la marca', 'v1', 'a demanda'],
      ],
    },
    {
      engine: 'agy cli', color: 'var(--color-blue)', path: '~/.agy/skills',
      rows: [
        ['dwh-designer', 'diseño y gobierno de tablas BigQuery', 'v3', 'siempre'],
        ['sql-queries', 'SQL por dialecto desde lenguaje natural', 'v2', 'siempre'],
        ['automatizaciones-query', 'consulta del catastro de flows', 'v2', 'a demanda'],
        ['glossary-entry', 'entradas del glosario de negocio', 'v1', 'a demanda'],
      ],
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
 * Uncommitted work per agent, as the editor shows it.
 * `status` is where the work stands: sin commitear | commit sin empujar | con conflicto.
 */
export function getDiffs() { return liveDiffs; }

export const SERIES_NO_DATA_FROM = 0;

/** The day's usage, per engine and per account. */
export function getUsage() {
  const accounts = getAccounts().map((a) => ({
    name: a.name || a.id,
    color: a.color || 'var(--color-lilac)',
    tokens: '0 k',
    cost: '$0.00',
    share: 0,
    claude: '0 k',
    agy: '0 k',
    claudeShare: 0,
  }));
  return {
    today: { total: '0 k', claude: '0 k', agy: '0 k' },
    cost: { total: '$0.00', claude: '$0.00', agy: '$0.00' },
    rate: { total: 0, claude: 0, agy: 0 },
    risk: { total: '0', claude: '0', agy: '0' },
    series: Array(24).fill(0),
    budgets: [
      { engine: 'claude cli', used: 0, cap: '1.6 M', color: 'var(--color-lilac)' },
      { engine: 'agy cli', used: 0, cap: '900 k', color: 'var(--color-blue)' },
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

/** Timeline: one lane per agent, bars are state runs inside the window. */
export function getTimeline() {
  return {
    window: 'sesión actual',
    ticks: [],
    lanes: [],
  };
}

export function getSummary() {
  const agents = getAgents();
  return {
    repos: getRepos().length,
    accounts: getAccounts().length,
    coordinators: getFlows().filter((f) => f.status !== 'archivado').length,
    running: agents.filter((a) => a.state === 'thinking' || a.state === 'tool').length,
    maxParallel: 5,
    blocked: agents.filter((a) => a.state === 'blocked').length,
    queued: 0,
  };
}

/** Settings shown in the config tabs, grouped exactly as the design groups them. */
export function getSettings() {
  return {
    coordinators: [
      ['Sesiones que puede abrir', '3'],
      ['Motor por defecto', 'claude cli'],
      ['Preguntar antes de abrir sesiones', false],
      ['Permitir enlaces entre agentes', false],
      ['Reutilizar coordinador del mismo repo', true],
      ['Reportar al coordinador cada', 'herramienta'],
      ['Archivar al entregar', true],
      ['Cerrar agentes idle tras', '15 min'],
    ],
    exec: [
      ['Sesiones en paralelo', '5'],
      ['Marcar bloqueado sin avance', '5 min'],
      ['Pedir aprobación para push', true],
      ['Pedir aprobación para bash', true],
      ['Auto-aprobar lecturas', true],
    ],
    deliver: [
      ['PR siempre en borrador', true],
      ['Bloquear push a main', true],
      ['Adjuntar reporte al PR', true],
      ['Un PR por repo', true],
      ['Título del PR', '<tipo>: <tarea>'],
    ],
    perf: [
      ['Terminales montadas a la vez', '1'],
      ['Scrollback por terminal', '2000 líneas'],
      ['Refresco de tarjetas', '1 s'],
      ['Animaciones de estado', true],
      ['Ventana del timeline', '30 min'],
      ['Rotar el registro de eventos', '50 MB'],
    ],
    advanced: [
      ['Directorio del harness', '~/.cute-agents-desk'],
      ['Worktrees fuera del repo', true],
      ['Sanear variables CLAUDE* al lanzar', true],
      ['Aislar la configuración del agente', true],
      ['Serializar operaciones remotas', true],
      ['Reconciliar procesos al arrancar', true],
      ['Puerto del panel', '4321'],
      ['Token del panel por corrida', true],
    ],
  };
}

export function getTerminalLines() {
  return [];
}
