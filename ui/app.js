// @ts-check
/**
 * Shell: state, the six tabs, and one delegated event handler.
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
import { renderScheduledTasks } from './scheduled-tasks-view.js';
import { renderConfig } from './config.js';
import { renderDialogs } from './dialogs.js';
import { esc } from './esc.js';

/** @type {Record<string, any>} */
const state = {
  view: 'dispatch',            // dispatch | flows | editor | usage | scheduled | config
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
  queueRepo: '',
  queueTask: '',
  queueEngine: 'claude',
  queueModel: 'default',
  queueEffort: 'default',
  queueMode: 'write',
  queueCoord: '',
  scan: null,                  // account id the add-folder dialog belongs to
  scanDepth: 2,
  scanPath: '',
  scanError: null,
  loading: Boolean(window.desk?.isDesk),
  newConvOpen: false,          // the sidebar's "+ nueva conversación" inline form
  newConvTitle: '',
  newConvTopic: '',
  tick: 0,
  error: null,                 // last IPC refusal (scheduler cap, still-alive agent, ...), or null
  inspectedSkill: null,        // data for currently inspected skill in dialog
  inspectedTask: null,         // data for currently inspected scheduled task in dialog
  chatInput: '',               // active input text in chat modal
};

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

/** Actions, keyed by the `data-act` value. Each one mutates state; render() follows. */
const ACTIONS = {
  view: (v) => {
    state.view = v;
    if (v === 'usage' && window.desk?.quotas) {
      window.desk.quotas().then((q) => { if (q) { data.setLiveQuotas(q); render(); } });
    }
  },
  refreshQuotas: () => {
    if (window.desk?.quotas) {
      window.desk.quotas({ forceRefresh: true }).then((q) => { if (q) { data.setLiveQuotas(q); render(); } });
    }
  },
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
  openTerminal: (id) => { state.terminal = id || null; },
  closeTerminal: () => { state.terminal = null; },
  openChat: (id) => { state.chat = id; state.chatTab = 'hilo'; state.tip = null; state.chatInput = ''; },
  closeChat: () => { state.chat = null; state.chatInput = ''; },
  chatTab: (v) => { state.chatTab = v; },
  submitChat: async (agentId) => {
    const text = (state.chatInput || '').trim();
    if (!text || !agentId) return;
    state.chatInput = '';
    render();
    if (window.desk?.sendInput) {
      const res = await window.desk.sendInput({ agentId, text });
      if (res?.error) {
        state.error = res.error;
        render();
      }
    }
  },
  /** Same file-opening path as the Editor tab's tree, reached from the chat panel's Diff sub-tab. */
  openDiffFile: (id) => {
    state.view = 'editor';
    state.chat = null;
    if (!state.ideOpen.includes(id)) state.ideOpen.push(id);
    state.ideActive = id;
  },
  openQueue: (repo) => {
    state.queue = repo ?? '';
    state.queueRepo = repo ?? '';
    state.queueTask = '';
    state.queueEngine = 'claude';
    state.queueModel = 'default';
    state.queueEffort = 'default';
    state.queueMode = 'write';
    state.queueCoord = '';
  },
  closeQueue: () => { state.queue = null; },
  queueMode: (m) => { state.queueMode = m || 'write'; },
  submitQueue: async () => {
    const task = (state.queueTask || '').trim();
    if (!task) return;
    const repos = data.getRepos();
    const repoIdentifier = state.queueRepo || state.queue;
    const repo = repos.find((r) => r.path === repoIdentifier || r.name === repoIdentifier);
    const cwd = repo ? (repo.path || (repo.folder ? `${repo.folder}/${repo.name}` : repo.name)) : undefined;
    const model = (state.queueModel && state.queueModel !== 'default') ? state.queueModel.trim() : undefined;
    const effort = (state.queueEffort && state.queueEffort !== 'default') ? state.queueEffort.trim() : undefined;

    const result = await window.desk?.spawn?.({
      cwd,
      task,
      bin: state.queueEngine,
      model,
      effort,
      mode: state.queueMode,
      conversationId: state.queueCoord || undefined,
    });

    if (result?.error) {
      state.error = result.error;
    } else {
      state.queue = null;
      state.queueTask = '';
    }
    render();
  },
  openScan: (accountId) => {
    state.scan = accountId;
    state.scanPath = '';
    state.scanDepth = 2;
    state.scanError = null;
  },
  closeScan: () => {
    state.scan = null;
    state.scanPath = '';
    state.scanError = null;
  },
  scanDepth: (d) => { state.scanDepth = Number(d); },
  browseScanFolder: async () => {
    if (window.desk?.pickDirectory) {
      const folder = await window.desk.pickDirectory();
      if (folder) {
        state.scanPath = folder;
        state.scanError = null;
        render();
      }
    }
  },
  submitScanFolder: async () => {
    const folderPath = (state.scanPath || '').trim();
    if (!folderPath) {
      state.scanError = 'Ingresa o selecciona una ruta de carpeta';
      render();
      return;
    }
    if (!state.scan) return;
    if (window.desk?.addAccountFolder) {
      const res = await window.desk.addAccountFolder({
        accountId: state.scan,
        folderPath,
        depth: state.scanDepth || 2,
      });
      if (res?.error) {
        state.scanError = res.error;
        render();
        return;
      }
      if (res?.repoData) {
        data.setLiveRepoData(res.repoData);
      }
    }
    state.scan = null;
    state.scanPath = '';
    state.scanError = null;
    render();
  },
  removeFolder: async (arg) => {
    if (!arg) return;
    const [accountId, folderPath] = arg.split('|');
    if (!accountId || !folderPath) return;
    if (window.desk?.removeAccountFolder) {
      const res = await window.desk.removeAccountFolder({ accountId, folderPath });
      if (res?.error) {
        state.error = res.error;
        render();
        return;
      }
      if (res?.repoData) {
        data.setLiveRepoData(res.repoData);
        render();
      }
    }
  },

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
      .then((created) => {
        if (created?.id) {
          window.desk?.spawnCoordinator?.({ conversationId: created.id });
        }
        return window.desk.conversations();
      })
      .then((conversations) => { data.setLiveConversations(conversations); render(); });
  },
  dismissError: () => { state.error = null; },

  /** The coordinator's own card shows up once it reports in, like any agent -- a rejection
   * (scheduler cap full) is the one outcome worth telling the user about right away. */
  openCoordinator: (conversationId) => {
    window.desk?.spawnCoordinator?.({ conversationId }).then((result) => {
      if (result?.error) { state.error = result.error; render(); }
    });
  },
  archive: (conversationId) => {
    if (!conversationId) return;
    window.desk?.archiveConversation?.(conversationId).then((res) => {
      if (res?.error) { state.error = res.error; render(); return; }
      return window.desk.conversations().then((conversations) => {
        data.setLiveConversations(conversations);
        render();
      });
    });
  },
  closeIdle: (flowId) => {
    const agents = data.getAgents();
    for (const a of agents) {
      if ((a.conversationId === flowId || a.boss?.includes(flowId)) && (a.state === 'idle' || a.state === 'done')) {
        window.desk?.stop?.(a.id);
      }
    }
  },

  /** Manual reap, per the plan: never automatic, so losing an agent's uncommitted work is never
   * a side effect of something else finishing. The IPC handler itself refuses a still-live agent. */
  reapWorktree: (agentId) => {
    window.desk?.reapWorktree?.(agentId).then((result) => {
      if (result?.error) { state.error = result.error; render(); return; }
      return window.desk.worktrees().then((worktrees) => { data.setLiveWorktrees(worktrees); render(); });
    });
  },

  /** Batch reap of clean or delivered inactive worktrees. */
  reapCleanWorktrees: () => {
    window.desk?.reapCleanWorktrees?.().then((res) => {
      if (res?.error) {
        state.error = res.error;
        render();
        return;
      }
      const reaped = res?.totalReaped || 0;
      const skipped = (res?.skipped || []).length;
      state.reapFeedback = `Se podaron ${reaped} worktrees (${skipped} conservados por cambios o actividad)`;
      window.desk.worktrees().then((worktrees) => {
        data.setLiveWorktrees(worktrees);
        render();
      });
    });
  },

  /** One real agent on the toy repo, proving the plumbing works end-to-end. */
  spawnTest: async () => {
    const result = await window.desk.spawn({
      task: 'Lee el README y agrega una linea al final que diga la hora actual. Nada mas.',
    });
    if (result?.error) { state.error = result.error; render(); }
  },
  stopAgent: (id) => window.desk.stop(id),
  refreshSkills: () => {
    window.desk?.skills?.().then((skills) => { data.setLiveSkills(skills); render(); });
  },

  /** Deliver an agent's work as a branch + draft PR. */
  deliverAgent: async (agentId) => {
    if (!window.desk?.deliver || !agentId) return;
    state.error = null;
    render();
    try {
      const res = await window.desk.deliver({ agentId });
      if (!res.ok) {
        state.error = res.error || 'Error al entregar la tarea';
      } else {
        const [delivered, worktrees] = await Promise.all([
          window.desk.delivered(),
          window.desk.worktrees(),
        ]);
        data.setLiveDelivered(delivered);
        data.setLiveWorktrees(worktrees);
      }
    } catch (err) {
      state.error = err.message || String(err);
    }
    render();
  },
  setAccountColor: async (arg) => {
    if (!arg) return;
    const [accountId, color] = arg.split('|');
    if (!accountId || !color) return;
    data.updateAccountColor(accountId, color);
    render();
    if (window.desk?.setAccountColor) {
      const res = await window.desk.setAccountColor(accountId, color);
      if (res?.accounts) {
        data.setAccounts(res.accounts);
        render();
      }
    }
  },
  toggleConfig: async (arg) => {
    if (!arg) return;
    const [section, key] = arg.split('|');
    if (!section || !key) return;

    const current = data.getLiveConfig() || {};
    let oldVal = current[section]?.[key];
    if (typeof oldVal !== 'boolean') {
      const allSettings = data.getSettings();
      const subtab = allSettings[section];
      const match = subtab?.find((r) => r[3] === key);
      oldVal = match && typeof match[1] === 'boolean' ? match[1] : false;
    }
    const newVal = !oldVal;

    data.updateLiveConfigKey(section, key, newVal);
    render();

    if (window.desk?.updateConfig) {
      const res = await window.desk.updateConfig({ section, key, value: newVal });
      if (res?.config) {
        data.setLiveConfig(res.config);
        render();
      }
    }
  },

  inspectSkill: (_arg, el) => {
    if (!el) return;
    const name = el.dataset.name || '';
    const desc = el.dataset.desc || '';
    const version = el.dataset.version || '';
    const load = el.dataset.load || 'a demanda';
    const tokens = Number(el.dataset.tokens || 0);
    const filePath = el.dataset.file || '';
    const folderPath = el.dataset.folder || '';
    const engine = el.dataset.engine || '';

    state.inspectedSkill = {
      name, desc, version, load, tokens, filePath, folder: folderPath, engine,
      content: '', loading: !!filePath, error: null,
    };
    render();

    if (filePath && window.desk?.readSkill) {
      window.desk.readSkill(filePath).then((res) => {
        if (state.inspectedSkill && state.inspectedSkill.name === name) {
          state.inspectedSkill.loading = false;
          if (res?.error) state.inspectedSkill.error = res.error;
          else state.inspectedSkill.content = res?.content || '';
          render();
        }
      });
    }
  },
  closeSkillInspector: () => {
    state.inspectedSkill = null;
    render();
  },

  inspectTask: (_arg, el) => {
    if (!el) return;
    const id = el.dataset.id || '';
    const name = el.dataset.name || '';
    const engine = el.dataset.engine || '';
    const sourcePath = el.dataset.source || '';

    state.inspectedTask = {
      id, name, engine, source: sourcePath,
      logs: '', loading: true, error: null,
    };
    render();

    if (sourcePath && window.desk?.taskLogs) {
      window.desk.taskLogs({ sourcePath, engine, taskId: id }).then((res) => {
        if (state.inspectedTask && state.inspectedTask.id === id) {
          state.inspectedTask.loading = false;
          if (res?.error) state.inspectedTask.error = res.error;
          else state.inspectedTask.logs = res?.logs || '';
          render();
        }
      });
    }
  },
  closeTaskInspector: () => {
    state.inspectedTask = null;
    render();
  },

  openFolderInExplorer: (_arg, el) => {
    const target = el?.dataset?.target;
    if (target && window.desk?.openPath) {
      window.desk.openPath(target).then((res) => {
        if (res?.error) {
          state.error = res.error;
          render();
        }
      });
    }
  },
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
  act(el.dataset.arg, el);
  render();
});

