// @ts-check
/**
 * The window, and nothing else yet.
 *
 * The UI is served over a custom `app://` protocol rather than `file://` for one concrete
 * reason: the renderer is plain ES modules, and `file://` gives them a null origin, so the
 * browser refuses every `import`. `app://` is a real origin, so the same `ui/` folder that a
 * local http server would serve loads unchanged — and without a port, a token, or an
 * `Origin` check, because nothing outside this process can reach it.
 */

// Registered before anything else is required, on purpose: an uncaught exception in the main
// process makes Electron pop a modal error box, and a modal box waits for a click forever. In a
// scripted run that is indistinguishable from a hang, so under --smoke the error goes to stderr
// and the process dies. With a window open the box is useful, so it stays.
if (process.argv.includes('--smoke')) {
  process.on('uncaughtException', (err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}

const { app, BrowserWindow, protocol, net, shell, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Registry } = require('./events.js');
const { spawn } = require('./agent.js');
const { toyRepo } = require('./toy-repo.js');
const { Scheduler } = require('./scheduler.js');
const { readAccountsConfig, buildAccounts } = require('./accounts.js');
const { scanRepos } = require('./discovery.js');
const conv = require('./conversations.js');
const coordinator = require('./coordinator.js');
const paths = require('./paths.js');
const worktree = require('./worktree.js');
const { getScheduledTasks } = require('./scheduled-tasks.js');

const ROOT = path.join(__dirname, '..');

/** Live agents, by id. The registry holds their state; this holds the terminals. */
const running = new Map();

/** A coordinator's spawn-request watcher, by its own agent id -- closed when it dies or is
 * stopped, so killing a coordinator never leaves an orphaned `fs.watch` behind. */
const spawnRequestWatchers = new Map();

/** @type {Registry} */
let registry;

/** @type {Promise<{accounts: object[], repos: object[]}>|null} */
let repoDataPromise = null;

/**
 * The accounts/repos scan, computed at most once per run instead of on every "abrir coordinador"
 * click (scanning real repos "takes a moment", per the comment this replaces) and reused for
 * validating a coordinator's spawn-request `cwd` too. Caches the in-flight promise, not the
 * resolved value, so two calls that race before the first scan finishes still only trigger one.
 * Nothing in this phase can add a folder at runtime, so there is no invalidation yet -- add one
 * when Configuracion can.
 */
function getRepoData() {
  if (!repoDataPromise) {
    const accountsConfig = readAccountsConfig();
    repoDataPromise = scanRepos(accountsConfig).then((repos) => ({ accounts: buildAccounts(), repos }));
  }
  return repoDataPromise;
}

// `standard` is what makes it a real origin (so modules and fetch behave); `secure` puts it
// on the same footing as https for the features that check.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/**
 * Map an `app://desk/<path>` request onto a file under the project root, refusing anything
 * that climbs out of it — the renderer is trusted today, but a path check is two lines and a
 * traversal bug here would read the whole disk.
 */
function serveFromRoot(request) {
  const url = new URL(request.url);
  const rel = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const target = path.join(ROOT, rel);
  if (!target.startsWith(ROOT + path.sep)) return new Response('forbidden', { status: 403 });
  return net.fetch(pathToFileURL(target).toString());
}

/**
 * Load the page, report what rendered, exit non-zero if anything failed. Checks the two
 * things that actually break when the plumbing is wrong: the `app://` handler resolving the
 * modules, and a console error from any of them.
 * @param {import('electron').BrowserWindow} win
 */
function smoke(win) {
  const errors = [];
  win.webContents.on('console-message', (ev) => {
    if (ev.level === 'error') errors.push(ev.message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`load failed: ${code} ${desc} ${url}`);
    app.exit(1);
  });
  win.webContents.on('did-finish-load', async () => {
    const found = await win.webContents.executeJavaScript(
      `({ tabs: document.querySelectorAll('[data-act="view"]').length,
          agents: document.querySelectorAll('[data-act="openChat"]').length,
          repos: document.querySelectorAll('[data-act="toggleNode"]').length })`,
    );
    console.log(`smoke: ${JSON.stringify(found)} errors=${errors.length}`);
    if (errors.length) console.error(errors.join('\n'));
    // `agents` and `repos` are just logged, not asserted: zero of either is the correct render
    // when no agent is running and no account/folder has been configured yet -- not a failure.
    app.exit(found.tabs === 6 && errors.length === 0 ? 0 : 1);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 620,
    // Same value as --app-bg, so the frame does not flash white before the page paints.
    backgroundColor: '#151223',
    title: 'Cute Agents Desk',
    // The packaged .exe carries the icon itself; this is what the taskbar shows while
    // running unpackaged with `npm start`.
    icon: path.join(ROOT, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL('app://desk/index.html');
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'bottom' });

  // `--smoke` is the only way to check the window from a script: a GUI launched by a
  // background shell reports nonsense for its own size, but "did the page load and paint
  // the tabs" is answerable without looking at it.
  if (process.argv.includes('--smoke')) smoke(win);

  // Prevent renderer from navigating away from the application
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== 'app://desk/index.html') {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  // A PR link or a report belongs in the real browser, not in a window with no address bar.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

/**
 * The three things the window can ask for, and the one thing it gets pushed.
 *
 * The renderer never sees a process or a path it did not already know about: it sends a task
 * and a repo, and receives derived state. Everything that can spawn or kill lives here.
 * @param {import('electron').BrowserWindow} win
 */
function wireAgents(win) {
  registry = new Registry((agents) => {
    if (!win.isDestroyed()) win.webContents.send('desk:patch', { agents });
  });
  const scheduler = new Scheduler();

  /**
   * The lifecycle wiring a plain worker and a coordinator both need: forward output through
   * `desk:patch`, and clear the agent out of `running` on exit. `getId` is a thunk because a
   * coordinator's own id is only known once `spawn()` returns -- inside the very options object
   * these callbacks belong to. `onExtraExit` is what only the coordinator needs on top: closing
   * its spawn-request watcher.
   * @param {() => string} getId
   * @param {(id: string) => void} [onExtraExit]
   */
  function wireLifecycle(getId, onExtraExit) {
    return {
      onOutput: (chunk) => {
        if (!win.isDestroyed()) win.webContents.send('desk:patch', { output: { id: getId(), chunk } });
      },
      onExit: (code) => {
        const id = getId();
        running.delete(id);
        onExtraExit?.(id);
        registry.exited(id, code);
      },
    };
  }

  ipcMain.handle('desk:agents', () => registry.list());

  // Scanning 71 real repos takes a moment; the renderer asks for this once on load, not on
  // every repaint, and getRepoData() caches the scan itself so re-invoking this handler is cheap.
  ipcMain.handle('desk:repos', () => getRepoData());

  const ALLOWED_ENGINES = new Set(['claude', 'agy', 'claude.exe', 'agy.exe']);

  /**
   * The one path that gates and spawns a worker, whether the request came from the window's own
   * `desk:spawn` IPC or from a coordinator's spawn-request file. One code path means the cap
   * logic can't drift between the two callers.
   * @param {object} o
   * @param {string} [o.cwd]
   * @param {string} o.task
   * @param {string} [o.conversationId]
   * @param {string} [o.replyTo]  the coordinator's agent id, when this worker was spawned on its
   *   behalf rather than directly from the window
   * @param {'read'|'write'|'plan'|'auto'} [o.mode]
   * @param {string} [o.bin]
   * @param {string} [o.engine]
   * @param {string} [o.model]
   * @param {string} [o.effort]
   * @returns {Promise<string | { error: string }>}
   */
  async function spawnWorker({ cwd, task, conversationId, replyTo, mode, bin, engine, model, effort }) {
    const rawBin = bin || engine || 'claude';
    const effectiveBin = ALLOWED_ENGINES.has(path.basename(rawBin).toLowerCase()) ? rawBin : 'claude';

    try {
      const { engineFor, validateAndSanitizeParams } = require('./agent.js');
      validateAndSanitizeParams({ engine: engineFor(effectiveBin), mode, model, effort });
    } catch (err) {
      const reason = err.message;
      registry.note(conversationId || 'scheduler', 'SpawnRefused', { reason, cwd, task });
      if (replyTo) registry.notifyCoordinator(replyTo, 'scheduler', `pedido rechazado: ${reason}`);
      return { error: reason };
    }

    // A path from anywhere other than the window's own trusted call must never reach `spawn`
    // unchecked (see agent.js's TRUST_PROMPT doc comment) — a coordinator's spawn-request is
    // exactly that "anywhere else", so its cwd is checked against the real, registered repos
    // before it can become a real process's cwd.
    if (cwd && cwd !== toyRepo()) {
      const { repos } = await getRepoData();
      if (!repos.some((r) => r.path === cwd)) {
        const reason = `"${cwd}" no es uno de los repos registrados`;
        registry.note(conversationId || 'scheduler', 'SpawnRefused', { reason, cwd, task });
        if (replyTo) registry.notifyCoordinator(replyTo, 'scheduler', `pedido rechazado: ${reason}`);
        return { error: reason };
      }
    }
    const conversation = conversationId && conv.getConversation(conversationId);
    const convGate = conversation
      ? { cap: conversation.cap, running: conv.runningInConversation(conversationId, registry.agents) }
      : undefined;
    // A coordinator can only *ask*; both caps are enforced here, not negotiable from the request
    // itself, per the plan's "los topes los impone el servidor".
    const gate = scheduler.canSpawn(running.size, convGate);
    if (!gate.ok) {
      registry.note(conversationId || 'scheduler', 'SpawnRefused', { reason: gate.reason, cwd, task });
      // Without this, a refused delegation just vanishes: no worker starts and the coordinator's
      // own terminal never says why, contradicting the "no insistas con el mismo archivo" line in
      // its own prompt, which assumes it can see the refusal.
      if (replyTo) registry.notifyCoordinator(replyTo, 'scheduler', `pedido rechazado: ${gate.reason}`);
      return { error: gate.reason };
    }
    cwd = cwd || toyRepo();
    // The id is what names the agent's folder, its branch and its report, so it has to be
    // readable in a directory listing — not a uuid.
    const id = `a${Date.now().toString(36).slice(-5)}`;
    // Only a worker with somewhere to send it gets told about the outbox — a bare desk:spawn
    // call has no coordinator, so the file would just sit there unread.
    const workerSystemPrompt = replyTo ? [
      'Puedes reportarle avances a tu coordinador en cualquier momento, ademas de tu informe',
      'final: escribe un archivo JSON con la forma { "message": "..." } en',
      `  ${paths.agent(id).outbox}\\<nombre-unico>.json`,
      'Es opcional -- usalo cuando tengas algo puntual que valga la pena que tu coordinador sepa',
      'antes de que termines.',
    ].join('\n') : undefined;
    const agent = spawn({
      id,
      cwd,
      task,
      mode,
      bin: effectiveBin,
      model,
      effort,
      systemPrompt: workerSystemPrompt,
      ...wireLifecycle(() => id),
      onNotice: (kind, detail) => registry.note(id, kind, detail),
    });
    running.set(id, agent);
    registry.register(agent, { conversationId, replyTo, model: agent.model, effort: agent.effort, mode: agent.mode });
    return id;
  }

  ipcMain.handle('desk:spawn', (_ev, opts) => spawnWorker(opts || {}));

  ipcMain.handle('desk:conversations', () => conv.listConversations());
  ipcMain.handle('desk:createConversation', (_ev, o) => conv.createConversation(o));

  ipcMain.handle('desk:spawnCoordinator', async (_ev, { conversationId, bin, engine, model, effort, mode } = {}) => {
    const conversation = conv.getConversation(conversationId);
    if (!conversation) return { error: `conversacion desconocida: ${conversationId}` };
    // A coordinator is a real PTY process in the same `running` map the global cap is measured
    // against — desk:spawn already gates on it, and this path was the one caller that didn't.
    const gate = scheduler.canSpawn(running.size);
    if (!gate.ok) {
      registry.note(conversationId, 'SpawnRefused', { reason: gate.reason });
      return { error: gate.reason };
    }
    const rawBin = bin || engine || 'claude';
    const effectiveBin = ALLOWED_ENGINES.has(path.basename(rawBin).toLowerCase()) ? rawBin : 'claude';

    try {
      const { engineFor, validateAndSanitizeParams } = require('./agent.js');
      validateAndSanitizeParams({ engine: engineFor(effectiveBin), mode, model, effort });
    } catch (err) {
      registry.note(conversationId, 'SpawnRefused', { reason: err.message });
      return { error: err.message };
    }

    const { repos } = await getRepoData();

    const agent = coordinator.spawnCoordinator({
      conversationId,
      conversation,
      repos,
      spawn,
      bin: effectiveBin,
      model,
      effort,
      mode,
      ...wireLifecycle(() => agent.id, (id) => {
        spawnRequestWatchers.get(id)?.close();
        spawnRequestWatchers.delete(id);
      }),
      onNotice: (kind, detail) => registry.note(agent.id, kind, detail),
    });
    running.set(agent.id, agent);
    registry.register(agent, { conversationId, role: 'coordinator', model: agent.model, effort: agent.effort, mode: agent.mode });

    const watcher = coordinator.watchSpawnRequests(conversationId, (req) => spawnWorker({
      cwd: req.cwd, task: req.objective, conversationId, replyTo: agent.id, mode: req.mode,
      bin: req.bin || req.engine, model: req.model, effort: req.effort,
    }));
    spawnRequestWatchers.set(agent.id, watcher);

    return agent.id;
  });

  ipcMain.handle('desk:stop', (_ev, id) => {
    running.get(id)?.kill();
    spawnRequestWatchers.get(id)?.close();
    spawnRequestWatchers.delete(id);
    return true;
  });

  // Manual reap only, per the plan: a worktree is never deleted on its own, so losing an
  // agent's uncommitted work is never a side effect of something else finishing.
  // Unlike getRepoData(), never memoized: these are cheap fs reads, and the data changes in the
  // background whenever Claude Desktop or Antigravity fire or reschedule a task, outside this app.
  ipcMain.handle('desk:scheduledTasks', () => getScheduledTasks());

  ipcMain.handle('desk:worktrees', () => worktree.listWorktrees());
  ipcMain.handle('desk:reapWorktree', (_ev, agentId) => {
    if (running.has(agentId)) return { error: 'el agente todavia esta vivo' };
    worktree.removeWorktree(agentId);
    return true;
  });
}

// A window closing must not leave a CLI running with nobody watching it: an orphan keeps
// spending tokens and still holds the repo's worktree.
app.on('before-quit', () => {
  for (const agent of running.values()) agent.kill();
  for (const watcher of spawnRequestWatchers.values()) watcher.close();
  registry?.stopAll();
});

// One window per machine: a second instance would fight over the PTYs and the gh account.
if (!app.requestSingleInstanceLock()) {
  // Saying it out loud matters for the scripted runs: a silent exit here looks exactly like a
  // window that failed to render.
  console.error('ya hay una ventana abierta; esta instancia se cierra');
  app.exit(2);
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    protocol.handle('app', serveFromRoot);
    const win = createWindow();
    wireAgents(win);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
