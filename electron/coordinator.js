'use strict';
// @ts-check
/**
 * A coordinator is a real CLI agent, not server code: the criterion for splitting up work comes
 * from a model, not an `if`. It never touches code itself -- its only two verbs are writing a
 * spawn request to its mailbox and reading `status.json` -- so what this file owns is the prompt
 * that teaches it those verbs, and the plumbing that turns a spawn-request file into a worker.
 */

const fs = require('node:fs');
const path = require('node:path');
const conv = require('./conversations.js');
const { drainJsonQueue, watchJsonQueue } = require('./json-queue.js');

/**
 * The system prompt appended to the coordinator's own, per the plan's "cuatro cosas": the repo
 * table, the mailbox protocol, its own cap, and where its status lives. Written for a CLI agent
 * to act on, not for a person to read -- concrete and short, not prose.
 * @param {{id: string, cap: number}} conversation
 * @param {Array<{name: string, accountGh: string, branch: string, path: string}>} repos
 * @param {object} [opts]
 * @param {string|Array<any>} [opts.skills]
 * @param {Array<{relativePath: string, absolutePath: string, engine?: string, scope?: string, excerpt?: string}>} [opts.repoDocs]
 */
function buildCoordinatorPrompt(conversation, repos, opts = {}) {
  const p = conv.conversationPaths(conversation.id);
  const repoLines = repos.length
    ? repos.map((r) => `- ${r.name} (cuenta ${r.accountGh}, rama ${r.branch}) -> ${r.path}`).join('\n')
    : '(sin repos declarados)';

  const promptParts = [
    'Eres el COORDINADOR de esta conversacion. Tu unico trabajo es descomponer el objetivo en',
    'tareas y delegarlas. Nunca edites codigo tu mismo: no tienes un repo propio donde pararte,',
    'tu directorio de trabajo es solo el buzon de esta conversacion.',
    '',
    'Repos disponibles:',
    repoLines,
  ];

  // Inyectar indice estructurado de documentacion anidada (si existe, con tope defensivo de 12 docs)
  if (Array.isArray(opts.repoDocs) && opts.repoDocs.length > 0) {
    promptParts.push(
      '',
      'Directivas y documentacion del proyecto encontradas en los repositorios:',
      'Usa estas directivas para guiar tus decisiones. Si requieres mas detalle de un modulo,',
      'puedes leer el archivo completo usando tu herramienta de lectura en su ruta absoluta.'
    );
    const cappedDocs = opts.repoDocs.slice(0, 12);
    for (const doc of cappedDocs) {
      promptParts.push(
        `<repo_guidelines scope="${doc.scope || 'general'}" path="${doc.absolutePath}">`,
        `Archivo: ${doc.relativePath} (motor recomendado: ${doc.engine || 'ambos'})`,
        doc.excerpt ? doc.excerpt.split('\n').map((l) => `  ${l}`).join('\n') : '  (sin extracto disponible)',
        '</repo_guidelines>'
      );
    }
    if (opts.repoDocs.length > 12) {
      promptParts.push(`(... y ${opts.repoDocs.length - 12} archivos de directivas adicionales en los repositorios)`);
    }
  }

  // Inyectar catalogo de skills segregado por motor (si existe)
  let skillsCatalog = '';
  if (typeof opts.skills === 'string') {
    skillsCatalog = opts.skills;
  } else if (Array.isArray(opts.skills)) {
    const { formatCompactCatalogByEngine } = require('./skills.js');
    skillsCatalog = formatCompactCatalogByEngine(opts.skills);
  }
  if (skillsCatalog.trim()) {
    promptParts.push('', skillsCatalog);
  }

  promptParts.push(
    '',
    'Para delegar una tarea, escribe un archivo JSON en:',
    `  ${path.join(p.dir, 'spawn-requests')}\\<nombre-unico>.json`,
    'con esta forma exacta:',
    '  { "id": "<id-opcional>", "objective": "que debe lograr", "cwd": "<ruta absoluta del repo>", "dependsOn": ["<id-previo>"], "mode": "write"|"plan"|"auto"|"read", "engine": "claude"|"agy", "model": "<modelo>", "effort": "low"|"medium"|"high" }',
    '"cwd" tiene que ser la ruta absoluta de uno de los repos de la lista de arriba. "mode",',
    '"engine", "model", "effort", "id" y "dependsOn" son opcionales (por defecto escribe con el motor predeterminado).',
    'Si defines "dependsOn", la tarea esperara en cola hasta que sus prerrequisitos finalicen con exito.',
    '',
    `Tu tope: a lo mas ${conversation.cap} workers vivos a la vez en esta conversacion. Un pedido`,
    'que se pase del tope se rechaza -- espera a que baje el numero de workers vivos antes de',
    'pedir otro, no insistas con el mismo archivo.',
    '',
    `Tu vista del estado de todos tus workers se mantiene en: ${p.status}`,
    'Leelo en vez de adivinar -- una linea por worker con su estado, tarea, herramienta actual y',
    'lo ultimo que reporto.',
    '',
    'Ademas de esas actualizaciones automaticas, un worker puede escribirte algo por su cuenta en',
    'cualquier momento -- lo veras en tu propia terminal como una linea que empieza con',
    '"[trabajador <id>] mensaje: ...". Es texto libre del worker, no un evento del sistema.'
  );

  return promptParts.join('\n');
}

