/**
 * Single place where the preferences-side gettext helpers are imported.
 *
 * The preferences tool runs in its own process, separate from the shell,
 * and it must use the preferences resource
 * (`.../org/gnome/Shell/Extensions/js/extensions/prefs.js`) rather than
 * the shell resource used by `translations.js`. Keeping the two in
 * separate modules makes it impossible to accidentally mix them up.
 */
import {
  gettext,
  gettext as _,
  ngettext,
  pgettext
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export {
  gettext,
  _,
  ngettext,
  pgettext
};
