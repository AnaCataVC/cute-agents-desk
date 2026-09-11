// @ts-check
/**
 * One agent = one real terminal running the CLI, plus the hooks that make it observable.
 *
 * The CLI is not asked to behave differently than it does for a person: same binary, same
 * interactive session. All the harness adds is a `--settings` file whose hooks report every
 * event, which is why the window can show progress without parsing the terminal output.
 */

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths.js');
const { agentEnv } = require('./pty-env.js');
const worktree = require('./worktree.js');

/** Events Claude Code reports. `Status` is the status line, which is where tokens and cost come from. */
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'Notification', 'Stop', 'SubagentStop', 'PreCompact'];

/**
 * The settings file the agent runs with. Every event calls the same script with its own name;
 * the script is what decides where the report goes.
 * @param {string} agentId
 */
function settingsFor(agentId) {
  const command = `node "${paths.hookScript.replace(/\\/g, '/')}"`;
  /** @type {Record<string, unknown>} */
  const hooks = {};
  for (const event of HOOK_EVENTS) {
    hooks[event] = [{ matcher: '*', hooks: [{ type: 'command', command: `${command} ${event}` }] }];
  }
  return {
    hooks,
    statusLine: { type: 'command', command: `${command} Status` },
  };
}

/**
 * The workspace check the CLI opens in every interactive session: "Accessing workspace …
 * Quick safety check", cursor on *No, exit*.
 *
 * MEASURED, 2026-09-10, claude 2.1.266: accepting it by hand persists nothing — not in
 * `~/.claude.json`, not in the repo — so it is asked again every session and no configuration
 * key can answer it. `hasTrustDialogAccepted` only affects `--print` runs.
 *
 * So the harness answers it, and that is a decision about authority: it is allowed **only**
 * because the folder came from the account's registered folders, which the user maintains in
 * the Configuración tab. A path from anywhere else — a coordinator's request, an unapproved
 * scan result, a directory named inside a task — must never reach `spawn`.
 *
 * Every answer is written to `events.jsonl` as `WorkspaceTrusted`, so "what did this thing
 * accept on my behalf" is a question the log answers.
 */
const TRUST_PROMPT = /Itrustthisfolder/i;

/** The TUI writes escapes between characters, so a phrase is only contiguous once flattened. */
const flatten = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\s+/g, '');

/** @param {string} bin @returns {'claude'|'agy'} */
function engineFor(bin) {
  return /agy(\.exe)?$/i.test(bin) ? 'agy' : 'claude';
}

/**
 * Both CLIs show the same literal phrase, but MEASURED 2026-09-10 (claude 2.1.266, agy 1.2.0)
 * they default the cursor to OPPOSITE options: claude sits on "No, exit" (one down-arrow reaches
 * "Yes"), agy already sits on "Yes, I trust this folder". Reusing claude's down-arrow-then-enter
 * for agy would move the cursor OFF "Yes" and confirm "No, exit" instead, closing the session
 * the harness just opened.
 * @param {string} bin
 * @returns {{ engine: 'claude'|'agy', keys: string[] }}
 */
function trustDialogFor(bin) {
  const engine = engineFor(bin);
  return { engine, keys: engine === 'agy' ? ['\r'] : ['\x1b[B', '\r'] };
}

/**
 * agy's own hook config, per `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/
 * hooks.md` (MEASURED 2026-09-10, agy 1.2.0 — this schema is NOT claude's `settingsFor()` shape:
 * the top-level key is an arbitrary hook NAME, not the literal string "hooks", and
 * PreInvocation/PostInvocation/Stop are flat arrays with no `matcher`/`hooks` wrapper, unlike
 * PreToolUse/PostToolUse). agy has no `--settings`-equivalent flag — it only ever reads this
 * exact relative path, so the file has to physically exist at `<cwd>/.agents/hooks.json`.
 *
 * MEASURED 2026-09-10: unlike claude, which parses `command` through a real shell (so quoting a
 * path with `"..."` is normal and required for one with spaces), agy's own path-absoluteness
 * check runs on the raw string BEFORE any quote stripping — a leading `"` makes it look relative
 * and gets the agent's own cwd prepended, producing a MODULE_NOT_FOUND that never reaches node.
 * `paths.hookScript` has no spaces, so it is passed bare here instead of quoted.
 */
