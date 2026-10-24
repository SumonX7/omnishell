/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * Signal bookkeeping helper.
 *
 * The original implementation stored connections in a plain object keyed by
 * the *signal name*:
 *
 *   this._signalsIds[key] = { id: signalId, obj };
 *
 * That is broken in two ways:
 *
 *  1. Two connections to the same signal name on different objects overwrite
 *     each other, so the first handler is leaked — it stays connected for the
 *     lifetime of the object and keeps firing.
 *
 *  2. `disconnect(obj)` searched for the *first* key whose object matched and
 *     disconnected only that one, leaving every other handler for the same
 *     object connected.
 *
 * The tiling code hits both: `_onWindowGrabBegin` connects "touch-event" and
 * "captured-event" on `global.stage` and "position-changed" on the window,
 * and `_onWindowGrabEnd` disconnects the window. Because the stage handlers
 * were keyed by name, every drag added another "touch-event" handler, so the
 * pointer position was tracked several times over and the drag behaved
 * inconsistently — the direct cause of the "tiling is not smooth" symptom.
 *
 * Connections are therefore stored in a list, and `disconnect(obj)` removes
 * *every* connection belonging to that object.
 */
class SignalHandling {
  _connections;

  constructor() {
    this._connections = [];
  }

  /**
   * Connects `fun` to the `key` signal of `obj` and remembers the connection.
   * Returns the signal handler id, as `GObject.connect` does.
   */
  connect(obj, key, fun) {
    const signalId = obj.connect(key, fun);
    this._connections.push({ id: signalId, obj, key });
    return signalId;
  }

  /**
   * Disconnects every remembered connection belonging to `obj`.
   *
   * With no argument, every remembered connection is disconnected.
   *
   * Returns true when at least one connection was removed.
   */
  disconnect(obj) {
    if (!obj) {
      const hadConnections = this._connections.length > 0;
      for (const connection of this._connections) {
        try {
          connection.obj.disconnect(connection.id);
        } catch {
        }
      }
      this._connections = [];
      return hadConnections;
    }

    const remaining = [];
    let disconnectedAny = false;
    for (const connection of this._connections) {
      if (connection.obj === obj) {
        disconnectedAny = true;
        try {
          connection.obj.disconnect(connection.id);
        } catch {
        }
      } else {
        remaining.push(connection);
      }
    }
    this._connections = remaining;
    return disconnectedAny;
  }
}

export {
  SignalHandling as default
};
