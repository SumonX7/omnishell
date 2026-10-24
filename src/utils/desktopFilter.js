/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * Conflict Protection Utility: identifies Desktop Icons NG windows
 * to ensure zero interference with tiling management, window borders,
 * snap assistant, and Alt+Tab switchers.
 */
import { Meta } from "../gi/ext.js";
import { isManagedWindow } from "../dingBridge/dingWindowRegistry.js";

function isDesktopWindow(window) {
  if (!window) return false;
  try {
    if (window.get_window_type() === Meta.WindowType.DESKTOP) {
      return true;
    }
  } catch {
  }
  try {
    const title = window.get_title();
    if (title) {
      // The title is only used as a *secondary* signal. The authoritative
      // check is the window type and the WM class below; a title alone must
      // never mark an ordinary application as a desktop window, because any
      // app can name its window "Desktop Icons ...".
      if (title === "DING") {
        return true;
      }
    }
  } catch {
  }
  try {
    const wmClass = window.get_wm_class();
    if (wmClass === "com.rastersoft.ding" || wmClass === "ding") {
      return true;
    }
    const gtkId = window.get_gtk_application_id();
    if (gtkId === "com.rastersoft.ding" || gtkId === "ding") {
      return true;
    }
  } catch {
  }
  if (isManagedWindow(window)) {
    return true;
  }
  return false;
}
export {
  isDesktopWindow
};
