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

import { Meta, Clutter } from "../gi/ext.js";
import SignalHandling from "./signalHandling.js";

const POINTER_UNSET = -1;

// Event types worth tracking — everything else (keyboard, button, scroll)
// is noise for a *pointer* tracker and can be skipped cheaply.
const POINTER_EVENT_TYPES = new Set([
  Clutter.EventType.MOTION,
  Clutter.EventType.TOUCH_UPDATE,
  Clutter.EventType.TOUCH_BEGIN,
  Clutter.EventType.TOUCH_END,
]);

class PointerTracker {
  static _instance = null;

  _x = POINTER_UNSET;
  _y = POINTER_UNSET;
  _modifiers = 0;
  _signals = null;
  _hooked = false;
  _wayland = null;
  // Reference count: how many callers need stage signals right now.
  // Signals are connected on the first acquire and disconnected when
  // the last holder releases, so normal typing / clicking does not run
  // through the handler at all.
  _refCount = 0;

  static get() {
    if (!PointerTracker._instance) {
      PointerTracker._instance = new PointerTracker();
    }
    return PointerTracker._instance;
  }

  /**
   * Marks the tracker as enabled. The stage signals are not connected
   * immediately — call `acquire()` when pointer events are actually needed
   * (e.g. a drag starts) and `release()` when they are not. This avoids
   * running a handler on every stage event while idle, saving CPU and
   * battery.
   *
   * For callers that do not use acquire/release, `enable()` seeds the
   * initial position from the native pointer and sets `_hooked` so that
   * `getPointer()` works.
   */
  enable() {
    if (this._hooked) return;
    this._hooked = true;

    // Seed from the X11 path when it is available.
    this._pollNative();
  }

  disable() {
    this._disconnectStage();
    this._refCount = 0;
    this._hooked = false;
  }

  /**
   * Acquires a reference to the stage signals. The first acquire connects
   * them; subsequent acquires are just reference-counted.
   */
  acquire() {
    this._refCount++;
    if (this._refCount === 1) {
      this._pollNative();
      this._connectStage();
    }
  }

  /**
   * Releases a reference. When the count reaches zero the stage signals
   * are disconnected, so no handler runs while the desktop is idle.
   */
  release() {
    if (this._refCount <= 0) return;
    this._refCount--;
    if (this._refCount === 0) this._disconnectStage();
  }

  _connectStage() {
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
        const eventType = event.type();
        if (!POINTER_EVENT_TYPES.has(eventType)) return;
        this._updateFromEvent(event);
      });
    } catch {
      // No stage (e.g. during shutdown) — nothing to track.
    }
  }

  _disconnectStage() {
    if (this._signals) {
      this._signals.disconnect();
      this._signals = null;
    }
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
      // On Wayland the third value is not a live modifier mask. Modifiers
      // are taken from the stage events instead, so a native read must not
      // overwrite them with a stale value.
      if (typeof modifiers === "number" && !this._isWayland()) {
        this._modifiers = modifiers;
      }
    } catch {
    }
  }

  _isWayland() {
    if (this._wayland !== null) return this._wayland;
    try {
      this._wayland = Boolean(Meta.is_wayland_compositor?.());
    } catch {
      this._wayland = false;
    }
    return this._wayland;
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
    if (!this._isWayland()) {
      try {
        if (typeof global.get_pointer === "function") {
          const modifiers = global.get_pointer()[2];
          if (typeof modifiers === "number") this._modifiers = modifiers;
        }
      } catch {
      }
    }
    return this._modifiers;
  }

  reset() {
    this._x = POINTER_UNSET;
    this._y = POINTER_UNSET;
  }
}

export {
  PointerTracker
};
