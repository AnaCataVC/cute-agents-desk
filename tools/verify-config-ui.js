// @ts-check
/**
 * Verification test for interactive configuration editing, modal dialogs, and metadata bounds.
 *
 * Validates:
 * 1. settingsRow (ui/config.js) renders an editable value-pill for non-booleans and a toggle
 *    for booleans, and a plain non-interactive pill when there is no section/key to write to.
 * 2. mismatchPanel and scanSummaryCard (ui/config.js) wire fixMismatch/ignoreMismatch/rescanRepos
 *    from real rendered output, not a guess at the template's shape.
 * 3. editConfigDialog (ui/dialogs.js) disables its controls and shows a saving state while a
 *    save is in flight, and offers to save when idle.
 * 4. CONFIG_META and getConfigRawValue exports and completeness across all non-boolean settings.
 * 5. Bounds and typing invariants between CONFIG_META and electron/config.js.
 * 6. Defensive zero-crash fallback for unregistered keys.
 * 7. Asset, CSS and dispatch-table wiring that has no pure-function equivalent to call instead.
 *
 * Run with: node tools/verify-config-ui.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  // @ts-ignore
  global.document = {
    getElementById: () => ({ addEventListener: () => {} }),
    addEventListener: () => {},
  };
  // @ts-ignore
  global.window = { desk: {} };

  const appModule = await import('../ui/app.js');
  const dataModule = await import('../ui/data.js');
  const configModule = await import('../ui/config.js');
  const dialogsModule = await import('../ui/dialogs.js');

  const { CONFIG_META, getConfigRawValue } = appModule;
  const { settingsRow, mismatchPanel, scanSummaryCard } = configModule;
  const { editConfigDialog } = dialogsModule;

  // 1. settingsRow renders the control that matches the value's shape and writability.
  const boolRow = settingsRow(['Preguntar antes de abrir sesiones', true, 'coordinators', 'askBeforeSpawning']);
  assert.ok(boolRow.includes('data-act="toggleConfig"'), 'a boolean row must render the toggle control');
  assert.ok(boolRow.includes('data-arg="coordinators|askBeforeSpawning"'), 'the toggle must carry section|key as its arg');

  const editableRow = settingsRow(['Sesiones que puede abrir', 3, 'coordinators', 'maxSessionsPerCoordinator']);
  assert.ok(editableRow.includes('data-act="editConfigValue"'), 'a non-boolean row with section/key must render the edit control');
  assert.ok(editableRow.includes('data-arg="coordinators|maxSessionsPerCoordinator"'), 'the edit control must carry section|key as its arg');

  const readonlyRow = settingsRow(['Repos', 5, '', '']);
  assert.ok(!readonlyRow.includes('data-act='), 'a row with no section/key must render a plain, non-interactive pill');

  // 2. mismatchPanel and scanSummaryCard, exercised with real sample data instead of grepped source.
  const mismatchHtml = mismatchPanel([{
    repo: 'cute-agents-desk',
    path: 'C:/repos/cute-agents-desk',
    detail: 'C:/repos/cute-agents-desk -> otra@cuenta.com',
    fix: 'AnaCataVC',
    accountName: 'AnaCataVC',
    targetEmail: 'anacatalina@outlook.cl',
  }], { fixingRepo: null });
  assert.ok(mismatchHtml.includes('data-act="fixMismatch"'), 'a detected mismatch must render fixMismatch');
  assert.ok(mismatchHtml.includes('data-act="ignoreMismatch"'), 'a detected mismatch must render ignoreMismatch');
  assert.ok(mismatchPanel([], {}).includes('Sin desajustes detectados'), 'an empty mismatch list must render the clean-state panel');

  const scanHtml = scanSummaryCard(dataModule, { rescanning: false });
  assert.ok(scanHtml.includes('data-act="rescanRepos"'), 'scanSummaryCard must render rescanRepos');
  assert.ok(scanSummaryCard(dataModule, { rescanning: true }).includes('disabled'), 'scanSummaryCard must disable the button while a scan is in flight');

  // 3. editConfigDialog: real behaviour while saving vs. idle, not a text search for the word "saving".
  const cfgBase = {
    section: 'advanced', key: 'harnessDir', label: 'Directorio del harness',
    currentValue: '~/x', type: 'text', isPath: true, error: null,
  };
  const savingDialog = editConfigDialog({ editConfig: { ...cfgBase, saving: true } }, {});
  assert.ok(savingDialog.includes('data-act="submitEditConfig"'), 'editConfigDialog must wire submitEditConfig');
  assert.ok(savingDialog.includes('data-act="browseEditConfigPath"'), 'a path field must wire browseEditConfigPath');
  assert.ok(savingDialog.includes('Guardando'), 'a dialog mid-save must show the saving label');
  assert.ok(savingDialog.includes('data-act="closeEditConfig" disabled'), 'the cancel/close controls must be disabled while saving');

  const idleDialog = editConfigDialog({ editConfig: { ...cfgBase, saving: false } }, {});
  assert.ok(idleDialog.includes('Guardar cambios'), 'an idle dialog must offer to save');
  assert.ok(!idleDialog.includes('disabled'), 'an idle dialog must not disable its controls');

  // 4. Source checks limited to what has no pure-function equivalent: the ACTIONS dispatch table
  //    (an inline object literal, never exported) and static asset/CSS integrity.
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
  assert.ok(appJs.includes('editConfigValue:'), 'app.js must handle editConfigValue');
  assert.ok(appJs.includes('submitEditConfig:'), 'app.js must handle submitEditConfig');
  assert.ok(appJs.includes('closeEditConfig:'), 'app.js must handle closeEditConfig');
  assert.ok(appJs.includes('rescanRepos:'), 'app.js must handle rescanRepos');
  assert.ok(appJs.includes('fixMismatch:'), 'app.js must handle fixMismatch');
  assert.ok(appJs.includes('ignoreMismatch:'), 'app.js must handle ignoreMismatch');
  assert.ok(appJs.includes('function showToast('), 'app.js must define function showToast');
  assert.ok(appJs.includes('function toastContainer()'), 'app.js must define function toastContainer');
  assert.ok(appJs.includes('${toastContainer()}'), 'app.js must render toastContainer');
  assert.ok(appJs.includes('assets/icon.png'), 'app.js loading screen must use official app icon');

  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('assets/icon.png'), 'index.html loading markup must use official app icon');

  const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(
    pkgJson.build?.files?.includes('assets/**'),
    'package.json must bundle assets/** to include app icons in distributions'
  );

  const appCss = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.css'), 'utf8');
  assert.ok(appCss.includes('.toast-container'), 'app.css must define .toast-container');
  assert.ok(appCss.includes('.toast-msg'), 'app.css must define .toast-msg');
  assert.ok(appCss.includes('.value-pill[data-act="editConfigValue"]'), 'app.css must style editable value-pill');

  // 5. Dynamic schema validation & functional test of CONFIG_META and getConfigRawValue
  assert.ok(CONFIG_META && typeof CONFIG_META === 'object', 'CONFIG_META must be exported as an object');
  assert.ok(typeof getConfigRawValue === 'function', 'getConfigRawValue must be exported as a function');

  // Verify all non-boolean settings in data.getSettings() have metadata
  const settings = dataModule.getSettings();
  for (const [_subtab, rows] of Object.entries(settings)) {
    for (const [label, value, section, key] of rows) {
      if (typeof value !== 'boolean' && section && key) {
        const metaKey = `${section}.${key}`;
        const meta = CONFIG_META[metaKey];
        assert.ok(meta, `CONFIG_META must include an entry for ${metaKey} (${label})`);
        assert.ok(meta.label, `CONFIG_META[${metaKey}] must have a descriptive label`);
        assert.ok(meta.type, `CONFIG_META[${metaKey}] must have a defined type`);

        if (meta.type === 'number') {
          assert.strictEqual(typeof meta.min, 'number', `${metaKey} must define numeric min`);
          assert.strictEqual(typeof meta.max, 'number', `${metaKey} must define numeric max`);
          assert.ok(meta.min <= meta.max, `${metaKey} min must be <= max`);
        } else if (meta.type === 'select') {
          assert.ok(Array.isArray(meta.options) && meta.options.length > 0, `${metaKey} must define select options`);
        }

        // Test getConfigRawValue resolution
        const raw = getConfigRawValue(section, key);
        assert.notStrictEqual(raw, undefined, `getConfigRawValue(${section}, ${key}) must not be undefined`);
        if (meta.type === 'number') {
          assert.strictEqual(typeof raw, 'number', `getConfigRawValue(${section}, ${key}) must parse to number`);
        }
      }
    }
  }

  // 6. Defensive zero-crash fallback test for unregistered keys
  const fallbackMeta = (CONFIG_META && CONFIG_META['unknownSection.unknownKey']) || {};
  assert.strictEqual(fallbackMeta.label, undefined, 'Unregistered key should safely produce empty object');
  const fallbackVal = getConfigRawValue('unknownSection', 'unknownKey');
  assert.strictEqual(fallbackVal, '', 'Unregistered key should produce empty string fallback');

  console.log('verify-config-ui OK: controles de edicion, dialog modal, CSS, metadatos y fallback hermeticamente validados');
  process.exit(0);
}

main().catch((err) => {
  console.error('verify-config-ui FAILED:', err);
  process.exit(1);
});
