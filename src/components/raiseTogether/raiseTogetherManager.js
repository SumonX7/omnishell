import SignalHandling from "../../utils/signalHandling.js";
import Settings from "../../settings/settings.js";
import { getWindows } from "../../utils/ui.js";
import { isDesktopWindow } from "../../utils/desktopFilter.js";

class RaiseTogetherManager {
  _signals;
  _raiseId;
  _disabled;
  _turnedOn;
  // map window id to 'raised' signal id
  constructor() {
    this._signals = new SignalHandling();
    this._raiseId = {};
    this._disabled = false;
    this._turnedOn = false;
  }

  enable() {
    this._disabled = false;
    if (Settings.RAISE_TOGETHER) this._turnOn();
    this._signals.connect(Settings, Settings.KEY_RAISE_TOGETHER, () => {
      if (Settings.RAISE_TOGETHER) this._turnOn();
      else this._turnOff();
    });
  }

  destroy() {
    this._signals.disconnect();
    this._raiseId = {};
    this._turnedOn = false;
    this._disabled = true;
  }

  _turnOn() {
    this._disabled = false;
    if (this._turnedOn) return;
    this._turnedOn = true;
    getWindows().forEach((win) => this._connectRaisedSignal(win));
    this._signals.connect(
      global.display,
      "window-created",
      (_display, window) => {
        this._connectRaisedSignal(window);
      }
    );
  }

  _turnOff() {
    this._disabled = true;
  }

  _connectRaisedSignal(window) {
    if (!window || isDesktopWindow(window) || this._raiseId[window.get_id()]) return;
    const raisedId = this._signals.connect(window, "raised", () => {
      if (this._disabled) return;
      if (!window.assignedTile) return;
      this._onTiledWindowRaised(window);
    });
    this._raiseId[window.get_id()] = { id: raisedId, win: window };
    this._signals.connect(window, "unmanaged", () => {
      delete this._raiseId[window.get_id()];
    });
  }

  _onTiledWindowRaised(tiledWindow) {
    if (!tiledWindow) return;
    const workspace = tiledWindow.get_workspace?.();
    getWindows(workspace).forEach((winSameWorkspace) => {
      if (!winSameWorkspace || winSameWorkspace === tiledWindow || !winSameWorkspace.assignedTile) return;
      this._stopRaiseSignalHandling(winSameWorkspace);
      try { winSameWorkspace.raise(); } catch {}
      this._restartRaiseSignalHandling(winSameWorkspace);
    });
    this._stopRaiseSignalHandling(tiledWindow);
    try { tiledWindow.raise(); } catch {}
    this._restartRaiseSignalHandling(tiledWindow);
  }

  _stopRaiseSignalHandling(window) {
    if (!window) return;
    try {
      const data = this._raiseId[window.get_id?.()];
      if (!data) return;
      window.block_signal_handler(data.id);
    } catch {}
  }

  _restartRaiseSignalHandling(window) {
    if (!window) return;
    try {
      const data = this._raiseId[window.get_id?.()];
      if (!data) return;
      window.unblock_signal_handler(data.id);
    } catch {}
  }
}

export {
  RaiseTogetherManager
};
