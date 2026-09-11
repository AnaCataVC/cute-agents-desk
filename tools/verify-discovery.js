// @ts-check
/**
 * Verifies discovery against the real machine: whatever accounts and folders are declared in
 * your own `~/.cute-agents-desk/accounts.json` (the Configuracion tab writes it, phase 2+),
 * scanned for real. No mocks -- if this finds zero repos, or misreads this very repo's own
 * account, the scanner is wrong, not the fixture.
 *
 * Run with: node tools/verify-discovery.js
 */

const assert = require('node:assert');
const { listGhAccounts, readAccountsConfig } = require('../electron/accounts.js');
const { scanRepos, inspectRepo } = require('../electron/discovery.js');

const accounts = readAccountsConfig();
assert.ok(accounts.length > 0,
  'accounts.json esta vacio -- declara al menos una cuenta y su carpeta desde la pestana '
  + 'Configuracion antes de correr este verify');

console.log('cuentas en gh auth status:', listGhAccounts());

const repos = scanRepos(accounts);
console.log(`repos encontrados: ${repos.length}`);
for (const r of repos.slice(0, 15)) {
  console.log(`  ${r.accountGh.padEnd(16)} ${r.name.padEnd(24)} ${r.branch.padEnd(20)} ${r.dirty ? 'sucio' : 'limpio'}${r.mismatch ? '  ** MISMATCH: ' + r.email + ' **' : ''}`);
}
if (repos.length > 15) console.log(`  ... y ${repos.length - 15} mas`);

const mismatched = repos.filter((r) => r.mismatch);
console.log(`\ndesajustes de cuenta detectados: ${mismatched.length}`);
for (const r of mismatched) console.log(`  ${r.path} -> ${r.email} (cuenta ${r.accountGh})`);

const self = repos.find((r) => r.name === 'cute-agents-desk');
assert.ok(self, 'este mismo repo deberia aparecer en el escaneo -- revisa que accounts.json '
  + 'declare la carpeta que lo contiene');
assert.strictEqual(self.mismatch, false, 'el repo propio no deberia marcar mismatch de cuenta');
assert.ok(repos.length >= 1, 'deberia encontrar al menos un repo real en la maquina');

// Zero mismatches in the real scan proves nothing about whether the comparison itself can ever
// fire -- it could just as well never run. Force it against this repo's real email.
const folderRoot = require('node:path').dirname(process.cwd());
const wrongAccount = inspectRepo(process.cwd(), { gh: 'x', email: 'nunca-va-a-calzar@ejemplo.com' }, folderRoot);
assert.strictEqual(wrongAccount.mismatch, true, 'un email distinto al de la cuenta deberia marcar mismatch');
assert.strictEqual(wrongAccount.folder, folderRoot, 'folder deberia ser la raiz declarada, no el padre del repo');
const rightAccount = inspectRepo(process.cwd(), { gh: 'x', email: wrongAccount.email }, folderRoot);
assert.strictEqual(rightAccount.mismatch, false, 'el mismo email no deberia marcar mismatch');

console.log('\ndescubrimiento OK: encontro repos reales y se encontro a si mismo sin marcar mismatch');
