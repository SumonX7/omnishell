/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * TilingDragCoordinator: the one owner of global drag input.
 *
 * Every monitor used to install its own "grab-op-begin"/"grab-op-end"
 * handlers, start its own 15 ms timer and add its own stage pointer handlers.
 * On a two-monitor setup every pointer event was therefore processed twice,
 * and every monitor's timer woke up for the whole drag even though only one
 * of them could contain the pointer.
 *
 * This coordinator connects the global signals once. It still notifies every
 * manager at the start and the end of a drag, because static tiling relies on
 * the destination manager being able to show its preview and assign a tile
 * when a window is dropped on another monitor. Only the manager under the
 * pointer receives the per-tick work, however, and there is exactly one timer
 * and one stage pointer path for the entire extension.
 */
import { Clutter, GLib } from "../../gi/ext.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Settings from "../../settings/settings.js";
import SignalHandling from "../../utils/signalHandling.js";
import { isDesktopWindow } from "../../utils/desktopFilter.js";
import { isMovingGrabOp } from "../../utils/grabOp.js";
import { PointerTracker } from "../../utils/pointerTracker.js";
import { isWindowAlive } from "../../utils/ui.js";
import TouchPointer from "./touchPointer.js";
import { logger } from "../../utils/logger.js";

const debug = logger("TilingDrag");

class TilingDragCoordinator {
  _getManagers;
  _signals = new SignalHandling();
  _stageSignals = new SignalHandling();
  _windowSignals = new SignalHandling();
  _dragWindow = null;
  _grabOp = 0;
  _timerId = null;
  _activeManager = null;
  _enabled = false;

  constructor(getManagers) {
    this._getManagers = getManagers;
  }

  enable() {
    if (this._enabled) return;
    this._enabled = true;

    // One tracker for the whole extension. The managers no longer call
    // enable() themselves.
    PointerTracker.get().enable();

    this._signals.connect(
      global.display,
      "grab-op-begin",
      (_display, window, grabOp) => this._onGrabBegin(window, grabOp)
    );
    this._signals.connect(
      global.display,
      "grab-op-end",
      (_display, window) => this._onGrabEnd(window)
    );
  }

  destroy() {
    if (!this._enabled) return;
    this._enabled = false;
    this._endDrag();
    this._signals.disconnect();
    PointerTracker.get().disable();
  }

  /**
   * Ends the current drag without tearing the coordinator down. Called when
   * the manager list is about to be replaced (monitor hotplug, fractional
   * scaling change), so no manager is dropped while still owning drag state.
   */
  abort() {
    this._endDrag();
  }

  _onGrabBegin(window, grabOp) {
    if (!isMovingGrabOp(grabOp)) return;
    if (isDesktopWindow(window)) return;
    if (!isWindowAlive(window)) return;
    if (this._dragWindow) this._endDrag();

    this._dragWindow = window;
    this._grabOp = grabOp;
    this._forgetActiveManager();
    PointerTracker.get().acquire();

    for (const manager of this._getManagers()) {
      try {
        manager._onWindowGrabBegin(window);
      } catch (e) {
        debug(`drag begin failed on monitor ${manager?._monitor?.index}: ${e.message}`);
      }
    }

    this._installStageHandlers();
    this._installWindowHandlers(window);
    this._timerId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      15,
      () => {
        if (!this._dragWindow) {
          this._timerId = null;
          return GLib.SOURCE_REMOVE;
        }
        this._tick();
        return GLib.SOURCE_CONTINUE;
      }
    );
    this._tick();
  }

  _onGrabEnd(window) {
    if (!this._dragWindow || window !== this._dragWindow) return;
    this._endDrag();
  }

  _tick() {
    const window = this._dragWindow;
    if (!window) return;
    if (!isWindowAlive(window)) {
      this._endDrag();
      return;
    }

    const pointer = this._readPointer(window);
    if (!pointer) return;
    const manager = this._managerAt(pointer);
    if (manager !== this._activeManager) {
      this._activeManager?._cancelWindowDragPreview?.();
      this._activeManager = manager;
    }
    if (!manager) return;
    if (!manager._isGrabbingWindow) return;

    try {
      manager._onMovingWindow(window, this._grabOp, pointer);
    } catch (e) {
      // A broken drag must not leave the other monitors stuck behind a
      // permanently running timer.
      debug(`drag tick failed on monitor ${manager._monitor?.index}: ${e.message}`);
    }
  }

  _endDrag() {
    const window = this._dragWindow;
    if (!window) return;
    PointerTracker.get().release();

    // Read the pointer before the drag state is cleared: the drop preview
    // must be resolved against the monitor the user released over, not the
    // pointer position a moment later.
    const pointer = isWindowAlive(window) ? this._readPointer(window) : null;
    this._dragWindow = null;
    this._grabOp = 0;
    this._stopTimer();
    this._stageSignals.disconnect();
    this._windowSignals.disconnect();
    this._activeManager = null;

    if (window) {
      for (const manager of this._getManagers()) {
        try {
          manager._onWindowGrabEnd(window, pointer);
        } catch (e) {
          debug(`drag end failed on monitor ${manager?._monitor?.index}: ${e.message}`);
        }
      }
    }
    TouchPointer.get().reset();
  }

  _stopTimer() {
    if (this._timerId === null) return;
    GLib.Source.remove(this._timerId);
    this._timerId = null;
  }

  _installStageHandlers() {
    this._stageSignals.disconnect();
    try {
      this._stageSignals.connect(global.stage, "touch-event", (_source, event) => {
        const [x, y] = event.get_coords();
        TouchPointer.get().onTouchEvent(x, y);
      });
      this._stageSignals.connect(global.stage, "captured-event", (_source, event) => {
        const device = event.get_source_device();
        if (!device) return;
        const deviceType = device.get_device_type();
        if (deviceType !== Clutter.InputDeviceType.TABLET_DEVICE &&
            deviceType !== Clutter.InputDeviceType.PEN_DEVICE)
          return;
        if (event.type() !== Clutter.EventType.MOTION) return;
        const [x, y] = event.get_coords();
        TouchPointer.get().onTouchEvent(x, y);
        const seat = Clutter.get_default_backend().get_default_seat();
        seat.warp_pointer(x, y);
      });
    } catch {
      // No stage (for example during shutdown). The timer will still end the
      // drag cleanly through the grab-op-end signal.
    }
  }

  _installWindowHandlers(window) {
    this._windowSignals.disconnect();
    if (!Settings.ENABLE_BLUR_SNAP_ASSISTANT && !Settings.ENABLE_BLUR_SELECTED_TILEPREVIEW)
      return;
    this._windowSignals.connect(window, "position-changed", () => {
      this._activeManager?._repaintDragEffects?.();
    });
  }

  _readPointer(window) {
    try {
      if (TouchPointer.get().isTouchDeviceActive())
        return TouchPointer.get().get_pointer(window);
      return PointerTracker.get().getPointer();
    } catch {
      return null;
    }
  }

  _managerAt(pointer) {
    if (!pointer) return null;
    const [x, y] = pointer;
    const managers = this._getManagers();
    const monitors = Main.layoutManager.monitors;
    for (let index = 0; index < monitors.length; index++) {
      const monitor = monitors[index];
      if (x < monitor.x || x >= monitor.x + monitor.width) continue;
      if (y < monitor.y || y >= monitor.y + monitor.height) continue;
      const manager = managers[monitor.index ?? index];
      if (manager) return manager;
    }
    return null;
  }

  _forgetActiveManager() {
    this._activeManager?._cancelWindowDragPreview?.();
    this._activeManager = null;
  }
}

export {
  TilingDragCoordinator
};
