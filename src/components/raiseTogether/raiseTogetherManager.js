import SignalHandling from "../../utils/signalHandling.js";
import Settings from "../../settings/settings.js";
import { getWindows } from "../../utils/ui.js";
import { isDesktopWindow } from "../../utils/desktopFilter.js";

class RaiseTogetherManager {
  _signals;
  _raiseId;
  // map window id to 'raised' signal id
  constructor() {
    this._signals = new SignalHandling();
    this._raiseId = {};
  }

  enable() {
    if (Settings.RAISE_TOGETHER) this._turnOn();
    this._signals.connect(Settings, Settings.KEY_RAISE_TOGETHER, () => {
      if (Settings.RAISE_TOGETHER) this._turnOn();
      else this._turnOff();
    });
  }

  destroy() {
    this._signals.disconnect();
    this._raiseId = {};
  }

  _turnOn() {
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
    this.destroy();
    this.enable();
  }

  _connectRaisedSignal(window) {
    if (!window || isDesktopWindow(window) || this._raiseId[window.get_id()]) return;
    const raisedId = this._signals.connect(window, "raised", () => {
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
