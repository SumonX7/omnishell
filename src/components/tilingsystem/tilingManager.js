import { Clutter, Meta, GLib } from "../../gi/ext.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { logger } from "../../utils/logger.js";
import {
  buildMargin,
  buildRectangle,
  buildTileGaps,
  getMonitorScalingFactor,
  getScalingFactorOf,
  getWindows,
  isPointInsideRect,
  isTileOnContainerBorder,
  isWindowAlive,
  squaredEuclideanDistance
} from "../../utils/ui.js";
import TilingLayout from "../../components/tilingsystem/tilingLayout.js";
import SnapAssist from "../snapassist/snapAssist.js";
import SelectionTilePreview from "../tilepreview/selectionTilePreview.js";
import { ActivationKey, EdgeTilingMode } from "../../settings/settings.js";
import Settings from "../../settings/settings.js";
import SignalHandling from "../../utils/signalHandling.js";
import { isDesktopWindow } from "../../utils/desktopFilter.js";
import { isMovingGrabOp } from "../../utils/grabOp.js";
import { PointerTracker } from "../../utils/pointerTracker.js";
import { getDingBridge } from "../../dingBridge/dingBridgeAccess.js";
import Layout from "../layout/Layout.js";
import Tile from "../layout/Tile.js";
import TileUtils from "../layout/TileUtils.js";
import {
  buildLayoutTree,
  leafCount
} from "../layout/dynamic/layoutTree.js";
import { assign, neighbourIndex, slotUnderPoint } from "../layout/dynamic/reflow.js";
import {
  arrangementKeys,
  arrangementRectOf,
  buildArrangement,
  insertIntoArrangement,
  swapInArrangement
} from "../layout/dynamic/arrangement.js";
import { applyPins } from "../layout/dynamic/pins.js";
import { pickLayoutIndex, pickLayoutIndexAt } from "../layout/dynamic/pickLayout.js";
import GlobalState from "../../utils/globalState.js";
import EdgeTilingManager from "./edgeTilingManager.js";
import TouchPointer from "./touchPointer.js";
import { KeyBindingsDirection } from "../../keybindings.js";
import TilingShellWindowManager from "../../components/windowManager/tilingShellWindowManager.js";
import TilingLayoutWithSuggestions from "../windowsSuggestions/tilingLayoutWithSuggestions.js";
import { maximizeWindow, unmaximizeWindow, skipNextEffect } from "../../utils/gnomesupport.js";
import { WindowPlacer } from "./windowPlacer.js";
import { ReflowScheduler } from "./reflowScheduler.js";
import {
  gjsPlacerClock,
  placementTargetFor,
  toRect
} from "./metaPlacementTarget.js";
const MINIMUM_DISTANCE_TO_RESTORE_ORIGINAL_SIZE = 90;
const DYNAMIC_DIRECTION = {
  [KeyBindingsDirection.LEFT]: "left",
  [KeyBindingsDirection.RIGHT]: "right",
  [KeyBindingsDirection.UP]: "up",
  [KeyBindingsDirection.DOWN]: "down"
};

class SnapAssistingInfo {
  _snapAssistantLayoutId;
  constructor() {
    this._snapAssistantLayoutId = void 0;
  }

  get layoutId() {
    return this._snapAssistantLayoutId ?? "";
  }

  get isSnapAssisting() {
    return this._snapAssistantLayoutId !== void 0;
  }

  update(layoutId) {
    this._snapAssistantLayoutId = !layoutId || layoutId.length === 0 ? void 0 : layoutId;
  }
}

class TilingManager {
  _monitor;
  _selectedTilesPreview;
  _snapAssist;
  _workspaceTilingLayout;
  _edgeTilingManager;
  _tilingSuggestionsLayout;
  _workArea;
  _enableScaling;
  _isGrabbingWindow;
  _movingWindowTimerDuration = 15;
  _lastCursorPos = null;
  _grabStartPosition = null;
  _wasSpanMultipleTilesActivated;
  _wasTilingSystemActivated;
  _snapAssistingInfo;
  _movingWindowTimerId = null;
  // Windows placed by dynamic tiling, in the order they claim slots.
  _dynamicWindows = [];
  // Per-window handlers, kept here because SignalHandling is keyed by signal
  // name and so cannot hold one entry per window.
  _dynamicWindowSignals = /* @__PURE__ */ new Map();
  // The window whose region overflow should halve, on the workspace it is
  // actually on. Held as a window rather than a slot index so it survives
  // windows ahead of it closing, and resolved to an index per workspace at
  // reflow time so it cannot be misapplied to an unrelated workspace.
  _splitTarget = null;
  // Once there are more windows than the template layout has tiles, the
  // arrangement is kept per workspace and only evolved on a fresh open
  // (the focused window's leaf is halved); anything else rebuilds it.
  _dynamicArrangements = /* @__PURE__ */ new Map();
  // Windows _dynamicAdd tracked that no reflow has placed yet: the only
  // ones an existing arrangement grows by a cut instead of a rebuild.
  _dynamicNewcomers = /* @__PURE__ */ new Set();
  _dynamicReflowSourceId = null;
  // Cache of _dynamicLayoutCandidates(), rebuilt only when the saved
  // layouts change rather than on every reflow.
  _dynamicLayoutCandidatesCache = null;
  // How many layouts to step past the default pick, per workspace and per
  // tile-count group (outer key: workspace, inner key: the tile count of
  // the group's default pick), so an offset set while N windows are open
  // cannot leak into the group that applies once the window count changes.
  // Set by cycleDynamicLayout.
  _dynamicLayoutOffset = /* @__PURE__ */ new Map();
  // Memoised result of `_dynamicSlots()`, per workspace.
  //
  // `_dynamicSlots()` is called from the drag tick, which runs every
  // 15 ms, and it rebuilt the whole arrangement from scratch every
  // time: the layout tree, the arrangement, the arrangement keys, and
  // then a second layout tree inside `applyPins()`. During a drag
  // neither the window set nor the tree changes -- only the pointer
  // moves -- so the result is cached and reused until something that
  // actually affects it changes.
  //
  // The key covers everything the result depends on: the ordered list
  // of managed windows, the tree, the split target, the current layout
  // id and the pinned sizes. A change to any of them produces a
  // different key and therefore a cache miss.
  _dynamicSlotsCache = /* @__PURE__ */ new Map();
  // Stable per-window integers, used to build the cache key above.
  _windowIds = /* @__PURE__ */ new WeakMap();
  // Per-workspace counter that is bumped whenever the layout tree for
  // that workspace could have changed.
  _dynamicTreeRevisions = /* @__PURE__ */ new Map();
  // Memoised `_dynamicTree()` result, per workspace.
  _dynamicTreeCache = /* @__PURE__ */ new Map();
  // Counter that is bumped whenever a pin is added, removed or resized.
  _pinRevisionCounter = 0;
  // Places windows without freezing their actors, and remembers what each
  // client answered so a refused rect is not asked for again.
  _placer;
  // Defers a reflow requested from inside a running reflow.
  _reflow;
  // While a dynamically managed window is dragged: the slot whose preview
  // is on screen (null when none), so the preview is only redrawn when the
  // pointer crosses into another slot.
  _dynamicPreviewSlot = null;
  // Frame sizes (px) below which a window's client has refused to go, as
  // learnt from its final answers to placements. A pinned window's slot is
  // grown to fit and its neighbours shrink, so the gaps stay intact.
  _pinnedWindows = /* @__PURE__ */ new Map();
  _signals;
  _debug;
  /**
   * Constructs a new TilingManager instance.
   * @param monitor The monitor to manage tiling for.
   */
  constructor(monitor, enableScaling) {
    this._isGrabbingWindow = false;
    this._wasSpanMultipleTilesActivated = false;
    this._wasTilingSystemActivated = false;
    this._snapAssistingInfo = new SnapAssistingInfo();
    this._enableScaling = enableScaling;
    this._monitor = monitor;
    this._signals = new SignalHandling();
    // Drag-scoped stage handlers. Kept apart from `_signals` so that ending a
    // drag can remove exactly the pointer trackers it added.
    this._dragStageSignals = new SignalHandling();
    this._placer = new WindowPlacer(gjsPlacerClock, {
      monitorIndex: monitor.index
    });
    this._reflow = new ReflowScheduler(() => this._queueDynamicReflow());
    this._debug = logger(`TilingManager ${monitor.index}`);
    this._workArea = Main.layoutManager.getWorkAreaForMonitor(
      this._monitor.index
    );
    this._debug(
      `Work area for monitor ${this._monitor.index}: ${this._workArea.x} ${this._workArea.y} ${this._workArea.width}x${this._workArea.height}`
    );
    this._edgeTilingManager = new EdgeTilingManager(this._workArea);
    this._edgeTilingManager.monitorIndex = this._monitor.index;
    const monitorScalingFactor = this._enableScaling ? getMonitorScalingFactor(monitor.index) : void 0;
    this._workspaceTilingLayout = /* @__PURE__ */ new Map();
    for (let i = 0; i < global.workspaceManager.get_n_workspaces(); i++) {
      const ws = global.workspaceManager.get_workspace_by_index(i);
      if (!ws) continue;
      const innerGaps = buildMargin(Settings.get_inner_gaps());
      const outerGaps = buildMargin(Settings.get_outer_gaps());
      const layout = GlobalState.get().getSelectedLayoutOfMonitor(
        monitor.index,
        ws.index()
      );
      this._workspaceTilingLayout.set(
        ws,
        new TilingLayout(
          layout,
          innerGaps,
          outerGaps,
          this._workArea,
          monitorScalingFactor
        )
      );
    }
    this._tilingSuggestionsLayout = new TilingLayoutWithSuggestions(
      buildMargin(Settings.get_inner_gaps()),
      buildMargin(Settings.get_outer_gaps()),
      this._workArea,
      monitorScalingFactor
    );
    this._selectedTilesPreview = new SelectionTilePreview({
      parent: global.windowGroup
    });
    this._snapAssist = new SnapAssist(
      Main.uiGroup,
      this._workArea,
      this._monitor.index,
      monitorScalingFactor
    );
  }

