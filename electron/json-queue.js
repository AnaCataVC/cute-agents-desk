'use strict';
// @ts-check
/**
 * The mailbox mechanics shared by every drop-a-json-file-here queue in the harness (an agent's
 * hook-event inbox, its outbox, a conversation's spawn-requests folder): list `.json` files,
 * parse each, hand it to a caller-supplied handler, then delete it.
 */

const fs = require('node:fs');
const path = require('node:path');

const PROCESSING_PREFIX = '.processing-';
const REJECTED_DIR = 'rejected';

/**
 * Each file is claimed by renaming it to a dot-prefixed `.processing-<name>` before `onItem`
 * runs, so a later drain can never see it again even if the final unlink fails (EPERM/EBUSY on
 * Windows); a file whose claim fails is skipped until the next drain.
 *
 * A file that fails to parse is left in place for the next drain instead of treated as an error,
 * since `fs.watch` gives only the filename on Windows and a rename can arrive before the content
 * is flushed. Parsed JSON that `onItem` answers with `'reject'` is malformed rather than not
 * ready, so it is moved to `rejected/` instead of retried forever.
 * @param {string} dir
 * @param {(item: any) => boolean | 'reject' | void | Promise<any>} onItem
 *   return `false` to leave the file unconsumed, `'reject'` to move it to `rejected/`
 * @returns {boolean} whether it found anything to process
 */
function drainJsonQueue(dir, onItem) {
  let files;
  try { files = fs.readdirSync(dir); } catch { return false; }
  const items = files.filter((f) => f.endsWith('.json') && !f.startsWith('.')).sort();
  if (!items.length) return false;

  for (const file of items) {
    const full = path.join(dir, file);
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
    const claimed = path.join(dir, PROCESSING_PREFIX + file);
    try { fs.renameSync(full, claimed); } catch { continue; }
    const verdict = onItem(parsed);
    if (verdict === false) {
      try { fs.renameSync(claimed, full); } catch { /* stays claimed; swept on next startup */ }
    } else if (verdict === 'reject') {
      rejectFile(dir, claimed, file);
    } else {
      try { fs.unlinkSync(claimed); } catch { /* dot-prefixed, so never re-read; swept on next startup */ }
    }
  }
  return true;
}

function rejectFile(dir, claimed, file) {
  try {
    fs.mkdirSync(path.join(dir, REJECTED_DIR), { recursive: true });
    fs.renameSync(claimed, path.join(dir, REJECTED_DIR, file));
  } catch (err) {
    console.warn(`[json-queue] could not move rejected ${file} out of ${dir}: ${err.message}`);
  }
}

/**
 * A `.processing-*` file left behind means a previous run died mid-`onItem` or failed to unlink
 * it. Whether its side effect already happened is unknown, so it is never re-run: re-running a
 * spawn request could start a second write worker. Remove it and leave a trace instead.
 */
function sweepAbandonedClaims(dir) {
  let files;
  try { files = fs.readdirSync(dir); } catch { return; }
  for (const file of files.filter((f) => f.startsWith(PROCESSING_PREFIX))) {
    console.warn(`[json-queue] discarding abandoned claim ${file} in ${dir} (not re-run)`);
    try { fs.unlinkSync(path.join(dir, file)); } catch { /* still locked; retried next startup */ }
  }
}

/** `fs.mkdirSync` the queue dir, drain it once, then redrain on every `fs.watch` event. */
function watchJsonQueue(dir, onDrain) {
  fs.mkdirSync(dir, { recursive: true });
  sweepAbandonedClaims(dir);
  onDrain();
  const watcher = fs.watch(dir, onDrain);
  // Without a listener, the folder being deleted under the watcher throws in the main process.
  watcher.on('error', (err) => console.warn(`[json-queue] watcher on ${dir} stopped: ${err.message}`));
  return { close: () => watcher.close() };
}

module.exports = { drainJsonQueue, watchJsonQueue };
