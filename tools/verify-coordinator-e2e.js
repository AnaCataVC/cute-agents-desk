// @ts-check
/**
 * The one thing neither backend nor UI unit test could prove on its own: a spawn-request file
 * dropped into a real conversation's mailbox actually results in a real second CLI agent being
 * spawned, registered, and reporting through its own hooks -- not just that the watcher's
 * drain logic runs (tools/verify-coordinator.js already proved that with a mock callback).
 *
 * The coordinator's own LLM turn is deliberately NOT exercised here: whether it *decides* to
 * delegate is a product-quality question for later, and a live turn is nondeterministic and
 * costs real tokens for no plumbing benefit. Instead this hand-writes the spawn-request a real
 * coordinator would produce and lets the real watcher + a real spawn take it from there.
 *
 * Run with: node_modules/electron/dist/electron.exe tools/verify-coordinator-e2e.js
 */

require('./test-home.js');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { Registry } = require('../electron/events.js');
const { spawn } = require('../electron/agent.js');
const { watchSpawnRequests } = require('../electron/coordinator.js');
const conv = require('../electron/conversations.js');
const { toyRepo } = require('../electron/toy-repo.js');
const paths = require('../electron/paths.js');

const DEADLINE_MS = 180000;

app.whenReady().then(() => {
  const cwd = toyRepo();
  const startedAt = new Date().toISOString();
  const conversation = conv.createConversation({ title: 'verify-e2e', cap: 2 });
  const seen = [];
  let workerId = null;
  let done = false;

  const registry = new Registry((agents) => {
    const worker = agents.find((a) => a.id === workerId);
    if (!worker) return;
    const line = `${worker.state} · ${worker.tool}`;
    if (seen[seen.length - 1] !== line) {
      seen.push(line);
      console.log(`  ${worker.state.padEnd(9)} ${worker.tool}`);
    }
    if (worker.state === 'idle' && !done) setTimeout(() => { workerAgent.kill(); }, 1500);
  });

  let workerAgent;
  const watcher = watchSpawnRequests(conversation.id, (req) => {
    console.log(`spawn-request drenado: ${JSON.stringify(req)}`);
    const id = `w${Date.now().toString(36).slice(-5)}`;
    workerId = id;
    workerAgent = spawn({
      id,
      cwd: req.cwd,
      task: req.objective,
      mode: req.mode || 'write',
      onExit: (code) => finish(code),
    });
    registry.register(workerAgent, { conversationId: conversation.id, replyTo: 'coordinator-stub' });
  });

  console.log(`conversacion: ${conversation.id} (cap ${conversation.cap})`);
  console.log(`escribiendo spawn-request a mano en ${conv.conversationPaths(conversation.id).dir}/spawn-requests/`);

  const requestsDir = path.join(conv.conversationPaths(conversation.id).dir, 'spawn-requests');
  fs.mkdirSync(requestsDir, { recursive: true });
  fs.writeFileSync(path.join(requestsDir, 'req-1.json'), JSON.stringify({
    objective: 'Lee README.md y agrega al final una linea que diga "delegado". Nada mas.',
    cwd,
  }));

  const timer = setTimeout(() => {
    console.error(`\nsin terminar a los ${DEADLINE_MS / 1000}s`);
    if (workerAgent) workerAgent.kill(); else finish(1);
  }, DEADLINE_MS);

  // The watcher itself is async (fs.watch), so give it a moment before declaring "never fired".
  const noWorkerTimer = setTimeout(() => {
    if (!workerId) { console.error('\nel watcher nunca disparo onRequest'); finish(1); }
  }, 5000);

  function finish(code) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearTimeout(noWorkerTimer);
    watcher.close();

    const requestFileGone = !fs.existsSync(path.join(requestsDir, 'req-1.json'));
    const readme = fs.readFileSync(path.join(cwd, 'README.md'), 'utf8');
    const events = fs.readFileSync(paths.eventsLog, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l)).filter((e) => e.agentId === workerId && e.at >= startedAt);
    const kinds = [...new Set(events.map((e) => e.event))];

    console.log('\nresultado');
    console.log(`  worker id:            ${workerId}`);
    console.log(`  archivo de pedido:    ${requestFileGone ? 'borrado tras actuarlo' : 'SIGUE AHI'}`);
    console.log(`  eventos del worker:   ${events.length} (${kinds.join(', ')})`);
    console.log(`  README:               ${readme.includes('delegado') ? 'la linea quedo escrita' : 'sin cambios'}`);

    require('node:child_process').execFileSync('git', ['checkout', '--', 'README.md'], { cwd });
    fs.rmSync(conv.conversationPaths(conversation.id).dir, { recursive: true, force: true });

    const ok = !!workerId && requestFileGone && kinds.includes('PreToolUse') && readme.includes('delegado');
    console.log(ok
      ? '\ncoordinador->trabajador end-to-end OK: el pedido escrito genero un agente real que hizo el trabajo'
      : '\ncoordinador->trabajador end-to-end NO cumple');
    app.exit(ok ? 0 : (code || 1));
  }
});
