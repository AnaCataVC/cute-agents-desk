'use strict';
// @ts-check
/**
 * The one rule that has to hold before anything else: a coordinator can *ask*
 * for a worker, it can never spawn one. Whoever calls `spawn` goes through here first, and a
 * refusal is not silent -- it is worth an event, because "why didn't my request happen" needs
 * an answer that isn't "read the source".
 */

const DEFAULT_GLOBAL_CAP = 5;

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
      }
      spawnFn(req);
      return { ok: true, queued: false };
    }

    // Check for cycles
    if (taskId && this.hasCycle(taskId, deps)) {
      return { ok: false, reason: `Ciclo de dependencias detectado para tarea "${taskId}"` };
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
      }
      spawnFn(req);
      return { ok: true, queued: false };
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
   * @param {string} taskId
   * @returns {string[]} ids of newly released and spawned tasks
   */
  onTaskCompleted(taskId) {
    if (!taskId) return [];
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
          released.push(pendingId);
          try {
            item.spawnFn(item.req);
          } catch (err) {
            this.onTaskFailed(pendingId, err && err.message ? err.message : String(err));
          }
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
   * @param {string} taskId
   * @param {string} [_reason]
   * @returns {string[]} ids of cascading failed tasks
   */
  onTaskFailed(taskId, _reason) {
    if (!taskId) return [];
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
}

module.exports = { Scheduler, DEFAULT_GLOBAL_CAP };