function agyHooksFor() {
  const command = `node ${paths.hookScript.replace(/\\/g, '/')}`;
  const grouped = (event) => [{ matcher: '*', hooks: [{ type: 'command', command: `${command} ${event}` }] }];
  const flat = (event) => [{ type: 'command', command: `${command} ${event}` }];
  return {
    'cad-hooks': {
      PreToolUse: grouped('PreToolUse'),
      PostToolUse: grouped('PostToolUse'),
      PreInvocation: flat('PreInvocation'),
      PostInvocation: flat('PostInvocation'),
      Stop: flat('Stop'),
    },
  };
}

/**
 * node-pty on Windows does not search the PATH the way `CreateProcess` does: given a bare
 * `claude` it answers `File not found:` with nothing after the colon. So the binary is resolved
 * here, and a failure says which name was searched instead of leaving that blank.
 * @param {string} bin
 */
function resolveBin(bin) {
  if (path.isAbsolute(bin)) return bin;
  try {
    const found = require('node:child_process')
      .execFileSync('where', [bin], { encoding: 'utf8' })
      .split(/\r?\n/).find((line) => line.trim());
    if (found) return found.trim();
  } catch { /* fall through to the error below */ }
  throw new Error(`no se encontro "${bin}" en el PATH`);
}

const VALID_EFFORTS_CLAUDE = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const VALID_EFFORTS_AGY = new Set(['low', 'medium', 'high']);
const MODEL_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/;

/**
 * Validate and normalize execution mode, model, and reasoning effort per engine.
 * @param {object} o
 * @param {'claude'|'agy'} o.engine
 * @param {string} [o.mode]
 * @param {string} [o.model]
 * @param {string} [o.effort]
 * @returns {{ normMode: 'write'|'read'|'plan'|'auto', normModel?: string, normEffort?: string }}
 */
function validateAndSanitizeParams({ engine, mode = 'write', model, effort }) {
  let normMode = (mode || 'write').toLowerCase();
  if (normMode === 'planning') normMode = 'plan';

  if (normMode === 'auto') {
    if (engine === 'agy') {
      throw new Error('el motor agy no soporta el modo "auto" (modos validos: write, plan, read)');
    }
  } else if (!['write', 'read', 'plan'].includes(normMode)) {
    throw new Error(`modo no reconocido: "${mode}" (modos validos: write, plan, auto, read)`);
  }

  let normModel;
  if (model && model !== 'default' && typeof model === 'string') {
    const trimmed = model.trim();
    if (trimmed && trimmed !== 'default') {
      if (trimmed.startsWith('-') || !MODEL_REGEX.test(trimmed)) {
        throw new Error(`nombre de modelo invalido o no permitido: "${model}"`);
      }
      normModel = trimmed;
    }
  }

  let normEffort;
  if (effort && effort !== 'default' && typeof effort === 'string') {
    const trimmed = effort.trim().toLowerCase();
    if (trimmed && trimmed !== 'default') {
      if (engine === 'agy') {
        if (!VALID_EFFORTS_AGY.has(trimmed)) {
          throw new Error(`el motor agy no soporta el nivel de esfuerzo "${effort}" (niveles validos: low, medium, high)`);
        }
      } else {
        if (!VALID_EFFORTS_CLAUDE.has(trimmed)) {
          throw new Error(`el motor claude no soporta el nivel de esfuerzo "${effort}" (niveles validos: low, medium, high, xhigh, max)`);
        }
      }
      normEffort = trimmed;
    }
  }

  return { normMode: /** @type {'write'|'read'|'plan'|'auto'} */ (normMode), normModel, normEffort };
}

