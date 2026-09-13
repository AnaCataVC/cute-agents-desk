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

const { app, BrowserWindow, protocol, net, shell, ipcMain, dialog } = require('electron');
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
const { getScheduledTasks, readTaskLogs } = require('./scheduled-tasks.js');
const { scanSkills, readSkillContent } = require('./skills.js');
const delivery = require('./delivery.js');

const ROOT = path.join(__dirname, '..');

/** Live agents, by id. The registry holds their state; this holds the terminals. */
const running = new Map();

/** A coordinator's spawn-request watcher, by its own agent id -- closed when it dies or is
 * stopped, so killing a coordinator never leaves an orphaned `fs.watch` behind. */
const spawnRequestWatchers = new Map();

/** @type {Registry} */
let registry;

const fs = require('node:fs');

/** @type {Promise<{accounts: object[], repos: object[]}>|null} */
let repoDataPromise = null;

function readCachedRepos() {
  try {
    if (fs.existsSync(paths.reposCache)) {
      return JSON.parse(fs.readFileSync(paths.reposCache, 'utf8'));
    }
  } catch { /* ignore corrupted cache */ }
  return null;
}

function writeCachedRepos(data) {
  try {
    fs.writeFileSync(paths.reposCache, JSON.stringify(data), 'utf8');
  } catch { /* best effort */ }
}

/**
 * The accounts/repos scan. Reads from cache immediately if present so window startup
 * doesn't wait 19s for 70+ git spawns. In the background, scanRepos refreshes the cache
 * and notifies the window.
 */
function getRepoData() {
  if (!repoDataPromise) {
    const cached = readCachedRepos();
    if (cached && Array.isArray(cached.repos) && cached.repos.length > 0) {
      repoDataPromise = Promise.resolve({ accounts: buildAccounts(), repos: cached.repos });
      const accountsConfig = readAccountsConfig();
      scanRepos(accountsConfig).then((repos) => {
        writeCachedRepos({ repos });
        const fresh = { accounts: buildAccounts(), repos };
        repoDataPromise = Promise.resolve(fresh);
        const [win] = BrowserWindow.getAllWindows();
        if (win && !win.isDestroyed()) {
          win.webContents.send('desk:patch', { repoData: fresh });
        }
      }).catch(() => {});
    } else {
      const accountsConfig = readAccountsConfig();
      repoDataPromise = scanRepos(accountsConfig).then((repos) => {
        writeCachedRepos({ repos });
        return { accounts: buildAccounts(), repos };
      });
    }
  }
  return repoDataPromise;
}

