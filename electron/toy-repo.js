// @ts-check
/**
 * A repo to try things on, created on first use.
 *
 * Real repos arrive with the folder scan; until then an agent needs somewhere it can write
 * without consequences — and the verification script needs the same place, which is why this
 * is not inlined in main.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { git } = require('./git.js');
const paths = require('./paths.js');

function toyRepo() {
  const dir = path.join(paths.ensure().home, 'toy-repo');
  if (fs.existsSync(path.join(dir, '.git'))) return dir;

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# repo de juguete\n\nPara probar el despacho.\n');
  git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  // An identity on the command line, not in the repo's config: the account rules are the
  // dashboard's job, and a fixture must not look like it earned one.
  git(dir, ['-c', 'user.name=cute-agents-desk', '-c', 'user.email=desk@localhost',
    'commit', '-q', '-m', 'primer commit']);
  return dir;
}

module.exports = { toyRepo };
