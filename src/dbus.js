const node = `<node>
    <interface name="org.gnome.Shell.Extensions.TilingShell">
        <method name="openLayoutEditor" />
    </interface>
</node>`;
import { Gio } from "./gi/ext.js";

/**
 * Bus name owned by the extension for its own D-Bus API.
 *
 * The exported object used to be published on the *anonymous* session bus
 * name (`:1.N`), which means it was reachable by anyone who guessed the
 * object path, with no ownership policy and no way for a client to look the
 * name up in a predictable way.
 */
const TILING_SHELL_BUS_NAME = "com.spark.omnishell.tilingshell";

/** Object path at which the tiling shell API is exported. */
const TILING_SHELL_OBJECT_PATH = "/org/gnome/Shell/Extensions/TilingShell";

class DBus {
  _dbus;
  _nameId;
  constructor() {
    this._dbus = null;
    this._nameId = 0;
  }

  enable(ext) {
    if (this._dbus) return;
    this._dbus = Gio.DBusExportedObject.wrapJSObject(node, ext);
    this._dbus.export(
      Gio.DBus.session,
      TILING_SHELL_OBJECT_PATH
    );
    // Own a dedicated well-known name so that clients have a stable way to
    // reach the API. `ALLOW_REPLACEMENT` lets a newer instance of the
    // extension take the name over cleanly instead of failing.
    this._nameId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      TILING_SHELL_BUS_NAME,
      Gio.BusNameOwnerFlags.ALLOW_REPLACEMENT | Gio.BusNameOwnerFlags.REPLACE,
      null,
      null,
      null
    );
  }

  disable() {
    this._dbus?.flush();
    this._dbus?.unexport();
    this._dbus = null;
    if (this._nameId) {
      Gio.bus_unown_name(this._nameId);
      this._nameId = 0;
    }
  }
}

export {
  DBus as default,
  TILING_SHELL_BUS_NAME,
  TILING_SHELL_OBJECT_PATH
};
