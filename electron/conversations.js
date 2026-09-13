// @ts-check
/**
 * A conversation is a folder. Everything a topic owns -- its own workers, its own caps, its
 * consolidated status -- lives under one directory, so deleting a conversation is deleting a
 * directory and nothing else has to be told.
 */

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths.js');

const CONVERSATIONS_DIR = path.join(paths.home, 'conversations');

/**
 * @param {string} id
 */
function conversationPaths(id) {
  const dir = path.join(CONVERSATIONS_DIR, id);
  return {
    dir,
    conversation: path.join(dir, 'conversation.json'),
    status: path.join(dir, 'status.json'),
    agents: path.join(dir, 'agents'),
  };
}

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.topic]
 * @param {number} [o.cap]  workers this conversation may have alive at once — separate from the
 *   machine-wide cap the scheduler also enforces
 */
function createConversation({ title, topic = '', cap = 3 }) {
  // Readable in a directory listing, like an agent id, not a uuid.
  const id = `c${Date.now().toString(36).slice(-6)}`;
  const p = conversationPaths(id);
  fs.mkdirSync(p.agents, { recursive: true });
  const conversation = { id, title, topic, cap, createdAt: new Date().toISOString(), status: 'active' };
  fs.writeFileSync(p.conversation, JSON.stringify(conversation, null, 2));
  fs.writeFileSync(p.status, JSON.stringify({}, null, 2));
  return conversation;
}

/** @returns {object[]} every conversation, newest first */
function listConversations() {
  let ids;
  try { ids = fs.readdirSync(CONVERSATIONS_DIR); } catch { return []; }
  const out = [];
  for (const id of ids) {
    try { out.push(JSON.parse(fs.readFileSync(conversationPaths(id).conversation, 'utf8'))); }
    catch { /* a folder without a valid conversation.json is not one of ours */ }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** @param {string} id */
function getConversation(id) {
  try { return JSON.parse(fs.readFileSync(conversationPaths(id).conversation, 'utf8')); }
  catch { return null; }
}

/**
 * How many workers this conversation currently has alive — the number its own cap is checked
 * against. Takes the live count rather than reading it off disk, since status.json is a summary
 * for display, not the source of truth for scheduling (that's the registry, in memory).
 *
 * A done/failed agent stays in the registry for a while after it exits purely so the UI and
 * status.json can still show its final state (see events.js's TERMINAL_RETENTION_MS) — it must
 * never count against this cap, or a conversation that already finished its workers would stay
 * refused until that retention window happens to lapse.
 * @param {string} id
 * @param {Map<string, {conversationId?: string, state?: string}>} agents  the registry's live
 *   agents, keyed by id
 */
function runningInConversation(id, agents) {
  let n = 0;
  for (const agent of agents.values()) {
    if (agent.conversationId === id && agent.state !== 'done' && agent.state !== 'failed') n++;
  }
  return n;
}

/**
 * Rewritten in full on every change, per the plan: this is the coordinator's whole view of its
 * own workers, so it must always reflect reality rather than accumulate patches that can drift.
 * @param {string} id
 * @param {Record<string, object>} summaryByAgentId
 */
function writeStatus(id, summaryByAgentId) {
  fs.writeFileSync(conversationPaths(id).status, JSON.stringify(summaryByAgentId, null, 2));
}

/**
 * Marks a conversation as archived.
 * @param {string} id
 */
function archiveConversation(id) {
  const p = conversationPaths(id);
  try {
    if (!fs.existsSync(p.conversation)) return { error: `Conversación no encontrada: ${id}` };
    const conv = JSON.parse(fs.readFileSync(p.conversation, 'utf8'));
    conv.status = 'archived';
    conv.archivedAt = new Date().toISOString();
    fs.writeFileSync(p.conversation, JSON.stringify(conv, null, 2));
    return conv;
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { createConversation, listConversations, getConversation, archiveConversation, runningInConversation, writeStatus, conversationPaths };
