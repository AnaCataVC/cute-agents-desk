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
import { renderVisualizer } from './visualizer.js';
import { renderUsage } from './tokens-view.js';
import { renderScheduledTasks } from './scheduled-tasks-view.js';
import { renderConfig } from './config.js';
import { renderDialogs } from './dialogs.js';
import { esc } from './esc.js';

/** @type {Record<string, any>} */
const state = {
  view: 'dispatch',            // dispatch | flows | visualizer | usage | scheduled | config
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
  visualizerOpen: [],          // open visualizer tabs, as `${agentId}:${path}`
  visualizerActive: null,
  diffMode: 'sbs',             // sbs | uni
  treeClosed: {},              // collapsed groups in the visualizer's change tree
  terminal: null,              // agent id whose terminal is mounted, or null
  chat: null,                  // agent id whose panel is open
  chatTab: 'hilo',             // ficha | hilo | diff, within that panel
  queue: null,                 // repo name being queued, or '' for "pick a repo"
  queueRepo: '',
  queueCwd: '',
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
  newConvCwd: '',
  newConvEngine: 'claude',
  newConvModel: 'default',
  newConvEffort: 'default',
  newConvMode: 'write',
  sidebarArchivedOpen: false,  // toggle collapsed archived list in sidebar
  tick: 0,
  error: null,                 // last IPC refusal (scheduler cap, still-alive agent, ...), or null
  inspectedSkill: null,        // data for currently inspected skill in dialog
  inspectedTask: null,         // data for currently inspected scheduled task in dialog
  chatInput: '',               // active input text in chat modal
  editConfig: null,            // data for currently edited non-boolean config key
  toast: null,                 // { message, type, id } for transient save confirmation
  toastTimer: null,            // timeout id for dismissing toast
};

const app = /** @type {HTMLElement} */ (document.getElementById('app'));

/**
 * Metadata definitions for all editable non-boolean configuration keys.
 * Specifies input control type, allowed bounds, units, step sizes, and hints.
 */
export const CONFIG_META = {
  'coordinators.maxSessionsPerCoordinator': {
    label: 'Sesiones que puede abrir',
    type: 'number',
    min: 1,
    max: 10,
    step: 1,
    unit: 'sesiones',
    hint: 'Máximo número de agentes paralelos por coordinador (1-10)',
  },
  'coordinators.defaultEngine': {
    label: 'Motor por defecto',
    type: 'select',
    options: [
      { value: 'claude cli', label: 'claude cli' },
      { value: 'agy cli', label: 'agy cli' },
    ],
    hint: 'Motor predeterminado para nuevos coordinadores',
  },
  'coordinators.reportInterval': {
    label: 'Reportar al coordinador cada',
    type: 'select',
    options: [
      { value: 'herramienta', label: 'herramienta' },
      { value: 'turno', label: 'turno' },
      { value: 'minuto', label: 'minuto' },
    ],
    hint: 'Frecuencia con la que los agentes reportan progreso',
  },
  'coordinators.idleTimeoutMinutes': {
    label: 'Cerrar agentes idle tras',
    type: 'number',
    min: 1,
    max: 120,
    step: 1,
    unit: 'min',
    hint: 'Minutos de inactividad antes de finalizar la sesión (1-120)',
  },

  'exec.maxParallel': {
    label: 'Sesiones en paralelo',
    type: 'number',
    min: 1,
    max: 20,
    step: 1,
    unit: 'sesiones',
    hint: 'Límite global de agentes ejecutándose a la vez (1-20)',
  },
  'exec.blockedTimeoutMinutes': {
    label: 'Marcar bloqueado sin avance',
    type: 'number',
    min: 1,
    max: 60,
    step: 1,
    unit: 'min',
    hint: 'Minutos sin avance para considerar un agente bloqueado (1-60)',
  },

  'deliver.prTitleTemplate': {
    label: 'Título del PR',
    type: 'text',
    placeholder: '<tipo>: <tarea>',
    hint: 'Plantilla de título para PRs generados (ej. <tipo>: <tarea>)',
  },

  'perf.maxMountedTerminals': {
    label: 'Terminales montadas a la vez',
    type: 'number',
    min: 1,
    max: 5,
    step: 1,
    unit: 'terminales',
    hint: 'Límite de terminales activas simultáneamente en pantalla (1-5)',
  },
  'perf.terminalScrollbackLines': {
    label: 'Scrollback por terminal',
    type: 'number',
    min: 100,
    max: 10000,
    step: 100,
    unit: 'líneas',
    hint: 'Líneas de historial retenidas por terminal (100-10000)',
  },
  'perf.cardRefreshIntervalMs': {
    label: 'Refresco de tarjetas',
    type: 'number',
    min: 250,
    max: 10000,
    step: 250,
    unit: 'ms',
    hint: 'Intervalo de refresco de telemetría en milisegundos (250-10000)',
  },
  'perf.eventLogRotationMb': {
    label: 'Rotar el registro de eventos',
    type: 'number',
    min: 1,
    max: 500,
    step: 5,
    unit: 'MB',
    hint: 'Tamaño máximo antes de rotar los registros de eventos (1-500)',
  },

  'advanced.harnessDir': {
    label: 'Directorio del harness',
    type: 'text',
    isPath: true,
    placeholder: '~/.cute-agents-desk',
    hint: 'Ubicación física para worktrees y entornos aislados',
  },
  'advanced.windowProtocol': {
    label: 'Protocolo de ventana',
    type: 'text',
    placeholder: 'app://desk',
    hint: 'Esquema de protocolo para la ventana principal',
  },
};

