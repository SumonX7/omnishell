/**
 * Single place where the shell-side gettext helpers are imported.
 *
 * GNOME Shell and the preferences tool live in two different JavaScript
 * contexts, and each one exposes its own `gettext` resource:
 *
 *   - the shell side uses `.../org/gnome/shell/extensions/extension.js` (here)
 *   - the preferences side uses `.../org/gnome/Shell/Extensions/js/extensions/prefs.js` (prefsTranslations.js)
 *
 * Importing the shell resource from the preferences process (or the other
 * way round) throws at runtime. Shell-side code imports from this module,
 * while preferences code imports from `prefsTranslations.js`.
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
