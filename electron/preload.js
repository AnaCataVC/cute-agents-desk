// @ts-check
/**
 * The seam between the window and the machine.
 *
 * The renderer never gets `require`, `fs` or a whole `ipcRenderer`: it gets named calls, so the
 * list of things the window can ask the machine to do is this file, readable in full.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  /** True inside the app, absent when the same `ui/` is opened through a plain http server. */
  isDesk: true,

  /** Live agents with their derived state, as the cards need them. */
  agents: () => ipcRenderer.invoke('desk:agents'),

  /** The declared accounts and every repo found under their folders, scanned for real. */
  repos: () => ipcRenderer.invoke('desk:repos'),

  /** Every conversation folder, newest first. */
  conversations: () => ipcRenderer.invoke('desk:conversations'),

  /** @param {{title: string, topic?: string, cap?: number}} o */
  createConversation: (o) => ipcRenderer.invoke('desk:createConversation', o),

  /**
   * Start an agent on a repo. Returns its id, or `{ error }` if the scheduler refused it.
   * @param {{cwd?: string, task: string, conversationId?: string, bin?: string, engine?: string, model?: string, effort?: string, mode?: 'write'|'read'|'plan'|'auto'}} o
   */
  spawn: (o) => ipcRenderer.invoke('desk:spawn', o),

  /** @param {string} id */
  stop: (id) => ipcRenderer.invoke('desk:stop', id),

  /** Retained write-mode worktrees, listed for the manual "reap" button — none are ever deleted on their own. */
  worktrees: () => ipcRenderer.invoke('desk:worktrees'),

  /** Recurring tasks Claude Desktop and Antigravity have scheduled on this machine, outside this app — read-only. */
  scheduledTasks: () => ipcRenderer.invoke('desk:scheduledTasks'),

  /** Skills installed for each CLI engine on this machine — read-only. */
  skills: () => ipcRenderer.invoke('desk:skills'),

  /** @param {string} agentId  refused with `{error}` while that agent is still alive */
  reapWorktree: (agentId) => ipcRenderer.invoke('desk:reapWorktree', agentId),

  /**
   * Start a conversation's coordinator: a real CLI agent whose only job is to break down work
   * and delegate, never to edit code itself. Returns its agent id, or `{ error }`.
   * @param {{conversationId: string, bin?: string, engine?: string, model?: string, effort?: string, mode?: 'write'|'read'|'plan'|'auto'}} o
   */
  spawnCoordinator: (o) => ipcRenderer.invoke('desk:spawnCoordinator', o),

  /** Delivered tasks with their PR and repo links. */
  delivered: () => ipcRenderer.invoke('desk:delivered'),

  /**
   * Deliver an agent's work: commits dirty files, pushes branch, and opens a draft PR.
   * @param {{agentId: string, commitMessage?: string, prTitle?: string, prBody?: string}} o
   */
  deliver: (o) => ipcRenderer.invoke('desk:deliver', o),

  /** Aggregated token usage and cost for today. */
  usage: () => ipcRenderer.invoke('desk:usage'),

  /**
   * Update and persist an account's color in accounts.json.
   * @param {string} accountId
   * @param {string} color
   */
  setAccountColor: (accountId, color) => ipcRenderer.invoke('desk:setAccountColor', { accountId, color }),

  /** Read persisted configuration with default schema merge. */
  config: () => ipcRenderer.invoke('desk:config'),

  /**
   * Update and persist a configuration setting.
   * @param {{section: string, key: string, value: any}} o
   */
  updateConfig: (o) => ipcRenderer.invoke('desk:updateConfig', o),

  /**
   * Push channel for what the main process owns: agent state, and raw terminal output.
   * Replaces the SSE stream the web version would have needed.
   * @param {(patch: {agents?: object[], output?: {id: string, chunk: string}}) => void} onPatch
   */
  subscribe(onPatch) {
    const handler = (_ev, patch) => onPatch(patch);
    ipcRenderer.on('desk:patch', handler);
    return () => ipcRenderer.off('desk:patch', handler);
  },
});