/**
 * Spawn an agent.
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.cwd            the repo it works in
 * @param {string} o.task           what it is asked to do, submitted as the first prompt
 * @param {'read'|'write'|'plan'|'auto'} [o.mode] defaults to 'write'; 'read' denies Edit/Write/NotebookEdit at
 *                                  the hook, so a task mislabeled read-only cannot mutate the repo.
 *                                  'write' runs inside a fresh `git worktree` on its own
 *                                  `agent/<id>` branch instead of `cwd` directly (see
 *                                  `worktree.js`), falling back to `cwd` if one can't be made.
 *                                  'plan' runs in planning mode without worktree.
 *                                  'auto' runs claude in autonomous permission mode.
 * @param {string} [o.bin]          defaults to `claude` on PATH
 * @param {string} [o.model]        optional model override (alias or ID)
 * @param {string} [o.effort]       optional reasoning effort override
 * @param {string} [o.systemPrompt] appended to the CLI's own system prompt via
 *                                  `--append-system-prompt`, instead of replacing it. Absent by
 *                                  default, which keeps every existing caller byte-identical.
 *                                  claude-only: silently dropped for agy, whose equivalent (if
 *                                  any) was never confirmed.
 * @param {boolean} [o.worktree]    defaults to true; set false for a write-mode agent whose `cwd`
 *                                  is known not to be a git repo (e.g. the coordinator's own
 *                                  conversation folder), so it skips the doomed worktree attempt
 *                                  instead of failing it on every spawn.
 * @param {(chunk: string) => void} [o.onOutput]
 * @param {(code: number) => void} [o.onExit]
 * @param {(kind: string, detail: object) => void} [o.onNotice]  things the harness did on its own
 */
