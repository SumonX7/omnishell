/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * LaunchSubprocess: Process supervisor for the GTK4 Desktop Icons application.
 * Manages Wayland client subprocess attachment, output streaming, and automatic recovery.
 */
import { Gio, GLib, Meta } from "../gi/ext.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { DING_APP_ID, DING_SETTINGS_PATH } from "../app/dingBusNames.js";

/** Grace period before the first watchdog kill, in milliseconds. */
const LAUNCH_GRACE_PERIOD_MS = 8e3;

/** How many times the watchdog may kill and re-arm before giving up. */
const MAX_WATCHDOG_ATTEMPTS = 3;

class LaunchSubprocess {
  _processId;
  cancellable;
  _launcher;
  subprocess;
  processRunning;
  _launchTimer;
  _waitingForWindows;
  _waylandClient;
  _dataInputStream;
  _watchdogAttempts;
  constructor(flags, processId) {
    this._processId = processId;
    this.cancellable = new Gio.Cancellable();
    this._launcher = new Gio.SubprocessLauncher({
      flags: flags | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE
    });
    this.subprocess = null;
    this.processRunning = false;
    this._launchTimer = 0;
    this._waitingForWindows = 0;
    this._waylandClient = null;
    this._dataInputStream = null;
    this._watchdogAttempts = 0;
  }

  setCwd(cwd) {
    this._launcher?.set_cwd(cwd);
  }

  spawnv(argv) {
    this._waylandClient = null;
    // `Meta.WaylandClient` also exists on X11 builds, but it cannot attach a
    // subprocess to an X11 compositor. Only use it on an actual Wayland
    // session, and fall back to a normal spawn if it fails for any reason.
    if (Meta.is_wayland_compositor?.() && Meta.WaylandClient?.new_subprocess) {
      try {
        this._waylandClient = Meta.WaylandClient.new_subprocess(
          global.context,
          this._launcher,
          argv
        );
        this.subprocess = this._waylandClient.get_subprocess();
      } catch (e) {
        this._waylandClient = null;
        this.subprocess = null;
        console.log(`[OmniShell] Wayland client launch failed, falling back to normal spawn: ${e.message}
${e.stack}`);
      }
    }
    if (!this.subprocess && !this._waylandClient) {
      try {
        this.subprocess = this._launcher?.spawnv(argv) ?? null;
      } catch (e) {
        this.subprocess = null;
        console.log(`[OmniShell] Error launching Desktop process: ${e.message}
${e.stack}`);
      }
    }
    try {
      this._launcher?.close();
    } catch {
    }
    this._launcher = null;
    if (this.subprocess) {
      const stdoutPipe = this.subprocess.get_stdout_pipe();
      if (stdoutPipe) {
        this._dataInputStream = Gio.DataInputStream.new(stdoutPipe);
        this._readOutput();
      }
      this.subprocess.wait_async(this.cancellable, () => {
        this.processRunning = false;
        this._dataInputStream = null;
        this.cancellable = null;
        this.cancelTimer();
      });
      this.processRunning = true;
      if (Main.layoutManager.monitors.length !== 0) {
        this._waitingForWindows = Main.layoutManager.monitors.length;
        // Watchdog: the DING application is expected to map one window per
        // monitor. If that has not happened within the grace period the
        // process is considered stuck and is killed.
        //
        // The original code used a flat 6 second timeout with no retry and no
        // backoff, which killed perfectly healthy children on a slow machine
        // or with several monitors: the desktop icons then simply never
        // appeared, and there was no recovery attempt.
        //
        // The watchdog now waits longer before the first kill, retries with
        // an exponential backoff, and gives up after a bounded number of
        // attempts.
        this._armWatchdog(LAUNCH_GRACE_PERIOD_MS);
      }
    }
    return this.subprocess;
  }

  /**
   * (Re-)arms the watchdog with the given delay. When the grace period
   * expires the child is killed and the watchdog is re-armed with an
   * exponential backoff, up to MAX_WATCHDOG_ATTEMPTS times.
   */
  _armWatchdog(delayMs) {
    this._launchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
      this._launchTimer = 0;
      this._watchdogAttempts++;
      if (this._watchdogAttempts > MAX_WATCHDOG_ATTEMPTS) {
        console.warn(
          `[OmniShell-${this._processId}]: Desktop process did not map its windows ` +
          `after ${MAX_WATCHDOG_ATTEMPTS} attempts; giving up.`
        );
        this._waitingForWindows = 0;
        return GLib.SOURCE_REMOVE;
      }
      try {
        this.subprocess?.force_exit();
      } catch {
      }
      // Re-arm with an exponential backoff so that a slow start is not
      // punished over and over.
      const nextDelay = delayMs * Math.pow(2, this._watchdogAttempts);
      this._armWatchdog(nextDelay);
      return GLib.SOURCE_REMOVE;
    });
  }

  cancelTimer() {
    if (this._launchTimer !== 0) {
      GLib.source_remove(this._launchTimer);
      this._launchTimer = 0;
      this._waitingForWindows = 0;
      this._watchdogAttempts = 0;
    }
  }

  _readOutput() {
    if (!this._dataInputStream || !this.cancellable) return;
    this._dataInputStream.read_line_async(
      GLib.PRIORITY_DEFAULT,
      this.cancellable,
      (object, res) => {
        try {
          const [output, length] = object.read_line_finish_utf8(res);
          if (length && output) {
            print(`[OmniShell-${this._processId}]: ${output}`);
            if (output.includes("Creating desktop index")) {
              this.cancelTimer();
            }
          }
        } catch (e) {
          if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
            return;
          }
          console.error(e, `[OmniShell-${this._processId}-Error]`);
        }
        if (this.processRunning) {
          this._readOutput();
        }
      }
    );
  }

  query_window_belongs_to(window) {
    if (!this.processRunning) return false;
    try {
      const title = window.get_title?.();
      const isDingByTitle = title && (title.startsWith("Desktop Icons ") || title === "DING" || title.startsWith("DING "));
      if (this._waylandClient && typeof this._waylandClient.owns_window === "function") {
        const ownsWindow = this._waylandClient.owns_window(window);
        if ((ownsWindow || isDingByTitle) && this._launchTimer !== 0 && this._waitingForWindows !== 0) {
          this._waitingForWindows--;
          if (this._waitingForWindows === 0) {
            this.cancelTimer();
          }
        }
        if (ownsWindow) return true;
      }
      if (isDingByTitle) {
        if (this._launchTimer !== 0 && this._waitingForWindows !== 0) {
          this._waitingForWindows--;
          if (this._waitingForWindows === 0) {
            this.cancelTimer();
          }
        }
        return true;
      }
    } catch (error) {
      console.log(`[OmniShell] query_window_belongs_to error: ${error.message}`);
    }
    return false;
  }

  showDesktopIconSettings() {
    try {
      const actionGroup = Gio.DBusActionGroup.get(
        Gio.DBus.session,
        DING_APP_ID,
        DING_SETTINGS_PATH
      );
      actionGroup?.activate_action("changeDesktopIconSettings", null);
    } catch (e) {
      console.log(`[OmniShell] Error opening desktop icon settings: ${e.message}`);
    }
  }
}

export {
  LaunchSubprocess
};