/**
 * Safely extracts the raw typed configuration value for a section and key.
 * Prioritizes live configuration over default visual representation in getSettings().
 * @param {string} section
 * @param {string} key
 * @returns {any}
 */
export function getConfigRawValue(section, key) {
  const current = data.getLiveConfig();
  if (current && current[section] && current[section][key] !== undefined) {
    return current[section][key];
  }

  const allSettings = data.getSettings();
  const subtab = allSettings[section];
  const match = Array.isArray(subtab) ? subtab.find((r) => r[3] === key) : null;
  if (match && match[1] !== undefined) {
    const meta = (CONFIG_META && CONFIG_META[`${section}.${key}`]) || {};
    if (meta.type === 'number') {
      const parsed = parseFloat(String(match[1]));
      if (!Number.isNaN(parsed)) return parsed;
    }
    return match[1];
  }

  return '';
}

/** Actions, keyed by the `data-act` value. Each one mutates state; render() follows. */
const ACTIONS = {
  view: (/** @type {string} */ v) => {
    state.view = v;
    if (v === 'usage' && window.desk?.quotas) {
      window.desk.quotas().then((/** @type {object} */ q) => { if (q) { data.setLiveQuotas(q); render(); } }).catch(() => {});
    }
  },
  refreshQuotas: () => {
    if (window.desk?.quotas) {
      window.desk.quotas({ forceRefresh: true }).then((/** @type {object} */ q) => { if (q) { data.setLiveQuotas(q); render(); } }).catch(() => {});
    }
  },
  flowView: (/** @type {any} */ v) => { state.flowView = v; },
  cfgTab: (/** @type {any} */ v) => { state.cfgTab = v; },
  toggleNode: (/** @type {string | number} */ key) => { state.open[key] = !state.open[key]; },
  toggleFilters: () => { state.filtersOpen = !state.filtersOpen; },
  accFilter: (/** @type {any} */ v) => { state.accFilter = v; },
  stFilter: (/** @type {any} */ v) => { state.stFilter = v; },
  clearFilters: () => { state.accFilter = 'all'; state.stFilter = 'any'; state.search = ''; },
  accFlow: (/** @type {any} */ v) => { state.accFlow = v; },
  showArch: () => { state.showArch = !state.showArch; },
  // A second click on the same node closes the tooltip, so it needs no close button.
  tip: (/** @type {any} */ v) => { state.tip = state.tip === v ? null : v; },
  toggleTreeNode: (/** @type {string | number} */ key) => { state.treeClosed[key] = !state.treeClosed[key]; },
  openFile: (/** @type {any} */ id) => {
    if (!state.visualizerOpen.includes(id)) state.visualizerOpen.push(id);
    state.visualizerActive = id;
  },
  closeFile: (/** @type {any} */ id) => {
    state.visualizerOpen = state.visualizerOpen.filter((/** @type {any} */ t) => t !== id);
    if (state.visualizerActive === id) state.visualizerActive = state.visualizerOpen[state.visualizerOpen.length - 1] || null;
  },
  diffMode: (/** @type {any} */ v) => { state.diffMode = v; },
  openTerminal: (/** @type {null} */ id) => { state.terminal = id || null; },
  closeTerminal: () => { state.terminal = null; },
  openChat: (/** @type {any} */ id) => { state.chat = id; state.chatTab = 'hilo'; state.tip = null; state.chatInput = ''; },
  closeChat: () => { state.chat = null; state.chatInput = ''; },
  chatTab: (/** @type {any} */ v) => { state.chatTab = v; },
  submitChat: async (/** @type {any} */ agentId) => {
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
  /** Same file-opening path as the Visualizador tab's tree, reached from the chat panel's Diff sub-tab. */
  openDiffFile: (/** @type {any} */ id) => {
    state.view = 'visualizer';
    state.chat = null;
    if (!state.visualizerOpen.includes(id)) state.visualizerOpen.push(id);
    state.visualizerActive = id;
  },
  openQueue: (/** @type {string} */ repo) => {
    state.queue = repo ?? '';
    state.queueRepo = repo ?? '';
    state.queueCwd = '';
    state.queueTask = '';
    state.queueEngine = 'claude';
    state.queueModel = 'default';
    state.queueEffort = 'default';
    state.queueMode = 'write';
    state.queueCoord = '';
  },
  closeQueue: () => { state.queue = null; state.queueCwd = ''; },
  browseQueueFolder: async () => {
    if (window.desk?.pickDirectory) {
      const folder = await window.desk.pickDirectory();
      if (folder) {
        state.queueCwd = folder;
        render();
      }
    }
  },
  queueMode: (/** @type {string} */ m) => { state.queueMode = m || 'write'; },
  submitQueue: async () => {
    const task = (state.queueTask || '').trim();
    if (!task) return;
    const repos = data.getRepos();
    const repoIdentifier = state.queueRepo || state.queue;
    const repo = repos.find((r) => r.path === repoIdentifier || r.name === repoIdentifier);
    const resolvedFromRepo = repo ? (repo.path || (repo.folder ? `${repo.folder}/${repo.name}` : repo.name)) : undefined;
    const cwd = (state.queueCwd && state.queueCwd.trim()) ? state.queueCwd.trim() : resolvedFromRepo;
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
      state.queueCwd = '';
      state.queueTask = '';
    }
    render();
  },
  openScan: (/** @type {any} */ accountId) => {
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
  scanDepth: (/** @type {any} */ d) => { state.scanDepth = Number(d); },
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
  removeFolder: async (/** @type {{ split: (arg0: string) => [any, any]; }} */ arg) => {
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
    state.newConvCwd = '';
    const defaultEng = (data.getEngines?.() || [])[0]?.id || 'claude';
    state.newConvEngine = defaultEng;
    state.newConvModel = 'default';
    state.newConvEffort = 'default';
    state.newConvMode = 'write';
  },
  browseNewConvFolder: async () => {
    if (window.desk?.pickDirectory) {
      const folder = await window.desk.pickDirectory();
      if (folder) {
        state.newConvCwd = folder;
        render();
      }
    }
  },
  toggleSidebarArchived: () => {
    state.sidebarArchivedOpen = !state.sidebarArchivedOpen;
    render();
  },
  /** Creates the conversation, then refetches the list -- there is no live push for it yet. */
  newConversation: () => {
    const title = (state.newConvTitle || '').trim();
    if (!title) return;
    const topic = (state.newConvTopic || '').trim();
    const engine = state.newConvEngine || 'claude';
    const model = state.newConvModel || 'default';
    const effort = state.newConvEffort || 'default';
    const mode = state.newConvMode || 'write';
    const cwd = (state.newConvCwd || '').trim() || undefined;

    state.newConvOpen = false;
    window.desk?.createConversation?.({
      title,
      topic: topic || undefined,
      engine,
      model: model !== 'default' ? model : undefined,
      effort: effort !== 'default' ? effort : undefined,
      mode,
      cwd,
    })
      .then((/** @type {{ id: any; }} */ created) => {
        if (created?.id) {
          window.desk?.spawnCoordinator?.({
            conversationId: created.id,
            engine,
            bin: engine,
            model: model !== 'default' ? model : undefined,
            effort: effort !== 'default' ? effort : undefined,
            mode,
            cwd,
          })?.catch(() => {});
        }
        return window.desk.conversations();
      })
      .then((/** @type {object[]} */ conversations) => { data.setLiveConversations(conversations); render(); })
      .catch((err) => { state.error = err?.message || String(err); render(); });
  },
  dismissError: () => { state.error = null; },

  /** The coordinator's own card shows up once it reports in, like any agent -- a rejection
   * (scheduler cap full) is the one outcome worth telling the user about right away. */
  openCoordinator: (/** @type {any} */ conversationId) => {
    window.desk?.spawnCoordinator?.({ conversationId }).then((/** @type {{ error: any; }} */ result) => {
      if (result?.error) { state.error = result.error; render(); }
    }).catch((err) => { state.error = err?.message || String(err); render(); });
  },
  archive: (/** @type {any} */ conversationId) => {
    if (!conversationId) return;
    window.desk?.archiveConversation?.(conversationId).then((/** @type {{ error: any; }} */ res) => {
      if (res?.error) { state.error = res.error; render(); return; }
      return window.desk.conversations().then((/** @type {object[]} */ conversations) => {
        data.setLiveConversations(conversations);
        render();
      });
    }).catch((err) => { state.error = err?.message || String(err); render(); });
  },
  deleteConversation: (/** @type {string} */ conversationId) => {
    if (!conversationId) return;
    const confirmDelete = window.confirm ? window.confirm(`¿Eliminar definitivamente la conversación "${conversationId}" y todos sus archivos? Esta acción no se puede deshacer.`) : true;
    if (!confirmDelete) return;

    window.desk?.deleteConversation?.(conversationId).then((/** @type {{ error: any; ok: boolean }} */ res) => {
      if (res?.error) { state.error = res.error; render(); return; }
      return window.desk.conversations().then((/** @type {object[]} */ conversations) => {
        data.setLiveConversations(conversations);
        render();
      });
    }).catch((err) => { state.error = err?.message || String(err); render(); });
  },
  closeIdle: (/** @type {any} */ flowId) => {
    const agents = data.getAgents();
    for (const a of agents) {
      if ((a.conversationId === flowId || a.boss?.includes(flowId)) && (a.state === 'idle' || a.state === 'done')) {
        window.desk?.stop?.(a.id);
      }
    }
  },

  /** Manual reap, per the plan: never automatic, so losing an agent's uncommitted work is never
   * a side effect of something else finishing. The IPC handler itself refuses a still-live agent. */
  reapWorktree: (/** @type {any} */ agentId) => {
    window.desk?.reapWorktree?.(agentId).then((/** @type {{ error: any; }} */ result) => {
      if (result?.error) { state.error = result.error; render(); return; }
      return window.desk.worktrees().then((/** @type {object[]} */ worktrees) => { data.setLiveWorktrees(worktrees); render(); });
    }).catch((err) => { state.error = err?.message || String(err); render(); });
  },

  /** Batch reap of clean or delivered inactive worktrees. */
  reapCleanWorktrees: () => {
    window.desk?.reapCleanWorktrees?.().then((/** @type {{ error: any; totalReaped: number; skipped: any; }} */ res) => {
      if (res?.error) {
        state.error = res.error;
        render();
        return;
      }
      const reaped = res?.totalReaped || 0;
      const skipped = (res?.skipped || []).length;
      state.reapFeedback = `Se podaron ${reaped} worktrees (${skipped} conservados por cambios o actividad)`;
      window.desk.worktrees().then((/** @type {object[]} */ worktrees) => {
        data.setLiveWorktrees(worktrees);
        render();
      }).catch(() => {});
    }).catch((err) => { state.error = err?.message || String(err); render(); });
  },

  /** One real agent on the toy repo, proving the plumbing works end-to-end. */
  spawnTest: async () => {
    const result = await window.desk.spawn({
      task: 'Lee el README y agrega una linea al final que diga la hora actual. Nada mas.',
    });
    if (result?.error) { state.error = result.error; render(); }
  },
  stopAgent: (/** @type {any} */ id) => window.desk.stop(id),
  refreshSkills: () => {
    window.desk?.skills?.().then((/** @type {any[]} */ skills) => { data.setLiveSkills(skills); render(); }).catch(() => {});
  },

  /** Deliver an agent's work as a branch + draft PR. */
  deliverAgent: async (/** @type {any} */ agentId) => {
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
  setAccountColor: async (/** @type {{ split: (arg0: string) => [any, any]; }} */ arg) => {
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
  setAccountEditor: async (/** @type {{ split: (arg0: string) => [any, any]; }} */ arg) => {
    if (!arg) return;
    const [accountId, editor] = arg.split('|');
    if (!accountId || !editor) return;
    data.updateAccountEditor(accountId, editor);
    render();
    if (window.desk?.setAccountEditor) {
      const res = await window.desk.setAccountEditor({ accountId, editor });
      if (res?.accounts) {
        data.setAccounts(res.accounts);
        render();
      }
    }
  },
  openExternalEditor: async (/** @type {{ split: (arg0: string) => [any, any]; }} */ arg) => {
    if (!arg) return;
    const [agentId, filePath] = arg.split('|');
    if (!agentId) return;
    state.error = null;
    render();
    if (window.desk?.openEditor) {
      const res = await window.desk.openEditor({
        agentId,
        filePath: filePath || undefined,
      });
      if (res?.error) {
        state.error = res.error;
        render();
      }
    }
  },
  toggleConfig: async (/** @type {{ split: (arg0: string) => [any, any]; }} */ arg) => {
    if (!arg) return;
    const [section, key] = arg.split('|');
    if (!section || !key) return;

    const current = data.getLiveConfig() || {};
    let oldVal = current[section]?.[key];
    if (typeof oldVal !== 'boolean') {
      const allSettings = data.getSettings();
      const subtab = allSettings[section];
      const match = subtab?.find((/** @type {any[]} */ r) => r[3] === key);
      oldVal = match && typeof match[1] === 'boolean' ? match[1] : false;
    }
    const newVal = !oldVal;

    data.updateLiveConfigKey(section, key, newVal);
    render();

    if (window.desk?.updateConfig) {
      const res = await window.desk.updateConfig({ section, key, value: newVal });
      if (res?.config) {
        data.setLiveConfig(res.config);
        showToast(`Configuración guardada: ${key} = ${newVal ? 'activo' : 'inactivo'}`);
      } else if (res?.error) {
        showToast(res.error, 'error');
      }
    } else {
      showToast(`Configuración actualizada: ${key} = ${newVal ? 'activo' : 'inactivo'}`);
    }
  },

  editConfigValue: (/** @type {{ split: (arg0: string) => [any, any]; }} */ arg) => {
    if (!arg) return;
    const [section, key] = arg.split('|');
    if (!section || !key) return;

    // Defensive zero-crash fallback: guarantee safe metadata even for unregistered keys
    const meta = (CONFIG_META && CONFIG_META[`${section}.${key}`]) || {};
    const rawVal = getConfigRawValue(section, key);

    state.editConfig = {
      section,
      key,
      label: meta.label || key,
      currentValue: rawVal,
      type: meta.type || (typeof rawVal === 'number' ? 'number' : 'text'),
      min: meta.min,
      max: meta.max,
      step: meta.step,
      unit: meta.unit,
      options: meta.options,
      isPath: meta.isPath,
      placeholder: meta.placeholder,
      hint: meta.hint,
      error: null,
      saving: false,
    };
    render();
  },

  closeEditConfig: () => {
    state.editConfig = null;
    render();
  },

  browseEditConfigPath: async () => {
    if (!state.editConfig) return;
    if (window.desk?.pickDirectory) {
      const folder = await window.desk.pickDirectory();
      if (folder) {
        state.editConfig.currentValue = folder;
        state.editConfig.error = null;
        render();
      }
    }
  },

  submitEditConfig: async () => {
    const cfg = state.editConfig;
    if (!cfg || cfg.saving) return;

    let finalVal = cfg.currentValue;
    if (cfg.type === 'number') {
      const num = Number(finalVal);
      if (Number.isNaN(num)) {
        cfg.error = 'Por favor ingresa un número válido.';
        render();
        return;
      }
      if (cfg.min !== undefined && num < cfg.min) {
        cfg.error = `El valor mínimo permitido es ${cfg.min}${cfg.unit ? ` ${cfg.unit}` : ''}.`;
        render();
        return;
      }
      if (cfg.max !== undefined && num > cfg.max) {
        cfg.error = `El valor máximo permitido es ${cfg.max}${cfg.unit ? ` ${cfg.unit}` : ''}.`;
        render();
        return;
      }
      finalVal = num;
    } else if (typeof finalVal === 'string') {
      finalVal = finalVal.trim();
      if (!finalVal && cfg.min !== undefined) {
        cfg.error = 'El valor no puede estar vacío.';
        render();
        return;
      }
      if (finalVal.length > 500) {
        cfg.error = 'El valor no puede superar los 500 caracteres.';
        render();
        return;
      }
    }

    const { section, key, label } = cfg;
    cfg.saving = true;
    cfg.error = null;
    render();

    if (window.desk?.updateConfig) {
      try {
        const res = await window.desk.updateConfig({ section, key, value: finalVal });
        if (res?.error) {
          cfg.error = res.error;
          cfg.saving = false;
          render();
          return;
        }
        if (res?.config) {
          data.setLiveConfig(res.config);
        } else {
          data.updateLiveConfigKey(section, key, finalVal);
        }
        state.editConfig = null;
        render();
        showToast(`Guardado: ${label}`);
      } catch (err) {
        cfg.error = err instanceof Error ? err.message : 'Error inesperado al guardar';
        cfg.saving = false;
        render();
      }
    } else {
      // Mock / browser preview mode
      data.updateLiveConfigKey(section, key, finalVal);
      state.editConfig = null;
      render();
      showToast(`Guardado: ${label}`);
    }
  },

  inspectSkill: (/** @type {any} */ _arg, /** @type {{ dataset: { name: string; desc: string; version: string; load: string; tokens: any; file: string; folder: string; engine: string; }; }} */ el) => {
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
      window.desk.readSkill(filePath).then((/** @type {{ error: any; content: string; }} */ res) => {
        if (state.inspectedSkill && state.inspectedSkill.name === name) {
          state.inspectedSkill.loading = false;
          if (res?.error) state.inspectedSkill.error = res.error;
          else state.inspectedSkill.content = res?.content || '';
          render();
        }
      }).catch((err) => {
        if (state.inspectedSkill && state.inspectedSkill.name === name) {
          state.inspectedSkill.loading = false;
          state.inspectedSkill.error = err?.message || String(err);
          render();
        }
      });
    }
  },
  closeSkillInspector: () => {
    state.inspectedSkill = null;
    render();
  },

  inspectTask: (/** @type {any} */ _arg, /** @type {{ dataset: { id: string; name: string; engine: string; source: string; }; }} */ el) => {
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
      window.desk.taskLogs({ sourcePath, engine, taskId: id }).then((/** @type {{ error: any; logs: string; }} */ res) => {
        if (state.inspectedTask && state.inspectedTask.id === id) {
          state.inspectedTask.loading = false;
          if (res?.error) state.inspectedTask.error = res.error;
          else state.inspectedTask.logs = res?.logs || '';
          render();
        }
      }).catch((err) => {
        if (state.inspectedTask && state.inspectedTask.id === id) {
          state.inspectedTask.loading = false;
          state.inspectedTask.error = err?.message || String(err);
          render();
        }
      });
    }
  },
  closeTaskInspector: () => {
    state.inspectedTask = null;
    render();
  },

  openFolderInExplorer: (/** @type {any} */ _arg, /** @type {{ dataset: { target: any; }; }} */ el) => {
    const target = el?.dataset?.target;
    if (target && window.desk?.openPath) {
      window.desk.openPath(target).then((/** @type {{ error: any; }} */ res) => {
        if (res?.error) {
          state.error = res.error;
          render();
        }
      }).catch((err) => {
        state.error = err?.message || String(err);
        render();
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
  render(true);
});

app.addEventListener('input', (ev) => {
  const el = /** @type {HTMLInputElement} */ (ev.target);
  if (el.dataset.act === 'search') { state.search = el.value; render(); }
  if (el.dataset.act === 'flowQuery') { state.flowQuery = el.value; render(); }
  if (el.dataset.act === 'newConvTitle') { state.newConvTitle = el.value; }
  if (el.dataset.act === 'newConvTopic') { state.newConvTopic = el.value; }
  if (el.dataset.act === 'newConvModel') { state.newConvModel = el.value; }
  if (el.dataset.act === 'queueTask') { state.queueTask = el.value; }
  if (el.dataset.act === 'queueModel') { state.queueModel = el.value; }
  if (el.dataset.act === 'scanPath') { state.scanPath = el.value; state.scanError = null; }
  if (el.dataset.act === 'chatInput') { state.chatInput = el.value; }
  if (el.dataset.act === 'editConfigInput' && state.editConfig) {
    state.editConfig.currentValue = el.value;
    state.editConfig.error = null;
  }
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const target = /** @type {HTMLElement} */ (ev.target);
  const el = /** @type {HTMLElement|null} */ (target.closest('[data-act]'));
  if (!el) return;
  const act = ACTIONS[el.dataset.act || ''];
  if (act) {
    act(el.dataset.arg, el);
    render(true);
  }
});

app.addEventListener('change', (ev) => {
  const el = /** @type {HTMLInputElement|HTMLSelectElement} */ (ev.target);
  if (el.dataset.act === 'editConfigInput' && state.editConfig) {
    state.editConfig.currentValue = el.value;
    state.editConfig.error = null;
  }
  if (el.dataset.act === 'newConvEngine') {
    state.newConvEngine = el.value;
    state.newConvModel = 'default';
    state.newConvEffort = 'default';
    render(true);
    return;
  }
  if (el.dataset.act === 'newConvEffort') { state.newConvEffort = el.value; }
  if (el.dataset.act === 'newConvMode') { state.newConvMode = el.value; }
  if (el.dataset.act === 'newConvModel') { state.newConvModel = el.value; }
  if (el.dataset.act === 'queueEngine') {
    state.queueEngine = el.value;
    if (state.queueEngine === 'agy') {
      if (state.queueMode === 'auto') state.queueMode = 'write';
      if (state.queueEffort === 'xhigh' || state.queueEffort === 'max') state.queueEffort = 'default';
    }
    render(true);
    return;
  }
  if (el.dataset.act === 'queueEffort') { state.queueEffort = el.value; }
  if (el.dataset.act === 'queueRepo') { state.queueRepo = el.value; }
  if (el.dataset.act === 'queueCoord') { state.queueCoord = el.value; }
  if (el.dataset.act === 'queueModel') { state.queueModel = el.value; }
  flushDeferredRender();
});

app.addEventListener('focusout', (ev) => {
  const target = /** @type {HTMLElement|null} */ (ev.target);
  if (target && (target.tagName === 'SELECT' || (target.tagName === 'INPUT' && target.hasAttribute('list')))) {
    setTimeout(() => {
      flushDeferredRender();
    }, 20);
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  // One key closes whatever is on top, innermost first.
  if (state.editConfig) state.editConfig = null;
  else if (state.chat) state.chat = null;
  else if (state.queue !== null) state.queue = null;
  else if (state.scan) state.scan = null;
  else if (state.tip) state.tip = null;
  else if (state.terminal) state.terminal = null;
  else if (state.newConvOpen) state.newConvOpen = false;
  else return;
  render(true);
});

const TABS = [
  ['dispatch', 'Control de agentes'], ['flows', 'Flujos de trabajo'], ['visualizer', 'Visualizador'],
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
  visualizer: () => renderVisualizer(state, data),
  editor: () => renderVisualizer(state, data),
  usage: () => renderUsage(state, data),
  scheduled: () => renderScheduledTasks(state, data),
  config: () => renderConfig(state, data),
};

/**
 * A full repaint replaces the focused element, so typing would lose focus and caret on every
 * keystroke — and once the SSE stream repaints on each hook event, on every event too. The
 * fields are identified by their `data-act`, which is unique per field and survives the repaint.
 * @param {{ (): void; (): void; }} paint
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

/**
 * Detects whether the user is actively focused on or interacting with a dropdown/select control.
 * In Chromium/Electron, rebuilding the DOM while a native select or datalist popup is open
 * immediately closes the popup before the user can select an option.
 * @returns {boolean}
 */
export function isInteractingWithDropdown() {
  const active = /** @type {HTMLElement|null} */ (document.activeElement);
  if (!active) return false;
  const tag = active.tagName;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT' && active.hasAttribute('list')) return true;
  return false;
}

let deferredRender = false;

/**
 * Renders the application artboard.
 * When force is false, background polls and telemetry streams defer repainting
 * if a select or datalist element is currently focused to prevent the OS dropdown popup from collapsing.
 * @param {boolean} [force=false]
 */
export function render(force = false) {
  if (!force && isInteractingWithDropdown()) {
    deferredRender = true;
    return;
  }
  deferredRender = false;
  keepFocus(() => paint());
}

/**
 * Flushes any deferred render once the user completes dropdown selection or leaves the control.
 */
export function flushDeferredRender() {
  if (deferredRender && !isInteractingWithDropdown()) {
    deferredRender = false;
    keepFocus(() => paint());
  }
}

/**
 * @param {string} message
 */
function showToast(message, type = 'success') {
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toast = { message, type, id: Date.now() };
  render(true);
  state.toastTimer = setTimeout(() => {
    state.toast = null;
    state.toastTimer = null;
    render(true);
  }, 3500);
}

function toastContainer() {
  if (!state.toast) return '<div class="toast-container"></div>';
  const icon = state.toast.type === 'error' ? '✕' : '✓';
  return `
  <div class="toast-container">
    <div class="toast-msg" data-type="${esc(state.toast.type || 'success')}">
      <span style="font-weight:700">${icon}</span>
      <span>${esc(state.toast.message)}</span>
    </div>
  </div>`;
}

function renderLoading() {
  return `
  <div style="display:flex;height:100vh;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:#151223;color:#EDE9FE;font-family:'Outfit',system-ui,sans-serif">
    <div style="display:flex;align-items:center;gap:12px">
      <img src="./assets/icon.png" alt="Cute Agents Desk" width="36" height="36" style="border-radius:10px;box-shadow:0 0 24px rgba(168,85,247,0.45);object-fit:cover">
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
    ${renderDialogs(state, data)}
    ${toastContainer()}`;
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
  requestAnimationFrame(() => { renderScheduled = false; render(false); });
}

/**
 * The live channel. Present only inside the app: served over plain http (or opened as a file)
 * the same `ui/` still runs, on the mock data, which is how the design gets reviewed without
 * spawning anything.
 */
if (window.desk?.isDesk) {
  state.loading = true;

  window.desk.subscribe((/** @type {{ agents: object[]; output: { id: string; chunk: string; }; usage: object; repoData: { accounts: object[]; repos: object[]; }; threads: Record<string, any[]>; }} */ patch) => {
    if (patch.agents) data.setLiveAgents(patch.agents);
    if (patch.output) data.pushOutput(patch.output.id, patch.output.chunk);
    if (patch.usage) data.setLiveUsage(patch.usage);
    if (patch.repoData) data.setLiveRepoData(patch.repoData);
    if (patch.threads) data.setLiveThreads(patch.threads);
    if (patch.dag) data.setLiveDag(patch.dag);
    scheduleRender();
  });

  const initialLoads = [
    window.desk.repos().then((/** @type {{ accounts: object[]; repos: object[]; }} */ repoData) => { if (repoData) data.setLiveRepoData(repoData); }),
    window.desk.conversations().then((/** @type {object[]} */ conversations) => { if (conversations) data.setLiveConversations(conversations); }),
    window.desk.agents().then((/** @type {string | any[]} */ agents) => { if (agents?.length) data.setLiveAgents(agents); }),
    window.desk.config?.().then((/** @type {Record<string, any>} */ cfg) => { if (cfg) data.setLiveConfig(cfg); }),
    window.desk.worktrees().then((/** @type {object[]} */ worktrees) => { if (worktrees) data.setLiveWorktrees(worktrees); }),
    window.desk.usage?.().then((/** @type {object} */ usage) => { if (usage) data.setLiveUsage(usage); }),
    window.desk.scheduledTasks().then((/** @type {object[]} */ tasks) => { if (tasks) data.setLiveScheduledTasks(tasks); }),
    window.desk.delivered().then((/** @type {any[]} */ deliv) => { if (deliv) data.setLiveDelivered(deliv); }),
    window.desk.skills?.().then((/** @type {any[]} */ skills) => { if (skills) data.setLiveSkills?.(skills); }),
    window.desk.threads?.().then((/** @type {Record<string, any[]>} */ threads) => { if (threads) data.setLiveThreads(threads); }),
  ];

  window.desk.quotas?.().then((/** @type {object} */ quotas) => {
    if (quotas) {
      data.setLiveQuotas(quotas);
      scheduleRender();
    }
  }).catch(() => {});

  Promise.allSettled(initialLoads).finally(() => {
    state.loading = false;
    render();
  });

  // Unlike repos/worktrees/conversations, this reflects files Claude Desktop and Antigravity
  // write in the background -- fetch-once-on-load would go stale the moment either reschedules,
  // so it gets its own poll, cheap fs reads only, and only while the tab is actually open.
  setInterval(() => {
    if (state.view === 'scheduled') {
      window.desk.scheduledTasks().then((/** @type {object[]} */ tasks) => { data.setLiveScheduledTasks(tasks); render(); }).catch(() => {});
    }
  }, 5000);
}

// The clock the artboard runs: elapsed times and the live rate tick without touching anything else.
setInterval(() => {
  state.tick++;
  if (state.loading) return;
  // Don't repaint the whole artboard on every second if a modal dialog is actively open
  const modalOpen = state.queue !== null || state.editConfig !== null || state.scan !== null
    || state.inspectedSkill !== null || state.inspectedTask !== null || state.newConvOpen;
  if (modalOpen) return;
  if (state.view === 'dispatch' || state.view === 'usage') render();
}, 1000);

render();