/**
 * Start the coordinator's own CLI session. It has no code of its own to sit in, so its cwd is the
 * conversation's own folder -- it only writes spawn-request files there and reads status.json.
 * @param {object} o
 * @param {string} o.conversationId
 * @param {{id: string, cap: number}} o.conversation
 * @param {Array<{name: string, accountGh: string, branch: string, path: string}>} o.repos
 * @param {typeof import('./agent.js').spawn} o.spawn
 * @param {string} [o.bin]
 * @param {string} [o.model]
 * @param {string} [o.effort]
 * @param {'write'|'read'|'plan'|'auto'} [o.mode]
 * @param {string|Array<any>} [o.skills]
 * @param {Array<any>} [o.repoDocs]
 * @param {(chunk: string) => void} [o.onOutput]
 * @param {(code: number) => void} [o.onExit]
 * @param {(kind: string, detail: object) => void} [o.onNotice]
 * @returns {{ id: string } & ReturnType<typeof import('./agent.js').spawn>}
 */
function spawnCoordinator({ conversationId, conversation, repos, spawn, bin, model, effort, mode, skills, repoDocs, onOutput, onExit, onNotice }) {
  const dir = conv.conversationPaths(conversationId).dir;
  fs.mkdirSync(dir, { recursive: true });
  const id = `co${Date.now().toString(36).slice(-5)}`;
  const agent = spawn({
    id,
    cwd: dir,
    task: 'Empieza: revisa tu system prompt y decide en que repos delegar trabajo.',
    bin,
    model,
    effort,
    mode,
    systemPrompt: buildCoordinatorPrompt(conversation, repos, { skills, repoDocs }),
    // The conversation folder is never a git repo, so a worktree here would always fail to
    // create — skip the doomed `git rev-parse` call and the spurious error log entirely.
    worktree: false,
    onOutput,
    onExit,
    onNotice,
  });
  return { ...agent, id };
}

/**
 * Watch `<conversation dir>/spawn-requests/` for the coordinator's delegation requests. See
 * `json-queue.js` for the drain mechanics shared with `Registry`'s inbox and outbox.
 *
 * Only carries requests coordinator -> new worker; the reverse direction (a worker's automatic
 * spawned/blocked/done reports, plus its own free-form messages) is `Registry.notifyCoordinator`
 * and `watchOutbox` in `events.js`, typed straight into this coordinator's own live terminal
 * rather than routed through a file here.
 * @param {string} conversationId
 * @param {(req: {id?: string, dependsOn?: string[], objective: string, cwd: string, mode?: 'read'|'write'|'plan'|'auto', bin?: string, engine?: string, model?: string, effort?: string}) => (boolean|void|Promise<any>)} onRequest
 *   a `false` return leaves the request file in place for the next drain instead of consuming it
 * @returns {{ close: () => void }}
 */
function watchSpawnRequests(conversationId, onRequest) {
  const dir = path.join(conv.conversationPaths(conversationId).dir, 'spawn-requests');
  return watchJsonQueue(dir, () => drainJsonQueue(dir, (req) => {
    if (!req || !req.objective || !req.cwd) return false;
    const item = { objective: req.objective, cwd: req.cwd, mode: req.mode };
    if (req.id) item.id = req.id;
    if (Array.isArray(req.dependsOn)) item.dependsOn = req.dependsOn;
    if (req.bin) item.bin = req.bin;
    if (req.engine) item.engine = req.engine;
    if (req.model) item.model = req.model;
    if (req.effort) item.effort = req.effort;
    return onRequest(item);
  }));
}

module.exports = { buildCoordinatorPrompt, spawnCoordinator, watchSpawnRequests };
