// @ts-check
/**
 * The mailbox mechanics shared by every drop-a-json-file-here queue in the harness (an agent's
 * hook-event inbox, its outbox, a conversation's spawn-requests folder): list `.json` files,
 * parse each, hand it to a caller-supplied handler, then delete it.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * A file that fails to parse -- or that `onItem` rejects by returning `false` -- is left in
 * place for the next drain instead of treated as an error, since `fs.watch` gives only the
 * filename on Windows and a rename can arrive before the content is flushed.
 * @param {string} dir
 * @param {(item: any) => boolean | void} onItem  return `false` to leave the file unconsumed
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
    if (onItem(parsed) === false) continue;
    try { fs.unlinkSync(full); } catch { /* raced with another drain */ }
  }
  return true;
}

/** `fs.mkdirSync` the queue dir, drain it once, then redrain on every `fs.watch` event. */
function watchJsonQueue(dir, onDrain) {
  fs.mkdirSync(dir, { recursive: true });
  onDrain();
  const watcher = fs.watch(dir, onDrain);
  return { close: () => watcher.close() };
}

module.exports = { drainJsonQueue, watchJsonQueue };
