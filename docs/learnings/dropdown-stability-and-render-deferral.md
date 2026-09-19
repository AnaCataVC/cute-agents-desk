# Learnings: Dropdown Stability and Render Deferral Guard

## 1. Problem Context & Symptoms

In Cute Agents Desk, users reported that clicking on dropdown controls (`<select>` and `<input list="...">` datalists) caused the native selection menu to immediately collapse before options could be inspected or selected:
- In the "Nueva petición" (Queue Task) modal dialog: repository selection, engine picker, coordinator flow reuse, reasoning effort level.
- In the "Nuevo Coordinador" inline sidebar form: engine selector, model datalist, effort level, and delegation mode.
- In the "Configuración" modal dialog: dropdown properties such as default engine and coordinator report interval.

The symptom manifested as an intermittent or immediate closing of the OS dropdown popup immediately upon opening or while moving the cursor towards an option.

---

## 2. Root Cause Analysis

### 2.1 Full-DOM Repainting Model (`app.innerHTML = ...`)
Cute Agents Desk employs a lightweight reactive architecture in `ui/app.js`:
- Components are pure functions (`render(state, data) -> html string`).
- State transitions trigger `render()`, which replaces `app.innerHTML` via `keepFocus(() => paint())`.
- Delegated event listeners on `#app` handle interactions through `data-act` attributes.

While this pattern is memory-efficient and avoids heavy virtual DOM dependencies, it has a fundamental conflict with native browser controls.

### 2.2 Chromium / Blink Native Widget Lifecycle
In Chromium (and Electron):
- A native `<select>` element delegates its popup list to an OS-level window/widget anchored to the DOM node.
- The instant `app.innerHTML = ...` executes, the active `<select>` node is removed from the DOM tree.
- When an element is disconnected from the DOM, Chromium **immediately destroys its native popup widget**.
- Although `keepFocus()` relocated focus to the newly created element with the same `data-act`, focus restoration **does not re-open the native popup widget**.

### 2.3 Collision Triggers: Ticks and Telemetry
Two independent asynchronous event sources triggered DOM repainting while users attempted to select options:
1. **Periodic Artboard Clock Tick:** `setInterval(..., 1000)` executes every second in `state.view === 'dispatch'` to update elapsed session runtimes and live token rates.
2. **Background Telemetry & Streaming Chunks:** `window.desk.subscribe()` receives streaming PTY chunks, agent lifecycle transitions, and usage metrics, scheduling repaints on animation frames (`requestAnimationFrame`).

Whenever a user opened a dropdown, any tick or telemetry chunk arriving within 1000 ms immediately wiped the DOM and collapsed the popup.

---

## 3. Architecture & Implemented Solution

### 3.1 Non-Intrusive Interaction Detection (`isInteractingWithDropdown`)
We introduced an active interaction checker:
```javascript
export function isInteractingWithDropdown() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT' && active.hasAttribute('list')) return true;
  return false;
}
```

### 3.2 Selective Render Deferral (`render(force)`)
`render()` distinguishes between automated background polls and deliberate user actions:
- **Background / Telemetry / Periodic Ticks (`force = false`):**
  If `isInteractingWithDropdown()` is true, repainting is safely deferred (`deferredRender = true`), leaving the existing DOM and its native popup intact.
- **Explicit User Actions (`force = true`):**
  User clicks on buttons, modal form submissions, `change` events on selects, or Escape key presses bypass deferral and render immediately.

### 3.3 Deferred Render Flushing (`flushDeferredRender`)
When interaction concludes:
1. **On `change` Event:** The user picked an option. The native popup has naturally closed. The state is updated and deferred repaints are flushed immediately.
2. **On `focusout` Event:** The user tabbed out or clicked outside the control. A short microtask timeout (20ms) checks that focus did not shift to another select, and then flushes any pending repaint.

### 3.4 Modal Tick Suppression
Periodic 1-second clock ticks are suppressed when interactive modal dialogs are open:
```javascript
const modalOpen = state.queue !== null || state.editConfig !== null || state.scan !== null
  || state.inspectedSkill !== null || state.inspectedTask !== null || state.newConvOpen;
if (modalOpen) return;
```
This guarantees that users composing a task description or configuring settings are never disturbed by background elapsed-time updates.

---

## 4. Verification & Testing Guard

A dedicated hermetic test suite was added in `tools/verify-dropdown-stability.js`:
- Verifies that `ui/app.js` exports `isInteractingWithDropdown`, `render`, and `flushDeferredRender`.
- Validates that active `<select>` and `<input list>` elements defer background renders.
- Validates that user-driven `change` events and explicit actions bypass deferral.
- Confirms that `focusout` cleanly flushes deferred repaints.
- Confirms that `modalOpen` suppresses periodic ticks.

The test runs in ~140ms and is integrated into `tools/verify-all.js`, preserving the **100% test pass rate (30/30 verify scripts OK)**.
