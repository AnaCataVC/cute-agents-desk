'use strict';
// @ts-check
/**
 * The one rule that has to hold before anything else: a coordinator can *ask*
 * for a worker, it can never spawn one. Whoever calls `spawn` goes through here first, and a
 * refusal is not silent -- it is worth an event, because "why didn't my request happen" needs
 * an answer that isn't "read the source".
 */

const DEFAULT_GLOBAL_CAP = 5;

/**
 * The one shape a task id may take once it leaves the coordinator's request: it becomes an agent
 * id, a directory name and a scheduler key, so all three must agree on the same sanitized string.
 * @param {unknown} rawId @returns {string | null}  null when nothing usable survives
 */
function sanitizeTaskId(rawId) {
  if (typeof rawId !== 'string') return null;
  return rawId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || null;
}

class Scheduler {
  /** @param {{ globalCap?: number }} [opts] */
  constructor({ globalCap = DEFAULT_GLOBAL_CAP } = {}) {
    this.globalCap = globalCap;
    /** @type {Map<string, 'pending' | 'running' | 'done' | 'failed'>} */
    this.taskStates = new Map();
    /** @type {Map<string, string[]>} */
    this.dependencies = new Map();
    /** @type {Map<string, { req: any, spawnFn: (req: any) => any }>} */
    this.pendingQueue = new Map();
    /** @type {Set<string>} task ids that actually got spawnFn called -- what tells `snapshot()`
     * apart a task still waiting on a dependency (or cascade-failed before ever running) from one
     * that ran and has its own real agent record elsewhere. */
    this.spawnedIds = new Set();
    /** @type {Map<string, string>} agent id -> task id, for a task whose spawn ended up under a
     * different id than the one it was queued with (the requested id was already taken). */
    this.agentToTask = new Map();
  }

  /** @param {string} id @returns {string} */
  taskIdOf(id) {
    return this.agentToTask.get(id) || id;
  }

  /**
   * Run `spawnFn` for a task and track its outcome. `spawnFn` may be async and may report a
   * refusal as `{ error }` instead of throwing; either way the task is marked failed so its
   * dependents cascade instead of waiting forever. A string result is the real agent id, mapped
   * back to the task id so the agent's exit reaches the right key.
   * @param {string | undefined} taskId @param {any} req @param {(req: any) => any} spawnFn
   * @returns {string | null}  the failure reason when spawnFn threw synchronously
   */
  launch(taskId, req, spawnFn) {
    let result;
    try {
      result = spawnFn(req);
    } catch (err) {
      const reason = err && err.message ? err.message : String(err);
      if (taskId) this.onTaskFailed(taskId, reason);
      return reason;
    }
    Promise.resolve(result).then((outcome) => {
      if (!taskId) return;
      if (outcome && typeof outcome === 'object' && outcome.error) {
        this.onTaskFailed(taskId, outcome.error);
      } else if (typeof outcome === 'string' && outcome !== taskId) {
        this.agentToTask.set(outcome, taskId);
      }
    }, (err) => {
      if (taskId) this.onTaskFailed(taskId, err && err.message ? err.message : String(err));
    });
    return null;
  }

  /**
   * @param {number} runningCount  agents currently alive, machine-wide
   * @param {{ cap: number, running: number }} [conversation]  the conversation's own cap and how
   *   many of its own workers are alive, when this spawn is on behalf of one. A coordinator can
   *   only ask; both checks run and either can refuse, but only the conversation's own count is
   *   compared to the conversation's own cap — the global cap never punishes one conversation
   *   for another's load.
   * @returns {{ ok: true } | { ok: false, reason: string }}
   */
  canSpawn(runningCount, conversation) {
    if (runningCount >= this.globalCap) {
      return { ok: false, reason: `cupo global lleno (${runningCount}/${this.globalCap})` };
    }
    if (conversation && conversation.running >= conversation.cap) {
      return { ok: false, reason: `cupo de la conversacion lleno (${conversation.running}/${conversation.cap})` };
    }
    return { ok: true };
  }

  /**
   * DFS Cycle detection in the dependency graph.
   * A cycle is formed if any prerequisite can reach `taskId` through existing dependency chains.
   * @param {string} taskId
   * @param {string[]} deps
   * @returns {boolean}
   */
  hasCycle(taskId, deps) {
    if (!taskId || !Array.isArray(deps) || deps.length === 0) return false;
    if (deps.includes(taskId)) return true;

    const visited = new Set();
    const stack = [...deps];

    while (stack.length > 0) {
      const curr = stack.pop();
      if (!curr) continue;
      if (curr === taskId) return true;
      if (!visited.has(curr)) {
        visited.add(curr);
        const nextDeps = this.dependencies.get(curr);
        if (Array.isArray(nextDeps)) {
          for (const next of nextDeps) {
            if (next === taskId) return true;
            stack.push(next);
          }
        }
      }
    }
    return false;
  }

