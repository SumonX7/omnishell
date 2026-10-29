import { isWindowAlive } from "../../utils/ui.js";

class MetaWindowGroup {
  _windows;
  _unmanagedCounter;
  // count how many windows are unmanaged
  _unmanagedEventHandler;
  _signals;
  /**
   * Initializes a WindowsGroup with a list of Meta.Window instances.
   * @param windows - An array of Meta.Window objects to manage as a group.
   */
  constructor(windows) {
    this._windows = windows;
    this._unmanagedCounter = 0;
    this._unmanagedEventHandler = null;
    this._signals = [];
    this._windows.forEach(
      (win) => {
        try {
          const id = win.connect("unmanaged", () => {
            this._unmanagedCounter++;
            if (this._unmanagedEventHandler && this._unmanagedCounter === this._windows.length) {
              this._unmanagedEventHandler();
              this.destroy();
            }
          });
          this._signals.push({ win, id });
        } catch {}
      }
    );
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof this._windows[0]?.[prop] === "function") {
          return (...args) => {
            this._windows.forEach(
              (win) => (
                // @ts-expect-error "This is expected"
                win[prop](...args)
              )
            );
          };
        }
        return this._windows[0]?.[prop];
      }
    });
  }

  get_workspace() {
    return this._windows[0]?.get_workspace?.();
  }

  activate(time) {
    this._windows.forEach((win) => {
      try {
        if (isWindowAlive(win)) {
          win.activate(time);
          time = global.get_current_time();
        }
      } catch {}
    });
  }

  connect(...args) {
    return this._windows[0]?.connect?.(...args);
  }

  connectObject(...args) {
    return this._windows[0]?.connectObject?.(...args);
  }

  onAllWindowsUnmanaged(fn) {
    this._unmanagedEventHandler = fn;
  }

  destroy() {
    if (this._signals) {
      this._signals.forEach(({ win, id }) => {
        try { win.disconnect(id); } catch {}
      });
      this._signals = [];
    }
  }
}

export {
  MetaWindowGroup as default
};
