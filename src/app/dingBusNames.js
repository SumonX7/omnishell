/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * D-Bus names used by the bundled Desktop Icons NG engine.
 *
 * Upstream Desktop Icons NG uses "com.rastersoft.dingextension" for its
 * control interface. OmniShell bundles the DING engine itself, so it must
 * not claim that name: doing so collides with a separately installed
 * upstream DING, and the two instances then fight over the name and over
 * the control object.
 *
 * The names below are therefore OmniShell-specific.
 */

/** Bus name owned by the extension for the DING control interface. */
const DING_BUS_NAME = "com.spark.omnishell.dingextension";

/** Object path at which the DING control actions are exported. */
const DING_CONTROL_PATH = "/com/spark/omnishell/dingextension/control";

/**
 * Object path at which the *child* DING process exports its own actions.
 *
 * The extension's preferences window has an "Open Full Settings" button that
 * raises the DING settings window. That window lives in the child process, so
 * the child exports an action group here and the extension calls the
 * `changeDesktopIconSettings` action on it.
 */
const DING_SETTINGS_PATH = "/com/spark/omnishell/dingextension/settings";

/**
 * Application id of the bundled DING desktop process.
 *
 * Upstream DING uses "com.rastersoft.ding" for the real desktop instance and
 * "com.rastersoft.dingtest" for a manually launched one. The bundled engine
 * is launched with `Gio.ApplicationFlags.REPLACE`, so claiming the upstream
 * id would *displace* a separately installed upstream DING on the session
 * bus -- destabilising the user's own installation.
 */
const DING_APP_ID = "com.spark.omnishell.ding";

/** Application id used when the engine is launched manually for testing. */
const DING_APP_ID_TEST = "com.spark.omnishell.dingtest";

export {
  DING_BUS_NAME,
  DING_CONTROL_PATH,
  DING_SETTINGS_PATH,
  DING_APP_ID,
  DING_APP_ID_TEST
};
