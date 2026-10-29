/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * DingBridge: Complete manager for the Desktop Icons subsystem inside OmniShell.
 * Superpower integration with dynamic tiling layouts, margins, and DBus coordination.
 */
import { Gio, GLib, St } from "../gi/ext.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { EmulateX11WindowType } from "./emulateX11WindowType.js";
import { VisibleArea } from "./visibleArea.js";
import { LaunchSubprocess } from "./launchSubprocess.js";
import Settings from "../settings/settings.js";
import { DING_BUS_NAME, DING_CONTROL_PATH } from "../app/dingBusNames.js";
import { setDingBridge, clearDingBridge } from "./dingBridgeAccess.js";

class DingBridge {
  _extensionPath;
  visibleArea;
  _x11Manager;
  _currentProcess;
  _isEnabled;
  _launchDesktopId;
  _launchTime;
  _dbusConnection;
  _dbusConnectionId;
  _dbusConnectionGroupId;
  _actionGroup;
  _disableTimer;
  _disableTimerId;
  _desktopGeometry;
  _startupPreparedId;
  _scaleFactorId;
  _visibleAreaId;
  _monitorsChangedId;
  _workareasChangedId;
  _enabledSettingSignalId;
  _safeZoneSettingSignalId;
  _lastFolderOpenTime;
  _folderOpenedAction;
  constructor(extensionPath) {
    this._extensionPath = extensionPath;
    this.visibleArea = null;
    this._x11Manager = null;
    this._currentProcess = null;
    this._isEnabled = false;
    this._launchDesktopId = 0;
    this._launchTime = 0;
    this._lastFolderOpenTime = 0;
    this._folderOpenedAction = null;
    this._dbusConnection = null;
    this._dbusConnectionId = 0;
    this._dbusConnectionGroupId = 0;
    this._actionGroup = null;
    this._disableTimer = null;
    this._disableTimerId = 0;
    this._desktopGeometry = null;
    this._startupPreparedId = null;
    this._scaleFactorId = 0;
    this._visibleAreaId = 0;
    this._monitorsChangedId = 0;
    this._workareasChangedId = 0;
    this._enabledSettingSignalId = 0;
    this._safeZoneSettingSignalId = 0;
    this.onDesktopWindowAdopted = null;
    // The bridge is published under a Symbol key rather than a string
    // property: a string property on `global` is easy to collide with and
    // shows up during enumeration. This is not a security boundary, because
    // `Symbol.for()` uses a shared registry that any extension can query; it
    // only avoids accidental clashes and casual introspection.
    setDingBridge(this);
  }

  enable() {
    this._enabledSettingSignalId = Settings.gioSetting.connect(
      `changed::${Settings.KEY_ENABLE_DESKTOP_ICONS}`,
      () => {
        if (Settings.ENABLE_DESKTOP_ICONS) {
          this._startDesktopSystem();
        } else {
          this._stopDesktopSystem();
        }
      }
    );
    this._safeZoneSettingSignalId = Settings.gioSetting.connect(
      `changed::${Settings.KEY_DESKTOP_ICONS_SAFE_ZONE}`,
      () => {
        this.updateDesktopGeometry();
      }
    );
    if (Settings.ENABLE_DESKTOP_ICONS) {
      this._startDesktopSystem();
    }
  }

  _startDesktopSystem() {
    if (this._isEnabled) return;
    if (!this._x11Manager) {
      this._x11Manager = new EmulateX11WindowType();
      this._x11Manager.onWindowAdopted = (window) => {
        this.onDesktopWindowAdopted?.(window);
      };
    }
    if (!this.visibleArea) {
      this.visibleArea = new VisibleArea();
    }
    if (Main.layoutManager._startingUp) {
      this._startupPreparedId = Main.layoutManager.connect(
        "startup-complete",
        () => this._innerEnable()
      );
    } else {
      this._startupPreparedId = null;
      this._innerEnable();
    }
  }

