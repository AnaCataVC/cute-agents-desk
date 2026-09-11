// @ts-check
/**
 * Shell: state, the five tabs, and one delegated event handler.
 *
 * Components are pure `render(state, data) -> html` functions. Interaction happens through
 * `data-act` attributes, dispatched here — so a re-render never has to rebind anything,
 * which is what keeps a full repaint cheap enough to do on every state change.
 */

import * as data from './data.js';
import { renderSidebar } from './sidebar.js';
import { renderRepoTree } from './repo-tree.js';
import { renderAgentPanel } from './agent-card.js';
import { renderFlows } from './boss-graph.js';
import { renderEditor } from './editor.js';
import { renderUsage } from './tokens-view.js';
import { renderConfig } from './config.js';
import { renderDialogs } from './dialogs.js';

/** @type {Record<string, any>} */
const state = {
  view: 'dispatch',            // dispatch | flows | editor | usage | config
  flowView: 'detail',          // detail | compact
  cfgTab: 'accounts',
  open: {},                     // repo tree, expanded nodes
  filtersOpen: false,
  accFilter: 'all',
  stFilter: 'any',
  search: '',
  flowQuery: '',
  accFlow: 'all',
  showArch: false,
  tip: null,                   // `${flowId}|${agentId}` of the picked graph node
  ideOpen: [],                 // open editor tabs, as `${agentId}:${path}`
  ideActive: null,
  diffMode: 'sbs',             // sbs | uni
  treeClosed: {},              // collapsed groups in the editor's change tree
  terminal: null,              // agent id whose terminal is mounted, or null
  chat: null,                  // agent id whose panel is open
  chatTab: 'hilo',             // ficha | hilo | diff, within that panel
  queue: null,                 // repo name being queued, or '' for "pick a repo"
  scan: null,                  // account id the add-folder dialog belongs to
  scanDepth: 2,
  newConvOpen: false,          // the sidebar's "+ nueva conversación" inline form
  newConvTitle: '',
  newConvTopic: '',
  tick: 0,
};

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

