// @ts-check
/**
 * ui/data.js's live-repo seam has no Electron dependency -- it is browser JS that reacts to
 * whatever setLiveRepoData() is handed. The one way this seam breaks silently is exactly what
 * happened while writing it: `repo.folder` not matching any `account.folders[].path` exactly,
 * which makes repo-tree.js's `kids = mine.filter((r) => r.folder === folder.path)` come back
 * empty and repos vanish from the tree with no error anywhere.
 *
 * Run with: node tools/verify-live-repo-data.mjs
 */

import assert from 'node:assert';
import * as data from '../ui/data.js';

const accounts = [
  { id: 'work-account', name: 'work-account', email: 'a@b.com', color: 'var(--color-mint)',
    folders: [{ path: 'C:/Users/dev/Work/Repositories', depth: 3 }] },
  { id: 'personal-account', name: 'personal-account', email: 'c@d.com', color: 'var(--color-lilac)',
    folders: [{ path: 'C:/Users/dev/Repos', depth: 2 }] },
];
const repos = [
  { path: 'C:/Users/dev/Work/Repositories/external/munder-difflin', name: 'munder-difflin',
    accountGh: 'work-account', folder: 'C:/Users/dev/Work/Repositories',
    branch: 'main', dirty: false, remote: 'git@github.com:x/munder-difflin.git', mismatch: false },
  { path: 'C:/Users/dev/Repos/cute-agents-desk', name: 'cute-agents-desk',
    accountGh: 'personal-account', folder: 'C:/Users/dev/Repos',
    branch: 'main', dirty: true, remote: null, mismatch: false },
];

data.setLiveRepoData({ accounts, repos });

const gotAccounts = data.getAccounts();
assert.strictEqual(gotAccounts.length, 2, 'deberia usar las cuentas reales, no el mock');
assert.strictEqual(gotAccounts[0].id, 'work-account');

const gotRepos = data.getRepos();
assert.strictEqual(gotRepos.length, 2);
const nested = gotRepos.find((r) => r.name === 'munder-difflin');
// The exact bug this test exists to catch: a repo nested two levels under its declared root
// (external/munder-difflin) must still carry the ROOT as its `folder`, not its filesystem parent
// (`.../external`), because that root is the only string repo-tree.js groups by.
assert.strictEqual(nested.folder, 'C:/Users/dev/Work/Repositories',
  'un repo anidado debe quedar etiquetado con la raiz declarada, no con su carpeta padre real');
assert.strictEqual(nested.accountId, 'work-account');
assert.strictEqual(nested.noRemote, false);

const noRemoteRepo = gotRepos.find((r) => r.name === 'cute-agents-desk');
assert.strictEqual(noRemoteRepo.noRemote, true, 'sin remote debe verse como noRemote:true');
assert.strictEqual(noRemoteRepo.dirty, true);

// The one thing repo-tree.js actually filters by: every repo's folder must match one of its
// account's declared folder paths verbatim, or it silently never renders.
for (const r of gotRepos) {
  const acc = gotAccounts.find((a) => a.id === r.accountId);
  assert.ok(acc.folders.some((f) => f.path === r.folder),
    `${r.name}: folder "${r.folder}" no calza con ninguna carpeta declarada de ${acc.id}`);
}

const summary = data.getSummary();
assert.strictEqual(summary.repos, 2, 'el header debe contar los repos reales, no el "65" fijo');
assert.strictEqual(summary.accounts, 2);

console.log('seam de datos en vivo OK: cuentas y repos reales pasan, y el repo anidado calza con su raiz declarada');
