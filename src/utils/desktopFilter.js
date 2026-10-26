/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * Conflict Protection Utility: identifies Desktop Icons NG windows
 * to ensure zero interference with tiling management, window borders,
 * snap assistant, and Alt+Tab switchers.
 */
import { Meta } from "../gi/ext.js";
import { isManagedWindow } from "../dingBridge/dingWindowRegistry.js";
import { DING_APP_ID, DING_APP_ID_TEST } from "../app/dingBusNames.js";
import { getDingBridge } from "../dingBridge/dingBridgeAccess.js";

// The bundled engine uses OmniShell-specific ids; the rastersoft ids are
// kept for compatibility with a separately installed upstream DING.
const DING_APP_IDS = new Set([
  DING_APP_ID,
  DING_APP_ID_TEST,
  "com.rastersoft.ding",
  "com.rastersoft.dingtest",
  "ding"
]);

function isDesktopWindow(window) {
  if (!window) return false;
  try {
    if (window.get_window_type() === Meta.WindowType.DESKTOP) {
      return true;
    }
  } catch {
  }
  if (isManagedWindow(window)) {
    return true;
  }
  try {
    const wmClass = window.get_wm_class();
    if (wmClass && (DING_APP_IDS.has(wmClass) || wmClass.includes("ding"))) {
      return true;
    }
    const gtkId = window.get_gtk_application_id();
    if (gtkId && (DING_APP_IDS.has(gtkId) || gtkId.includes("ding"))) {
      return true;
    }
  } catch {
  }
  try {
    const bridge = getDingBridge();
    if (bridge?.query_window_belongs_to?.(window)) {
      return true;
    }
  } catch {
  }
  try {
    const title = window.get_title();
    if (title === "DING" || (title && title.startsWith("DING "))) {
      return true;
    }
  } catch {
  }
  return false;
}
export {
  isDesktopWindow
};
