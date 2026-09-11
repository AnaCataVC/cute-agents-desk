// @ts-check
/**
 * Plan verification #7: "con tres workers vivos en una conversacion, matar uno a la fuerza
 * (taskkill) y confirmar que su status.json pasa a failed sin que nadie lo reporte, que el
 * coordinador lo ve al leer el archivo, y que el correo de los otros dos sigue llegando. Luego
 * intentar desde un worker escribir en el inbox de otra conversacion y verificar que el poller
 * lo rechaza."
 *
 * The registry-level half of this (exited() sets failed, writes status.json, doesn't touch
 * siblings) is already covered by verify-coordinator-status.js with a fake handle. What's
 * genuinely untested is the real-OS half the plan's own risk table calls out by name --
 * "node-pty en Windows (procesos huerfanos, codigos de salida mentirosos)" -- so this spawns one
 * REAL process via node-pty (not `claude`, no reason to spend tokens proving an OS fact) and
 * kills it externally with `taskkill`, exactly as a person would from Task Manager, to confirm
 * `term.onExit` really fires and reaches `Registry.exited()` the same way agent.js wires it.
 *
 * Run with: node tools/verify-forced-kill.js
 */

require('./test-home.js');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const pty = require('node-pty');
const conv = require('../electron/conversations.js');
const coordinator = require('../electron/coordinator.js');
const { Registry } = require('../electron/events.js');

async function main() {
  const conversation = conv.createConversation({ title: 'verify-forced-kill', cap: 5 });
  const coordinatorWrites = [];
  const registry = new Registry(() => {});

  registry.register(
    { id: 'coord1', cwd: conv.conversationPaths(conversation.id).dir, task: 'coordina', pid: 1,
      write: (t) => coordinatorWrites.push(t), kill: () => {} },
    { conversationId: conversation.id, role: 'coordinator' },
  );

  // Two ordinary siblings, fake handles -- what matters for them is that nothing about killing
  // a THIRD worker ever touches their own records or stops their own mail from landing.
  registry.register(
    { id: 'sibling-a', cwd: 'C:/fake/repo-a', task: 'tarea a', pid: 2, write: () => {}, kill: () => {} },
    { conversationId: conversation.id, replyTo: 'coord1' },
  );
  registry.register(
    { id: 'sibling-b', cwd: 'C:/fake/repo-b', task: 'tarea b', pid: 3, write: () => {}, kill: () => {} },
    { conversationId: conversation.id, replyTo: 'coord1' },
  );

  // The one that actually dies: a REAL long-lived process, wired through onExit exactly like
  // agent.js does, so a forced OS-level kill is what triggers registry.exited() -- not a call
  // the test makes on the agent's behalf.
  const term = pty.spawn('cmd.exe', ['/c', 'ping -t 127.0.0.1'], {
    name: 'xterm-256color', cols: 80, rows: 20, useConpty: true,
  });
  const victimId = 'victim1';
  term.onExit(({ exitCode }) => registry.exited(victimId, exitCode));
  registry.register(
    { id: victimId, cwd: 'C:/fake/repo-victim', task: 'tarea que se cuelga', pid: term.pid,
      write: (t) => term.write(t), kill: () => term.kill() },
    { conversationId: conversation.id, replyTo: 'coord1' },
  );

  const writesBeforeKill = coordinatorWrites.length; // three "arranco" notices so far

  // A real forced kill, external to the harness -- same command a person would run from outside
  // this app, and the same one agent.js's own kill() uses internally.
  execFileSync('taskkill', ['/PID', String(term.pid), '/T', '/F']);

  // ConPTY's exit callback is asynchronous relative to the OS process actually dying; give it a
  // real window instead of asserting in the same tick.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const status = JSON.parse(require('node:fs')
    .readFileSync(conv.conversationPaths(conversation.id).status, 'utf8'));

  assert.strictEqual(status.victim1.state, 'failed',
    'un taskkill externo debe reflejarse como failed sin que el worker haya reportado nada');
  assert.strictEqual(status['sibling-a'].state, 'spawning',
    'matar a un worker no debe tocar el estado de otro');
  assert.strictEqual(status['sibling-b'].state, 'spawning',
    'matar a un worker no debe tocar el estado de otro');

  assert.ok(coordinatorWrites.length > writesBeforeKill,
    'el coordinador debe enterarse de que el worker murio, sin que nadie se lo reporte a mano');
  assert.match(coordinatorWrites[coordinatorWrites.length - 1], /victim1.*failed/);

  // The mail of the other two must keep landing after one sibling's forced death -- a Notification
  // from sibling-a should still reach the coordinator normally.
  const before = coordinatorWrites.length;
  registry.apply('sibling-a', { event: 'Notification', at: new Date().toISOString(), payload: { message: 'esperando aprobacion' } });
  registry.publish();
  assert.ok(coordinatorWrites.length > before,
    'el correo de un worker vivo debe seguir llegando aunque otro haya muerto a la fuerza');

  // Cross-conversation isolation: a coordinator's spawn-requests watcher only ever fires for
  // requests dropped into ITS OWN conversation's directory -- a request written into a different
  // conversation's folder must never reach this one's callback.
  const conversationB = conv.createConversation({ title: 'verify-forced-kill-b', cap: 5 });
  let sawInWatcherA = false;
  let sawInWatcherB = false;
  const watcherA = coordinator.watchSpawnRequests(conversation.id, () => { sawInWatcherA = true; });
  const watcherB = coordinator.watchSpawnRequests(conversationB.id, () => { sawInWatcherB = true; });

  const fs = require('node:fs');
  const path = require('node:path');
  const foreignDir = path.join(conv.conversationPaths(conversationB.id).dir, 'spawn-requests');
  fs.mkdirSync(foreignDir, { recursive: true });
  fs.writeFileSync(path.join(foreignDir, 'sneaky.json'),
    JSON.stringify({ objective: 'algo', cwd: 'C:/fake/repo-a' }));

  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.strictEqual(sawInWatcherA, false,
    'un spawn-request escrito en la carpeta de OTRA conversacion no debe llegarle a esta');
  assert.strictEqual(sawInWatcherB, true,
    'ese mismo spawn-request si debe llegarle a la conversacion cuya carpeta realmente es');

  watcherA.close();
  watcherB.close();

  console.log('kill forzado OK: taskkill externo se refleja como failed sin auto-reporte, no toca '
    + 'a los hermanos, su correo sigue llegando, y un spawn-request ajeno nunca cruza de conversacion');
  registry.exited('coord1', 0);
  registry.exited('sibling-a', 0);
  registry.exited('sibling-b', 0);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
