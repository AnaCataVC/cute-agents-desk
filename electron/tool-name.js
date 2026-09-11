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

module.exports = { toolNameOf };
