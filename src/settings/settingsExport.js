import { Gio, GLib } from "../gi/prefs.js";
import Settings from "../settings/settings.js";
import SettingsOverride from "../settings/settingsOverride.js";
const dconfPath = "/org/gnome/shell/extensions/tilingshell/";
const excludedKeys = [
  Settings.KEY_SETTING_LAYOUTS_JSON,
  Settings.KEY_LAST_VERSION_NAME_INSTALLED,
  Settings.KEY_OVERRIDDEN_SETTINGS,
  "omnishell-migrations-applied"
];

class SettingsExport {
  _gioSettings;
  constructor(gioSettings) {
    this._gioSettings = gioSettings;
  }

  exportToString() {
    return this._excludeKeys(this._dumpDconf());
  }

  importFromString(content) {
    const backup = this.exportToString();
    this.restoreToDefault();
    try {
      const proc = Gio.Subprocess.new(
        ["dconf", "load", dconfPath],
        Gio.SubprocessFlags.STDIN_PIPE
      );
      proc.communicate_utf8(this._excludeKeys(content), null);
      if (!proc.get_successful()) {
        throw new Error("Failed to load dconf dump");
      }
    } catch (err) {
      try {
        const restoreProc = Gio.Subprocess.new(
          ["dconf", "load", dconfPath],
          Gio.SubprocessFlags.STDIN_PIPE
        );
        restoreProc.communicate_utf8(backup, null);
      } catch {
        this.restoreToDefault();
      }
      throw new Error(
        "Failed to import dconf dump file. Previous settings preserved: " + err.message
      );
    }
  }

  restoreToDefault() {
    // NOTE: this used to explicitly set
    //   Settings.ACTIVE_SCREEN_EDGES = false;
    //   Settings.ENABLE_MOVE_KEYBINDINGS = false;
    // before resetting every key. Both schema defaults are `true`, so
    // "Bring back the default settings" silently turned off screen-edge
    // tiling and every movement shortcut, and the user had to know to
    // re-enable them by hand. The `reset()` loop below already restores
    // the schema default for every key, so the explicit assignments were
    // both redundant and wrong.
    SettingsOverride.get().restoreAll();
    this._gioSettings.list_keys().filter((key) => key.length > 0 && !excludedKeys.includes(key)).forEach((key) => this._gioSettings.reset(key));
  }

  _dumpDconf() {
    const proc = Gio.Subprocess.new(
      ["dconf", "dump", dconfPath],
      Gio.SubprocessFlags.STDOUT_PIPE
    );
    const [, dump] = proc.communicate_utf8(null, null);
    if (proc.get_successful()) return dump;
    else throw new Error("Failed to dump dconf");
  }

  _excludeKeys(dconfDump) {
    if (dconfDump.trim().length === 0) return "";
    const keyFile = new GLib.KeyFile();
    const length = new TextEncoder().encode(dconfDump).length;
    if (!keyFile.load_from_data(dconfDump, length, GLib.KeyFileFlags.NONE))
      throw new Error("Failed to load from dconf dump");
    const [key_list] = keyFile.get_keys("/");
    key_list.forEach((key) => {
      if (excludedKeys.includes(key)) keyFile.remove_key("/", key);
    });
    const [data] = keyFile.to_data();
    return data ?? "";
  }
}

export {
  SettingsExport as default
};
