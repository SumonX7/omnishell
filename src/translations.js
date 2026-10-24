/**
 * Single place where the gettext helpers are imported.
 *
 * GNOME Shell and the preferences tool live in two different JavaScript
 * contexts, and each one exposes its own `gettext` resource:
 *
 *   - the shell side uses `.../org/gnome/shell/extensions/extension.js`
 *   - the preferences side uses `.../org/gnome/Shell/Extensions/js/extensions/prefs.js`
 *
 * Importing the shell resource from the preferences process (or the other
 * way round) throws at runtime, which is why the two used to be imported
 * from two different places with two different spellings. Everything now
 * goes through this module, which re-exports both variants under
 * unambiguous names.
 */

// Shell-side helpers.
import {
  gettext,
  gettext as _,
  ngettext,
  pgettext
} from "resource:///org/gnome/shell/extensions/extension.js";

export {
  gettext,
  _,
  ngettext,
  pgettext
};
