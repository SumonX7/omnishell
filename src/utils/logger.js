// GLib is imported directly rather than through `gi/ext.js`: the latter
// pulls in the shell-only libraries, and this file is also used by the
// preferences process, which is a plain GTK application.
import GLib from "gi://GLib";

/**
 * Whether the extension writes its debug output.
 *
 * Writing to the journal is a synchronous operation, and the shell does it
 * on the main thread — every message costs a write that the compositor
 * waits for. The extension logs on window creation, on every layout
 * change and on every monitor change, which is enough to keep a disk busy
 * and a laptop's battery drained for no benefit, because nobody reads
 * the output unless they are debugging the extension.
 *
 * The output is therefore off unless it is asked for. To turn it on, start
 * the shell with the variable set:
 *
 *     OMNISHELL_DEBUG=1 gnome-shell --replace
 *
 * or, on a session started by a display manager, add it to the
 * environment before logging in.
 */
function _debugEnabled() {
  try {
    const value = GLib.getenv("OMNISHELL_DEBUG");
    return value !== null && value !== "" && value !== "0" && value !== "false";
  } catch {
    return false;
  }
}

let _enabled = null;

/**
 * Whether debug output is on. Read once and remembered, so that the
 * check costs nothing per message.
 */
function debugEnabled() {
  if (_enabled === null) _enabled = _debugEnabled();
  return _enabled;
}

const logger = (prefix) => (...content) => {
  if (!debugEnabled()) return;
  console.log("[omnishell]", `[${prefix}]`, ...content);
};
export {
  logger
};
