// @ts-check
/**
 * Unit verification for the Task Dependencies DAG in Scheduler.
 * Tests dependency resolution, pending queues, DFS cycle detection, and fail-fast cascades.
 * Pure logic test -- no real PTY or Electron window needed.
 *
 * Run with: node tools/verify-scheduler-dag.js
 */

require('./test-home.js');
const assert = require('node:assert');
const { Scheduler, sanitizeTaskId } = require('../electron/scheduler.js');

async function testSchedulerDAG() {
  const scheduler = new Scheduler({ globalCap: 10 });

  // --- 1. Sequential execution with dependency chain A -> B -> C ---
  const executed = [];
  const spawnMock = (req) => {
    executed.push(req.id);
  };

  const reqA = { id: 'task-A', objective: 'Compile core', cwd: 'C:/repos/app' };
  const resA = scheduler.enqueueTask(reqA, spawnMock);
  assert.strictEqual(resA.ok, true);
  assert.strictEqual(resA.queued, false, 'Task A without dependencies must run immediately');
  assert.strictEqual(scheduler.taskStates.get('task-A'), 'running');
  assert.deepStrictEqual(executed, ['task-A']);

  const reqB = { id: 'task-B', dependsOn: ['task-A'], objective: 'Run unit tests', cwd: 'C:/repos/app' };
  const resB = scheduler.enqueueTask(reqB, spawnMock);
  assert.strictEqual(resB.ok, true);
  assert.strictEqual(resB.queued, true, 'Task B must be queued waiting for task A');
  assert.strictEqual(scheduler.taskStates.get('task-B'), 'pending');
  assert.deepStrictEqual(executed, ['task-A'], 'Task B should not have run yet');

  const reqC = { id: 'task-C', dependsOn: ['task-B'], objective: 'Generate coverage report', cwd: 'C:/repos/app' };
  const resC = scheduler.enqueueTask(reqC, spawnMock);
  assert.strictEqual(resC.ok, true);
  assert.strictEqual(resC.queued, true, 'Task C must be queued waiting for task B');
  assert.strictEqual(scheduler.taskStates.get('task-C'), 'pending');

  // Complete A -> B should automatically unlock and run
  const releasedA = scheduler.onTaskCompleted('task-A');
  assert.deepStrictEqual(releasedA, ['task-B'], 'Completing A must release B');
  assert.strictEqual(scheduler.taskStates.get('task-A'), 'done');
  assert.strictEqual(scheduler.taskStates.get('task-B'), 'running');
  assert.strictEqual(scheduler.taskStates.get('task-C'), 'pending');
  assert.deepStrictEqual(executed, ['task-A', 'task-B']);

  // Complete B -> C should automatically unlock and run
  const releasedB = scheduler.onTaskCompleted('task-B');
  assert.deepStrictEqual(releasedB, ['task-C'], 'Completing B must release C');
  assert.strictEqual(scheduler.taskStates.get('task-B'), 'done');
  assert.strictEqual(scheduler.taskStates.get('task-C'), 'running');
  assert.deepStrictEqual(executed, ['task-A', 'task-B', 'task-C']);

  // Complete C
  scheduler.onTaskCompleted('task-C');
  assert.strictEqual(scheduler.taskStates.get('task-C'), 'done');
  console.log('DAG resolution OK: Tareas en cadena se liberan secuencialmente al completarse');

  // --- 2. DFS Cycle Detection ---
  const cycleScheduler = new Scheduler();

  // Self-cycle: X depends on X
  assert.strictEqual(cycleScheduler.hasCycle('task-X', ['task-X']), true, 'Self-dependency is a cycle');
  const resSelf = cycleScheduler.enqueueTask({ id: 'task-X', dependsOn: ['task-X'] }, () => {});
  assert.strictEqual(resSelf.ok, false, 'Enqueueing self-cycle must be refused');

  // Direct 2-node cycle: 1 -> 2, then 2 re-requested depending on 1. Every dependency must already
  // be known, so the only way to close a loop is re-enqueueing an existing id.
  cycleScheduler.enqueueTask({ id: 'seed' }, () => {});
  cycleScheduler.enqueueTask({ id: 'node-2', dependsOn: ['seed'] }, () => {});
  cycleScheduler.enqueueTask({ id: 'node-1', dependsOn: ['node-2'] }, () => {});
  assert.strictEqual(cycleScheduler.hasCycle('node-2', ['node-1']), true, 'Direct circular dependency must be detected');
  const resCycle2 = cycleScheduler.enqueueTask({ id: 'node-2', dependsOn: ['node-1'] }, () => {});
  assert.strictEqual(resCycle2.ok, false);
  assert.ok(/Ciclo/.test(resCycle2.reason));

  // Transitive 3-node cycle: alpha -> beta -> gamma -> alpha
  const transScheduler = new Scheduler();
  transScheduler.enqueueTask({ id: 'seed' }, () => {});
  transScheduler.enqueueTask({ id: 'gamma', dependsOn: ['seed'] }, () => {});
  transScheduler.enqueueTask({ id: 'beta', dependsOn: ['gamma'] }, () => {});
  transScheduler.enqueueTask({ id: 'alpha', dependsOn: ['beta'] }, () => {});
  assert.strictEqual(transScheduler.hasCycle('gamma', ['alpha']), true, 'Transitive cycle must be detected');
  const resTrans = transScheduler.enqueueTask({ id: 'gamma', dependsOn: ['alpha'] }, () => {});
  assert.strictEqual(resTrans.ok, false);
  console.log('Cycle detection OK: Detección DFS previene auto-ciclos y dependencias circulares directas o transitivas');

  // --- 3. Fail-fast cascade policy ---
  const failScheduler = new Scheduler();
  const failExecuted = [];
  failScheduler.enqueueTask({ id: 'parent-task' }, (req) => failExecuted.push(req.id));
  failScheduler.enqueueTask({ id: 'child-task', dependsOn: ['parent-task'] }, (req) => failExecuted.push(req.id));
  failScheduler.enqueueTask({ id: 'grandchild-task', dependsOn: ['child-task'] }, (req) => failExecuted.push(req.id));

  assert.strictEqual(failScheduler.taskStates.get('child-task'), 'pending');
  assert.strictEqual(failScheduler.taskStates.get('grandchild-task'), 'pending');

  // Simulate parent task failure
  const cascade = failScheduler.onTaskFailed('parent-task', 'Exit code 1');
  assert.strictEqual(failScheduler.taskStates.get('parent-task'), 'failed');
  assert.ok(cascade.includes('child-task'), 'Child task must be aborted in cascade');
  assert.ok(cascade.includes('grandchild-task'), 'Grandchild task must be aborted in cascade');
  assert.strictEqual(failScheduler.taskStates.get('child-task'), 'failed');
  assert.strictEqual(failScheduler.taskStates.get('grandchild-task'), 'failed');
  assert.deepStrictEqual(failExecuted, ['parent-task'], 'Failed downstream tasks must never execute');

  // Enqueueing a task that depends on an already failed task must be refused immediately
  const resLate = failScheduler.enqueueTask({ id: 'late-task', dependsOn: ['parent-task'] }, () => {});
  assert.strictEqual(resLate.ok, false);
  assert.ok(/fallida/i.test(resLate.reason), 'Task depending on a failed prerequisite must be rejected fail-fast');
  console.log('Fail-fast cascade OK: Fallos en upstream abortan tareas pendientes y rechazan nuevas dependientes');

  // --- 4. Parallel diamond dependency graph: A -> [B, C] -> D ---
  const diamondScheduler = new Scheduler();
  const diamondRuns = [];
  diamondScheduler.enqueueTask({ id: 'A' }, (req) => diamondRuns.push(req.id));
  diamondScheduler.enqueueTask({ id: 'B', dependsOn: ['A'] }, (req) => diamondRuns.push(req.id));
  diamondScheduler.enqueueTask({ id: 'C', dependsOn: ['A'] }, (req) => diamondRuns.push(req.id));
  diamondScheduler.enqueueTask({ id: 'D', dependsOn: ['B', 'C'] }, (req) => diamondRuns.push(req.id));

  // Initially only A is running
  assert.deepStrictEqual(diamondRuns, ['A']);
  // Completing A should unlock both B and C
  const releasedFromA = diamondScheduler.onTaskCompleted('A');
  assert.strictEqual(releasedFromA.includes('B'), true);
  assert.strictEqual(releasedFromA.includes('C'), true);
  assert.strictEqual(diamondScheduler.taskStates.get('D'), 'pending', 'D must still wait for both B and C');

  // Completing B alone shouldn't unlock D
  diamondScheduler.onTaskCompleted('B');
  assert.strictEqual(diamondScheduler.taskStates.get('D'), 'pending');

  // Completing C unlocks D
  const releasedFromC = diamondScheduler.onTaskCompleted('C');
  assert.deepStrictEqual(releasedFromC, ['D']);
  assert.strictEqual(diamondScheduler.taskStates.get('D'), 'running');
  console.log('Diamond DAG OK: Tarea D espera a que ramas paralelas B y C concluyan');

  // --- 5. snapshot() only surfaces tasks that never got a real agent spawned for them ---
  const snapScheduler = new Scheduler();
  snapScheduler.enqueueTask({ id: 'ran-task' }, () => {});
  snapScheduler.enqueueTask({ id: 'queued-task', dependsOn: ['ran-task'] }, () => {});
  snapScheduler.enqueueTask({ id: 'queued-grandchild', dependsOn: ['queued-task'] }, () => {});

  let snap = snapScheduler.snapshot();
  assert.ok(!snap.some((t) => t.id === 'ran-task'), 'A task that already spawned must not appear in snapshot');
  assert.deepStrictEqual(snap.find((t) => t.id === 'queued-task'), { id: 'queued-task', state: 'pending', dependsOn: ['ran-task'] });

  // ran-task later fails at runtime (its own agent exited non-zero): it already has a real agent
  // record, so it must stay out of snapshot even after onTaskFailed marks it 'failed'.
  const cascadeIds = snapScheduler.onTaskFailed('ran-task', 'exit 1');
  assert.ok(cascadeIds.includes('queued-task') && cascadeIds.includes('queued-grandchild'));
  snap = snapScheduler.snapshot();
  assert.ok(!snap.some((t) => t.id === 'ran-task'), 'A task that spawned and failed later must not become a ghost');
  const ghostChild = snap.find((t) => t.id === 'queued-task');
  assert.ok(ghostChild, 'A cascade-failed task that never spawned must still appear');
  assert.strictEqual(ghostChild.state, 'failed');
  console.log('Snapshot OK: solo expone tareas que nunca llegaron a spawnearse (en cola o abortadas en cascada)');

  // --- 6. Unknown dependencies are refused instead of waiting forever ---
  const unknownScheduler = new Scheduler();
  const resUnknown = unknownScheduler.enqueueTask({ id: 'orphan', dependsOn: ['never-queued'] }, () => {});
  assert.strictEqual(resUnknown.ok, false);
  assert.ok(/never-queued/.test(resUnknown.reason), 'The refusal must name the unknown dependency');
  assert.strictEqual(unknownScheduler.taskStates.has('orphan'), false);

  // --- 7. Async spawnFn: {error}, rejection and a renamed agent id all reach the right key ---
  const asyncScheduler = new Scheduler();
  asyncScheduler.enqueueTask({ id: 'refused' }, async () => ({ error: 'cupo lleno' }));
  asyncScheduler.enqueueTask({ id: 'refused-child', dependsOn: ['refused'] }, () => {});
  asyncScheduler.enqueueTask({ id: 'rejected' }, async () => { throw new Error('boom'); });
  asyncScheduler.enqueueTask({ id: 'renamed' }, async () => 'a12345');
  const renamedRuns = [];
  asyncScheduler.enqueueTask({ id: 'renamed-child', dependsOn: ['renamed'] }, (req) => renamedRuns.push(req.id));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(asyncScheduler.taskStates.get('refused'), 'failed', 'A spawn refused with {error} must fail the task');
  assert.strictEqual(asyncScheduler.taskStates.get('refused-child'), 'failed', 'and cascade to its dependents');
  assert.strictEqual(asyncScheduler.taskStates.get('rejected'), 'failed', 'A rejected spawn must fail the task');
  asyncScheduler.onTaskCompleted('a12345');
  assert.strictEqual(asyncScheduler.taskStates.get('renamed'), 'done', 'The agent id must map back to its task id');
  assert.deepStrictEqual(renamedRuns, ['renamed-child']);

  assert.strictEqual(sanitizeTaskId('task A/../x'), 'taskAx');
  assert.strictEqual(sanitizeTaskId('***'), null);
  assert.strictEqual(sanitizeTaskId(42), null);
  assert.strictEqual(sanitizeTaskId('x'.repeat(40)).length, 32);
  console.log('Async spawn OK: rechazos y errores fallan la tarea, un id renombrado se mapea, dependencias desconocidas se rechazan');
}

testSchedulerDAG().then(() => {
  console.log('\nverify-scheduler-dag OK: 7/7 checks passing');
}).catch((err) => {
  console.error('verify-scheduler-dag FAILED:', err);
  process.exit(1);
});