  /**
   * Enqueue or directly run a task according to its dependency graph.
   * @param {object} req
   * @param {string} [req.id]
   * @param {string[]} [req.dependsOn]
   * @param {(req: any) => any} spawnFn
   * @returns {{ ok: true, queued: boolean } | { ok: false, reason: string }}
   */
  enqueueTask(req, spawnFn) {
    if (!req) return { ok: false, reason: 'Pedido de tarea nulo o inválido' };
    const taskId = req.id;
    const deps = Array.isArray(req.dependsOn) ? req.dependsOn.filter(Boolean) : [];

    // If no dependencies, run immediately
    if (deps.length === 0) {
      if (taskId) {
        this.taskStates.set(taskId, 'running');
        this.spawnedIds.add(taskId);
      }
      const reason = this.launch(taskId, req, spawnFn);
      return reason ? { ok: false, reason } : { ok: true, queued: false };
    }

    // Check for cycles
    if (taskId && this.hasCycle(taskId, deps)) {
      return { ok: false, reason: `Ciclo de dependencias detectado para tarea "${taskId}"` };
    }

    // A dependency nobody ever queued can never complete, so the task would wait forever.
    const unknown = deps.filter((depId) => !this.taskStates.has(depId));
    if (unknown.length > 0) {
      return { ok: false, reason: `Dependencias desconocidas (nunca encoladas): ${unknown.join(', ')}` };
    }

    // Fail-fast: if any prerequisite has already failed, abort immediately
    for (const depId of deps) {
      if (this.taskStates.get(depId) === 'failed') {
        if (taskId) this.taskStates.set(taskId, 'failed');
        return { ok: false, reason: `Dependencia previa fallida: "${depId}"` };
      }
    }

    // Check if all prerequisites are already satisfied ('done')
    const allDone = deps.every((depId) => this.taskStates.get(depId) === 'done');
    if (allDone) {
      if (taskId) {
        this.dependencies.set(taskId, deps);
        this.taskStates.set(taskId, 'running');
        this.spawnedIds.add(taskId);
      }
      const reason = this.launch(taskId, req, spawnFn);
      return reason ? { ok: false, reason } : { ok: true, queued: false };
    }

    // Prerequisite pending or running: queue the task
    const effectiveId = taskId || `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    req.id = effectiveId;
    this.dependencies.set(effectiveId, deps);
    this.taskStates.set(effectiveId, 'pending');
    this.pendingQueue.set(effectiveId, { req, spawnFn });
    return { ok: true, queued: true };
  }

  /**
   * Notify scheduler that a task completed successfully.
   * Evaluates pendingQueue and triggers any tasks whose dependencies are now all satisfied.
   * @param {string} agentOrTaskId  an agent id is mapped back to the task it ran
   * @returns {string[]} ids of newly released and spawned tasks
   */
  onTaskCompleted(agentOrTaskId) {
    if (!agentOrTaskId) return [];
    const taskId = this.taskIdOf(agentOrTaskId);
    this.taskStates.set(taskId, 'done');

    const released = [];
    let progress = true;

    while (progress) {
      progress = false;
      for (const [pendingId, item] of Array.from(this.pendingQueue.entries())) {
        const deps = this.dependencies.get(pendingId) || [];
        const allDone = deps.every((depId) => this.taskStates.get(depId) === 'done');
        if (allDone) {
          this.pendingQueue.delete(pendingId);
          this.taskStates.set(pendingId, 'running');
          this.spawnedIds.add(pendingId);
          released.push(pendingId);
          this.launch(pendingId, item.req, item.spawnFn);
          progress = true;
          break; // restart scan since states changed
        }
      }
    }

    return released;
  }

  /**
   * Notify scheduler that a task failed.
   * Triggers cascade failure on all pending tasks that directly or indirectly depend on it.
   * @param {string} agentOrTaskId  an agent id is mapped back to the task it ran
   * @param {string} [_reason]
   * @returns {string[]} ids of cascading failed tasks
   */
  onTaskFailed(agentOrTaskId, _reason) {
    if (!agentOrTaskId) return [];
    const taskId = this.taskIdOf(agentOrTaskId);
    this.taskStates.set(taskId, 'failed');

    const cascadeFailed = [];
    let progress = true;

    while (progress) {
      progress = false;
      for (const [pendingId] of Array.from(this.pendingQueue.entries())) {
        const deps = this.dependencies.get(pendingId) || [];
        const hasFailedDep = deps.some((depId) => this.taskStates.get(depId) === 'failed');
        if (hasFailedDep) {
          this.pendingQueue.delete(pendingId);
          this.taskStates.set(pendingId, 'failed');
          cascadeFailed.push(pendingId);
          progress = true;
          break;
        }
      }
    }

    return cascadeFailed;
  }

  /**
   * Tasks that never got a real agent spawned for them: still queued on a dependency, or
   * cascade-failed before their turn ever came. A task that ran (even if it later failed) has its
   * own agent record already, so it's excluded here -- this is only for the part of the DAG the
   * flow graph otherwise has no way to show at all.
   * @returns {{id: string, state: 'pending'|'failed', dependsOn: string[]}[]}
   */
  snapshot() {
    const out = [];
    for (const [id, state] of this.taskStates) {
      if (this.spawnedIds.has(id)) continue;
      out.push({ id, state, dependsOn: this.dependencies.get(id) || [] });
    }
    return out;
  }
}

module.exports = { Scheduler, DEFAULT_GLOBAL_CAP, sanitizeTaskId };
