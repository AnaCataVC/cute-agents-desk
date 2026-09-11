// @ts-check
/**
 * Point electron/paths.js at a throwaway HOME for the life of this process, so a verify-*.js run
 * never writes its test conversations, agents or events into ~/.cute-agents-desk -- the same
 * directory the real app reads to draw its UI. Without this, a script that crashes before its own
 * cleanup (or never cleans up at all) leaves fake coordinators/conversations sitting in the real
 * app's data.
 *
 * Must be required before electron/paths.js, directly or via conversations.js/events.js/agent.js
 * -- HOME is resolved once, at first require. So this has to be the very first require in any
 * verify-*.js script that touches those modules.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cute-agents-desk-verify-'));
process.env.CUTE_AGENTS_DESK_HOME = dir;
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

module.exports = { dir };