/** Actions, keyed by the `data-act` value. Each one mutates state; render() follows. */
const ACTIONS = {
  view: (v) => { state.view = v; },
  flowView: (v) => { state.flowView = v; },
  cfgTab: (v) => { state.cfgTab = v; },
  toggleNode: (key) => { state.open[key] = !state.open[key]; },
  toggleFilters: () => { state.filtersOpen = !state.filtersOpen; },
  accFilter: (v) => { state.accFilter = v; },
  stFilter: (v) => { state.stFilter = v; },
  clearFilters: () => { state.accFilter = 'all'; state.stFilter = 'any'; state.search = ''; },
  accFlow: (v) => { state.accFlow = v; },
  showArch: () => { state.showArch = !state.showArch; },
  // A second click on the same node closes the tooltip, so it needs no close button.
  tip: (v) => { state.tip = state.tip === v ? null : v; },
  toggleTreeNode: (key) => { state.treeClosed[key] = !state.treeClosed[key]; },
  openFile: (id) => {
    if (!state.ideOpen.includes(id)) state.ideOpen.push(id);
    state.ideActive = id;
  },
  closeFile: (id) => {
    state.ideOpen = state.ideOpen.filter((t) => t !== id);
    if (state.ideActive === id) state.ideActive = state.ideOpen[state.ideOpen.length - 1] || null;
  },
  diffMode: (v) => { state.diffMode = v; },
  openTerminal: (id) => { state.terminal = id || 'perf-tiles'; },
  closeTerminal: () => { state.terminal = null; },
  openChat: (id) => { state.chat = id; state.chatTab = 'hilo'; state.tip = null; },
  closeChat: () => { state.chat = null; },
  chatTab: (v) => { state.chatTab = v; },
  /** Same file-opening path as the Editor tab's tree, reached from the chat panel's Diff sub-tab. */
  openDiffFile: (id) => {
    state.view = 'editor';
    state.chat = null;
    if (!state.ideOpen.includes(id)) state.ideOpen.push(id);
    state.ideActive = id;
  },
  openQueue: (repo) => { state.queue = repo ?? ''; },
  closeQueue: () => { state.queue = null; },
  openScan: (accountId) => { state.scan = accountId; },
  closeScan: () => { state.scan = null; },
  scanDepth: (d) => { state.scanDepth = Number(d); },

  toggleNewConversation: () => {
    state.newConvOpen = !state.newConvOpen;
    state.newConvTitle = '';
    state.newConvTopic = '';
  },
  /** Creates the conversation, then refetches the list -- there is no live push for it yet. */
  newConversation: () => {
    const title = (state.newConvTitle || '').trim();
    if (!title) return;
    const topic = (state.newConvTopic || '').trim();
    state.newConvOpen = false;
    window.desk?.createConversation?.({ title, topic: topic || undefined })
      .then(() => window.desk.conversations())
      .then((conversations) => { data.setLiveConversations(conversations); render(); });
  },
  /** Fire-and-forget: the coordinator's own card shows up once it reports in, like any agent. */
  openCoordinator: (conversationId) => { window.desk?.spawnCoordinator?.({ conversationId }); },
  // Declared but inert until the main process owns them: archiving and closing sessions are
  // its calls, not the window's.
  archive: () => {},
  closeIdle: () => {},

  /** Manual reap, per the plan: never automatic, so losing an agent's uncommitted work is never
   * a side effect of something else finishing. The IPC handler itself refuses a still-live agent. */
  reapWorktree: (agentId) => {
    window.desk?.reapWorktree?.(agentId)
      .then(() => window.desk.worktrees())
      .then((worktrees) => { data.setLiveWorktrees(worktrees); render(); });
  },

  /** Phase 1: one real agent on the toy repo, which is what the whole plumbing is proving. */
  spawnTest: async () => {
    await window.desk.spawn({
      task: 'Lee el README y agrega una linea al final que diga la hora actual. Nada mas.',
    });
  },
  stopAgent: (id) => window.desk.stop(id),
};

app.addEventListener('click', (ev) => {
  const target = /** @type {HTMLElement} */ (ev.target);
  const el = /** @type {HTMLElement|null} */ (target.closest('[data-act]'));
  if (!el) return;
  // A dialog backdrop carries a close action, but a click *inside* the dialog must not close it.
  if (el.hasAttribute('data-backdrop') && target !== el) return;
  const act = ACTIONS[el.dataset.act || ''];
  if (!act) return;
  ev.preventDefault();
  act(el.dataset.arg);
  render();
});

app.addEventListener('input', (ev) => {
  const el = /** @type {HTMLInputElement} */ (ev.target);
  if (el.dataset.act === 'search') { state.search = el.value; render(); }
  if (el.dataset.act === 'flowQuery') { state.flowQuery = el.value; render(); }
  if (el.dataset.act === 'newConvTitle') { state.newConvTitle = el.value; }
  if (el.dataset.act === 'newConvTopic') { state.newConvTopic = el.value; }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  // One key closes whatever is on top, innermost first.
  if (state.chat) state.chat = null;
  else if (state.queue !== null) state.queue = null;
  else if (state.scan) state.scan = null;
  else if (state.tip) state.tip = null;
  else if (state.terminal) state.terminal = null;
  else if (state.newConvOpen) state.newConvOpen = false;
  else return;
  render();
});

const TABS = [
  ['dispatch', 'Control de agentes'], ['flows', 'Flujos de trabajo'], ['editor', 'Editor'],
  ['usage', 'Uso'], ['config', 'Configuración'],
];

