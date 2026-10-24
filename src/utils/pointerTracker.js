/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * Unified pointer-position tracker that works on both X11 and Wayland.
 *
 * `global.get_pointer()` is an X11-only API. On Wayland it does not report a
 * live position, so the tiling code that used it either saw stale
 * coordinates or none at all — which is why dragging a window between two
 * tiles felt unresponsive: the code could not tell which tile the pointer was
 * over.
 *
 * The tracker below keeps a position from two sources:
 *
 *  1. The stage's "motion"/"touch-event"/"captured-event" signals, which are
 *     delivered on Wayland, and
 *  2. `global.get_pointer()`, which is still the most accurate source on X11
 *     and is used to seed the very first position.
 *
 * The last known position is retained, so callers always get a usable
 * coordinate even when no event has arrived yet.
 */

const POINTER_UNSET = -1;

class PointerTracker {
  static _instance = null;

  _x = POINTER_UNSET;
  _y = POINTER_UNSET;
  _modifiers = 0;
  _signals = null;
  _hooked = false;

  static get() {
    if (!PointerTracker._instance) {
      PointerTracker._instance = new PointerTracker();
    }
    return PointerTracker._instance;
  }

  /**
   * Starts listening for pointer motion on the stage. Safe to call more than
   * once; only the first call installs the handlers.
   */
  enable() {
    if (this._hooked) return;
    this._hooked = true;

    // Seed from the X11 path when it is available.
    this._pollNative();

    try {
      const stage = global.stage;
      if (!stage) return;
      if (!this._signals) {
        this._signals = new SignalHandling();
      }

      this._signals.connect(stage, "motion-event", (_source, event) => {
        this._updateFromEvent(event);
      });
      this._signals.connect(stage, "touch-event", (_source, event) => {
        this._updateFromEvent(event);
      });
      this._signals.connect(stage, "captured-event", (_source, event) => {
        this._updateFromEvent(event);
      });
    } catch {
      // No stage (e.g. during shutdown) — nothing to track.
    }
  }

  disable() {
    if (this._signals) {
      this._signals.disconnect();
      this._signals = null;
    }
    this._hooked = false;
  }

  _updateFromEvent(event) {
    try {
      const [x, y] = event.get_coords();
      if (typeof x === "number" && typeof y === "number") {
        this._x = x;
        this._y = y;
      }
      const state = event.get_state?.();
      if (typeof state === "number") {
        this._modifiers = state;
      }
    } catch {
    }
  }

  /**
   * Reads the native pointer position. On X11 this is authoritative; on
   * Wayland the values are unreliable, so they are only used when no event
   * has been received yet.
   */
  _pollNative() {
    try {
      if (typeof global.get_pointer !== "function") return;
      const [x, y, modifiers] = global.get_pointer();
      if (typeof x === "number" && typeof y === "number") {
        if (this._x === POINTER_UNSET || this._isWayland() === false) {
          this._x = x;
          this._y = y;
        }
      }
      if (typeof modifiers === "number") {
        this._modifiers = modifiers;
      }
    } catch {
    }
  }

  _isWayland() {
    try {
      return global.get_current_time === void 0
        ? false
        : typeof Meta !== "undefined" && typeof Meta.Backend !== "undefined"
          ? !!Meta.Backend.is_wayland?.()
          : false;
    } catch {
      return false;
    }
  }

  /**
   * Returns the current pointer position as `[x, y, modifiers]`.
   *
   * The position is guaranteed to be a number: if nothing has been observed
   * yet the native pointer is polled, and failing that the origin is used.
   */
  getPointer() {
    if (this._x === POINTER_UNSET || this._y === POINTER_UNSET) {
      this._pollNative();
    }
    if (this._x === POINTER_UNSET || this._y === POINTER_UNSET) {
      return [0, 0, this._modifiers];
    }
    return [this._x, this._y, this._modifiers];
  }

  /**
   * Returns the current modifier mask (the third element of
   * `global.get_pointer()`), refreshed from the native call when possible.
   */
  getModifiers() {
    try {
      if (typeof global.get_pointer === "function") {
        const modifiers = global.get_pointer()[2];
        if (typeof modifiers === "number") this._modifiers = modifiers;
      }
    } catch {
    }
    return this._modifiers;
  }

  reset() {
    this._x = POINTER_UNSET;
    this._y = POINTER_UNSET;
  }
}

import SignalHandling from "./signalHandling.js";

export {
  PointerTracker
};