  _innerEnable() {
    if (this._startupPreparedId !== null) {
      Main.layoutManager.disconnect(this._startupPreparedId);
      this._startupPreparedId = null;
    }
    Main.overview.hide();
    this._x11Manager?.enable();
    this._monitorsChangedId = Main.layoutManager.connect(
      "monitors-changed",
      () => this.updateDesktopGeometry()
    );
    this._workareasChangedId = global.display.connect(
      "workareas-changed",
      () => this.updateDesktopGeometry()
    );
    if (this.visibleArea) {
      this._visibleAreaId = this.visibleArea.connect(
        "updated-usable-area",
        () => this.updateDesktopGeometry()
      );
    }
    this._scaleFactorId = St.ThemeContext.get_for_stage(global.stage).connect(
      "notify::scale-factor",
      () => this.updateDesktopGeometry()
    );
    this._isEnabled = true;
    if (this._launchDesktopId) {
      GLib.source_remove(this._launchDesktopId);
      this._launchDesktopId = 0;
    }
    this._dbusConnectionId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      // Upstream Desktop Icons NG owns "com.rastersoft.dingextension".
      // Claiming the same name means only one of the two can be the owner:
      // whichever starts second either fails or, worse, silently steals the
      // name from the running instance, which then loses its control
      // interface. OmniShell therefore uses its own name and exports the
      // action group under its own object path.
      DING_BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      null,
      (connection) => {
        this._dbusConnection = connection;
        this._disableTimer = new Gio.SimpleAction({
          name: "disableTimer"
        });
        this._desktopGeometry = Gio.SimpleAction.new_stateful(
          "desktopGeometry",
          new GLib.VariantType("av"),
          this.getDesktopGeometry()
        );
        this._desktopGeometry.set_enabled(true);
        this._disableTimerId = this._disableTimer.connect("activate", () => {
          this._currentProcess?.cancelTimer();
        });
        this._folderOpenedAction = new Gio.SimpleAction({
          name: "folderOpened"
        });
        this._folderOpenedActionId = this._folderOpenedAction.connect("activate", () => {
          this._lastFolderOpenTime = GLib.get_monotonic_time();
        });
        // The "Open Full Settings" button in the preferences window used to
        // call a `changeDesktopIconSettings` action that existed nowhere in
        // the codebase, so the button silently failed. The action is now
        // implemented here and forwarded to the DING child process, which
        // owns the real settings window.
        this._changeDesktopIconSettingsAction = new Gio.SimpleAction({
          name: "changeDesktopIconSettings"
        });
        this._changeDesktopIconSettingsActionId = this._changeDesktopIconSettingsAction.connect("activate", () => {
          this._currentProcess?.showDesktopIconSettings?.();
        });
        this._actionGroup = new Gio.SimpleActionGroup();
        this._actionGroup.add_action(this._disableTimer);
        this._actionGroup.add_action(this._desktopGeometry);
        this._actionGroup.add_action(this._folderOpenedAction);
        this._actionGroup.add_action(this._changeDesktopIconSettingsAction);
        this._dbusConnectionGroupId = this._dbusConnection.export_action_group(
          DING_CONTROL_PATH,
          this._actionGroup
        );
        this._launchDesktop();
      },
      null
    );
  }

  wasFolderOpenedRecently() {
    if (!this._lastFolderOpenTime) return false;
    return GLib.get_monotonic_time() - this._lastFolderOpenTime < 35e5;
  }

  notifyFolderOpened() {
    this._lastFolderOpenTime = GLib.get_monotonic_time();
  }

  consumeFolderOpened() {
    this._lastFolderOpenTime = 0;
  }

  query_window_belongs_to(window) {
    return this._currentProcess?.query_window_belongs_to?.(window) ?? false;
  }

  updateDesktopGeometry() {
    if (this._actionGroup && Main.layoutManager.monitors.length !== 0) {
      this._actionGroup.change_action_state("desktopGeometry", this.getDesktopGeometry());
      this._x11Manager?.refreshWindowsPosition();
    }
  }

  getDesktopGeometry() {
    const desktopVariantList = [];
    const desktopList = [];
    const ws = global.workspaceManager?.get_active_workspace?.() || global.workspace_manager?.get_active_workspace?.();
    const { scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
    for (let monitorIndex = 0; monitorIndex < Main.layoutManager.monitors.length; monitorIndex++) {
      const mon = Main.layoutManager.monitors[monitorIndex];
      const area = this.visibleArea?.getMonitorGeometry(ws, monitorIndex) ?? {
        x: mon?.x ?? 0,
        y: mon?.y ?? 0,
        width: mon?.width ?? 1920,
        height: mon?.height ?? 1080,
        scale: scaleFactor ?? 1,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        windowMarginTop: 0,
        windowMarginBottom: 0,
        windowMarginLeft: 0,
        windowMarginRight: 0
      };
      const monitorData = {
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
        // The per-monitor scale computed by `visibleArea.js` is used here
        // instead of the stage-global `scaleFactor`. On a mixed-DPI setup
        // (1x + 2x) the DING child used to receive one global scale for
        // every monitor and laid out the icons at the wrong size on the
        // non-primary monitor.
        scaleFactor: area.scale ?? scaleFactor,
        marginTop: area.marginTop,
        marginBottom: area.marginBottom,
        marginLeft: area.marginLeft,
        marginRight: area.marginRight,
        monitorIndex,
        primaryMonitor: Main.layoutManager.primaryIndex,
        windowMarginTop: area.windowMarginTop,
        windowMarginBottom: area.windowMarginBottom,
        windowMarginLeft: area.windowMarginLeft,
        windowMarginRight: area.windowMarginRight
      };
      const desktopListElement = new GLib.Variant("a{sd}", monitorData);
      desktopVariantList.push(desktopListElement);
      desktopList.push(area);
    }
    this._x11Manager?.setMonitorData(desktopList);
    return new GLib.Variant("av", desktopVariantList);
  }

  _launchDesktop() {
    console.log("[OmniShell] Launching integrated DING desktop process");
    const argv = [];
    // The interpreter is resolved explicitly instead of relying on the
    // shebang of `app/ding.js`. `Meta.WaylandClient.new_subprocess()` runs
    // the program through `env -S gjs -m`, which requires `gjs` to be on
    // the PATH of the gnome-shell process -- true on most systems, but not
    // guaranteed on a minimal or containerised installation.
    const gjs = GLib.find_program_in_path("gjs");
    if (gjs) {
      argv.push(gjs);
      argv.push("-m");
    }
    argv.push(GLib.build_filenamev([this._extensionPath, "app", "ding.js"]));
    argv.push("-E");
    argv.push("-P");
    argv.push(GLib.build_filenamev([this._extensionPath, "app"]));
    this._currentProcess = new LaunchSubprocess(0, "DING");
    this._currentProcess.setCwd(GLib.get_home_dir());
    if (this._currentProcess.spawnv(argv) === null) {
      this._doRelaunch(1e3);
      return;
    }
    this._x11Manager?.setWaylandClient(this._currentProcess);
    this._launchTime = GLib.get_monotonic_time();
    this._currentProcess.subprocess?.wait_async(null, (obj, res) => {
      const delta = GLib.get_monotonic_time() - this._launchTime;
      let reloadTime = 1;
      if (delta < 1e6) {
        reloadTime = 1e3;
      }
      try {
        obj.wait_finish(res);
      } catch {
      }
      if (!this._currentProcess || obj !== this._currentProcess.subprocess) return;
      this._doRelaunch(reloadTime);
    });
  }

  _doRelaunch(reloadTime) {
    this._currentProcess = null;
    this._x11Manager?.setWaylandClient(null);
    if (this._isEnabled && Settings.ENABLE_DESKTOP_ICONS) {
      if (this._launchDesktopId) {
        GLib.source_remove(this._launchDesktopId);
      }
      this._launchDesktopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, reloadTime, () => {
        this._launchDesktopId = 0;
        this._launchDesktop();
        return GLib.SOURCE_REMOVE;
      });
    }
  }

  killCurrentProcess() {
    if (this._launchDesktopId) {
      GLib.source_remove(this._launchDesktopId);
      this._launchDesktopId = 0;
    }
    const subprocess = this._currentProcess?.subprocess;
    if (subprocess) {
      this._currentProcess.cancelTimer();
      this._currentProcess.cancellable?.cancel();
      try {
        subprocess.send_signal(15);
      } catch {
      }
      // DING handles SIGTERM gracefully, but a hung child must not survive
      // and keep its desktop windows alongside the replacement process.
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        try {
          if (!subprocess.get_if_exited()) subprocess.force_exit();
        } catch {
        }
        return GLib.SOURCE_REMOVE;
      });
    }
    this._currentProcess = null;
    this._x11Manager?.setWaylandClient(null);
  }

  _stopDesktopSystem() {
    this._isEnabled = false;
    this.killCurrentProcess();
    this._x11Manager?.disable();
    if (this._visibleAreaId && this.visibleArea) {
      this.visibleArea.disconnect(this._visibleAreaId);
      this._visibleAreaId = 0;
    }
    this.visibleArea?.disable();
    this.visibleArea = null;
    if (this._disableTimerId && this._disableTimer) {
      this._disableTimer.disconnect(this._disableTimerId);
      this._disableTimerId = 0;
      this._disableTimer = null;
    }
    if (this._folderOpenedActionId && this._folderOpenedAction) {
      this._folderOpenedAction.disconnect(this._folderOpenedActionId);
      this._folderOpenedActionId = 0;
      this._folderOpenedAction = null;
    }
    if (this._changeDesktopIconSettingsActionId && this._changeDesktopIconSettingsAction) {
      this._changeDesktopIconSettingsAction.disconnect(this._changeDesktopIconSettingsActionId);
      this._changeDesktopIconSettingsActionId = 0;
      this._changeDesktopIconSettingsAction = null;
    }
    this._desktopGeometry = null;
    if (this._dbusConnectionGroupId && this._dbusConnection) {
      this._dbusConnection.unexport_action_group(this._dbusConnectionGroupId);
      this._dbusConnectionGroupId = 0;
      this._dbusConnection = null;
    }
    if (this._dbusConnectionId) {
      Gio.bus_unown_name(this._dbusConnectionId);
      this._dbusConnectionId = 0;
    }
    this._actionGroup = null;
    if (this._scaleFactorId) {
      St.ThemeContext.get_for_stage(global.stage).disconnect(this._scaleFactorId);
      this._scaleFactorId = 0;
    }
    if (this._startupPreparedId) {
      Main.layoutManager.disconnect(this._startupPreparedId);
      this._startupPreparedId = null;
    }
    if (this._monitorsChangedId) {
      Main.layoutManager.disconnect(this._monitorsChangedId);
      this._monitorsChangedId = 0;
    }
    if (this._workareasChangedId) {
      global.display.disconnect(this._workareasChangedId);
      this._workareasChangedId = 0;
    }
  }

  disable() {
    if (this._enabledSettingSignalId) {
      Settings.gioSetting.disconnect(this._enabledSettingSignalId);
      this._enabledSettingSignalId = 0;
    }
    if (this._safeZoneSettingSignalId) {
      Settings.gioSetting.disconnect(this._safeZoneSettingSignalId);
      this._safeZoneSettingSignalId = 0;
    }
    clearDingBridge(this);
    this._stopDesktopSystem();
  }
}

export {
  DingBridge
};
