// @ts-check
/**
 * Pure predicates behind render deferral. Shared by the renderer (ui/app.js) and its
 * verification test (tools/verify-dropdown-stability.js) so both read the same rule instead of
 * two copies that can silently drift apart.
 */

/**
 * True while `active` is a native dropdown control the OS is rendering an open popup for.
 * Rebuilding the DOM under it while it is open closes that popup before the user can pick
 * an option, which is why a repaint has to check this before it runs.
 * @param {{tagName?: string, hasAttribute?: (name: string) => boolean}|null|undefined} active
 * @returns {boolean}
 */
export function isInteractingWithDropdown(active) {
  if (!active) return false;
  const tag = active.tagName;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT' && active.hasAttribute && active.hasAttribute('list')) return true;
  return false;
}

/**
 * True when the artboard's 1-second clock tick may repaint: not while a modal dialog or an
 * inline form holds focus, and only for the two views that clock actually drives.
 * @param {Record<string, any>} state
 * @returns {boolean}
 */
export function shouldTickRepaint(state) {
  const modalOpen = state.queue !== null || state.editConfig !== null || state.scan !== null
    || state.inspectedSkill !== null || state.inspectedTask !== null || state.newConvOpen;
  if (modalOpen) return false;
  return state.view === 'dispatch' || state.view === 'usage';
}
