'use strict';
// @ts-check
/**
 * Whether a tool call would be denied under CAD_MODE=read. Shared by hook.js, which enforces it
 * on the agent's own turn, and events.js, which only needs to know it happened, for the flow
 * graph's denied-call counter -- one source of truth instead of two copies of the same regexes.
 */
const { toolNameOf } = require('./tool-name.js');

// Claude: a short, closed deny-list (Edit/Write/NotebookEdit) is enough because every other tool
// it has is genuinely read-only or has its own confirmation gate.
const CLAUDE_WRITE_TOOLS = /^(Edit|Write|NotebookEdit)$/;

// agy: the full tool surface was never enumerated end-to-end (only list_dir/view_file/run_command
// were actually observed during measurement), and `run_command` alone can write files a deny-list
// would never think to name. So agy inverts the check to an ALLOW-list of tools confirmed
// read-only instead of a deny-list of tools confirmed to write — safer under the genuine
// uncertainty about what else agy can call, at the cost of being stricter than claude's mode.
const AGY_READONLY_TOOLS = /^(view_file|list_dir|grep_search|search_web|find|find_by_name|read_url_content|ask_question)$/;

// `plan` and `read` cannot change files; `auto` is `write` with fewer confirmation prompts.
// An absent mode is `write`, matching agent.js's own default.
const WRITING_MODES = /^(write|auto)$/;

/** @param {string} [mode] @returns {boolean} */
function isWritingMode(mode) {
  return WRITING_MODES.test(String(mode || 'write'));
}

/**
 * Whether a coordinator running in `bossMode` may delegate a task in `taskMode`.
 *
 * Read and plan mode are promises the harness makes about what a conversation can do to a repo,
 * and a coordinator is the one agent that can hand work to a process the promise never covered.
 * Delegation therefore inherits the ceiling: a non-writing coordinator can only spawn non-writing
 * workers. Enforced at the one spawn path in `main.js`, never by trusting the request.
 * @param {string} [bossMode] @param {string} [taskMode] @returns {boolean}
 */
function mayDelegate(bossMode, taskMode) {
  return isWritingMode(bossMode) || !isWritingMode(taskMode);
}

/** @param {object|null} payload @returns {boolean} */
function isDeniedInReadMode(payload) {
  const name = toolNameOf(payload);
  // Fail closed: read mode exists to guarantee Edit/Write/NotebookEdit cannot run, so a payload
  // this harness cannot even name must be denied, not waved through.
  if (!name) return true;
  return payload?.toolCall ? !AGY_READONLY_TOOLS.test(name) : CLAUDE_WRITE_TOOLS.test(name);
}

module.exports = { isDeniedInReadMode, isWritingMode, mayDelegate };