  /**
   * Enables tiling manager by setting up event listeners:
   *  - handle any window's grab begin.
   *  - handle any window's grab end.
   *  - handle grabbed window's movement.
   */
  enable() {
    // Keep track of the pointer position so that the tiling code works on
    // Wayland, where `global.get_pointer()` does not report a live position.
    PointerTracker.get().enable();
    this._signals.connect(
      Settings,
      Settings.KEY_SETTING_SELECTED_LAYOUTS,
      () => {
        const ws = global.workspaceManager.get_active_workspace();
        if (!ws) return;
        const layout = GlobalState.get().getSelectedLayoutOfMonitor(
          this._monitor.index,
          ws.index()
        );
        this._workspaceTilingLayout.get(ws)?.relayout({ layout });
      }
    );
    this._signals.connect(
      GlobalState.get(),
      GlobalState.SIGNAL_LAYOUTS_CHANGED,
      () => {
        this._dynamicLayoutCandidatesCache = null;
        this._dynamicArrangements.clear();
        this._invalidateDynamicSlots();
        const ws = global.workspaceManager.get_active_workspace();
        if (!ws) return;
        const layout = GlobalState.get().getSelectedLayoutOfMonitor(
          this._monitor.index,
          ws.index()
        );
        this._workspaceTilingLayout.get(ws)?.relayout({ layout });
        this._queueDynamicReflow();
      }
    );
    this._signals.connect(Settings, Settings.KEY_INNER_GAPS, () => {
      const innerGaps = buildMargin(Settings.get_inner_gaps());
      this._workspaceTilingLayout.forEach(
        (tilingLayout) => tilingLayout.relayout({ innerGaps })
      );
      this._invalidateDynamicSlots();
      this._queueDynamicReflow();
    });
    this._signals.connect(Settings, Settings.KEY_OUTER_GAPS, () => {
      const outerGaps = buildMargin(Settings.get_outer_gaps());
      this._workspaceTilingLayout.forEach(
        (tilingLayout) => tilingLayout.relayout({ outerGaps })
      );
      this._invalidateDynamicSlots();
      this._queueDynamicReflow();
    });
    this._signals.connect(
      global.display,
      "grab-op-begin",
      (_display, window, grabOp) => {
        // Meta.GrabOp is a bit field on mutter 18:
        //   WINDOW_BASE          = 1
        //   KEYBOARD_MOVING      = 257   (1 | 256)
        //   MOVING_UNCONSTRAINED = 1025  (1 | 1024)
        //   RESIZING_*           = 4097, 8193, ... (1 | 8192 | edge)
        // The old test `(grabOp & ~1024) === 1` matched WINDOW_BASE and
        // MOVING_UNCONSTRAINED but *missed* KEYBOARD_MOVING (257 & ~1024 is
        // still 257), so a window moved with the keyboard never entered the
        // tiling drag machinery and never snapped into a tile.
        if (!isMovingGrabOp(grabOp) || isDesktopWindow(window)) return;
        this._onWindowGrabBegin(window, grabOp);
      }
    );
    this._signals.connect(
      global.display,
      "grab-op-end",
      (_display, window) => {
        if (!this._isGrabbingWindow) return;
        this._onWindowGrabEnd(window);
      }
    );
    this._signals.connect(
      this._snapAssist,
      "snap-assist",
      this._onSnapAssist.bind(this)
    );
    this._signals.connect(
      global.windowManager,
      "minimize",
      () => this._queueDynamicReflow()
    );
    this._signals.connect(
      global.windowManager,
      "unminimize",
      () => this._queueDynamicReflow()
    );
    this._signals.connect(
      Settings,
      Settings.KEY_ENABLE_DYNAMIC_TILING,
      () => this._adoptOpenWindows()
    );
    this._adoptOpenWindows();
    this._signals.connect(
      global.workspaceManager,
      "active-workspace-changed",
      () => {
        const ws = global.workspaceManager.get_active_workspace();
        if (this._workspaceTilingLayout.has(ws)) return;
        const monitorScalingFactor = this._enableScaling ? getMonitorScalingFactor(this._monitor.index) : void 0;
        const layout = GlobalState.get().getSelectedLayoutOfMonitor(
          this._monitor.index,
          ws.index()
        );
        const innerGaps = buildMargin(Settings.get_inner_gaps());
        const outerGaps = buildMargin(Settings.get_outer_gaps());
        this._debug("created new tiling layout for active workspace");
        this._workspaceTilingLayout.set(
          ws,
          new TilingLayout(
            layout,
            innerGaps,
            outerGaps,
            this._workArea,
            monitorScalingFactor
          )
        );
      }
    );
    this._signals.connect(
      global.workspaceManager,
      "workspace-removed",
      (_) => {
        const newMap = /* @__PURE__ */ new Map();
        const n_workspaces = global.workspaceManager.get_n_workspaces();
        for (let i = 0; i < n_workspaces; i++) {
          const ws = global.workspaceManager.get_workspace_by_index(i);
          if (!ws) continue;
          const tl = this._workspaceTilingLayout.get(ws);
          if (!tl) continue;
          this._workspaceTilingLayout.delete(ws);
          newMap.set(ws, tl);
        }
        [...this._workspaceTilingLayout.values()].forEach(
          (tl) => tl.destroy()
        );
        this._workspaceTilingLayout.clear();
        this._workspaceTilingLayout = newMap;
        const liveWorkspaces = new Set(newMap.keys());
        [...this._dynamicLayoutOffset.keys()].filter((ws) => !liveWorkspaces.has(ws)).forEach((ws) => this._dynamicLayoutOffset.delete(ws));
        [...this._dynamicArrangements.keys()].filter((ws) => !liveWorkspaces.has(ws)).forEach((ws) => this._dynamicArrangements.delete(ws));
        this._debug("deleted workspace");
      }
    );
    this._signals.connect(
      global.display,
      "window-created",
      (_display, window) => {
        if (isDesktopWindow(window)) return;
        if (this._isExcludedFromTiling(window)) return;
        const isFileManager = window.get_wm_class() === "org.gnome.Nautilus" || window.get_gtk_application_id() === "org.gnome.Nautilus";
        const dingBridge = getDingBridge();
        const wasDesktopLaunch = dingBridge?.wasFolderOpenedRecently?.();
        if (Settings.MAXIMIZE_DESKTOP_OPEN && (wasDesktopLaunch || isFileManager)) {
          if (wasDesktopLaunch && dingBridge?.consumeFolderOpened) {
            dingBridge.consumeFolderOpened();
          }
          window.assignedTile = void 0;
          if (Settings.ENABLE_DYNAMIC_TILING) {
            // Dynamic tiling manages the window geometry so it tiles side-by-side
            // with other open apps according to dynamic layout without overlapping.
            this._dynamicAdd(window);
            return;
          }
          const doMaximize = () => {
            try {
              if (window.can_maximize()) {
                maximizeWindow(window);
              }
            } catch {
            }
          };
          const windowActor = window.get_compositor_private();
          if (windowActor) {
            const id = windowActor.connect("first-frame", () => {
              doMaximize();
              windowActor.disconnect(id);
            });
          }
          doMaximize();
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            doMaximize();
            return GLib.SOURCE_REMOVE;
          });
          window.assignedTile = void 0;
          window.omnishellIntentionalMaximize = true;
          return;
        }
        if (Settings.ENABLE_DYNAMIC_TILING) this._dynamicAdd(window);
        else if (Settings.ENABLE_AUTO_TILING)
          this._autoTile(window, true);
      }
    );
    this._signals.connect(
      TilingShellWindowManager.get(),
      "unmaximized",
      (_, window) => {
        if (isDesktopWindow(window)) return;
        // The window is no longer deliberately maximized, so it may be tiled
        // again. The flag is cleared here rather than in the window's own
        // "unmaximized" handler, because that handler may run *after* this
        // one and would then still block the tiling.
        window.omnishellIntentionalMaximize = false;
        if (Settings.ENABLE_DYNAMIC_TILING) {
          this._queueDynamicReflow();
          return;
        }
        if (Settings.ENABLE_AUTO_TILING) this._autoTile(window, false);
      }
    );
    this._signals.connect(
      TilingShellWindowManager.get(),
      "maximized",
      (_, window) => {
        delete window.assignedTile;
        this._placer.forget(placementTargetFor(window));
      }
    );
  }

  onUntileWindow(window, force) {
    const destination = window.originalSize;
    if (!destination) return;
    this._easeWindowRect(window, destination, false, force);
    window.assignedTile = void 0;
  }

  onKeyboardMoveWindow(window, direction, force, spanFlag, clamp) {
    if (Settings.ENABLE_DYNAMIC_TILING && !spanFlag) {
      if (this._dynamicMoveByKeyboard(window, direction)) return true;
    }
    let destination;
    const isMaximized = window.maximizedHorizontally || window.maximizedVertically;
    if (spanFlag && isMaximized) return false;
    const currentWs = window.get_workspace();
    const tilingLayout = this._workspaceTilingLayout.get(currentWs);
    if (!tilingLayout) return false;
    const windowRectCopy = window.get_frame_rect().copy();
    const extWin = window;
    if (isMaximized) {
      switch (direction) {
        case KeyBindingsDirection.NODIRECTION:
        case KeyBindingsDirection.LEFT:
        case KeyBindingsDirection.RIGHT:
          break;
        case KeyBindingsDirection.DOWN:
          unmaximizeWindow(window);
          return true;
        case KeyBindingsDirection.UP:
          return false;
      }
    }
    if (direction === KeyBindingsDirection.UP && extWin.assignedTile && extWin.assignedTile?.y === 0) {
      maximizeWindow(window);
      return true;
    }
    if (direction === KeyBindingsDirection.NODIRECTION) {
      const rect = buildRectangle({
        x: this._workArea.x + this._workArea.width / 2 - windowRectCopy.width / 2,
        y: this._workArea.y + this._workArea.height / 2 - windowRectCopy.height / 2,
        width: windowRectCopy.width,
        height: windowRectCopy.height
      });
      destination = {
        rect,
        tile: TileUtils.build_tile(rect, this._workArea)
      };
    } else if (window.get_monitor() === this._monitor.index) {
      const enlargeFactor = Math.max(
        64,
        // if the gaps are all 0 we choose 64 instead
        // NOTE: the gap list used to omit `top` and list `right` twice.
        tilingLayout.innerGaps.top,
        tilingLayout.innerGaps.right,
        tilingLayout.innerGaps.left,
        tilingLayout.innerGaps.bottom
      );
      destination = tilingLayout.findNearestTileDirection(
        windowRectCopy,
        direction,
        clamp,
        enlargeFactor
      );
    } else {
      destination = tilingLayout.findNearestTile(windowRectCopy);
    }
    if (window.get_monitor() === this._monitor.index && destination && !window.maximizedHorizontally && !window.maximizedVertically && window.assignedTile && window.assignedTile?.x === destination.tile.x && window.assignedTile?.y === destination.tile.y && window.assignedTile?.width === destination.tile.width && window.assignedTile?.height === destination.tile.height)
      return true;
    if (!destination) {
      if (spanFlag) return false;
      if (direction === KeyBindingsDirection.UP && window.can_maximize()) {
        maximizeWindow(window);
        return true;
      }
      return false;
    }
    if (!window.assignedTile && !isMaximized)
      window.originalSize = windowRectCopy;
    if (spanFlag) {
      destination.rect = destination.rect.union(windowRectCopy);
      destination.tile = TileUtils.build_tile(
        destination.rect,
        this._workArea
      );
    }
    if (isMaximized) this._unmaximizeForPlacement(window);
    this._easeWindowRect(window, destination.rect, false, force);
    if (direction !== KeyBindingsDirection.NODIRECTION) {
      window.assignedTile = new Tile({
        ...destination.tile
      });
    }
    return true;
  }

  /**
   * Destroys the tiling manager and cleans up resources.
   */
  destroy() {
    this._placer.destroy();
    if (this._movingWindowTimerId) {
      GLib.Source.remove(this._movingWindowTimerId);
      this._movingWindowTimerId = null;
    }
    if (this._dynamicReflowSourceId !== null) {
      GLib.Source.remove(this._dynamicReflowSourceId);
      this._dynamicReflowSourceId = null;
    }
    this._dynamicWindowSignals.forEach(
      (ids, window) => ids.forEach((id) => window.disconnect(id))
    );
    this._dynamicWindowSignals.clear();
    this._dynamicWindows.length = 0;
    this._dynamicLayoutOffset.clear();
    this._pinnedWindows.clear();
    this._splitTarget = null;
    this._dynamicArrangements.clear();
    this._dynamicNewcomers.clear();
    this._dynamicSlotsCache.clear();
    this._dynamicTreeRevisions.clear();
    this._dynamicTreeCache.clear();
    this._pinRevisionCounter = 0;
    this._signals.disconnect();
    this._dragStageSignals.disconnect();
    this._isGrabbingWindow = false;
    this._snapAssistingInfo.update(void 0);
    this._edgeTilingManager.abortEdgeTiling();
    this._workspaceTilingLayout.forEach((tl) => tl.destroy());
    this._workspaceTilingLayout.clear();
    this._snapAssist.destroy();
    this._selectedTilesPreview.destroy();
    this._tilingSuggestionsLayout.destroy();
  }

  set workArea(newWorkArea) {
    if (newWorkArea.equal(this._workArea)) return;
    this._workArea = newWorkArea;
    this._debug(
      `new work area for monitor ${this._monitor.index}: ${newWorkArea.x} ${newWorkArea.y} ${newWorkArea.width}x${newWorkArea.height}`
    );
    this._workspaceTilingLayout.forEach(
      (tl) => tl.relayout({ containerRect: this._workArea })
    );
    this._snapAssist.workArea = this._workArea;
    this._edgeTilingManager.workarea = this._workArea;
    // The memoised slots depend on the work area: the pin sizes are
    // expressed as a fraction of it.
    this._invalidateDynamicSlots();
    this._queueDynamicReflow();
  }

  _onWindowGrabBegin(window, grabOp) {
    if (this._isGrabbingWindow) return;
    TouchPointer.get().updateWindowPosition(window.get_frame_rect());
    // The stage-level pointer trackers are drag-scoped: they must be removed
    // when the drag ends, otherwise every drag leaves another "touch-event"
    // handler behind and the pointer position gets tracked several times
    // over, which makes the tiling feel sluggish and inconsistent.
    this._dragStageSignals.disconnect();
    this._dragStageSignals.connect(
      global.stage,
      "touch-event",
      (_source, event) => {
        const [x, y] = event.get_coords();
        TouchPointer.get().onTouchEvent(x, y);
      }
    );
    this._dragStageSignals.connect(
      global.stage,
      "captured-event",
      (_source, event) => {
        const device = event.get_source_device();
        if (!device) return;
        const deviceType = device.get_device_type();
        if (deviceType === Clutter.InputDeviceType.TABLET_DEVICE || deviceType === Clutter.InputDeviceType.PEN_DEVICE) {
          const eventType = event.type();
          if (eventType === Clutter.EventType.MOTION) {
            const [x, y] = event.get_coords();
            TouchPointer.get().onTouchEvent(x, y);
            const seat = Clutter.get_default_backend().get_default_seat();
            seat.warp_pointer(x, y);
          }
        }
      }
    );
    if (Settings.ENABLE_BLUR_SNAP_ASSISTANT || Settings.ENABLE_BLUR_SELECTED_TILEPREVIEW) {
      this._signals.connect(window, "position-changed", () => {
        if (Settings.ENABLE_BLUR_SELECTED_TILEPREVIEW) {
          this._selectedTilesPreview.get_effect("blur")?.queue_repaint();
        }
        if (Settings.ENABLE_BLUR_SNAP_ASSISTANT) {
          this._snapAssist.get_first_child()?.get_effect("blur")?.queue_repaint();
        }
      });
    }
    this._isGrabbingWindow = true;
    this._movingWindowTimerId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      this._movingWindowTimerDuration,
      this._onMovingWindow.bind(this, window, grabOp)
    );
    this._onMovingWindow(window, grabOp);
  }

  _activationKeyStatus(modifier, key) {
    if (key === ActivationKey.NONE) return true;
    let mask = Clutter.ModifierType.CONTROL_MASK;
    switch (key) {
      case ActivationKey.CTRL:
        mask = Clutter.ModifierType.CONTROL_MASK;
        break;
      case ActivationKey.ALT:
        mask = Clutter.ModifierType.MOD1_MASK;
        break;
      case ActivationKey.SUPER:
        mask = Clutter.ModifierType.SUPER_MASK;
        break;
    }
    return (modifier & mask) === mask;
  }

  _onMovingWindow(window, grabOp) {
    if (!this._isGrabbingWindow) {
      this._movingWindowTimerId = null;
      return GLib.SOURCE_REMOVE;
    }
    const currentWs = window.get_workspace();
    const tilingLayout = this._workspaceTilingLayout.get(currentWs);
    if (!tilingLayout) return GLib.SOURCE_REMOVE;
    this._edgeTilingManager.workspaceIndex = currentWs.index();
    if (!window.allows_resize() || !window.allows_move() || !this._isPointerInsideThisMonitor(window)) {
      tilingLayout.close();
      this._selectedTilesPreview.close(true);
      this._snapAssist.close(true);
      this._snapAssistingInfo.update(void 0);
      this._edgeTilingManager.abortEdgeTiling();
      return GLib.SOURCE_CONTINUE;
    }
    const [x, y, modifier] = TouchPointer.get().isTouchDeviceActive() ? TouchPointer.get().get_pointer(window) : PointerTracker.get().getPointer();
    const extWin = window;
    extWin.assignedTile = void 0;
    const currPointerPos = { x, y };
    if (this._grabStartPosition === null)
      this._grabStartPosition = { x, y };
    if (extWin.originalSize && squaredEuclideanDistance(currPointerPos, this._grabStartPosition) > MINIMUM_DISTANCE_TO_RESTORE_ORIGINAL_SIZE) {
      if (Settings.RESTORE_WINDOW_ORIGINAL_SIZE) {
        const windowRect = window.get_frame_rect();
        const offsetX = (x - windowRect.x) / windowRect.width;
        const offsetY = (y - windowRect.y) / windowRect.height;
        const newSize = buildRectangle({
          x: x - extWin.originalSize.width * offsetX,
          y: y - extWin.originalSize.height * offsetY,
          width: extWin.originalSize.width,
          height: extWin.originalSize.height
        });
        const restartGrab = (
          // @ts-expect-error "grab is available on GNOME 42"
          global.display.end_grab_op && global.display.begin_grab_op
        );
        if (restartGrab) {
          global.display.end_grab_op(global.get_current_time());
        }
        this._easeWindowRect(window, newSize, restartGrab, restartGrab);
        TouchPointer.get().updateWindowPosition(newSize);
        if (restartGrab) {
          extWin.originalSize = void 0;
          // `begin_grab_op()` is a private mutter API whose signature has
          // drifted across versions. A throw here would abort the whole
          // grab, leaving the window stuck, so the restart is best-effort:
          // if it fails, the drag simply continues with the original size
          // instead of being restored.
          try {
            global.display.begin_grab_op(
              window,
              grabOp,
              true,
              // pointer already grabbed
              true,
              // frame action
              -1,
              // Button
              modifier,
              global.get_current_time(),
              x,
              y
            );
          } catch {
          }
        }
      }
      extWin.originalSize = void 0;
      this._grabStartPosition = null;
    }
    const isSpanMultiTilesActivated = this._activationKeyStatus(
      modifier,
      Settings.SPAN_MULTIPLE_TILES_ACTIVATION_KEY
    );
    const isTilingSystemActivated = this._activationKeyStatus(
      modifier,
      Settings.TILING_SYSTEM_ACTIVATION_KEY
    );
    const deactivationKey = Settings.TILING_SYSTEM_DEACTIVATION_KEY;
    const isTilingSystemDeactivated = deactivationKey === ActivationKey.NONE ? false : this._activationKeyStatus(modifier, deactivationKey);
    const allowSpanMultipleTiles = Settings.SPAN_MULTIPLE_TILES && isSpanMultiTilesActivated;
    const showTilingSystem = Settings.TILING_SYSTEM && isTilingSystemActivated && !isTilingSystemDeactivated;
    const changedSpanMultipleTiles = Settings.SPAN_MULTIPLE_TILES && isSpanMultiTilesActivated !== this._wasSpanMultipleTilesActivated;
    const changedShowTilingSystem = Settings.TILING_SYSTEM && isTilingSystemActivated !== this._wasTilingSystemActivated;
    if (!changedSpanMultipleTiles && !changedShowTilingSystem && currPointerPos.x === this._lastCursorPos?.x && currPointerPos.y === this._lastCursorPos?.y)
      return GLib.SOURCE_CONTINUE;
    this._lastCursorPos = currPointerPos;
    this._wasTilingSystemActivated = isTilingSystemActivated;
    this._wasSpanMultipleTilesActivated = isSpanMultiTilesActivated;
    if (Settings.ENABLE_DYNAMIC_TILING && this._previewDynamicSlot(
      window,
      currentWs,
      currPointerPos,
      tilingLayout
    ))
      return GLib.SOURCE_CONTINUE;
    if (!showTilingSystem) {
      if (tilingLayout.showing) {
        tilingLayout.close();
        this._selectedTilesPreview.close(true);
      }
      if (Settings.ACTIVE_SCREEN_EDGES && !this._snapAssistingInfo.isSnapAssisting && this._edgeTilingManager.canActivateEdgeTiling(currPointerPos)) {
        const { changed, rect } = this._edgeTilingManager.startEdgeTiling(currPointerPos);
        if (changed)
          this._showEdgeTiling(window, rect, x, y, tilingLayout);
        this._snapAssist.close(true);
      } else {
        if (this._edgeTilingManager.isPerformingEdgeTiling()) {
          this._selectedTilesPreview.close(true);
          this._edgeTilingManager.abortEdgeTiling();
        }
        if (Settings.SNAP_ASSIST) {
          const dynamicWs = Settings.ENABLE_DYNAMIC_TILING ? window.get_workspace() : null;
          this._snapAssist.setDynamicLayoutId(
            dynamicWs ? this.getCurrentDynamicLayoutId(dynamicWs) : void 0
          );
          this._snapAssist.onMovingWindow(
            window,
            currPointerPos,
            true
          );
        }
      }
      return GLib.SOURCE_CONTINUE;
    }
    if (!tilingLayout.showing) {
      tilingLayout.openAbove(window);
      this._snapAssist.close(true);
      if (this._edgeTilingManager.isPerformingEdgeTiling()) {
        this._selectedTilesPreview.close(true);
        this._edgeTilingManager.abortEdgeTiling();
      }
    }
    if (this._snapAssistingInfo.isSnapAssisting) {
      this._selectedTilesPreview.close(true);
      this._snapAssistingInfo.update(void 0);
    }
    if (!changedSpanMultipleTiles && isPointInsideRect(currPointerPos, this._selectedTilesPreview.rect))
      return GLib.SOURCE_CONTINUE;
    let selectionRect = tilingLayout.getTileBelow(
      currPointerPos,
      changedSpanMultipleTiles && !allowSpanMultipleTiles
    );
    if (!selectionRect) return GLib.SOURCE_CONTINUE;
    selectionRect = selectionRect.copy();
    if (allowSpanMultipleTiles && this._selectedTilesPreview.showing) {
      selectionRect = selectionRect.union(
        this._selectedTilesPreview.rect
      );
    }
    tilingLayout.hoverTilesInRect(selectionRect, !allowSpanMultipleTiles);
    this.openSelectionTilePreview(selectionRect, true, true, window);
    return GLib.SOURCE_CONTINUE;
  }

  _onWindowGrabEnd(window) {
    this._isGrabbingWindow = false;
    this._grabStartPosition = null;
    this._signals.disconnect(window);
    // Remove the drag-scoped stage trackers; without this they pile up over
    // successive drags.
    this._dragStageSignals.disconnect();
    // The moving-window timer used to be removed only in `destroy()`. It
    // self-terminates on the next tick, but in that window `_onMovingWindow`
    // could run against a window that had already been released, and
    // `window.get_workspace()` on a dead Meta.Window throws.
    if (this._movingWindowTimerId) {
      GLib.Source.remove(this._movingWindowTimerId);
      this._movingWindowTimerId = 0;
    }
    TouchPointer.get().reset();
    const currentWs = window.get_workspace();
    const tilingLayout = this._workspaceTilingLayout.get(currentWs);
    if (tilingLayout) tilingLayout.close();
    // The preview rectangle is only meaningful when the preview was actually
    // shown. Reading it unconditionally picked up the rectangle of the
    // *previous* drag, and the window was then assigned a tile it does not
    // occupy.
    const previewWasShowing = this._selectedTilesPreview.showing;
    const desiredWindowRect = buildRectangle({
      x: this._selectedTilesPreview.innerX,
      y: this._selectedTilesPreview.innerY,
      width: this._selectedTilesPreview.innerWidth,
      height: this._selectedTilesPreview.innerHeight
    });
    const selectedTilesRect = this._selectedTilesPreview.rect.copy();
    this._selectedTilesPreview.close(true);
    this._snapAssist.close(true);
    this._lastCursorPos = null;
    this._dynamicPreviewSlot = null;
    if (!isWindowAlive(window)) {
      this._snapAssistingInfo.update(void 0);
      this._edgeTilingManager.abortEdgeTiling();
      return;
    }
    if (Settings.ENABLE_DYNAMIC_TILING && this._dynamicSwapOnDrop(window)) {
      this._snapAssistingInfo.update(void 0);
      this._edgeTilingManager.abortEdgeTiling();
      return;
    }
    const isTilingSystemActivated = this._activationKeyStatus(
      PointerTracker.get().getModifiers(),
      Settings.TILING_SYSTEM_ACTIVATION_KEY
    );
    if (!isTilingSystemActivated && !this._snapAssistingInfo.isSnapAssisting && !this._edgeTilingManager.isPerformingEdgeTiling())
      return;
    const wasSnapAssistingLayout = this._snapAssistingInfo.isSnapAssisting ? GlobalState.get().layouts.find(
      (lay) => lay.id === this._snapAssistingInfo.layoutId
    ) : void 0;
    this._snapAssistingInfo.update(void 0);
    if (this._edgeTilingManager.isPerformingEdgeTiling() && this._edgeTilingManager.needMaximize() && window.can_maximize())
      maximizeWindow(window);
    const wasEdgeTiling = this._edgeTilingManager.isPerformingEdgeTiling();
    this._edgeTilingManager.abortEdgeTiling();
    const canShowTilingSuggestions = wasSnapAssistingLayout && Settings.ENABLE_SNAP_ASSISTANT_WINDOWS_SUGGESTIONS || wasEdgeTiling && Settings.ENABLE_SCREEN_EDGES_WINDOWS_SUGGESTIONS || isTilingSystemActivated && Settings.ENABLE_TILING_SYSTEM_WINDOWS_SUGGESTIONS;
    if (!this._isPointerInsideThisMonitor(window)) return;
    if (desiredWindowRect.width <= 0 || desiredWindowRect.height <= 0)
      return;
    // Without a visible preview there is no tile to assign: the rectangle
    // would be the leftover of the previous drag. The window keeps whatever
    // position it already has.
    if (!previewWasShowing) return;
    if (window.maximizedHorizontally || window.maximizedVertically) return;
    window.originalSize = window.get_frame_rect().copy();
    window.assignedTile = new Tile({
      ...TileUtils.build_tile(selectedTilesRect, this._workArea)
    });
    this._easeWindowRect(window, desiredWindowRect);
    if (wasSnapAssistingLayout && Settings.SNAP_ASSIST_SYNC_LAYOUT) {
      GlobalState.get().setSelectedLayoutOfMonitor(
        wasSnapAssistingLayout.id,
        this._monitor.index
      );
    }
    if (!tilingLayout || !canShowTilingSuggestions) return;
    const layout = wasEdgeTiling ? Settings.EDGE_TILING_MODE === EdgeTilingMode.DEFAULT ? new Layout(
      [
        new Tile({ x: 0, y: 0, height: 0.5, width: 0.5, groups: [] }),
        new Tile({ x: 0.5, y: 0, height: 0.5, width: 0.5, groups: [] }),
        new Tile({ x: 0, y: 0.5, height: 0.5, width: 0.5, groups: [] }),
        new Tile({ x: 0.5, y: 0.5, height: 0.5, width: 0.5, groups: [] })
      ],
      "quarters"
    ) : GlobalState.get().getSelectedLayoutOfMonitor(
      this._monitor.index,
      window.get_workspace().index()
    ) : wasSnapAssistingLayout ? wasSnapAssistingLayout : GlobalState.get().getSelectedLayoutOfMonitor(
      this._monitor.index,
      window.get_workspace().index()
    );
    this._openWindowsSuggestions(
      window,
      desiredWindowRect,
      window.get_monitor(),
      layout,
      tilingLayout.innerGaps,
      tilingLayout.outerGaps,
      tilingLayout.scalingFactor
    );
  }

  _openWindowsSuggestions(window, windowDesiredRect, monitorIndex, layout, innerGaps, outerGaps, scalingFactor) {
    const tiledWindows = [];
    const nontiledWindows = [];
    getWindows().forEach((extWin) => {
      if (extWin && !extWin.minimized && extWin.assignedTile)
        tiledWindows.push(extWin);
      else nontiledWindows.push(extWin);
    });
    if (nontiledWindows.length === 0) return;
    // The suggestions layout used to be destroyed and rebuilt on every
    // drop, which allocated a whole new set of preview actors and
    // `Clutter.Clone`s each time. The existing instance is reused and
    // simply re-laid-out instead.
    if (!this._tilingSuggestionsLayout) {
      this._tilingSuggestionsLayout = new TilingLayoutWithSuggestions(
        innerGaps,
        outerGaps,
        this._workArea,
        scalingFactor
      );
    }
    this._tilingSuggestionsLayout.scalingFactor = scalingFactor;
    this._tilingSuggestionsLayout.relayout({
      layout,
      innerGaps,
      outerGaps
    });
    this._tilingSuggestionsLayout.open(
      tiledWindows,
      nontiledWindows,
      window,
      windowDesiredRect,
      monitorIndex
    );
  }

  /**
   * Unmaximizes a window that is about to be placed. mutter would animate
   * the unmaximize on its own and the placement would then animate again on
   * top of it, so mutter's effect is skipped; the placer's animation covers
   * the whole way from the maximized rect to the tile.
   */
  _unmaximizeForPlacement(window) {
    const actor = window.get_compositor_private();
    if (actor) skipNextEffect(actor);
    unmaximizeWindow(window);
  }

  _easeWindowRect(window, destRect, user_op = false, force = false) {
    this._placer.place(placementTargetFor(window), toRect(destRect), {
      userOp: user_op,
      forceMove: force,
      animate: true
    });
  }

  _onSnapAssist(_, tile, layoutId) {
    if (this._dynamicPreviewSlot !== null) return;
    if (tile.width === 0 || tile.height === 0) {
      this._selectedTilesPreview.close(true);
      this._snapAssistingInfo.update(void 0);
      return;
    }
    const scaledRect = TileUtils.apply_props(tile, this._workArea);
    if (scaledRect.x + scaledRect.width > this._workArea.x + this._workArea.width) {
      scaledRect.width -= scaledRect.x + scaledRect.width - this._workArea.x - this._workArea.width;
    }
    if (scaledRect.y + scaledRect.height > this._workArea.y + this._workArea.height) {
      scaledRect.height -= scaledRect.y + scaledRect.height - this._workArea.y - this._workArea.height;
    }
    const currentWs = global.workspaceManager.get_active_workspace();
    const tilingLayout = this._workspaceTilingLayout.get(currentWs);
    if (!tilingLayout) return;
    this._selectedTilesPreview.get_parent()?.set_child_above_sibling(this._selectedTilesPreview, null);
    this.openSelectionTilePreview(scaledRect, false, true, void 0);
    this._snapAssistingInfo.update(layoutId);
  }

  openSelectionTilePreview(position, isAboveLayout, ease, window) {
    const currentWs = global.workspaceManager.get_active_workspace();
    const tilingLayout = this._workspaceTilingLayout.get(currentWs);
    if (!tilingLayout) return;
    this._selectedTilesPreview.gaps = buildTileGaps(
      position,
      tilingLayout.innerGaps,
      tilingLayout.outerGaps,
      this._workArea,
      this._enableScaling ? getScalingFactorOf(tilingLayout)[1] : void 0
    ).gaps;
    this._selectedTilesPreview.get_parent()?.set_child_above_sibling(this._selectedTilesPreview, null);
    const gaps = this._selectedTilesPreview.gaps;
    if (isAboveLayout) {
      this._selectedTilesPreview.updateBorderRadius(
        gaps.top > 0,
        gaps.right > 0,
        gaps.bottom > 0,
        gaps.left > 0
      );
    } else {
      const { isTop, isRight, isBottom, isLeft } = isTileOnContainerBorder(
        buildRectangle({
          x: position.x + gaps.left,
          y: position.y + gaps.top,
          width: position.width - gaps.left - gaps.right,
          height: position.height - gaps.top - gaps.bottom
        }),
        this._workArea
      );
      this._selectedTilesPreview.updateBorderRadius(
        !isTop,
        !isRight,
        !isBottom,
        !isLeft
      );
    }
    if (window)
      this._selectedTilesPreview.openAbove(window, position, ease);
    else this._selectedTilesPreview.open(position, ease);
  }

  /**
   * Checks if pointer is inside the current monitor
   * @returns true if the pointer is inside the current monitor, false otherwise
   */
  _isPointerInsideThisMonitor(window) {
    const [x, y] = TouchPointer.get().isTouchDeviceActive() ? TouchPointer.get().get_pointer(window) : PointerTracker.get().getPointer();
    const pointerMonitorIndex = global.display.get_monitor_index_for_rect(
      buildRectangle({
        x,
        y,
        width: 1,
        height: 1
      })
    );
    return this._monitor.index === pointerMonitorIndex;
  }

  _showEdgeTiling(window, edgeTile, pointerX, pointerY, tilingLayout) {
    this._selectedTilesPreview.gaps = buildTileGaps(
      edgeTile,
      tilingLayout.innerGaps,
      tilingLayout.outerGaps,
      this._workArea,
      this._enableScaling ? getScalingFactorOf(tilingLayout)[1] : void 0
    ).gaps;
    if (!this._selectedTilesPreview.showing) {
      const { left, right, top, bottom } = this._selectedTilesPreview.gaps;
      const initialRect = buildRectangle({
        x: pointerX,
        y: pointerY,
        width: left + right + 8,
        // width without gaps will be 8
        height: top + bottom + 8
        // height without gaps will be 8
      });
      initialRect.x -= initialRect.width / 2;
      initialRect.y -= initialRect.height / 2;
      this._selectedTilesPreview.open(initialRect, false);
    }
    this.openSelectionTilePreview(edgeTile, false, true, window);
  }

  /**
   * The rectangle a window gets for a tile: the tile scaled to the work
   * area, clamped to it, minus the configured gaps. Null when nothing is
   * left after the gaps.
   */
  _windowRectForTile(tile, tilingLayout) {
    const scaledRect = TileUtils.apply_props(tile, this._workArea);
    if (scaledRect.x + scaledRect.width > this._workArea.x + this._workArea.width) {
      scaledRect.width -= scaledRect.x + scaledRect.width - this._workArea.x - this._workArea.width;
    }
    if (scaledRect.y + scaledRect.height > this._workArea.y + this._workArea.height) {
      scaledRect.height -= scaledRect.y + scaledRect.height - this._workArea.y - this._workArea.height;
    }
    const gaps = buildTileGaps(
      scaledRect,
      tilingLayout.innerGaps,
      tilingLayout.outerGaps,
      this._workArea,
      this._enableScaling ? getScalingFactorOf(tilingLayout)[1] : void 0
    ).gaps;
    const rect = buildRectangle({
      x: scaledRect.x + gaps.left,
      y: scaledRect.y + gaps.top,
      width: scaledRect.width - gaps.left - gaps.right,
      height: scaledRect.height - gaps.top - gaps.bottom
    });
    return rect.width <= 0 || rect.height <= 0 ? null : rect;
  }

  /**
   * The managed windows of a workspace and the slot rectangles dynamic
   * tiling gives them, or null when there is nothing to place.
   *
   * While the template layout has a tile per window the rects are a pure
   * function of the window count. Past that, this is where the remembered
   * arrangement advances: a window `_dynamicAdd` just tracked halves the
   * focused window's leaf and nothing else moves; any other difference
   * from what was remembered — a window closed, minimised or moved, the
   * layout cycled — rebuilds from the layout in creation order, so the
   * oldest windows get the roomiest tiles again. Calling this twice
   * without a change in between returns the same rects.
   */
  _dynamicSlots(ws) {
    const windows = this._dynamicManagedWindows(ws);
    if (windows.length === 0) {
      this._dynamicArrangements.delete(ws);
      this._dynamicSlotsCache.delete(ws);
      return null;
    }
    const tree = this._dynamicTree(windows.length, ws);
    if (!tree) return null;

    // The result depends on the managed windows, the tree, the split
    // target, the current layout and the pinned sizes. All of them are
    // folded into one key so that a hit means "nothing that matters
    // changed" and the (expensive) recomputation can be skipped.
    const layoutId = this.getCurrentDynamicLayoutId(ws) ?? "";
    const focused = this._splitTarget && windows.includes(this._splitTarget) ? this._splitTarget : null;
    const key = this._dynamicSlotsKey(ws, windows, tree, focused, layoutId);
    const cached = this._dynamicSlotsCache.get(ws);
    if (cached && cached.key === key) {
      // A hit still has to clear the newcomer marks: they record which
      // windows an existing arrangement may grow by, and they are
      // consumed by the recomputation.
      windows.forEach((w) => this._dynamicNewcomers.delete(w));
      return cached.value;
    }

    const rects = this._dynamicRects(ws, tree, windows);
    windows.forEach((w) => this._dynamicNewcomers.delete(w));
    const value = { windows, rects: this._applyWindowPins(ws, windows, rects) };
    this._dynamicSlotsCache.set(ws, { key, value });
    return value;
  }

  /**
   * A string that changes whenever anything `_dynamicSlots()` depends on
   * changes: the managed windows and their order, the layout tree, the
   * split target, the current layout id and the pinned sizes.
   *
   * The windows are identified by their object identity, which is
   * assigned a small per-manager id, so that the key stays a string
   * (cheap to compare) without needing a Map.
   */
  _dynamicSlotsKey(ws, windows, tree, focused, layoutId) {
    const parts = new Array(windows.length + 6);
    for (let i = 0; i < windows.length; i++)
      parts[i] = String(this._windowId(windows[i]));
    parts[windows.length] = focused ? String(this._windowId(focused)) : "-";
    parts[windows.length + 1] = layoutId;
    parts[windows.length + 2] = String(this._dynamicTreeRevision(ws));
    parts[windows.length + 3] = this._pinRevision();
    parts[windows.length + 4] = String(Settings.INNER_GAPS);
    parts[windows.length + 5] = String(Settings.OUTER_GAPS);
    return parts.join(",");
  }

  /**
   * A small, stable integer for a window, used to build cheap cache keys.
   */
  _windowId(window) {
    let id = this._windowIds.get(window);
    if (id === void 0) {
      id = this._windowIds.size;
      this._windowIds.set(window, id);
    }
    return id;
  }

  /**
   * A number that changes whenever the layout tree for the workspace
   * could have changed. The tree is rebuilt when the layout is cycled
   * or when the saved layouts change, and those are exactly the events
   * that must invalidate the memoised slots.
   */
  _dynamicTreeRevision(ws) {
    let revision = this._dynamicTreeRevisions.get(ws);
    if (revision === void 0) {
      revision = 0;
      this._dynamicTreeRevisions.set(ws, revision);
    }
    return revision;
  }

  /**
   * A number that changes whenever a pinned window is pinned, unpinned
   * or resized.
   */
  _pinRevision() {
    return this._pinRevisionCounter;
  }

  /**
   * Invalidate the memoised slots.
   *
   * `workspaces` is the list of workspaces whose layout tree may have
   * changed; passing nothing invalidates every workspace.
   */
  _invalidateDynamicSlots(workspaces) {
    if (workspaces === void 0) {
      this._dynamicSlotsCache.clear();
      this._dynamicTreeCache.clear();
      this._dynamicTreeRevisions.clear();
      return;
    }
    for (const ws of workspaces) {
      this._dynamicSlotsCache.delete(ws);
      this._dynamicTreeCache.delete(ws);
      const revision = this._dynamicTreeRevisions.get(ws) ?? 0;
      this._dynamicTreeRevisions.set(ws, revision + 1);
    }
  }

  /**
   * Invalidate the memoised slots because a pin changed.
   */
  _invalidatePins() {
    this._pinRevisionCounter++;
    this._dynamicSlotsCache.clear();
  }

  _dynamicRects(ws, tree, windows) {
    if (windows.length <= leafCount(tree)) {
      this._dynamicArrangements.delete(ws);
      return assign(tree, windows.length);
    }
    const focused = this._splitTarget && windows.includes(this._splitTarget) ? this._splitTarget : void 0;
    const layoutId = this.getCurrentDynamicLayoutId(ws) ?? "";
    const previous = this._dynamicArrangements.get(ws);
    let arrangement = null;
    if (previous && previous.layoutId === layoutId) {
      const known = new Set(arrangementKeys(previous.tree));
      const newcomers = windows.filter((w) => !known.has(w));
      const onlyGrew = known.size + newcomers.length === windows.length && [...known].every((w) => windows.includes(w)) && newcomers.every((w) => this._dynamicNewcomers.has(w));
      if (onlyGrew) {
        arrangement = newcomers.reduce(
          (t, w) => insertIntoArrangement(t, focused, w),
          previous.tree
        );
      }
    }
    if (!arrangement)
      arrangement = buildArrangement(tree, windows, focused);
    if (!arrangement) {
      this._dynamicArrangements.delete(ws);
      const splitSlot = focused ? windows.indexOf(focused) : -1;
      return assign(
        tree,
        windows.length,
        splitSlot >= 0 ? splitSlot : void 0
      );
    }
    this._dynamicArrangements.set(ws, { layoutId, tree: arrangement });
    const final = arrangement;
    return windows.map((w) => arrangementRectOf(final, w));
  }

  /**
   * Trades the places of two managed windows: their creation-order slots
   * (what a rebuild hands out) and, when an arrangement is remembered for
   * the workspace, their leaves in it.
   */
  _dynamicSwap(ws, a, b) {
    // The swap is scoped to the workspace: the global `_dynamicWindows` list
    // holds the windows of *every* workspace, so reordering it here would
    // silently reshuffle the slot order of the other workspaces too.
    const remembered = this._dynamicArrangements.get(ws);
    if (remembered) {
      remembered.tree = swapInArrangement(remembered.tree, a, b);
    }

    // Reorder the two windows *within* the global list only if they are
    // adjacent-in-workspace neighbours, so that the creation-order slots of
    // the affected workspace follow the swap. Windows of other workspaces
    // keep their relative order.
    const workspaceWindows = this._dynamicManagedWindows(ws);
    const i = workspaceWindows.indexOf(a);
    const j = workspaceWindows.indexOf(b);
    if (i < 0 || j < 0) return;

    const globalA = this._dynamicWindows.indexOf(a);
    const globalB = this._dynamicWindows.indexOf(b);
    if (globalA < 0 || globalB < 0) return;
    [this._dynamicWindows[globalA], this._dynamicWindows[globalB]] = [
      this._dynamicWindows[globalB],
      this._dynamicWindows[globalA]
    ];
    this._invalidateDynamicSlots();
  }

  /**
   * Grows the slots of pinned windows so the frame the client insists on
   * fits inside them together with the gaps; the neighbours give way.
   */
  _applyWindowPins(ws, windows, rects) {
    if (this._pinnedWindows.size === 0) return rects;
    const tilingLayout = this._workspaceTilingLayout.get(ws);
    if (!tilingLayout) return rects;
    const pins = [];
    windows.forEach((window, slot) => {
      const pin = this._pinnedWindows.get(window);
      if (!pin) return;
      const tile = this._tileOf(rects[slot]);
      const tilePx = TileUtils.apply_props(tile, this._workArea);
      const framePx = this._windowRectForTile(tile, tilingLayout);
      if (!framePx) return;
      const entry = { slot };
      if (pin.width !== void 0)
        entry.minWidth = (pin.width + tilePx.width - framePx.width) / this._workArea.width;
      if (pin.height !== void 0)
        entry.minHeight = (pin.height + tilePx.height - framePx.height) / this._workArea.height;
      pins.push(entry);
    });
    return pins.length === 0 ? rects : applyPins(rects, pins);
  }

  /**
   * Previews, for a dragged window dynamic tiling manages, the slot it
   * would be dropped into: the one under the pointer, or its own when the
   * pointer is outside every slot. Returns false when the window is not
   * managed, leaving the static previews to their usual logic.
   */
  _previewDynamicSlot(window, ws, pointer, tilingLayout) {
    const slots = this._dynamicSlots(ws);
    const from = slots ? slots.windows.indexOf(window) : -1;
    if (!slots || from < 0) return false;
    if (tilingLayout.showing) tilingLayout.close();
    if (this._edgeTilingManager.isPerformingEdgeTiling())
      this._edgeTilingManager.abortEdgeTiling();
    this._snapAssistingInfo.update(void 0);
    if (Settings.SNAP_ASSIST) {
      this._snapAssist.setDynamicLayoutId(
        this.getCurrentDynamicLayoutId(ws)
      );
      this._snapAssist.onMovingWindow(window, pointer, true);
    } else {
      this._snapAssist.close(true);
    }
    const under = slotUnderPoint(slots.rects, this._workArea, pointer);
    const to = under >= 0 ? under : from;
    if (to === this._dynamicPreviewSlot) return true;
    const rect = this._windowRectForTile(
      this._tileOf(slots.rects[to]),
      tilingLayout
    );
    if (rect) {
      this._selectedTilesPreview.open(
        rect,
        this._dynamicPreviewSlot !== null
      );
      this._dynamicPreviewSlot = to;
    }
    return true;
  }

  _easeWindowRectFromTile(tile, window, skipAnimation = false) {
    const currentWs = window.get_workspace();
    const tilingLayout = this._workspaceTilingLayout.get(currentWs);
    if (!tilingLayout) return;
    const scaledRect = TileUtils.apply_props(tile, this._workArea);
    const destinationRect = this._windowRectForTile(tile, tilingLayout);
    if (!destinationRect) return;
    const isMaximized = window.maximizedHorizontally || window.maximizedVertically;
    const rememberOriginalSize = !isMaximized;
    if (isMaximized) this._unmaximizeForPlacement(window);
    if (rememberOriginalSize && !window.assignedTile) {
      window.originalSize = window.get_frame_rect().copy();
    }
    window.assignedTile = TileUtils.build_tile(
      buildRectangle({
        x: scaledRect.x,
        y: scaledRect.y,
        width: scaledRect.width,
        height: scaledRect.height
      }),
      this._workArea
    );
    this._placer.place(placementTargetFor(window), toRect(destinationRect), {
      animate: !skipAnimation,
      onSettled: (requested, actual, final) => this._onPlacementSettled(window, requested, actual, final)
    });
  }

  /**
   * Learns from the client's final answer to a placement. A window that
   * ends up larger than asked cannot be made that small, so its slot must
   * grow (pin); one that accepted a size below its pin has proven the pin
   * wrong. Either change means a reflow.
   */
  _onPlacementSettled(window, requested, actual, final) {
    if (!final || !Settings.ENABLE_DYNAMIC_TILING) return;
    if (!this._dynamicWindowSignals.has(window)) return;
    const pin = { ...this._pinnedWindows.get(window) ?? {} };
    const update = (axis) => {
      if (actual[axis] > requested[axis]) pin[axis] = actual[axis];
      else if (pin[axis] !== void 0 && requested[axis] < pin[axis])
        delete pin[axis];
    };
    update("width");
    update("height");
    const before = this._pinnedWindows.get(window);
    const changed = (before?.width ?? null) !== (pin.width ?? null) || (before?.height ?? null) !== (pin.height ?? null);
    if (!changed) return;
    if (pin.width === void 0 && pin.height === void 0)
      this._pinnedWindows.delete(window);
    else this._pinnedWindows.set(window, pin);
    this._invalidatePins();
    this._queueDynamicReflow();
  }

  onTileFromWindowMenu(tile, window) {
    this._easeWindowRectFromTile(tile, window);
  }

  onSpanAllTiles(window) {
    this._easeWindowRectFromTile(
      new Tile({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        groups: []
      }),
      window
    );
  }

  /**
   * Swaps the focused window with the region beside it. Returns true when
   * dynamic tiling has taken responsibility for the keypress, including when
   * there is nothing in that direction — reaching the edge of the screen
   * should do nothing, rather than fall through to the static layout.
   */
  _dynamicMoveByKeyboard(window, direction) {
    const towards = DYNAMIC_DIRECTION[direction];
    if (!towards) return false;
    const isMaximized = Boolean(
      (window.maximizedHorizontally && window.maximizedVertically) ||
      (window.maximized_horizontally && window.maximized_vertically)
    );
    if (isMaximized) {
      if (direction === KeyBindingsDirection.DOWN) {
        unmaximizeWindow(window);
        this._queueDynamicReflow();
        return true;
      }
      return true;
    }
    const ws = global.workspaceManager.get_active_workspace();
    if (!ws) return false;
    const slots = this._dynamicSlots(ws);
    const from = slots ? slots.windows.indexOf(window) : -1;
    if (!slots || from < 0) return false;
    const { windows, rects } = slots;
    if (windows.length < 2) {
      if (direction === KeyBindingsDirection.UP && window.can_maximize?.()) {
        maximizeWindow(window);
        return true;
      }
      return true;
    }
    const to = neighbourIndex(rects, from, towards);
    if (to < 0) {
      if (direction === KeyBindingsDirection.UP && window.can_maximize?.()) {
        maximizeWindow(window);
        return true;
      }
      return true;
    }
    this._dynamicSwap(ws, windows[from], windows[to]);
    this._applyDynamicTiling();
    return true;
  }

  /**
   * Whether the user has explicitly excluded this window's application from
   * being managed by the tiling system.
   *
   * The exclusion list is matched against both the WM class and the GTK
   * application id, because different toolkits report different identifiers
   * for the same app (Nautilus is `org.gnome.Nautilus` for both, but
   * Konsole reports `org.kde.konsole` as WM class while GTK apps tend to
   * use the reverse-DNS app id). Matching is case-insensitive and also
   * accepts the short basename, so `nautilus` matches
   * `org.gnome.Nautilus`.
   */
  _isExcludedFromTiling(window) {
    if (!window) return false;
    let excluded;
    try {
      excluded = Settings.TILING_EXCLUDED_APPS || [];
    } catch {
      return false;
    }
    if (!excluded || excluded.length === 0) return false;

    const identifiers = [];
    try {
      if (window.get_wm_class()) identifiers.push(window.get_wm_class());
    } catch {
    }
    try {
      if (window.get_gtk_application_id())
        identifiers.push(window.get_gtk_application_id());
    } catch {
    }

    const normalized = identifiers.map((id) => id.toLowerCase());
    const shortNames = normalized.map((id) => id.split(".").pop());

    return excluded.some((entry) => {
      const needle = String(entry).trim().toLowerCase();
      if (!needle) return false;
      return normalized.includes(needle) || shortNames.includes(needle);
    });
  }

  /**
   * Windows dynamic tiling is willing to keep track of at all — including
   * ones it cannot place right now, such as a minimized window, so that
   * tracking survives a minimize/restore or a lock/unlock cycle rather than
   * losing the window entirely.
   *
   * Being maximized is deliberately not disqualifying either. Plenty of
   * applications maximize themselves the moment they are mapped, and in a
   * mode whose whole premise is that windows fill the screen according to a
   * layout, refusing them would mean refusing almost everything. They are
   * unmaximized on placement instead, by `_easeWindowRectFromTile`.
   */
  _isDynamicTrackable(window) {
    if (window !== null && window.windowType === Meta.WindowType.NORMAL && window.get_transient_for() === null && !window.is_attached_dialog()) {
      return !this._isExcludedFromTiling(window);
    }
    return false;
  }

  /** Trackable windows that additionally have a rectangle to be placed in. */
  _isDynamicEligible(window) {
    return this._isDynamicTrackable(window) && isWindowAlive(window) && !window.minimized;
  }

  /**
   * Starts managing a window: gives it a slot and listens for the events
   * that must reflow. Returns false when the window is not ours to place.
   */
  _trackDynamicWindow(window) {
    if (window.get_monitor() !== this._monitor.index) return false;
    if (!this._isDynamicTrackable(window)) return false;
    if (this._dynamicWindowSignals.has(window)) return false;
    this._dynamicWindows.push(window);
    this._invalidateDynamicSlots();
    this._dynamicWindowSignals.set(window, [
      window.connect(
        "unmanaged",
        () => this._untrackDynamicWindow(window)
      ),
      // moving to another workspace leaves a hole behind and crowds the
      // destination, so both ends need recomputing
      window.connect(
        "workspace-changed",
        () => this._queueDynamicReflow()
      ),
      // dragging a window onto another monitor is the one way a
      // tracked window can leave this manager's domain without being
      // destroyed, so it is caught by polling get_monitor() on move
      // rather than a notify::monitor signal (which windowBorder.ts
      // does not rely on existing either)
      window.connect("position-changed", () => {
        if (window.get_monitor() !== this._monitor.index)
          this._releaseDynamicWindow(window);
      })
    ]);
    return true;
  }

  /**
   * Stops managing a window. The handlers are dropped rather than
   * disconnected because this runs while the window is being destroyed.
   */
  _untrackDynamicWindow(window) {
    // This method is reachable twice for the same window: once when the
    // window is destroyed, and once when it is released because it moved
    // to another monitor. The second call used to run a second
    // `_dynamicWindows.splice()`, which shifts the indices a concurrent
    // `_dynamicSwap` relies on and corrupts the slot assignment.
    const slot = this._dynamicWindows.indexOf(window);
    if (slot < 0) {
      // Already untracked. The bookkeeping below is idempotent, but the
      // reflow must not be queued twice.
      this._dynamicWindowSignals.delete(window);
      this._dynamicNewcomers.delete(window);
      if (this._splitTarget === window) this._splitTarget = null;
      this._placer.forget(placementTargetFor(window));
      this._pinnedWindows.delete(window);
      this._invalidatePins();
      this._invalidateDynamicSlots();
      return;
    }
    this._dynamicWindowSignals.delete(window);
    this._dynamicNewcomers.delete(window);
    [...this._dynamicArrangements.entries()].filter(([, { tree }]) => arrangementKeys(tree).includes(window)).forEach(([ws]) => this._dynamicArrangements.delete(ws));
    if (this._splitTarget === window) this._splitTarget = null;
    this._placer.forget(placementTargetFor(window));
    this._pinnedWindows.delete(window);
    this._invalidatePins();
    this._dynamicWindows.splice(slot, 1);
    this._invalidateDynamicSlots();
    this._queueDynamicReflow();
  }

  /**
   * Stops managing a window that is still alive, e.g. one dragged onto
   * another monitor. Unlike `_untrackDynamicWindow`, this disconnects the
   * window's handlers first, since the window survives and would
   * otherwise keep firing reflows into a manager that no longer owns it
   * — and, if dragged back later, `_trackDynamicWindow` would refuse to
   * re-track it while a stale entry lingers.
   *
   * The window is only dropped here, not adopted by the destination
   * monitor's manager; it is picked back up the next time dynamic tiling
   * is toggled or that manager re-adopts open windows.
   */
  _releaseDynamicWindow(window) {
    this._dynamicWindowSignals.get(window)?.forEach((id) => window.disconnect(id));
    this._untrackDynamicWindow(window);
  }

  /**
   * Takes on every window already open, on every workspace. Needed because
   * windows are otherwise only picked up as they are created, and the
   * extension is disabled and re-enabled on lock, unlock and monitor
   * changes — after which nothing already on screen would be managed at
   * all. Ordered by creation rather than by recency, so an unlock or a
   * toggle does not promote whichever window was last focused into the
   * master slot.
   */
  _adoptOpenWindows() {
    if (!Settings.ENABLE_DYNAMIC_TILING) return;
    const byWorkspace = [];
    for (let i = 0; i < global.workspaceManager.get_n_workspaces(); i++) {
      const ws = global.workspaceManager.get_workspace_by_index(i);
      if (ws) byWorkspace.push(...getWindows(ws));
    }
    const inCreationOrder = [...new Set(byWorkspace)].sort(
      (a, b) => a.get_stable_sequence() - b.get_stable_sequence()
    );
    let adopted = false;
    inCreationOrder.forEach((window) => {
      if (this._trackDynamicWindow(window)) adopted = true;
    });
    if (adopted) this._queueDynamicReflow();
  }

  /**
   * Gives a newly created window a slot and reflows everything else to make
   * room for it. Closing is the mirror image: the window gives its slot back
   * and the survivors reflow into the space.
   */
  _dynamicAdd(window) {
    const ws = window.get_workspace();
    const focused = global.display.focus_window;
    const focusedIsManaged = focused && ws ? this._dynamicManagedWindows(ws).includes(focused) : false;
    if (!this._trackDynamicWindow(window)) return;
    this._dynamicNewcomers.add(window);
    this._splitTarget = focusedIsManaged ? focused : null;
    this._invalidateDynamicSlots();
    const windowActor = window.get_compositor_private();
    if (!windowActor) {
      this._queueDynamicReflow();
      return;
    }
    let applied = false;
    const applyTiling = () => {
      if (applied) return;
      applied = true;
      this._applyDynamicTiling();
    };
    const id = windowActor.connect("first-frame", () => {
      windowActor.disconnect(id);
      applyTiling();
    });
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      applyTiling();
      return GLib.SOURCE_REMOVE;
    });
  }

  /**
   * The split tree dynamic tiling should follow for a given number of
   * windows on a given workspace. Layout order is preference: a layout with
   * exactly as many tiles as there are windows is used as drawn, otherwise
   * the leftmost roomier one is collapsed to fit, otherwise the roomiest is
   * subdivided. Layouts with no guillotine decomposition are not candidates
   * at all.
   *
   * That default pick can be stepped away from with cycleDynamicLayout,
   * which moves within the group of layouts sharing the same tile count —
   * the offset is per workspace and per tile-count group, and read here.
   */
  _dynamicTree(windowCount, ws) {
    // The result only depends on the window count, the candidate layouts
    // and the cycling offset for this workspace. The first two change
    // rarely, so the tree is memoised: the drag tick calls this on every
    // pointer move, and each call allocated two arrays and did two
    // linear scans over the candidate list.
    const candidates = this._dynamicLayoutCandidates();
    const revision = this._dynamicTreeRevision(ws);
    const cached = this._dynamicTreeCache.get(ws);
    if (cached && cached.windowCount === windowCount && cached.revision === revision)
      return cached.tree;
    const tileCounts = candidates.map((candidate) => candidate.tileCount);
    const defaultIndex = pickLayoutIndex(tileCounts, windowCount);
    const offset = defaultIndex < 0 ? 0 : this._dynamicLayoutOffset.get(ws)?.get(tileCounts[defaultIndex]) ?? 0;
    const index = pickLayoutIndexAt(tileCounts, windowCount, offset);
    const tree = index < 0 ? null : candidates[index].tree;
    this._dynamicTreeCache.set(ws, { windowCount, revision, tree });
    return tree;
  }

  /**
   * Every layout with a valid guillotine decomposition, paired with its
   * tile count, in the user's preferred order. Shared by `_dynamicTree`
   * and `cycleDynamicLayout` so both agree on what the tile-count groups
   * are.
   */
  _dynamicLayoutCandidates() {
    if (this._dynamicLayoutCandidatesCache !== null)
      return this._dynamicLayoutCandidatesCache;
    const candidates = GlobalState.get().layouts.map((layout) => ({
      id: layout.id,
      tileCount: layout.tiles.length,
      tree: buildLayoutTree(
        layout.tiles.map((t) => ({
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height
        }))
      )
    })).filter((candidate) => candidate.tree !== null);
    this._dynamicLayoutCandidatesCache = candidates;
    return candidates;
  }

  /**
   * Steps to the next (or, with a negative direction, previous) layout that
   * shares the tile count currently in use on the active workspace, and
   * reflows immediately. A group of one layout — nothing else the same
   * size — is a harmless no-op.
   */
  cycleDynamicLayout(direction) {
    if (!Settings.ENABLE_DYNAMIC_TILING) return;
    const ws = global.workspaceManager.get_active_workspace();
    if (!ws) return;
    const windowCount = this._dynamicManagedWindows(ws).length;
    if (windowCount === 0) return;
    const tileCounts = this._dynamicLayoutCandidates().map(
      (candidate) => candidate.tileCount
    );
    const defaultIndex = pickLayoutIndex(tileCounts, windowCount);
    if (defaultIndex < 0) return;
    const tileCount = tileCounts[defaultIndex];
    const groupOffsets = this._dynamicLayoutOffset.get(ws) ?? /* @__PURE__ */ new Map();
    groupOffsets.set(
      tileCount,
      (groupOffsets.get(tileCount) ?? 0) + direction
    );
    this._dynamicLayoutOffset.set(ws, groupOffsets);
    this._invalidateDynamicSlots([ws]);
    this._applyDynamicTiling();
  }

  /**
   * The saved layout currently acting as dynamic tiling's template on this
   * workspace — the same one `_dynamicTree` resolves to, including any
   * `cycleDynamicLayout` offset, whether or not the window count matches
   * its tile count exactly. `undefined` when there is nothing to place
   * (no windows, or no decomposable layout at all).
   */
  getCurrentDynamicLayoutId(ws) {
    const windowCount = this._dynamicManagedWindows(ws).length;
    if (windowCount === 0) return void 0;
    const candidates = this._dynamicLayoutCandidates();
    const tileCounts = candidates.map((candidate) => candidate.tileCount);
    const defaultIndex = pickLayoutIndex(tileCounts, windowCount);
    if (defaultIndex < 0) return void 0;
    const offset = this._dynamicLayoutOffset.get(ws)?.get(tileCounts[defaultIndex]) ?? 0;
    const index = pickLayoutIndexAt(tileCounts, windowCount, offset);
    return index < 0 ? void 0 : candidates[index].id;
  }

  /**
   * Every saved layout `selectDynamicLayout` would actually accept right
   * now — the ones sharing the current tile-count group — so UI can grey
   * out the rest instead of offering a choice that silently does nothing.
   * `undefined` when there is nothing to place.
   */
  getCurrentDynamicLayoutGroupIds(ws) {
    const windowCount = this._dynamicManagedWindows(ws).length;
    if (windowCount === 0) return void 0;
    const candidates = this._dynamicLayoutCandidates();
    const tileCounts = candidates.map((candidate) => candidate.tileCount);
    const defaultIndex = pickLayoutIndex(tileCounts, windowCount);
    if (defaultIndex < 0) return void 0;
    const tileCount = tileCounts[defaultIndex];
    return new Set(
      candidates.filter((candidate) => candidate.tileCount === tileCount).map((candidate) => candidate.id)
    );
  }

  /**
   * Jumps directly to a specific saved layout, the same way
   * `cycleDynamicLayout` steps by one — this just computes the offset
   * needed to land on `layoutId` in a single move instead of stepping.
   * A no-op, returning false, when `layoutId` is not part of the
   * tile-count group currently in use (there is nothing sensible to
   * switch to outside that group: dynamic tiling picks the group from the
   * window count, not from what is clicked).
   */
  selectDynamicLayout(ws, layoutId) {
    if (!Settings.ENABLE_DYNAMIC_TILING) return false;
    const windowCount = this._dynamicManagedWindows(ws).length;
    if (windowCount === 0) return false;
    const candidates = this._dynamicLayoutCandidates();
    const tileCounts = candidates.map((candidate) => candidate.tileCount);
    const defaultIndex = pickLayoutIndex(tileCounts, windowCount);
    if (defaultIndex < 0) return false;
    const tileCount = tileCounts[defaultIndex];
    const targetIndex = candidates.findIndex(
      (candidate) => candidate.id === layoutId
    );
    if (targetIndex < 0 || candidates[targetIndex].tileCount !== tileCount)
      return false;
    const group = tileCounts.map((count, index) => ({ count, index })).filter((entry) => entry.count === tileCount).map((entry) => entry.index);
    const defaultPosition = group.indexOf(defaultIndex);
    const targetPosition = group.indexOf(targetIndex);
    const groupOffsets = this._dynamicLayoutOffset.get(ws) ?? /* @__PURE__ */ new Map();
    groupOffsets.set(tileCount, targetPosition - defaultPosition);
    this._dynamicLayoutOffset.set(ws, groupOffsets);
    this._invalidateDynamicSlots([ws]);
    this._applyDynamicTiling();
    return true;
  }

  /**
   * Managed windows currently placeable on this monitor and workspace, in
   * slot order. Minimized windows stay tracked (see `_isDynamicTrackable`)
   * but are excluded here, since they have nothing on screen to place.
   */
  _dynamicManagedWindows(ws) {
    return this._dynamicWindows.filter(
      (w) => this._isDynamicEligible(w) && w.get_workspace() === ws && w.get_monitor() === this._monitor.index
    );
  }

  _tileOf(rect) {
    return new Tile({ ...rect, groups: [] });
  }

  /**
   * Queues one reflow on the next idle, coalescing any further calls until
   * it runs — several windows minimizing, unminimizing or changing
   * workspace together must produce one reflow, not one each.
   */
  _queueDynamicReflow() {
    if (!Settings.ENABLE_DYNAMIC_TILING) return;
    if (this._dynamicReflowSourceId !== null) return;
    this._dynamicReflowSourceId = GLib.idle_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      () => {
        this._dynamicReflowSourceId = null;
        this._applyDynamicTiling();
        return GLib.SOURCE_REMOVE;
      }
    );
  }

  /**
   * Recomputes rectangles and eases every managed window into place, on
   * every workspace that holds one — a window closing on another workspace
   * must not leave a hole there.
   *
   * Two ways in: call this directly only when the caller is the last thing
   * before a frame the user is watching for (a drop, a keybinding, a
   * window's first frame); everything that is merely a consequence of
   * window state changing (open/close/minimize/workspace/layout/work area)
   * goes through `_queueDynamicReflow`, which coalesces bursts into one
   * idle reflow. A reflow requested from inside a running one is deferred
   * to that same idle by the scheduler.
   */
  _applyDynamicTiling() {
    if (!Settings.ENABLE_DYNAMIC_TILING) return;
    this._reflow.run(() => this._reflowDynamicWindows());
  }

  _reflowDynamicWindows() {
    if (this._isGrabbingWindow) return;
    const workspaces = /* @__PURE__ */ new Set();
    this._dynamicWindows.forEach((window) => {
      const ws = window.get_workspace();
      if (ws) workspaces.add(ws);
    });
    workspaces.forEach((ws) => {
      const slots = this._dynamicSlots(ws);
      if (!slots) return;
      const { windows, rects } = slots;
      windows.forEach((window, slot) => {
        if (!isWindowAlive(window)) return;
        const isMax = Boolean(
          (window.maximizedHorizontally && window.maximizedVertically) ||
          (window.maximized_horizontally && window.maximized_vertically)
        );
        if (isMax) return;
        this._easeWindowRectFromTile(this._tileOf(rects[slot]), window);
      });
    });
  }

  /**
   * Drops a dragged window into whichever slot the pointer is over,
   * exchanging places with the window already living there. Returns true
   * when dynamic tiling has taken responsibility for the drop.
   */
  _dynamicSwapOnDrop(window) {
    const ws = global.workspaceManager.get_active_workspace();
    if (!ws) return false;
    const slots = this._dynamicSlots(ws);
    const from = slots ? slots.windows.indexOf(window) : -1;
    if (!slots || from < 0) return false;
    const { windows, rects } = slots;
    if (windows.length < 2) {
      this._applyDynamicTiling();
      return true;
    }
    const [pointerX, pointerY] = PointerTracker.get().getPointer();
    const to = slotUnderPoint(rects, this._workArea, {
      x: pointerX,
      y: pointerY
    });
    if (to >= 0 && to !== from)
      this._dynamicSwap(ws, windows[from], windows[to]);
    this._applyDynamicTiling();
    return true;
  }

  _autoTile(window, windowCreated) {
    if (window.get_monitor() !== this._monitor.index) return;
    if (window === null || window.windowType !== Meta.WindowType.NORMAL || window.get_transient_for() !== null || window.is_attached_dialog() || window.minimized || window.maximizedHorizontally || window.maximizedVertically)
      return;
    if (this._isExcludedFromTiling(window)) return;
    if (window.omnishellIntentionalMaximize) return;
    window.assignedTile = void 0;
    const vacantTile = this._findEmptyTile(window);
    if (!vacantTile) return;
    if (windowCreated) {
      const windowActor = window.get_compositor_private();
      if (!windowActor) return;
      const id = windowActor.connect("first-frame", () => {
        if (!window.minimized && !window.maximizedHorizontally && !window.maximizedVertically && window.get_transient_for() === null && !window.is_attached_dialog())
          this._easeWindowRectFromTile(vacantTile, window, true);
        windowActor.disconnect(id);
      });
    } else {
      this._easeWindowRectFromTile(vacantTile, window, true);
    }
  }

  _findEmptyTile(window) {
    // The vacant tile has to be looked up in the *window's* workspace, not in
    // the active one: a window that is being placed on a background workspace
    // would otherwise be matched against the layout of whatever workspace the
    // user is currently looking at.
    const windowWorkspace = window.get_workspace();
    const workspaceIndex = windowWorkspace?.index?.() ?? global.workspaceManager.get_active_workspace_index();
    const tilingLayout = this._workspaceTilingLayout.get(windowWorkspace);
    const tiledWindows = getWindows(windowWorkspace).filter((otherWindow) => {
      return otherWindow && otherWindow.assignedTile && !otherWindow.minimized && !otherWindow.maximizedVertically && !otherWindow.maximizedHorizontally;
    }).map((w) => w);
    const tiles = GlobalState.get().getSelectedLayoutOfMonitor(
      window.get_monitor(),
      workspaceIndex
    ).tiles;
    const workArea = Main.layoutManager.getWorkAreaForMonitor(
      window.get_monitor()
    );
    const vacantTiles = tiles.filter((t) => {
      // The tile rectangle produced by `apply_props` includes the inner
      // gaps, while a window's frame rectangle does not. Comparing the two
      // directly therefore reported a tile as vacant when it was only
      // "occupied" by the gap pixels of the neighbouring window -- and two
      // windows could be auto-tiled into the same tile.
      //
      // The comparison is done against the *window* rectangle of the tile
      // (the tile shrunk by the gaps), which is the same space the window
      // actually occupies.
      const windowRect = this._windowRectForTile(t, tilingLayout);
      return !tiledWindows.find(
        (win) => windowRect.overlap(win.get_frame_rect())
      );
    });
    if (vacantTiles.length === 0) return void 0;
    vacantTiles.sort((a, b) => a.x - b.x);
    let bestTileIndex = 0;
    let bestDistance = Number.MAX_VALUE;
    for (let index = 0; index < vacantTiles.length; index++) {
      const distance = Math.abs(
        0.5 - (vacantTiles[index].x + vacantTiles[index].width / 2)
      );
      if (bestDistance > distance) {
        bestTileIndex = index;
        bestDistance = distance;
      }
    }
    if (bestTileIndex < 0 || bestTileIndex >= vacantTiles.length)
      return void 0;
    return vacantTiles[bestTileIndex];
  }
}

export {
  TilingManager
};
