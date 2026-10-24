/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * EmulateX11WindowType: Ensures Desktop Icons windows behave as desktop
 * background canvases under Wayland and X11 without being treated as normal windows.
 */
import { GLib, Meta } from "../gi/ext.js";
import {
  getManagedWindow,
  isManagedWindow,
  setManagedWindow,
  takeManagedWindow
} from "./dingWindowRegistry.js";

class ManageWindow {
  _window;
  _waylandClient;
  _emulator;
  _signalIDs;
  _moveIntoPlaceID;
  _keepAtTop;
  _showInAllDesktops;
  _fixed;
  _x;
  _y;
  windowUnmanaged;
  unmanagedID;
  constructor(window, waylandClient, emulator) {
    this._waylandClient = waylandClient;
    this._emulator = emulator;
    this._window = window;
    this._signalIDs = [];
    this._moveIntoPlaceID = 0;
    this.windowUnmanaged = false;
    this._keepAtTop = false;
    this._showInAllDesktops = false;
    this._fixed = false;
    this._x = null;
    this._y = null;
    this.unmanagedID = 0;
    this._signalIDs.push(
      window.connect("notify::title", () => {
        this._parseTitle();
      })
    );
    this._parseTitle();
  }

  _moveIntoPlace() {
    if (this._moveIntoPlaceID) {
      GLib.source_remove(this._moveIntoPlaceID);
      this._moveIntoPlaceID = 0;
    }
    this._moveIntoPlaceID = GLib.timeout_add(GLib.PRIORITY_LOW, 250, () => {
      if (this._fixed && this._x !== null && this._y !== null && this._window) {
        try {
          this._window.move_frame(true, this._x, this._y);
        } catch {
        }
      }
      this._moveIntoPlaceID = 0;
      return GLib.SOURCE_REMOVE;
    });
  }

  refreshWindowPosition() {
    this._moveIntoPlace();
  }

  destroy() {
    if (this._window) {
      for (const signalID of this._signalIDs) {
        try {
          this._window.disconnect(signalID);
        } catch {
        }
      }
      if (this._keepAtTop && !this.windowUnmanaged) {
        try {
          this._window.unmake_above();
        } catch {
        }
      }
    }
    this._signalIDs = [];
    if (this._moveIntoPlaceID) {
      GLib.source_remove(this._moveIntoPlaceID);
      this._moveIntoPlaceID = 0;
    }
    this._window = null;
    this._waylandClient = null;
  }

  setWaylandClient(client) {
    this._waylandClient = client;
  }

  _parseTitle() {
    if (!this._window) return;
    this._x = null;
    this._y = null;
    const keepAtTop = this._keepAtTop;
    this._keepAtTop = false;
    const showInAllDesktops = this._showInAllDesktops;
    this._showInAllDesktops = false;
    this._fixed = false;
    let title = this._window.get_title();
    if (title !== null) {
      if (title.length > 0 && title[title.length - 1] === " ") {
        if (title.length > 1 && title[title.length - 2] === " ") {
          title = "@!HTD";
        } else {
          title = "@!H";
        }
      }
      const pos = title.search("@!");
      if (pos !== -1) {
        const extraChars = title.substring(pos + 2).trim().toUpperCase();
        for (const char of extraChars) {
          switch (char) {
            case "T":
              this._keepAtTop = true;
              break;
            case "D":
              this._showInAllDesktops = true;
              break;
          }
        }
      }
      if (title.startsWith("Desktop Icons ")) {
        this._keepAtTop = false;
        this._fixed = true;
        try {
          const desktopIndex = parseInt(title.substring(14).trim(), 10);
          const desktopData = this._emulator.getMonitorData(desktopIndex - 1);
          if (desktopData) {
            this._x = desktopData.x + desktopData.windowMarginLeft;
            this._y = desktopData.y + desktopData.windowMarginTop;
          }
        } catch (e) {
          console.log(`[OmniShell] Exception calculating window pos: ${e.message}`);
        }
        try {
          this._window.set_type(Meta.WindowType.DESKTOP);
        } catch {
        }
      }
      if (this._keepAtTop !== keepAtTop) {
        if (this._keepAtTop) this._window.make_above();
        else this._window.unmake_above();
      }
      if (this._showInAllDesktops !== showInAllDesktops) {
        if (this._showInAllDesktops) this._window.stick();
        else this._window.unstick();
      }
      this._moveIntoPlace();
    }
  }
}

class EmulateX11WindowType {
  _windowList;
  _waylandClient;
  _monitorData;
  constructor() {
    this._windowList = [];
    this._waylandClient = null;
    this._monitorData = [];
  }

  setMonitorData(data) {
    this._monitorData = data;
  }

  getMonitorData(idx) {
    if (idx >= this._monitorData.length || idx < 0) return null;
    return this._monitorData[idx];
  }

  setWaylandClient(client) {
    this._waylandClient = client;
    for (const window of this._windowList) {
      const manageWindow = getManagedWindow(window);
      if (manageWindow) {
        manageWindow.setWaylandClient(this._waylandClient);
      }
    }
  }

  enable() {
    global.display.connectObject(
      "window-created",
      (_, window) => {
        // A window is only treated as a DING desktop canvas when the
        // Wayland client that we spawned claims it.
        //
        // The previous test also accepted any window whose *title* started
        // with "Desktop Icons ", which is a spoofing primitive: an ordinary
        // application could name its window that way and would then be
        // retyped as Meta.WindowType.DESKTOP, escaping the tiling manager
        // and the window switcher.
        if (this._waylandClient?.query_window_belongs_to(window)) {
          this.addWindow(window);
        }
      },
      this
    );
  }

  disable() {
    for (const window of this._windowList) {
      this._clearWindow(window);
    }
    this._windowList = [];
    try {
      global.display.disconnectObject(this);
    } catch {
    }
    this.refreshWindowsPosition();
  }

  addWindow(window) {
    if (isManagedWindow(window)) return;
    const manageWindow = new ManageWindow(window, this._waylandClient, this);
    setManagedWindow(window, manageWindow);
    this._windowList.push(window);
    manageWindow.unmanagedID = window.connect("unmanaged", (iWindow) => {
      const managed = getManagedWindow(iWindow);
      if (managed) {
        managed.windowUnmanaged = true;
        this._clearWindow(iWindow);
      }
      this._windowList = this._windowList.filter((item) => item !== iWindow);
    });
    this.refreshWindowsPosition();
  }

  refreshWindowsPosition() {
    this._windowList.forEach((window) => {
      const manageWindow = getManagedWindow(window);
      if (manageWindow) {
        manageWindow.refreshWindowPosition();
      }
    });
  }

  _clearWindow(window) {
    const custom = takeManagedWindow(window);
    if (custom) {
      if (custom.unmanagedID) {
        try {
          window.disconnect(custom.unmanagedID);
        } catch {
        }
      }
      custom.destroy();
    }
  }
}

export {
  EmulateX11WindowType,
  ManageWindow
};
