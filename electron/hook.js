// @ts-check
/**
 * The reporter. Claude Code runs this on every hook event and on every status-line render,
 * hands it a JSON payload on stdin, and this drops one file into the agent's `events/`
 * directory, where the window's watcher picks it up.
 *
 * A file, not an HTTP POST: with Electron there is no server to POST to, and a directory
 * needs no port, no token and no origin check — the only thing that can write into it is a
 * process already running as this user. It is also the same mailbox the coordinator will use.
 *
 * Runs on the critical path of the agent's own turn, so it must be cheap and must never fail
 * loudly: a broken reporter is allowed to lose telemetry, never to stall the agent or make a
 * tool call look denied.
 *
 * Usage (from the generated settings.json): node hook.js <EventName>
 */

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths.js');
const { toolNameOf } = require('./tool-name.js');

const event = process.argv[2] || 'Unknown';
const agentId = process.env.CAD_AGENT_ID;

// A real decision, not telemetry: read-mode is what makes "just look at this repo" a mode the
// harness can actually promise, instead of trusting the task description not to mention editing.

// Claude: a short, closed deny-list (Edit/Write/NotebookEdit) is enough because every other tool
// it has is genuinely read-only or has its own confirmation gate.
const CLAUDE_WRITE_TOOLS = /^(Edit|Write|NotebookEdit)$/;

// agy: the full tool surface was never enumerated end-to-end (only list_dir/view_file/run_command
// were actually observed during measurement), and `run_command` alone can write files a deny-list
// would never think to name. So agy inverts the check to an ALLOW-list of tools confirmed
// read-only instead of a deny-list of tools confirmed to write — safer under the genuine
// uncertainty about what else agy can call, at the cost of being stricter than claude's mode.
const AGY_READONLY_TOOLS = /^(view_file|list_dir|grep_search|search_web|find|find_by_name|read_url_content|ask_question)$/;

/** @param {object|null} payload @returns {boolean} */
function isDeniedInReadMode(payload) {
  const name = toolNameOf(payload);
  // Fail closed: read mode exists to guarantee Edit/Write/NotebookEdit cannot run, so a payload
  // this harness cannot even name (e.g. one hook.js's own JSON.parse below couldn't parse) must
  // be denied, not waved through.
  if (!name) return true;
  return payload?.toolCall ? !AGY_READONLY_TOOLS.test(name) : CLAUDE_WRITE_TOOLS.test(name);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { unparsed: raw.slice(0, 2000) }; }

  try {
    if (agentId) record(payload);
  } catch {
    // Deliberately silent: see the note above about never failing loudly.
  }

  if (event === 'PreToolUse') {
    const denied = process.env.CAD_MODE === 'read' && isDeniedInReadMode(payload);
    const toolLabel = toolNameOf(payload) || 'herramienta no identificada';
    if (payload?.toolCall) {
      // agy's contract (hooks.md): PreToolUse output is JSON on stdout with a REQUIRED
      // `decision` field — unlike claude, an empty stdout is not a documented "allow", so every
      // PreToolUse call gets an explicit answer, not just the denied ones.
      process.stdout.write(JSON.stringify(denied
        ? { decision: 'deny', reason: `modo lectura: ${toolLabel} esta deshabilitado para este agente.` }
        : { decision: 'allow' }));
    } else if (denied) {
      process.stderr.write(`modo lectura: ${toolLabel} esta deshabilitado para este agente.\n`);
      process.exit(2);
    }
  }

  // The status line renders whatever this prints. Empty is valid, and the window is where
  // the state is actually read, so it stays out of the agent's own screen.
  if (event === 'Status') process.stdout.write('');
  process.exit(0);
});

/** @param {object|null} payload already parsed by the caller, so the decision above and the report below agree on it */
function record(payload) {
  const { inbox } = paths.agent(String(agentId));
  fs.mkdirSync(inbox, { recursive: true });

  const at = new Date().toISOString();
  // The random suffix is what keeps two events inside the same millisecond from colliding —
  // PreToolUse and PostToolUse of a fast tool land that close together.
  const name = `${at.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.json`;
  const body = JSON.stringify({ event, at, agentId, payload });

  // Write, then rename: the watcher must never read a half-written file.
  const tmp = path.join(inbox, `.${name}`);
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, path.join(inbox, name));
}
