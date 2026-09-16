'use strict';
// @ts-check
/**
 * Claude and agy send completely different payload shapes for the same hook event (MEASURED
 * 2026-09-10): claude's is snake_case with a bare `tool_name`; agy's is camelCase with a nested
 * `toolCall.name`, documented in `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/
 * docs/hooks.md`. `hook.js` and `events.js` both need to know which tool a payload is about, so
 * this lives in one place instead of being re-derived per engine in each file.
 * @param {any} payload
 * @returns {string|undefined}
 */
function toolNameOf(payload) {
  return payload?.tool_name || payload?.toolCall?.name;
}

const SHELL_TOOLS = /^(Bash|run_command)$/;
const VERIFY_COMMAND = /\b(npm (run )?(test|verify)|pytest|verify[-_]?(changes|all)?|go test|cargo test|jest|vitest)\b/i;

/** @param {any} payload @returns {string} */
function commandTextOf(payload) {
  return payload?.tool_input?.command || payload?.toolCall?.args?.CommandLine || '';
}

/**
 * Whether a PreToolUse call is a test/verification run, so events.js can badge the agent's node
 * while it's checking its own work instead of just calling it "tool".
 * @param {any} payload
 */
function isVerificationCommand(payload) {
  const name = toolNameOf(payload);
  if (!SHELL_TOOLS.test(name || '')) return false;
  return VERIFY_COMMAND.test(commandTextOf(payload));
}

/**
 * ponytail: `tool_result.exit_code` is per Claude Code's public hooks doc, not measured against a
 * live payload the way the Status shape above was -- if the field is ever absent or renamed, this
 * returns undefined and the caller shows a neutral "ran" badge, never a guessed pass/fail.
 * @param {any} payload @returns {number|undefined}
 */
function exitCodeOf(payload) {
  const code = payload?.tool_result?.exit_code ?? payload?.tool_response?.exit_code;
  return typeof code === 'number' ? code : undefined;
}

module.exports = { toolNameOf, isVerificationCommand, exitCodeOf };
