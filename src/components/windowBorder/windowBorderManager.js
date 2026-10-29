import { Gio } from "../../gi/ext.js";
import WindowBorder from "./windowBorder.js";
import SignalHandling from "../../utils/signalHandling.js";
import Settings from "../../settings/settings.js";
import { isDesktopWindow } from "../../utils/desktopFilter.js";

class WindowBorderManager {
  _signals;
  _border;
  _borderSignals;
  _enableScaling;
  _interfaceSettings;
  _accentColorId;
  _disabled;
  _turnedOn;
  constructor(enableScaling) {
    this._signals = new SignalHandling();
    this._borderSignals = null;
    this._border = null;
    this._enableScaling = enableScaling;
    this._accentColorId = 0;
    this._disabled = false;
    this._turnedOn = false;
    this._interfaceSettings = new Gio.Settings({
      schema_id: "org.gnome.desktop.interface"
    });
  }

  enable() {
    this._disabled = false;
    this._signals.disconnect();
    if (Settings.ENABLE_WINDOW_BORDER) this._turnOn();
    this._signals.connect(
      Settings,
      Settings.KEY_ENABLE_WINDOW_BORDER,
      () => {
        if (Settings.ENABLE_WINDOW_BORDER) this._turnOn();
        else this._turnOff();
      }
    );
  }

  _turnOn() {
    this._disabled = false;
    if (this._turnedOn) {
      this._onWindowFocused();
      return;
    }
    this._turnedOn = true;
    this._onWindowFocused();
    this._borderSignals = new SignalHandling();
    this._borderSignals.connect(
      global.display,
      "notify::focus-window",
      this._onWindowFocused.bind(this)
    );
    this._borderSignals.connect(
      Settings,
      Settings.KEY_WINDOW_BORDER_COLOR,
      () => this._border?.updateStyle()
    );
    this._borderSignals.connect(
      Settings,
      Settings.KEY_WINDOW_USE_CUSTOM_BORDER_COLOR,
      () => this._border?.updateStyle()
    );
    if (this._accentColorId) {
      this._interfaceSettings.disconnect(this._accentColorId);
      this._accentColorId = 0;
    }
    this._accentColorId = this._interfaceSettings.connect(
      "changed::accent-color",
      () => this._border?.updateStyle()
    );
    this._borderSignals.connect(
      Settings,
      Settings.KEY_WINDOW_BORDER_WIDTH,
      () => this._border?.updateStyle()
    );
    this._borderSignals.connect(
      Settings,
      Settings.KEY_ENABLE_SMART_WINDOW_BORDER_RADIUS,
      () => this._border?.updateStyle()
    );
  }

  _turnOff() {
    this._disabled = true;
    this._turnedOn = false;
    if (this._borderSignals) {
      this._borderSignals.disconnect();
      this._borderSignals = null;
    }
    if (this._accentColorId) {
      this._interfaceSettings.disconnect(this._accentColorId);
      this._accentColorId = 0;
    }
    this._border?.destroy();
    this._border = null;
  }

  destroy() {
    this._turnOff();
    this._signals.disconnect();
    this._border?.destroy();
    this._border = null;
    this._turnedOn = false;
    this._disabled = true;
  }

  _onWindowFocused() {
    if (this._disabled) return;
    const metaWindow = global.display.focus_window;
    if (!metaWindow || isDesktopWindow(metaWindow)) {
      this._border?.destroy();
      this._border = null;
      return;
    }
    const wmClass = metaWindow.get_wm_class?.();
    const appId = metaWindow.get_gtk_application_id?.();
    if (wmClass === "gjs" || appId === "gjs") {
      this._border?.destroy();
      this._border = null;
      return;
    }

    if (!this._border)
      this._border = new WindowBorder(metaWindow, this._enableScaling);
    else this._border.trackWindow(metaWindow);
  }
}

export {
  WindowBorderManager
};
