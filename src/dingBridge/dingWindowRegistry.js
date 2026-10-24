/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * Registry for the `ManageWindow` objects that the DING emulation attaches to
 * the desktop canvas windows.
 *
 * The association used to be stored as an ad-hoc JavaScript property on the
 * `Meta.Window` GObject:
 *
 *   window.customJS_ding = manageWindow;
 *
 * That has two problems:
 *
 *  1. The property is not a declared GObject property, so it is invisible to
 *     `notify::` and to GObject introspection.
 *  2. It survives an abnormal termination of gnome-shell. On the next start
 *     `addWindow()` sees a stale `customJS_ding` and returns early, so the
 *     window is never re-managed and the stale `ManageWindow` stays bound to
 *     a dead Wayland client.
 *
 * A `WeakMap` keyed by the window fixes both: the entry disappears together
 * with the window, and the association is not visible on the GObject.
 */

/** @type {WeakMap<object, object>} window -> ManageWindow */
const _managedWindows = new WeakMap();

/**
 * Returns the `ManageWindow` associated with a window, if any.
 */
function getManagedWindow(window) {
  if (!window) return null;
  try {
    return _managedWindows.get(window) ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns true when the window is already managed.
 */
function isManagedWindow(window) {
  return getManagedWindow(window) !== null;
}

/**
 * Associates a `ManageWindow` with a window.
 */
function setManagedWindow(window, manageWindow) {
  if (!window) return;
  try {
    _managedWindows.set(window, manageWindow);
  } catch {
  }
}

/**
 * Removes the association for a window and returns the object that was
 * associated with it, so the caller can dispose of it.
 */
function takeManagedWindow(window) {
  if (!window) return null;
  try {
    const manageWindow = _managedWindows.get(window) ?? null;
    _managedWindows.delete(window);
    return manageWindow;
  } catch {
    return null;
  }
}

export {
  getManagedWindow,
  isManagedWindow,
  setManagedWindow,
  takeManagedWindow
};
