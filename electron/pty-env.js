// @ts-check
/**
 * The environment a spawned agent gets.
 *
 * The rule that matters: if the harness is launched from *inside* a Claude Code session, the
 * child inherits that session's identity through the `CLAUDE_*` variables — and then it stops
 * writing its own transcript, so `--resume` has nothing to resume from. This is a measured bug
 * in the harness this project replaces, not a theoretical one, so the variables are stripped
 * rather than trusted.
 *
 * Only what is genuinely machine-level survives: where the config lives, and how to
 * authenticate.
 */

const KEEP = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
]);

const SESSION_VAR = /^CLAUDE(CODE|_)/;

/**
 * @param {object} o
 * @param {string} o.agentId
 * @param {'read'|'write'} [o.mode]  read is what electron/hook.js checks to deny writes
 * @param {Record<string, string|undefined>} [o.base]  defaults to this process's environment
 * @returns {Record<string, string>}
 */
function agentEnv({ agentId, mode = 'write', base = process.env }) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (SESSION_VAR.test(key) && !KEEP.has(key)) continue;
    env[key] = value;
  }

  // Two jobs: the hook script reads it to know who is reporting, and any personal hook that
  // wants to stay out of a worker can early-exit on it.
  env.CAD_AGENT_ID = agentId;
  env.CAD_MODE = mode;
  // A PTY is a terminal, but not one that should be redrawn with cursor tricks we then have to
  // parse back out of pty.log.
  env.TERM = 'xterm-256color';
  return env;
}

module.exports = { agentEnv };
