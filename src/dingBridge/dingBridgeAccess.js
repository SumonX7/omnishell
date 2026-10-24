/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * Accessor for the shared DingBridge instance.
 *
 * The bridge used to be published as `global.__omnishell_ding_bridge`, a
 * plain string property. Every extension in the session can read and write
 * such a property, which means a third-party extension could replace the
 * bridge and thereby control how the tiling manager reacts to desktop
 * launches.
 *
 * The bridge is now published under a Symbol key, which cannot be guessed
 * from outside and does not show up when `global` is enumerated. This module
 * is the single place that knows the symbol, and it is imported by both the
 * producer and the consumer.
 */

/** Symbol under which the active DingBridge is published on `global`. */
const DING_BRIDGE_SYMBOL = Symbol.for("omnishell-ding-bridge");

/**
 * Returns the active DingBridge, or null when the desktop icon engine is not
 * running.
 */
function getDingBridge() {
  try {
    return global[DING_BRIDGE_SYMBOL] ?? null;
  } catch {
    return null;
  }
}

/**
 * Publishes the bridge. Called by the DingBridge constructor.
 */
function setDingBridge(bridge) {
  try {
    global[DING_BRIDGE_SYMBOL] = bridge;
  } catch {
  }
}

/**
 * Removes the published bridge. Called when the extension is disabled.
 */
function clearDingBridge(bridge) {
  try {
    if (bridge && global[DING_BRIDGE_SYMBOL] !== bridge) return;
    global[DING_BRIDGE_SYMBOL] = null;
    delete global[DING_BRIDGE_SYMBOL];
  } catch {
  }
}

export {
  DING_BRIDGE_SYMBOL,
  getDingBridge,
  setDingBridge,
  clearDingBridge
};
