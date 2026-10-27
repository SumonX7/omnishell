/*!
 * Tiling Shell: advanced and modern window management for GNOME
 *
 * Copyright (C) 2025 Domenico Ferraro
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Extension } from "./polyfill.js";
import { Gio, GLib, Meta } from "./gi/ext.js";
import { logger } from "./utils/logger.js";
import {
  filterUnfocusableWindows,
  getMonitors,
  getWindows,
  squaredEuclideanDistance
} from "./utils/ui.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { TilingManager } from "./components/tilingsystem/tilingManager.js";
import { TilingDragCoordinator } from "./components/tilingsystem/dragCoordinator.js";
import Settings from "./settings/settings.js";
import SignalHandling from "./utils/signalHandling.js";
import GlobalState from "./utils/globalState.js";
import Indicator from "./indicator/indicator.js";
import DBus from "./dbus.js";
import { KeyBindingsDirection, FocusSwitchDirection } from "./keybindings.js";
import KeyBindings from "./keybindings.js";
import SettingsOverride from "./settings/settingsOverride.js";
import { ResizingManager } from "./components/tilingsystem/resizeManager.js";
import OverriddenWindowMenu from "./components/window_menu/overriddenWindowMenu.js";
import { WindowBorderManager } from "./components/windowBorder/windowBorderManager.js";
import TilingShellWindowManager from "./components/windowManager/tilingShellWindowManager.js";
import OverriddenAltTab from "./components/altTab/overriddenAltTab.js";
import { LayoutSwitcherPopup } from "./components/layoutSwitcher/layoutSwitcher.js";
import { unmaximizeWindow, skipNextEffect } from "./utils/gnomesupport.js";
import * as Config from "resource:///org/gnome/shell/misc/config.js";
import { RaiseTogetherManager } from "./components/raiseTogether/raiseTogetherManager.js";
import { DingBridge } from "./dingBridge/dingBridge.js";
import { isDesktopWindow } from "./utils/desktopFilter.js";
const debug = logger("extension");

class TilingShellExtension extends Extension {
  _indicator;
  _tilingManagers;
  _tilingDragCoordinator;
  _fractionalScalingEnabled;
  _dbus;
  _signals;
  _keybindings;
  _resizingManager;
  _windowBorderManager;
  _raiseTogetherManager;
  _dingBridge;
  _mutterSettings;
  constructor(metadata) {
    super(metadata);
    this._signals = null;
    this._fractionalScalingEnabled = false;
    this._tilingManagers = [];
    this._tilingDragCoordinator = null;
    this._indicator = null;
    this._dbus = null;
    this._keybindings = null;
    this._resizingManager = null;
    this._windowBorderManager = null;
    this._raiseTogetherManager = null;
    this._dingBridge = null;
    this._mutterSettings = null;
  }

  createIndicator() {
    this._indicator = new Indicator(
      this.path,
      this.uuid,
      (monitorIndex) => this._tilingManagers[monitorIndex]
    );
    this._indicator.enableScaling = !this._fractionalScalingEnabled;
    this._indicator.enable();
    this._signals?.connect(this._indicator, "open-preferences", () => this.openPreferences());
  }

  /**
   * One-shot compatibility migrations.
   *
   * The original code compared `LAST_VERSION_NAME_INSTALLED` against the
   * upstream Tiling Shell versions "17.0" and "17.3". This fork uses its own
   * version scheme ("1.0.0"), so:
   *
   *  - the "17.0" branch could never run, and
   *  - the "17.3" branch ran on *every* start, because "1.0.0" !== "17.3",
   *    overwriting the user's `cycle-layouts-backward` shortcut with a
   *    garbage value.
   *
   * That value was also built wrong: `get_strv()` returns an array, and
   * interpolating an array into a template literal produces the literal
   * text "<Shift>['','']" instead of the individual shortcuts.
   *
   * The migrations now run exactly once, guarded by a dedicated
   * "migrations already applied" key, and the shortcut array is mapped
   * entry by entry.
   */
  _validateSettings(freshInstall = false) {
    const migrationsKey = "omnishell-migrations-applied";
    const applied = new Set(
      (Settings.gioSetting.get_strv(migrationsKey) || []).filter(Boolean)
    );

    if (!applied.has("17.0-border-color")) {
      // A fresh install already has the correct value from `_onInstall()`
      // (custom colour on GNOME < 47, accent colour afterwards). Running the
      // upgrade migration would overwrite it with whatever the border switch
      // happens to be, so only existing installations need the migration.
      if (!freshInstall) {
        debug("apply compatibility changes: 17.0 border colour");
        Settings.WINDOW_USE_CUSTOM_BORDER_COLOR = Settings.ENABLE_WINDOW_BORDER;
      }
      applied.add("17.0-border-color");
    }

    if (!applied.has("17.3-cycle-layouts-backward")) {
      debug("apply compatibility changes: 17.3 cycle-layouts-backward");
      const cycleLayouts = Settings.gioSetting.get_strv(
        Settings.SETTING_CYCLE_LAYOUTS
      ) || [];
      // Each shortcut gets its own "<Shift>" variant; the old code
      // stringified the whole array, producing "['','']" in the shortcut.
      const backward = cycleLayouts.map((shortcut) =>
        shortcut.startsWith("<Shift>") ? shortcut : `<Shift>${shortcut}`
      );
      Settings.gioSetting.set_strv(
        Settings.SETTING_CYCLE_LAYOUTS_BACKWARD,
        backward
      );
      applied.add("17.3-cycle-layouts-backward");
    }

    Settings.gioSetting.set_strv(migrationsKey, [...applied]);
  }

  _onInstall() {
    const GNOME_VERSION_MAJOR = Number(
      Config.PACKAGE_VERSION.split(".")[0]
    );
    Settings.WINDOW_USE_CUSTOM_BORDER_COLOR = GNOME_VERSION_MAJOR < 47;
  }

  enable() {
    if (this._signals) this._signals.disconnect();
    this._signals = new SignalHandling();
    // A re-enable must not leave a second set of global drag handlers
    // connected. The coordinator owns those handlers and the pointer tracker
    // for the whole extension.
    if (this._tilingDragCoordinator) {
      this._tilingDragCoordinator.destroy();
      this._tilingDragCoordinator = null;
    }
    this._tilingDragCoordinator = new TilingDragCoordinator(
      () => this._tilingManagers
    );
    this._tilingDragCoordinator.enable();
    Settings.initialize(this.getSettings());
    const freshInstall = Settings.LAST_VERSION_NAME_INSTALLED === "0";
    if (freshInstall) {
      this._onInstall();
      if (this.metadata["version-name"]) {
        Settings.LAST_VERSION_NAME_INSTALLED = this.metadata["version-name"] || "0";
      }
    }
    this._validateSettings(freshInstall);
    TilingShellWindowManager.get();
    this._mutterSettings = new Gio.Settings({ schemaId: "org.gnome.mutter" });
    this._fractionalScalingEnabled = this._isFractionalScalingEnabled(
      this._mutterSettings
    );
    if (this._keybindings) this._keybindings.destroy();
    this._keybindings = new KeyBindings(this.getSettings());
    if (Settings.ACTIVE_SCREEN_EDGES) {
      SettingsOverride.get().override(
        this._mutterSettings,
        "edge-tiling",
        new GLib.Variant("b", false)
      );
    }
    if (Main.layoutManager._startingUp) {
      this._signals.connect(
        Main.layoutManager,
        "startup-complete",
        () => {
          this._createTilingManagers();
          this._setupSignals();
        }
      );
    } else {
      this._createTilingManagers();
      this._setupSignals();
    }
    this._resizingManager = new ResizingManager();
    this._resizingManager.enable();
    if (this._windowBorderManager) this._windowBorderManager.destroy();
    this._windowBorderManager = new WindowBorderManager(
      !this._fractionalScalingEnabled
    );
    this._windowBorderManager.enable();
    this._raiseTogetherManager = new RaiseTogetherManager();
    this._raiseTogetherManager.enable();
    this.createIndicator();
    if (this._dbus) this._dbus.disable();
    this._dbus = new DBus();
    this._dbus.enable(this);
    if (Settings.OVERRIDE_WINDOW_MENU) OverriddenWindowMenu.enable();
    if (Settings.OVERRIDE_ALT_TAB) OverriddenAltTab.enable();
    if (this._dingBridge) this._dingBridge.disable();
    this._dingBridge = new DingBridge(this.path);
    this._dingBridge.onDesktopWindowAdopted = (window) => {
      for (const manager of this._tilingManagers) {
        manager.untrackWindow?.(window);
      }
    };
    this._dingBridge.enable();
    debug("extension is enabled");
  }

  openLayoutEditor() {
    this._indicator?.openLayoutEditor();
  }

  _createTilingManagers() {
    debug("building a tiling manager for each monitor");
    // Monitor hotplug or a scaling change can replace the managers while a
    // window is being dragged. End that drag against the old managers before
    // they are destroyed.
    this._tilingDragCoordinator?.abort();
    this._tilingManagers.forEach((tm) => tm.destroy());
    this._tilingManagers = getMonitors().map(
      (monitor) => new TilingManager(monitor, !this._fractionalScalingEnabled)
    );
    this._tilingManagers.forEach((tm) => tm.enable());
  }

  /**
   * The manager that owns the monitor a window is on. During window creation
   * mutter may not have assigned a monitor yet; the primary monitor is the
   * same fallback the window itself would use.
   */
  _managerForWindow(window) {
    const monitorIndex = window?.get_monitor?.() ?? -1;
    return this._tilingManagers[monitorIndex] ??
      this._tilingManagers[Main.layoutManager.primaryIndex] ??
      this._tilingManagers[0] ??
      null;
  }

  _setupSignals() {
    if (!this._signals) return;
    // "window-created" used to be connected by every monitor manager, so a
    // single new window ran the maximize/auto-tile logic once per monitor and
    // every dynamic manager tried to track it. Route it to its owner once.
    this._signals.connect(global.display, "window-created", (_display, window) => {
      if (isDesktopWindow(window)) return;
      this._managerForWindow(window)?.onWindowCreated(window);
    });
    // Hand a dynamic window over as it crosses monitors. This replaces the
    // per-window "position-changed" monitor poll, which cost a mutter round
    // trip on every pointer event of every dragged window.
    this._signals.connect(
      global.display,
      "window-entered-monitor",
      (_display, monitorIndex, window) => {
        if (!Settings.ENABLE_DYNAMIC_TILING) return;
        if (isDesktopWindow(window)) return;
        const target = this._tilingManagers[monitorIndex];
        if (!target) return;
        for (const manager of this._tilingManagers) {
          if (manager !== target) manager.onWindowLeftMonitor(window);
        }
        target.onWindowEnteredMonitor(window);
      }
    );
    // Maximize state changes also belong to one manager, not to all of them.
    const shellWindowManager = TilingShellWindowManager.get();
    this._signals.connect(shellWindowManager, "unmaximized", (_wm, window) => {
      if (isDesktopWindow(window)) return;
      this._managerForWindow(window)?.onWindowUnmaximized(window);
    });
    this._signals.connect(shellWindowManager, "maximized", (_wm, window) => {
      if (isDesktopWindow(window)) return;
      this._managerForWindow(window)?.onWindowMaximized(window);
    });
    this._signals.connect(global.display, "workareas-changed", () => {
      const allMonitors = getMonitors();
      if (this._tilingManagers.length !== allMonitors.length) {
        GlobalState.get().validate_selected_layouts();
        this._createTilingManagers();
      } else {
        this._tilingManagers.forEach((tm, index) => {
          tm.workArea = Main.layoutManager.getWorkAreaForMonitor(index);
        });
      }
    });
    this._signals.connect(
      this._mutterSettings,
      "changed::experimental-features",
      (_mutterSettings) => {
        if (!_mutterSettings) return;
        const fractionalScalingEnabled = this._isFractionalScalingEnabled(_mutterSettings);
        if (this._fractionalScalingEnabled === fractionalScalingEnabled)
          return;
        this._fractionalScalingEnabled = fractionalScalingEnabled;
        this._createTilingManagers();
        if (this._indicator) {
          this._indicator.enableScaling = !this._fractionalScalingEnabled;
        }
        if (this._windowBorderManager)
          this._windowBorderManager.destroy();
        this._windowBorderManager = new WindowBorderManager(
          !this._fractionalScalingEnabled
        );
        this._windowBorderManager.enable();
      }
    );
    if (this._keybindings) {
      this._signals.connect(
        this._keybindings,
        "move-window",
        (kb, dp, dir) => {
          this._onKeyboardMoveWin(dp, dir, false);
        }
      );
      this._signals.connect(
        this._keybindings,
        "span-window",
        (kb, dp, dir) => {
          this._onKeyboardMoveWin(dp, dir, true);
        }
      );
      this._signals.connect(
        this._keybindings,
        "span-window-all-tiles",
        (kb, dp) => {
          const window = dp.focus_window;
          if (!window) return;
          const monitorIndex = window.get_monitor();
          const manager = this._tilingManagers[monitorIndex];
          if (manager) manager.onSpanAllTiles(window);
        }
      );
      this._signals.connect(
        this._keybindings,
        "cycle-dynamic-layout",
        (kb, dp, direction) => {
          const window = dp.focus_window;
          if (!window) return;
          const manager = this._tilingManagers[window.get_monitor()];
          if (manager)
            manager.cycleDynamicLayout(direction > 0 ? 1 : -1);
        }
      );
      this._signals.connect(
        this._keybindings,
        "untile-window",
        this._onKeyboardUntileWindow.bind(this)
      );
      this._signals.connect(
        this._keybindings,
        "move-window-center",
        (kb, dp) => {
          this._onKeyboardMoveWin(
            dp,
            KeyBindingsDirection.NODIRECTION,
            false
          );
        }
      );
      this._signals.connect(
        this._keybindings,
        "focus-window",
        (kb, dp, dir) => {
          this._onKeyboardFocusWin(dp, dir);
        }
      );
      this._signals.connect(
        this._keybindings,
        "focus-window-direction",
        (kb, dp, dir) => {
          this._onKeyboardFocusWinDirection(dp, dir);
        }
      );
      this._signals.connect(
        this._keybindings,
        "highlight-current-window",
        (kb, dp) => {
          const focus_window = dp.focus_window || dp.get_focus_window?.();
          if (!focus_window) return;
          getWindows(
            global.workspaceManager.get_active_workspace()
          ).forEach((win) => {
            if (win !== focus_window && win.can_minimize())
              win.minimize();
          });
          Main.activateWindow(
            focus_window,
            global.get_current_time()
          );
        }
      );
      this._signals.connect(
        this._keybindings,
        "cycle-layouts",
        (kb, dp, currentAction, mask) => {
          const backwardAction = kb.cycleLayoutsBackwardAction;
          const switcher = new LayoutSwitcherPopup(
            kb.cycleLayoutsAction,
            backwardAction,
            !this._fractionalScalingEnabled
          );
          if (!switcher.show(currentAction === backwardAction, "", mask)) switcher.destroy();
        }
      );
    }
    this._signals.connect(
      Settings,
      Settings.KEY_ACTIVE_SCREEN_EDGES,
      () => {
        if (Settings.ACTIVE_SCREEN_EDGES) {
          debug("disable native edge tiling");
          SettingsOverride.get().override(
            this._mutterSettings,
            "edge-tiling",
            new GLib.Variant("b", false)
          );
        } else {
          debug("bring back native edge tiling");
          SettingsOverride.get().restoreKey(
            this._mutterSettings,
            "edge-tiling"
          );
        }
      }
    );
    this._signals.connect(
      Settings,
      Settings.KEY_OVERRIDE_WINDOW_MENU,
      () => {
        if (Settings.OVERRIDE_WINDOW_MENU)
          OverriddenWindowMenu.enable();
        else OverriddenWindowMenu.disable();
      }
    );
    this._signals.connect(
      OverriddenWindowMenu,
      "tile-clicked",
      (_, tile, window) => {
        const monitorIndex = window.get_monitor();
        const manager = this._tilingManagers[monitorIndex];
        if (manager) manager.onTileFromWindowMenu(tile, window);
      }
    );
    this._signals.connect(Settings, Settings.KEY_OVERRIDE_ALT_TAB, () => {
      if (Settings.OVERRIDE_ALT_TAB) OverriddenAltTab.enable();
      else OverriddenAltTab.disable();
    });
  }

  _onKeyboardMoveWin(display, direction, spanFlag) {
    const focus_window = display.get_focus_window();
    if (!focus_window || !focus_window.has_focus() || focus_window.get_wm_class() && focus_window.get_wm_class() === "gjs" || focus_window.is_fullscreen() || isDesktopWindow(focus_window))
      return;
    if ((focus_window.maximizedHorizontally || focus_window.maximizedVertically) && spanFlag)
      return;
    if ((focus_window.maximizedHorizontally || focus_window.maximizedVertically) && direction === KeyBindingsDirection.DOWN) {
      unmaximizeWindow(focus_window);
      return;
    }
    const monitorTilingManager = this._tilingManagers[focus_window.get_monitor()];
    if (!monitorTilingManager) return;
    if (Settings.ENABLE_AUTO_TILING && (focus_window.maximizedHorizontally || focus_window.maximizedVertically)) {
      unmaximizeWindow(focus_window);
      return;
    }
    let displayDirection = Meta.DisplayDirection.DOWN;
    switch (direction) {
      case KeyBindingsDirection.LEFT:
        displayDirection = Meta.DisplayDirection.LEFT;
        break;
      case KeyBindingsDirection.RIGHT:
        displayDirection = Meta.DisplayDirection.RIGHT;
        break;
      case KeyBindingsDirection.UP:
        displayDirection = Meta.DisplayDirection.UP;
        break;
    }
    const neighborMonitorIndex = display.get_monitor_neighbor_index(
      focus_window.get_monitor(),
      displayDirection
    );
    const success = monitorTilingManager.onKeyboardMoveWindow(
      focus_window,
      direction,
      false,
      spanFlag,
      neighborMonitorIndex === -1
      // clamp if there is NOT a monitor in this direction
    );
    if (success || direction === KeyBindingsDirection.NODIRECTION || neighborMonitorIndex === -1)
      return;
    if ((focus_window.maximizedHorizontally || focus_window.maximizedVertically) && direction === KeyBindingsDirection.UP) {
      skipNextEffect(focus_window.get_compositor_private());
      unmaximizeWindow(focus_window);
      focus_window.assignedTile = void 0;
    }
    const neighborTilingManager = this._tilingManagers[neighborMonitorIndex];
    if (!neighborTilingManager) return;
    neighborTilingManager.onKeyboardMoveWindow(
      focus_window,
      direction,
      true,
      spanFlag,
      false
    );
  }

  _onKeyboardFocusWinDirection(display, direction) {
    const focus_window = display.get_focus_window();
    if (!focus_window || !focus_window.has_focus() || focus_window.get_wm_class() && focus_window.get_wm_class() === "gjs" || isDesktopWindow(focus_window))
      return;
    let bestWindow;
    let bestWindowDistance = -1;
    const focusWindowRect = focus_window.get_frame_rect();
    const focusWindowCenter = {
      x: focusWindowRect.x + focusWindowRect.width / 2,
      y: focusWindowRect.y + focusWindowRect.height / 2
    };
    const ws = focus_window.get_workspace() || global.workspaceManager?.get_active_workspace?.();
    const windowList = filterUnfocusableWindows(
      ws?.list_windows?.() ?? []
    );
    const onlyTiledWindows = Settings.ENABLE_DIRECTIONAL_FOCUS_TILED_ONLY;
    windowList.filter((win) => {
      if (win === focus_window || win.minimized) return false;
      if (onlyTiledWindows && win.assignedTile === void 0)
        return false;
      const winRect = win.get_frame_rect();
      switch (direction) {
        case KeyBindingsDirection.RIGHT:
          return winRect.x > focusWindowRect.x;
        case KeyBindingsDirection.LEFT:
          return winRect.x < focusWindowRect.x;
        case KeyBindingsDirection.UP:
          return winRect.y < focusWindowRect.y;
        case KeyBindingsDirection.DOWN:
          return winRect.y > focusWindowRect.y;
      }
      return false;
    }).forEach((win) => {
      const winRect = win.get_frame_rect();
      const winCenter = {
        x: winRect.x + winRect.width / 2,
        y: winRect.y + winRect.height / 2
      };
      const euclideanDistance = squaredEuclideanDistance(
        winCenter,
        focusWindowCenter
      );
      if (!bestWindow || euclideanDistance < bestWindowDistance || euclideanDistance === bestWindowDistance && bestWindow.get_frame_rect().y > winRect.y) {
        bestWindow = win;
        bestWindowDistance = euclideanDistance;
      }
    });
    if (!bestWindow) return;
    bestWindow.activate(global.get_current_time());
  }

  _onKeyboardFocusWin(display, direction) {
    const focus_window = display.get_focus_window();
    if (!focus_window || !focus_window.has_focus() || focus_window.get_wm_class() && focus_window.get_wm_class() === "gjs" || isDesktopWindow(focus_window))
      return;
    const ws = focus_window.get_workspace() || global.workspaceManager?.get_active_workspace?.();
    const windowList = filterUnfocusableWindows(
      ws?.list_windows?.() ?? []
    );
    const focusParent = focus_window.get_transient_for() || focus_window;
    const focusedIdx = windowList.findIndex((win) => {
      return win === focusParent;
    });
    // The focused window can be absent from the filtered list (for example
    // when a desktop-canvas window or a transient dialog owns focus), and
    // an empty list yields -1 as well. Indexing with -1/NaN would throw.
    if (focusedIdx < 0) return;
    let nextIndex = -1;
    switch (direction) {
      case FocusSwitchDirection.PREV:
        if (focusedIdx === 0) {
          if (Settings.WRAPAROUND_FOCUS) {
            windowList[windowList.length - 1].activate(
              global.get_current_time()
            );
          }
        } else {
          windowList[focusedIdx - 1].activate(
            global.get_current_time()
          );
        }
        break;
      case FocusSwitchDirection.NEXT:
        nextIndex = (focusedIdx + 1) % windowList.length;
        if (nextIndex > 0 || Settings.WRAPAROUND_FOCUS)
          windowList[nextIndex].activate(global.get_current_time());
        break;
    }
  }

  _onKeyboardUntileWindow(kb, display) {
    const focus_window = display.get_focus_window();
    const winType = typeof focus_window?.get_window_type === "function" ? focus_window.get_window_type() : (focus_window?.window_type ?? focus_window?.windowType);
    if (!focus_window || !focus_window.has_focus() || winType !== Meta.WindowType.NORMAL || focus_window.get_wm_class() && focus_window.get_wm_class() === "gjs" || isDesktopWindow(focus_window))
      return;
    if (focus_window.maximizedHorizontally || focus_window.maximizedVertically || focus_window.maximized_horizontally || focus_window.maximized_vertically)
      unmaximizeWindow(focus_window);
    const monitorTilingManager = this._tilingManagers[focus_window.get_monitor()];
    if (!monitorTilingManager) return;
    monitorTilingManager.onUntileWindow(focus_window, true);
  }

  _isFractionalScalingEnabled(_mutterSettings) {
    return _mutterSettings.get_strv("experimental-features").find(
      (feat) => feat === "scale-monitor-framebuffer" || feat === "x11-randr-fractional-scaling"
    ) !== void 0;
  }

  disable() {
    // Disconnect extension-level handlers before destroying the objects they
    // are attached to: the indicator emits "open-preferences", and after
    // `Indicator.destroy()` its GObject is disposed, so disconnecting then
    // would log "has been already disposed".
    this._signals?.disconnect();
    this._signals = null;
    this._keybindings?.destroy();
    this._keybindings = null;
    this._indicator?.destroy();
    this._indicator = null;
    // The coordinator ends any in-flight drag and fans the end out to the
    // managers, so it must go before the managers it calls into.
    this._tilingDragCoordinator?.destroy();
    this._tilingDragCoordinator = null;
    this._tilingManagers.forEach((tm) => tm.destroy());
    this._tilingManagers = [];
    this._resizingManager?.destroy();
    this._resizingManager = null;
    this._windowBorderManager?.destroy();
    this._windowBorderManager = null;
    this._raiseTogetherManager?.destroy();
    this._raiseTogetherManager = null;
    this._dingBridge?.disable();
    this._dingBridge = null;
    this._dbus?.disable();
    this._dbus = null;
    this._mutterSettings = null;
    this._fractionalScalingEnabled = false;
    OverriddenWindowMenu.destroy();
    OverriddenAltTab.destroy();
    SettingsOverride.destroy();
    GlobalState.destroy();
    Settings.destroy();
    TilingShellWindowManager.destroy();
    debug("extension is disabled");
  }
}

export {
  TilingShellExtension as default
};