function header() {
  const s = data.getSummary();
  const u = data.getUsage();
  const accounts = data.getAccounts().map((a) => `
    <div style="display:flex;align-items:center;gap:7px">
      <span style="width:9px;height:9px;border-radius:2px;background:${a.color}"></span>
      <span style="font:500 11px var(--font-body,Inter);color:var(--color-dark-text-2)">${a.name} · ${a.folders[0].path}</span>
    </div>`).join('');

  return `
  <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px">
    <div class="font-display" style="font-size:17px;font-weight:600;white-space:nowrap">
      Cute Agents <span style="color:var(--color-lilac)">Desk</span>
    </div>
    <div role="tablist" style="display:flex;gap:2px;flex:none;background:var(--color-dark-bg);
         padding:3px;border-radius:var(--radius-full);border:1px solid var(--color-dark-border)">
      ${TABS.map(([id, label]) => `<button class="tab" role="tab" aria-selected="${state.view === id}"
        data-act="view" data-arg="${id}">${label}</button>`).join('')}
    </div>
    <div class="mono" style="font-size:11px;color:var(--color-dark-text-3);min-width:0;flex:1 1 auto">
      ${s.repos} repos · ${s.accounts} cuentas · ${s.coordinators} coordinadores ·
      ${s.running} de ${s.maxParallel} sesiones · ${s.blocked} bloqueada · ${s.queued} en cola ·
      <span style="color:var(--color-dark-text-2)">${u.today.total} tokens · ${u.cost.total}</span>
    </div>
    <div style="display:flex;align-items:center;gap:14px;margin-left:auto;flex:none">${accounts}</div>
  </div>`;
}

function dispatch() {
  return `
  <div style="display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start">
    ${renderRepoTree(state, data)}
    ${renderAgentPanel(state, data)}
  </div>`;
}

const VIEWS = {
  dispatch,
  flows: () => renderFlows(state, data),
  editor: () => renderEditor(state, data),
  usage: () => renderUsage(state, data),
  config: () => renderConfig(state, data),
};

/**
 * A full repaint replaces the focused element, so typing would lose focus and caret on every
 * keystroke — and once the SSE stream repaints on each hook event, on every event too. The
 * fields are identified by their `data-act`, which is unique per field and survives the repaint.
 */
function keepFocus(paint) {
  const active = /** @type {HTMLInputElement|null} */ (document.activeElement);
  const act = active && active.dataset ? active.dataset.act : null;
  const caret = act ? active.selectionStart : null;

  paint();

  if (!act) return;
  const next = /** @type {HTMLInputElement|null} */ (app.querySelector(`[data-act="${act}"]`));
  if (!next) return;
  next.focus();
  if (caret !== null && next.setSelectionRange) next.setSelectionRange(caret, caret);
}

function render() {
  keepFocus(() => paint());
}

function paint() {
  app.innerHTML = `
    <div style="display:flex;align-items:flex-start">
      ${renderSidebar(state, data)}
      <div style="flex:1;min-width:0;max-width:1440px;margin:0 auto;padding:22px 26px 40px">
        ${header()}
        ${(VIEWS[state.view] || dispatch)()}
      </div>
    </div>
    ${renderDialogs(state, data)}`;
}

/**
 * The live channel. Present only inside the app: served over plain http (or opened as a file)
 * the same `ui/` still runs, on the mock data, which is how the design gets reviewed without
 * spawning anything.
 */
if (window.desk?.isDesk) {
  window.desk.subscribe((patch) => {
    if (patch.agents) data.setLiveAgents(patch.agents);
    if (patch.output) data.pushOutput(patch.output.id, patch.output.chunk);
    render();
  });
  window.desk.agents().then((agents) => {
    if (agents.length) { data.setLiveAgents(agents); render(); }
  });
  // Scanned once on load, same as the agent list -- the tree does not need to re-scan on every
  // repaint, only when a folder is added or removed from Configuracion (phase 2+).
  window.desk.repos().then((repoData) => { data.setLiveRepoData(repoData); render(); });
  window.desk.conversations().then((conversations) => { data.setLiveConversations(conversations); render(); });
  window.desk.worktrees().then((worktrees) => { data.setLiveWorktrees(worktrees); render(); });
}

// The clock the artboard runs: elapsed times and the live rate tick without touching anything else.
setInterval(() => {
  state.tick++;
  if (state.view === 'dispatch' || state.view === 'usage') render();
}, 1000);

render();
