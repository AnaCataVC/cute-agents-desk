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
}

module.exports = { Scheduler, DEFAULT_GLOBAL_CAP };