async function refreshRepoData() {
  const accountsConfig = readAccountsConfig();
  const repos = await scanRepos(accountsConfig);
  writeCachedRepos({ repos });
  const fresh = { accounts: buildAccounts(), repos };
  repoDataPromise = Promise.resolve(fresh);
  const [win] = BrowserWindow.getAllWindows();
  if (win && !win.isDestroyed()) {
    win.webContents.send('desk:patch', { repoData: fresh });
  }
  return fresh;
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
    const startTime = Date.now();
    let found = { tabs: 0, agents: 0, repos: 0 };
    while (Date.now() - startTime < 10000) {
      found = await win.webContents.executeJavaScript(
        `({ tabs: document.querySelectorAll('[data-act="view"]').length,
            agents: document.querySelectorAll('[data-act="openChat"]').length,
            repos: document.querySelectorAll('[data-act="toggleNode"]').length })`,
      );
      if (found.tabs === 6) break;
      await new Promise((r) => setTimeout(r, 100));
    }
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
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 1000);

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
  const config = require('./config.js');
  const appConfig = config.readConfig();

  registry = new Registry((agents, usage, threads) => {
    if (!win.isDestroyed()) win.webContents.send('desk:patch', { agents, usage, threads });
  });
  const scheduler = new Scheduler({ globalCap: appConfig.exec?.maxParallel || 5 });

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
        if (code === 0) {
          scheduler.onTaskCompleted(id);
        } else {
          const cascade = scheduler.onTaskFailed(id, `Exit code ${code}`);
          for (const failedId of cascade) {
            registry.note('scheduler', 'TaskCascadeFailed', { taskId: failedId, causedBy: id });
          }
        }
      },
    };
  }

  ipcMain.handle('desk:agents', () => registry.list());

  // Scanning 71 real repos takes a moment; the renderer asks for this once on load, not on
  // every repaint, and getRepoData() caches the scan itself so re-invoking this handler is cheap.
  ipcMain.handle('desk:repos', () => getRepoData());

  ipcMain.handle('desk:usage', () => registry.getUsage());
  ipcMain.handle('desk:quotas', (_ev, opts) => {
    const { getQuotas } = require('./quotas.js');
    return getQuotas(opts);
  });

  ipcMain.handle('desk:config', () => config.readConfig());
  ipcMain.handle('desk:updateConfig', (_ev, { section, key, value }) => {
    const res = config.updateConfigKey(section, key, value);
    if (res.ok && section === 'exec' && key === 'maxParallel') {
      scheduler.globalCap = res.config.exec.maxParallel;
    }
    return res;
  });

  ipcMain.handle('desk:setAccountColor', async (_ev, { accountId, color }) => {
    const { updateAccountColor, buildAccounts } = require('./accounts.js');
    const ok = updateAccountColor(accountId, color);
    if (ok) {
      const accounts = buildAccounts();
      if (repoDataPromise) {
        const current = await repoDataPromise;
        current.accounts = accounts;
      }
      return { ok: true, accounts };
    }
    return { ok: false };
  });

  ipcMain.handle('desk:setAccountEditor', async (_ev, { accountId, editor }) => {
    const { updateAccountEditor, buildAccounts } = require('./accounts.js');
    const ok = updateAccountEditor(accountId, editor);
    if (ok) {
      const accounts = buildAccounts();
      if (repoDataPromise) {
        const current = await repoDataPromise;
        current.accounts = accounts;
      }
      return { ok: true, accounts };
    }
    return { ok: false };
  });

  ipcMain.handle('desk:openEditor', async (_ev, { agentId, targetPath, filePath, line, editorChoice }) => {
    const editor = require('./editor.js');
    let effectiveTarget = targetPath;
    let effectiveEditor = editorChoice;

    if (agentId) {
      const wtDir = worktree.worktreeDirFor(agentId);
      if (fs.existsSync(wtDir)) {
        effectiveTarget = wtDir;
      }
      if (!effectiveEditor) {
        // Resolve account for this worktree
        const reg = registry?.agents?.get(agentId);
        const { readAccountsConfig } = require('./accounts.js');
        const accounts = readAccountsConfig();
        const acc = accounts.find((a) => (a.folders || []).some((f) => (reg?.cwd || '').toLowerCase().includes(f.path.toLowerCase())));
        if (acc?.editor) {
          effectiveEditor = acc.editor;
        }
      }
    }

    if (!effectiveTarget) {
      return { ok: false, error: 'No se encontró la ruta del worktree o archivo' };
    }

    return editor.openInEditor({
      targetPath: effectiveTarget,
      filePath,
      line,
      editorChoice: effectiveEditor,
      shell,
    });
  });

  ipcMain.handle('desk:addAccountFolder', async (_ev, { accountId, folderPath, depth }) => {
    const { addAccountFolder } = require('./accounts.js');
    const ok = addAccountFolder(accountId, folderPath, depth);
    if (ok) {
      const fresh = await refreshRepoData();
      return { ok: true, repoData: fresh };
    }
    return { ok: false, error: 'No se pudo añadir la carpeta' };
  });

  ipcMain.handle('desk:removeAccountFolder', async (_ev, { accountId, folderPath }) => {
    const { removeAccountFolder } = require('./accounts.js');
    const ok = removeAccountFolder(accountId, folderPath);
    if (ok) {
      const fresh = await refreshRepoData();
      return { ok: true, repoData: fresh };
    }
    return { ok: false, error: 'No se pudo quitar la carpeta' };
  });

  ipcMain.handle('desk:pickDirectory', async () => {
    const [win] = BrowserWindow.getAllWindows();
    const res = await dialog.showOpenDialog(win, {
      title: 'Seleccionar carpeta de repositorios',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

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
  async function spawnWorker(opts = {}) {
    let { cwd, task, conversationId, replyTo, bin, engine, model, effort, mode, id: customId, dependsOn } = opts;

    // Auto-resolve replyTo to the active coordinator if conversationId is given without explicit replyTo
    if (conversationId && !replyTo) {
      for (const a of registry.agents.values()) {
        if (a.conversationId === conversationId && a.role === 'coordinator' && a.state !== 'done' && a.state !== 'failed') {
          replyTo = a.id;
          break;
        }
      }
    }

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
    const safeCustomId = (customId && typeof customId === 'string')
      ? customId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
      : null;
    const id = (safeCustomId && !running.has(safeCustomId))
      ? safeCustomId
      : `a${Date.now().toString(36).slice(-5)}`;
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
    const engKey = effectiveBin.startsWith('agy') ? 'agy' : 'claude';
    const dynamicTokenCap = config.readConfig().engines?.[engKey]?.contextCap;
    registry.register(agent, {
      conversationId,
      replyTo,
      model: agent.model,
      effort: agent.effort,
      mode: agent.mode,
      tokenCap: dynamicTokenCap,
      dependsOn: opts.dependsOn || dependsOn || [],
    });
    return id;
  }

  ipcMain.handle('desk:spawn', (_ev, opts) => spawnWorker(opts || {}));

  ipcMain.handle('desk:conversations', () => conv.listConversations());
  ipcMain.handle('desk:createConversation', (_ev, o) => conv.createConversation(o));
  ipcMain.handle('desk:archiveConversation', (_ev, id) => conv.archiveConversation(id));

  ipcMain.handle('desk:spawnCoordinator', async (_ev, { conversationId, bin, engine, model, effort, mode } = {}) => {
    const conversation = conv.getConversation(conversationId);
    if (!conversation) return { error: `conversacion desconocida: ${conversationId}` };

    // Reuse coordinator if one is already alive for this conversation
    for (const a of registry.agents.values()) {
      if (a.conversationId === conversationId && a.role === 'coordinator' && a.state !== 'done' && a.state !== 'failed') {
        return a.id;
      }
    }
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

    // Async discovery of repo docs and skills scan
    let repoDocs = [];
    try {
      const { findRepoDocsAsync } = require('./discovery.js');
      const docPromises = repos.map((r) => findRepoDocsAsync(r.path));
      const allDocs = await Promise.all(docPromises);
      repoDocs = allDocs.flat();
    } catch { /* best effort */ }

    let skillsScan = [];
    try {
      skillsScan = scanSkills();
    } catch { /* best effort */ }

    const agent = coordinator.spawnCoordinator({
      conversationId,
      conversation,
      repos,
      skills: skillsScan,
      repoDocs,
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

    const watcher = coordinator.watchSpawnRequests(conversationId, (req) => {
      const enqueueRes = scheduler.enqueueTask(req, (taskReq) => spawnWorker({
        id: taskReq.id,
        cwd: taskReq.cwd,
        task: taskReq.objective,
        conversationId,
        replyTo: agent.id,
        mode: taskReq.mode,
        bin: taskReq.bin || taskReq.engine,
        model: taskReq.model,
        effort: taskReq.effort,
        dependsOn: taskReq.dependsOn,
      }));
      if (!enqueueRes.ok) {
        registry.notifyCoordinator(agent.id, 'scheduler', `pedido rechazado: ${enqueueRes.reason}`);
        registry.note(conversationId, 'SpawnRefused', { reason: enqueueRes.reason, req });
        return true;
      }
      if (enqueueRes.queued) {
        registry.notifyCoordinator(agent.id, 'scheduler', `tarea "${req.id || 'en cola'}" esperando dependencias: ${(req.dependsOn || []).join(', ')}`);
        registry.note(conversationId, 'TaskQueued', { taskId: req.id, dependsOn: req.dependsOn });
        return true;
      }
      return true;
    });
    spawnRequestWatchers.set(agent.id, watcher);

    return agent.id;
  });

  ipcMain.handle('desk:stop', (_ev, id) => {
    running.get(id)?.kill();
    spawnRequestWatchers.get(id)?.close();
    spawnRequestWatchers.delete(id);
    return true;
  });

  ipcMain.handle('desk:threads', () => (registry ? registry.getThreads() : {}));
  ipcMain.handle('desk:sendInput', async (_ev, { agentId, text } = {}) => {
    if (!agentId || typeof text !== 'string' || !text.trim()) {
      return { ok: false, error: 'Mensaje inválido' };
    }
    const targetAgent = running.get(agentId);
    const regAgent = registry?.agents?.get(agentId);
    if (!targetAgent || !regAgent) {
      return { ok: false, error: 'El agente no está activo o ha finalizado' };
    }
    if (regAgent.state === 'tool') {
      return { ok: false, error: 'El agente está ocupado ejecutando una herramienta. Espera a que termine su turno.' };
    }

    const sanitized = text
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][A-B0-2]|[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '')
      .slice(0, 4000)
      .trim();

    let destHandle = targetAgent;
    let messageToPty = `${sanitized}\r`;
    if (regAgent.replyTo && running.has(regAgent.replyTo)) {
      destHandle = running.get(regAgent.replyTo);
      messageToPty = `[mensaje del usuario sobre trabajador ${agentId}] ${sanitized}\r`;
      registry.recordMessage(regAgent.replyTo, 'user', 'tú', `[sobre ${agentId}]: ${sanitized}`);
    }

    destHandle.write(messageToPty);
    registry.recordMessage(agentId, 'user', 'tú', sanitized);
    registry.note(agentId, 'UserInputInjected', { length: sanitized.length });
    return { ok: true };
  });

  // Manual reap only, per the plan: a worktree is never deleted on its own, so losing an
  // agent's uncommitted work is never a side effect of something else finishing.
  // Unlike getRepoData(), never memoized: these are cheap fs reads, and the data changes in the
  // background whenever Claude Desktop or Antigravity fire or reschedule a task, outside this app.
  ipcMain.handle('desk:scheduledTasks', () => getScheduledTasks());
  ipcMain.handle('desk:skills', () => scanSkills());
  ipcMain.handle('desk:readSkill', (_ev, filePath) => readSkillContent(filePath));
  ipcMain.handle('desk:taskLogs', (_ev, { sourcePath, engine, taskId }) => readTaskLogs(sourcePath, engine, taskId));
  ipcMain.handle('desk:openPath', async (_ev, targetPath) => {
    if (!targetPath || typeof targetPath !== 'string') return { error: 'Ruta no válida' };
    try {
      if (!fs.existsSync(targetPath)) return { error: 'La ruta no existe en disco' };

      // Prevent accidental execution of binary files; open their parent directory instead
      const stat = fs.statSync(targetPath);
      let pathToOpen = targetPath;
      if (stat.isFile()) {
        const ext = path.extname(targetPath).toLowerCase();
        const executableExts = ['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msi'];
        if (executableExts.includes(ext)) {
          pathToOpen = path.dirname(targetPath);
        }
      }

      await shell.openPath(pathToOpen);
      return { ok: true };
    } catch (err) {
      return { error: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('desk:worktrees', () => worktree.listWorktrees());
  ipcMain.handle('desk:reapWorktree', (_ev, agentId) => {
    if (running.has(agentId)) return { error: 'el agente todavia esta vivo' };
    worktree.removeWorktree(agentId);
    return true;
  });
  ipcMain.handle('desk:reapCleanWorktrees', async () => {
    const runningAgentIds = Array.from(running.keys());
    const delivered = delivery.listDeliveries();
    const deliveredIds = delivered.map((d) => d.agentId || d.id);
    return await worktree.reapCleanWorktrees({ runningAgentIds, deliveredIds });
  });

  ipcMain.handle('desk:delivered', () => delivery.listDeliveries());
  ipcMain.handle('desk:deliver', async (_ev, opts) => {
    const appCfg = config.readConfig();
    const effectiveOpts = {
      ...opts,
      draftPR: opts?.draftPR !== undefined ? opts.draftPR : appCfg.deliver?.draftPR,
    };
    const res = await delivery.deliverAgent(effectiveOpts);
    if (res.ok && res.delivery) {
      registry.note(opts?.agentId, 'AgentDelivered', res.delivery);
    }
    return res;
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