app.addEventListener('input', (ev) => {
  const el = /** @type {HTMLInputElement} */ (ev.target);
  if (el.dataset.act === 'search') { state.search = el.value; render(); }
  if (el.dataset.act === 'flowQuery') { state.flowQuery = el.value; render(); }
  if (el.dataset.act === 'newConvTitle') { state.newConvTitle = el.value; }
  if (el.dataset.act === 'newConvTopic') { state.newConvTopic = el.value; }
  if (el.dataset.act === 'queueTask') { state.queueTask = el.value; }
  if (el.dataset.act === 'queueModel') { state.queueModel = el.value; }
  if (el.dataset.act === 'scanPath') { state.scanPath = el.value; state.scanError = null; }
  if (el.dataset.act === 'chatInput') { state.chatInput = el.value; }
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const target = /** @type {HTMLElement} */ (ev.target);
  const el = /** @type {HTMLElement|null} */ (target.closest('[data-act]'));
  if (!el) return;
  const act = ACTIONS[el.dataset.act || ''];
  if (act) {
    act(el.dataset.arg, el);
    render();
  }
});

app.addEventListener('change', (ev) => {
  const el = /** @type {HTMLInputElement|HTMLSelectElement} */ (ev.target);
  if (el.dataset.act === 'queueEngine') {
    state.queueEngine = el.value;
    if (state.queueEngine === 'agy') {
      if (state.queueMode === 'auto') state.queueMode = 'write';
      if (state.queueEffort === 'xhigh' || state.queueEffort === 'max') state.queueEffort = 'default';
    }
    render();
  }
  if (el.dataset.act === 'queueEffort') { state.queueEffort = el.value; }
  if (el.dataset.act === 'queueRepo') { state.queueRepo = el.value; }
  if (el.dataset.act === 'queueCoord') { state.queueCoord = el.value; }
  if (el.dataset.act === 'queueModel') { state.queueModel = el.value; }
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
  ['usage', 'Uso'], ['scheduled', 'Tareas programadas'], ['config', 'Configuración'],
];

function header() {
  const s = data.getSummary();
  const u = data.getUsage();
  const accounts = data.getAccounts().map((a) => `
    <div style="display:flex;align-items:center;gap:7px">
      <span style="width:9px;height:9px;border-radius:2px;background:${a.color}"></span>
      <span style="font:500 11px var(--font-body,Inter);color:var(--color-dark-text-2)">${a.name} · ${a.folders?.[0]?.path || '(sin carpetas)'}</span>
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

function errorBanner() {
  if (!state.error) return '';
  return `
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:9px 14px;
       background:var(--who-system-bg);border:1px solid var(--state-blocked);border-radius:var(--radius-md)">
    <span style="font:500 11.5px var(--font-body);color:var(--state-blocked)">${esc(state.error)}</span>
    <button class="btn-ghost" data-act="dismissError" style="margin-left:auto;font-size:11px">Cerrar</button>
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
  scheduled: () => renderScheduledTasks(state, data),
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

function renderLoading() {
  return `
  <div style="display:flex;height:100vh;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:#151223;color:#EDE9FE;font-family:'Outfit',system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:28px;height:28px;border-radius:8px;background:#A855F7;display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px rgba(168,85,247,0.4)">
        <span style="font-size:16px;color:#fff">✦</span>
      </div>
      <div style="font-size:19px;font-weight:600;letter-spacing:-0.01em">
        Cute Agents <span style="color:#C4B5FD">Desk</span>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#94A3B8;font-family:'Inter',system-ui,sans-serif">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#A855F7;animation:antenna 1.8s ease-in-out infinite"></span>
      <span>Iniciando despacho local...</span>
    </div>
  </div>`;
}

function paint() {
  if (state.loading) {
    app.innerHTML = renderLoading();
    return;
  }
  app.innerHTML = `
    <div style="display:flex;align-items:flex-start">
      ${renderSidebar(state, data)}
      <div style="flex:1;min-width:0;max-width:1440px;margin:0 auto;padding:22px 26px 40px">
        ${errorBanner()}
        ${header()}
        ${(VIEWS[state.view] || dispatch)()}
      </div>
    </div>
    ${renderDialogs(state, data)}`;
}

/**
 * At most one repaint per animation frame, however many patches land inside it. Without this, a
 * chatty agent's raw PTY output — forwarded chunk by chunk, independent of and often far more
 * frequent than any one tick — was rebuilding the whole app on every single chunk. The data is
 * still applied immediately below; only the (expensive) painting is coalesced.
 */
let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => { renderScheduled = false; render(); });
}

/**
 * The live channel. Present only inside the app: served over plain http (or opened as a file)
 * the same `ui/` still runs, on the mock data, which is how the design gets reviewed without
 * spawning anything.
 */
if (window.desk?.isDesk) {
  state.loading = true;

  window.desk.subscribe((patch) => {
    if (patch.agents) data.setLiveAgents(patch.agents);
    if (patch.output) data.pushOutput(patch.output.id, patch.output.chunk);
    if (patch.usage) data.setLiveUsage(patch.usage);
    if (patch.repoData) data.setLiveRepoData(patch.repoData);
    if (patch.threads) data.setLiveThreads(patch.threads);
    if (patch.timeline) data.setLiveTimeline(patch.timeline);
    scheduleRender();
  });

  const initialLoads = [
    window.desk.repos().then((repoData) => { if (repoData) data.setLiveRepoData(repoData); }),
    window.desk.conversations().then((conversations) => { if (conversations) data.setLiveConversations(conversations); }),
    window.desk.agents().then((agents) => { if (agents?.length) data.setLiveAgents(agents); }),
    window.desk.config?.().then((cfg) => { if (cfg) data.setLiveConfig(cfg); }),
    window.desk.worktrees().then((worktrees) => { if (worktrees) data.setLiveWorktrees(worktrees); }),
    window.desk.usage?.().then((usage) => { if (usage) data.setLiveUsage(usage); }),
    window.desk.scheduledTasks().then((tasks) => { if (tasks) data.setLiveScheduledTasks(tasks); }),
    window.desk.delivered().then((deliv) => { if (deliv) data.setLiveDelivered(deliv); }),
    window.desk.skills?.().then((skills) => { if (skills) data.setLiveSkills?.(skills); }),
    window.desk.threads?.().then((threads) => { if (threads) data.setLiveThreads(threads); }),
    window.desk.timeline?.().then((tl) => { if (tl) data.setLiveTimeline(tl); }),
  ];

  window.desk.quotas?.().then((quotas) => {
    if (quotas) {
      data.setLiveQuotas(quotas);
      scheduleRender();
    }
  });

  Promise.allSettled(initialLoads).finally(() => {
    state.loading = false;
    render();
  });

  // Unlike repos/worktrees/conversations, this reflects files Claude Desktop and Antigravity
  // write in the background -- fetch-once-on-load would go stale the moment either reschedules,
  // so it gets its own poll, cheap fs reads only, and only while the tab is actually open.
  setInterval(() => {
    if (state.view === 'scheduled') {
      window.desk.scheduledTasks().then((tasks) => { data.setLiveScheduledTasks(tasks); render(); });
    }
  }, 5000);
}

// The clock the artboard runs: elapsed times and the live rate tick without touching anything else.
setInterval(() => {
  state.tick++;
  if (state.loading) return;
  if (state.view === 'dispatch' || state.view === 'usage') render();
}, 1000);

render();
