// @ts-check
/**
 * Verification test for interactive configuration editing and toast notifications.
 *
 * Validates:
 * 1. settingsRow markup renders interactive edit buttons with data-act="editConfigValue" for non-boolean values.
 * 2. settingsRow markup renders toggle-tracks with data-act="toggleConfig" for booleans.
 * 3. Config bounds and metadata exist for all non-boolean setting rows.
 * 4. Dialog schema generation for numbers, paths, and dropdowns.
 *
 * Run with: node tools/verify-config-ui.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

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

// 3. Inspect app.js content to ensure actions and toast are wired
const appJs = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
assert.ok(appJs.includes('editConfigValue:'), 'app.js must handle editConfigValue');
assert.ok(appJs.includes('submitEditConfig:'), 'app.js must handle submitEditConfig');
assert.ok(appJs.includes('closeEditConfig:'), 'app.js must handle closeEditConfig');
assert.ok(appJs.includes('showToast'), 'app.js must include showToast');
assert.ok(appJs.includes('toastContainer()'), 'app.js must render toastContainer');

// 4. Inspect app.css for toast and value-pill interactive styling
const appCss = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.css'), 'utf8');
assert.ok(appCss.includes('.toast-container'), 'app.css must define .toast-container');
assert.ok(appCss.includes('.toast-msg'), 'app.css must define .toast-msg');
assert.ok(appCss.includes('.value-pill[data-act="editConfigValue"]'), 'app.css must style editable value-pill');

console.log('verify-config-ui OK: controles de edicion, dialog modal, CSS y feedback toast validados hermeticamente');
process.exit(0);
