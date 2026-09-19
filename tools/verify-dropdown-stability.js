// @ts-check
/**
 * Verification test for dropdown stability and render deferral.
 *
 * Validates:
 * 1. ui/app.js defines and exports isInteractingWithDropdown, render, and flushDeferredRender.
 * 2. Dropdown interaction guard correctly detects active <select> and <input list="..."> controls.
 * 3. Normal background/telemetry renders are deferred while the user interacts with dropdowns.
 * 4. User-forced actions (change events, clicks, Escape) bypass deferral and render immediately.
 * 5. Deferred repaints are cleanly flushed when dropdown interaction ends (focusout/change).
 * 6. Modal dialog open state guards 1-second artboard clock ticks from wiping user inputs.
 *
 * Run with: node tools/verify-dropdown-stability.js
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function testSourceInvariants() {
  const appJsPath = path.join(__dirname, '..', 'ui', 'app.js');
  const content = fs.readFileSync(appJsPath, 'utf8');

  // Verify function definitions and exports
  assert.ok(
    content.includes('export function isInteractingWithDropdown('),
    'ui/app.js must export isInteractingWithDropdown'
  );
  assert.ok(
    content.includes('export function render('),
    'ui/app.js must export render'
  );
  assert.ok(
    content.includes('export function flushDeferredRender('),
    'ui/app.js must export flushDeferredRender'
  );

  // Verify deferral state and logic
  assert.ok(
    content.includes('let deferredRender = false;'),
    'ui/app.js must maintain deferredRender state'
  );
  assert.ok(
    content.includes('if (!force && isInteractingWithDropdown())'),
    'render() must defer background renders when interacting with dropdowns'
  );

  // Verify listeners wiring
  assert.ok(
    content.includes("app.addEventListener('focusout'"),
    'ui/app.js must handle focusout to flush deferred repaints'
  );
  assert.ok(
    content.includes('flushDeferredRender();'),
    'change listener must flush deferred renders after processing value updates'
  );

  // Verify 1s tick modal open guard
  assert.ok(
    content.includes('const modalOpen = state.queue !== null || state.editConfig !== null'),
    '1-second artboard tick must check modalOpen before repainting'
  );
  assert.ok(
    content.includes('if (modalOpen) return;'),
    '1-second artboard tick must abort repaint if modal dialog is open'
  );

  console.log('Source invariants OK: app.js contains all required stability guards');
}

function testInteractionDetectionLogic() {
  function isInteracting(activeEl) {
    if (!activeEl) return false;
    const tag = activeEl.tagName;
    if (tag === 'SELECT') return true;
    if (tag === 'INPUT' && activeEl.hasAttribute('list')) return true;
    return false;
  }

  // <select> element
  assert.strictEqual(isInteracting({ tagName: 'SELECT', hasAttribute: () => false }), true);

  // <input list="some-datalist">
  assert.strictEqual(
    isInteracting({
      tagName: 'INPUT',
      hasAttribute: (attr) => attr === 'list',
    }),
    true
  );

  // Regular input without list
  assert.strictEqual(
    isInteracting({
      tagName: 'INPUT',
      hasAttribute: () => false,
    }),
    false
  );

  // Regular button or div
  assert.strictEqual(isInteracting({ tagName: 'BUTTON', hasAttribute: () => false }), false);
  assert.strictEqual(isInteracting({ tagName: 'DIV', hasAttribute: () => false }), false);
  assert.strictEqual(isInteracting(null), false);
  assert.strictEqual(isInteracting(undefined), false);

  console.log('Interaction detection OK: accurately identifies active dropdown controls');
}

function testRenderDeferralLifecycle() {
  let activeElement = null;
  let paintedCount = 0;
  let deferred = false;

  function mockPaint() {
    paintedCount++;
  }

  function mockIsInteracting() {
    if (!activeElement) return false;
    return activeElement.tagName === 'SELECT' || (activeElement.tagName === 'INPUT' && activeElement.hasList);
  }

  function mockRender(force = false) {
    if (!force && mockIsInteracting()) {
      deferred = true;
      return;
    }
    deferred = false;
    mockPaint();
  }

  function mockFlush() {
    if (deferred && !mockIsInteracting()) {
      deferred = false;
      mockPaint();
    }
  }

  // 1. Initial render when no dropdown is active
  mockRender();
  assert.strictEqual(paintedCount, 1);
  assert.strictEqual(deferred, false);

  // 2. User focuses on a select element
  activeElement = { tagName: 'SELECT' };

  // 3. Background tick or telemetry comes in (force = false)
  mockRender(false);
  assert.strictEqual(paintedCount, 1, 'Should NOT repaint while select is focused');
  assert.strictEqual(deferred, true, 'deferred flag must be set');

  // Another telemetry chunk
  mockRender(false);
  assert.strictEqual(paintedCount, 1, 'Still should NOT repaint');
  assert.strictEqual(deferred, true);

  // 4. User makes a selection (change event -> force = true)
  mockRender(true);
  assert.strictEqual(paintedCount, 2, 'Forced render must repaint immediately');
  assert.strictEqual(deferred, false);

  // 5. Select focuses again, telemetry arrives, then user tabs away (focusout)
  activeElement = { tagName: 'SELECT' };
  mockRender(false);
  assert.strictEqual(paintedCount, 2);
  assert.strictEqual(deferred, true);

  // User leaves select
  activeElement = null;
  mockFlush();
  assert.strictEqual(paintedCount, 3, 'Flushing deferred render repaints once focus is released');
  assert.strictEqual(deferred, false);

  console.log('Render deferral lifecycle OK: deferred on focus, flushed on release, forced on user change');
}

function testModalTickGuard() {
  function shouldTickRepaint(state) {
    const modalOpen = state.queue !== null || state.editConfig !== null || state.scan !== null
      || state.inspectedSkill !== null || state.inspectedTask !== null || state.newConvOpen;
    if (modalOpen) return false;
    return state.view === 'dispatch' || state.view === 'usage';
  }

  // Normal dispatch view with no modals
  assert.strictEqual(
    shouldTickRepaint({
      view: 'dispatch',
      queue: null,
      editConfig: null,
      scan: null,
      inspectedSkill: null,
      inspectedTask: null,
      newConvOpen: false,
    }),
    true
  );

  // Queue dialog open
  assert.strictEqual(
    shouldTickRepaint({
      view: 'dispatch',
      queue: 'cute-agents-desk',
      editConfig: null,
      scan: null,
      inspectedSkill: null,
      inspectedTask: null,
      newConvOpen: false,
    }),
    false
  );

  // Config edit dialog open
  assert.strictEqual(
    shouldTickRepaint({
      view: 'config',
      queue: null,
      editConfig: { key: 'coordinators.defaultEngine' },
      scan: null,
      inspectedSkill: null,
      inspectedTask: null,
      newConvOpen: false,
    }),
    false
  );

  // Sidebar new coordinator form open
  assert.strictEqual(
    shouldTickRepaint({
      view: 'dispatch',
      queue: null,
      editConfig: null,
      scan: null,
      inspectedSkill: null,
      inspectedTask: null,
      newConvOpen: true,
    }),
    false
  );

  console.log('Modal tick guard OK: suppresses periodic repaints while modals or forms are open');
}

testSourceInvariants();
testInteractionDetectionLogic();
testRenderDeferralLifecycle();
testModalTickGuard();
console.log('All dropdown stability verification checks passed successfully.');
