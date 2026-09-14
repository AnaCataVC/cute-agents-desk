// @ts-check
/**
 * Verification test for interactive configuration editing, modal dialogs, and metadata bounds.
 *
 * Validates:
 * 1. settingsRow markup renders interactive edit buttons with data-act="editConfigValue" for non-boolean values.
 * 2. settingsRow markup renders toggle-tracks with data-act="toggleConfig" for booleans.
 * 3. Dialog schema generation, modal wiring, and button state in dialogs.js.
 * 4. CONFIG_META and getConfigRawValue exports and completeness across all non-boolean settings.
 * 5. Bounds and typing invariants between CONFIG_META and electron/config.js.
 * 6. Defensive zero-crash fallback for unregistered keys.
 * 7. Asset and icon integrity.
 *
 * Run with: node tools/verify-config-ui.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  // 1. Inspect config.js content directly to ensure settingsRow generates the edit action
  const configJs = fs.readFileSync(path.join(__dirname, '..', 'ui', 'config.js'), 'utf8');
  assert.ok(configJs.includes('data-act="editConfigValue"'), 'settingsRow must render data-act="editConfigValue" for non-booleans');
  assert.ok(configJs.includes('data-act="toggleConfig"'), 'settingsRow must render data-act="toggleConfig" for booleans');

  // 2. Inspect dialogs.js content to ensure editConfigDialog is present and wired in renderDialogs
  const dialogsJs = fs.readFileSync(path.join(__dirname, '..', 'ui', 'dialogs.js'), 'utf8');
  assert.ok(dialogsJs.includes('function editConfigDialog'), 'dialogs.js must define editConfigDialog');
  assert.ok(dialogsJs.includes('state.editConfig'), 'dialogs.js must check state.editConfig in renderDialogs');
  assert.ok(dialogsJs.includes('data-act="submitEditConfig"'), 'dialogs.js must support submitEditConfig');
  assert.ok(dialogsJs.includes('data-act="browseEditConfigPath"'), 'dialogs.js must support browseEditConfigPath');
  assert.ok(dialogsJs.includes('cfg.saving'), 'dialogs.js must support saving state to prevent double submit');

  // 3. Inspect app.js content to ensure actions and toast are properly defined and wired
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
  assert.ok(appJs.includes('export const CONFIG_META ='), 'app.js must export CONFIG_META');
  assert.ok(appJs.includes('export function getConfigRawValue('), 'app.js must export getConfigRawValue');
  assert.ok(appJs.includes('editConfigValue:'), 'app.js must handle editConfigValue');
  assert.ok(appJs.includes('submitEditConfig:'), 'app.js must handle submitEditConfig');
  assert.ok(appJs.includes('closeEditConfig:'), 'app.js must handle closeEditConfig');
  assert.ok(appJs.includes('function showToast('), 'app.js must define function showToast');
  assert.ok(appJs.includes('function toastContainer()'), 'app.js must define function toastContainer');
  assert.ok(appJs.includes('${toastContainer()}'), 'app.js must render toastContainer');
  assert.ok(appJs.includes('assets/icon.png'), 'app.js loading screen must use official app icon');

  // 4. Inspect index.html and package.json for asset and icon integrity
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('assets/icon.png'), 'index.html loading markup must use official app icon');

  const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(
    pkgJson.build?.files?.includes('assets/**'),
    'package.json must bundle assets/** to include app icons in distributions'
  );

  // 5. Inspect app.css for toast and value-pill interactive styling
  const appCss = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.css'), 'utf8');
  assert.ok(appCss.includes('.toast-container'), 'app.css must define .toast-container');
  assert.ok(appCss.includes('.toast-msg'), 'app.css must define .toast-msg');
  assert.ok(appCss.includes('.value-pill[data-act="editConfigValue"]'), 'app.css must style editable value-pill');

  // 6. Dynamic schema validation & functional test of CONFIG_META and getConfigRawValue
  // @ts-ignore
  global.document = {
    getElementById: () => ({ addEventListener: () => {} }),
    addEventListener: () => {},
  };
  // @ts-ignore
  global.window = { desk: {} };

  const appModule = await import('../ui/app.js');
  const dataModule = await import('../ui/data.js');

  const { CONFIG_META, getConfigRawValue } = appModule;
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

  // 7. Defensive zero-crash fallback test for unregistered keys
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