function spawn({ id, cwd, task, mode = 'write', bin = 'claude', model, effort, systemPrompt, worktree: useWorktree = true, onOutput, onExit, onNotice }) {
  // Required lazily so the rest of the app (and the smoke check) still runs if the native
  // module is missing — a broken node-pty should not mean a blank window.
  const pty = require('node-pty');
  const dirs = paths.agent(id);
  fs.mkdirSync(dirs.inbox, { recursive: true });

  const engine = engineFor(bin);
  const { normMode, normModel, normEffort } = validateAndSanitizeParams({ engine, mode, model, effort });

  let effectiveCwd = cwd;
  let args;

  if (engine === 'agy') {
    // agy has no worktree support yet — it always runs directly against `cwd`, reached through
    // `--add-dir` since its own cwd has to be the directory holding `.agents/hooks.json` (see
    // agyHooksFor's doc comment), never the repo itself. A write-mode agy task is therefore NOT
    // isolated the way a write-mode claude task is: this is a known, deliberate gap, not an
    // oversight, until worktree.js grows a variant that doesn't assume cwd == the repo.
    effectiveCwd = dirs.dir;
    fs.mkdirSync(dirs.agyHooksDir, { recursive: true });
    // agyHooksFor() cannot quote this path (see its own doc comment on why), so a space in it
    // breaks agy's hook invocation silently -- surface that as a harness event instead of
    // leaving it as an untraceable MODULE_NOT_FOUND inside agy's own process.
    if (/\s/.test(paths.hookScript)) onNotice?.('AgyHookPathHasSpace', { hookScript: paths.hookScript });
    fs.writeFileSync(dirs.agyHooks, JSON.stringify(agyHooksFor(), null, 2));
    args = ['-i', task, '--add-dir', cwd];
    if (normMode === 'write') args.push('--mode', 'accept-edits');
    else if (normMode === 'plan') args.push('--mode', 'plan');
    if (normModel) args.push('--model', normModel);
    if (normEffort) args.push('--effort', normEffort);
  } else {
    // Write agents get their own worktree so parallel tasks on the same repo never collide and
    // a task's changes stay isolated on their own branch until reviewed. Read and plan agents never need
    // this — the hook already denies Edit/Write/NotebookEdit for them — and a worktree that
    // can't be created (cwd isn't a git repo, e.g. the toy repo in some tests) degrades to
    // running in cwd directly rather than failing the whole spawn.
    if (normMode === 'write' && useWorktree) {
      try {
        effectiveCwd = worktree.createWorktree(cwd, id);
      } catch (err) {
        console.error(`no se pudo crear el worktree para "${id}" en "${cwd}": ${err.message}`);
        onNotice?.('WorktreeCreationFailed', { id, cwd, error: err.message });
        if (err.message.includes('no es un repo git')) {
          effectiveCwd = cwd;
        } else {
          throw err;
        }
      }
    }
    fs.writeFileSync(dirs.settings, JSON.stringify(settingsFor(id), null, 2));
    args = [task, '--settings', dirs.settings];
    if (normMode === 'write') args.push('--permission-mode', 'acceptEdits');
    else if (normMode === 'plan') args.push('--permission-mode', 'plan');
    else if (normMode === 'auto') args.push('--permission-mode', 'auto');
    if (normModel) args.push('--model', normModel);
    if (normEffort) args.push('--effort', normEffort);
  }
  // `--append-system-prompt` is claude-only (unconfirmed whether agy has an equivalent) — never
  // pass an unverified flag to a CLI, so it's silently dropped for agy rather than guessed at.
  args = args.concat(systemPrompt && engine === 'claude' ? ['--append-system-prompt', systemPrompt] : []);

  fs.writeFileSync(dirs.manifest, JSON.stringify({
    id, cwd, worktreeCwd: effectiveCwd, task, mode: normMode, bin, engine,
    model: normModel, effort: normEffort, startedAt: new Date().toISOString(),
  }, null, 2));

  const term = pty.spawn(resolveBin(bin), args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: effectiveCwd,
    env: agentEnv({ agentId: id, mode: normMode }),
    useConpty: true,
  });

  const log = fs.createWriteStream(dirs.ptyLog, { flags: 'a' });

  let answeredTrust = false;
  let head = '';

  term.onData((chunk) => {
    log.write(chunk);

    if (!answeredTrust) {
      // A bounded window: the prompt is the first thing on screen, and this must not grow into
      // a full copy of the session's output.
      head = (head + chunk).slice(-4000);
      if (TRUST_PROMPT.test(flatten(head))) {
        answeredTrust = true;
        const { engine, keys } = trustDialogFor(bin);
        // The initial wait is there because the TUI is still painting when the phrase first
        // appears; the per-key wait after it gives each keystroke its own render before the next.
        setTimeout(() => {
          keys.forEach((key, i) => setTimeout(() => term.write(key), i * 150));
        }, 300);
        if (onNotice) onNotice('WorkspaceTrusted', { cwd: effectiveCwd, engine });
      }
    }

    if (onOutput) onOutput(chunk);
  });
  term.onExit(({ exitCode }) => {
    log.end();
    if (onExit) onExit(exitCode);
  });

  return {
    id,
    cwd,
    worktreeCwd: effectiveCwd,
    task,
    engine,
    mode: normMode,
    model: normModel || undefined,
    effort: normEffort || undefined,
    pid: term.pid,
    /** @param {string} text */
    write(text) { term.write(text); },
    resize(cols, rows) { term.resize(cols, rows); },
    kill() {
      // node-pty's kill ends the ConPTY host, which does not always take the CLI's own child
      // processes with it. taskkill /T is what actually walks the tree.
      try { require('node:child_process').execFileSync('taskkill', ['/PID', String(term.pid), '/T', '/F']); } catch { /* already gone */ }
      try { term.kill(); } catch { /* already gone */ }
    },
  };
}

module.exports = { spawn, trustDialogFor, validateAndSanitizeParams, engineFor };
