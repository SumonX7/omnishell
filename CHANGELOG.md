# Changelog

All notable changes to OmniShell are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-10-24

### Fixed
* **Fullscreen Priority in Dynamic Tiling**:
  * Fixed an issue where maximizing a window (via Maximize button, titlebar double-click, or `<Super>Up`) while dynamic tiling was active caused the window to immediately snap back into its tile slot within 40ms due to `WindowPlacer`'s geometry drift watcher.
  * Added `isMaximized` detection in `placementAdapter.js` and guarded `pending.disconnectGeometry` and drift watch in `windowPlacer.js` to immediately stop and forget placement when a window enters maximized state.
  * Preserved background layout memory: maximized windows are retained in dynamic slot tracking so other open windows retain their exact slot geometries without shifting.
  * Restoring / unmaximizing a window (via Unmaximize button, titlebar double-click, or `<Super>Down`) smoothly snaps the window back into its dynamic layout slot via idle reflow.
  * Added keyboard shortcuts in dynamic tiling: pressing `<Super>Up` at the top boundary maximizes the window, and pressing `<Super>Down` on a maximized window restores it back to dynamic tiling.
* **Preferences Footer Styling**:
  * Cleaned footer labels by removing raw `<small>` and `<b>` markup tags that were rendered literally due to Pango markup parsing limitations on unescaped ampersands.
  * Styled footer using native Libadwaita typography CSS classes (`title-4`, `dim-label`, `caption`).

## [1.0.1] - 2026-10-24

### Added
* **Desktop Icon Font Size Adjustment**: Added a responsive SpinButton in Preferences under Desktop Icons configuration allowing users to customize desktop icon label font sizes from 8pt to 24pt (default 11pt).
* **Zero Telemetry & 100% Privacy Guarantee**: Explicit zero telemetry design with local-only operations, no background analytics, network trackers, or metrics. Highlighted in preferences UI, metadata, and documentation.
* **Open Source & Author Attributions**: Prominently showcased the project's open source nature (GNU GPL-3.0) and acknowledged Domenico Ferraro (Tiling Shell) and Sergio Costas (DING) alongside modifier & engineer Sumon Mahmud.
* **Important Settings Enabled by Default**: Out-of-the-box experience now comes with `enable-dynamic-tiling` and `enable-autotiling` turned on by default in the GSettings schema.

### Fixed
* **Dynamic Window Margins & Gap Synchronization**:
  * Real-time listener for `inner-gaps` and `outer-gaps` in `tilingManager.js`: changing gap values in Preferences now immediately invalidates slot caches and reflows all currently managed windows on screen.
  * Memoised dynamic slots cache key (`_dynamicSlotsKey`) now factors in `Settings.INNER_GAPS` and `Settings.OUTER_GAPS` so stale geometries are never served.
* **Window Placement & Overlap Prevention (Race Condition Fix)**:
  * Newly created windows in `_dynamicAdd` now feature an idle fallback handler alongside `first-frame` to guarantee dynamic placement executes even if Wayland clients render buffers before the shell connects. Newly opened apps will never get stuck floating over or covering existing apps.
* **Desktop Launch / File Manager vs Dynamic Tiling Conflict**:
  * Fixed conflict where `MAXIMIZE_DESKTOP_OPEN` would execute `doMaximize()` multiple times while dynamic tiling was active, causing window fighting and unmaximizing jumps. Under dynamic tiling, newly opened windows cleanly tile into dynamic splits without full-screen collision.
* **Preferences Window Crash Fixes**:
  * Fixed `SyntaxError: The requested module '.../prefsTranslations.js' doesn't provide an export named: 'gettext'`.
  * Fixed `Error: Expected type string for argument 'accelerator' but got type undefined` in `prefs.js:1605` (`ShortcutSettingButton`).
  * Fixed missing window control buttons (Close, Minimize, Maximize) in the preferences dialog by setting `window.set_modal(false)` and configuring GTK decoration layout.
  * Cleaned up OS-specific strings in credits and preferences to maintain clean GNOME Shell focus.

## [1.0.0] - 2026-10-23

### Fixed — a stale schema could silently disable auto-tiling

* **Auto-tiling still did not work after the code fixes were deployed.**
  A copy of `org.gnome.shell.extensions.tilingshell.gschema.xml` left in
  `~/.local/share/glib-2.0/schemas/` by an earlier install **shadowed** the
  schema that ships with the extension, because GSettings searches the user
  directory first. Reading `enable-dynamic-tiling` then threw inside the
  settings accessor, which aborted the whole window-placement call chain —
  so a window opened and was never tiled, with no error on screen.
* **The installer now detects and repairs the shadowing.** It compares every
  schema the extension ships against the user-level copy and replaces a
  differing one, then recompiles that directory. The old upstream DING schema
  is moved aside to `…gschema.xml.disabled` so that it can never shadow the
  project's own DING schema. The system directory is left untouched — it
  needs root, and it is only consulted when the user directory does not
  provide the schema at all.
* The regression is guarded by the new `R2-SHADOW` check in
  `verify_fixes.mjs`.
* **`verify_claims.mjs` re-tests every claim from the original audit
  reports against the current source.** All 26 claims are now refuted —
  every real defect they identified has been fixed, and the ones that
  were never real have been correctly understood rather than "fixed" into
  a regression. It is now part of `make check` and of CI.

### Fixed — the preferences window

* **The preferences window could not be opened at all.** The
  excluded-apps row connected to a `"apply"` signal on a `Gtk.Entry`.
  `Gtk.Entry` has no such signal — it belongs to `GtkFileChooser` and
  friends — so the connection threw `No signal 'apply' on object
  'GtkEntry'` and aborted the construction of the whole window. The
  invalid connection was removed; only the `"changed"` signal is used
  now, which is what the row wants anyway.
* **The preferences window never unregistered its GResource bundle and
  CSS provider.** `Gio.resources_register()` fails for an
  already-registered path, so opening the preferences a second time
  lost the extension's icons.
* **The suffix order in the settings rows** was reversed, so "New
  Folder" sorted before "New File".
* **`Settings.destroy()` was called when the window closed**, nulling
  the shared `Gio.Settings` handle. `Settings.bind()` is a silent
  no-op on a null handle, so anything bound afterwards did nothing.
* **Several preference rows were one-way** — the widget and the setting
  did not stay in sync. They are now two-way through `changed::`
  signals.
* **The footer was not wrapped in `_()`**, so it was never translatable.

### Fixed — auto-tiling and the tiling engine

* **Auto-tiling now works for terminals and file managers.** A window that
  is maximised on the desktop was skipped by the tiling bookkeeping
  entirely, so the layout never learned about it and the next window had
  nowhere to go. The maximised window is now tracked properly and simply
  left without a tile.
* **Keyboard-initiated drags are now detected as moves.** `Meta.GrabOp`
  is a bit field, and `KEYBOARD_MOVING` (257) was being masked away by a
  hard-coded bitmask, so a window moved with the keyboard was never
  placed into a tile. The mask now strips the keyboard bit explicitly.
* **Pointer tracking is Wayland-safe.** `global.get_pointer()` is X11-only
  and does not exist on Wayland; the tiling code now goes through the
  pointer tracker, which works on both.
* **The empty-tile search uses the right workspace.** It looked the layout
  up on the *active* workspace instead of the window's own workspace, so
  windows on a background workspace were placed against the wrong layout.
* **Windows are now filtered by workspace explicitly** instead of relying
  on the shell's window list happening to be filtered already.
* **Swapping two windows no longer reshuffles the global window list.**
  The swap is applied to the arrangement of the affected workspace only.
* **The source rectangle's centre is computed from `source.y`**, not
  `source.x`, so the "move to neighbour" search started from the wrong
  place.
* **Negative rectangle sizes are clamped**, which previously produced
  invalid geometry that the shell rejected.
* **The reflow split slot is validated** against the number of windows,
  so an out-of-range slot can no longer produce a layout with a negative
  extent.
* **The layout tree clamps the first extent** so that the sibling extent
  can never become negative.
* **Duplicate pin paths are detected** and ignored instead of producing
  a corrupt layout.
* **Tile extents are derived from the rounded edges**, which removed
  off-by-one seams between adjacent tiles.
* **The suggestions layout is reused** between drops instead of being
  destroyed and rebuilt, which allocated a fresh set of preview actors
  and clones on every single drop.
* **The drift watch is bounded.** A client that changed its own geometry
  re-armed a ten-second watch forever and kept the placer permanently
  busy. The retry budget is now a separate, capped counter.
* **The dynamic layout is no longer rebuilt on every drag tick.** The
  arrangement was recomputed from scratch every 15 ms, including a
  second layout tree inside the pin pass. The result is now memoised
  per workspace and invalidated only when something that affects it
  actually changes.
* **Sub-pixel slivers are dropped** when a rectangle is subtracted, so no
  fractional tiles are produced.
* **The snap assistant re-centres itself** against the container's
  current width instead of a stale one.
* **The snap assistant always resets its state** when it closes, so it no
  longer stays logically enlarged while hidden.
* **A destroyed tile preview is never destroyed a second time.**

### Fixed — the desktop-icons bridge

* **The extension no longer claims upstream DING's bus name or schema
  ID.** It uses `com.spark.omnishell.*` and
  `org.gnome.shell.extensions.omnishell.ding`, so a separately installed
  upstream DING keeps working.
* **The "open desktop icon settings" action is now reachable.** The
  action group existed but was never exported on the bus, so the button
  failed silently.
* **Window type is no longer decided by the window title alone.** A
  window whose title started with `Desktop Icons ` was treated as the
  desktop; the client is now checked as well.
* **The managed-window registry uses a `WeakMap`** instead of
  monkey-patching a `customJS_ding` property onto the window object.
* **The bridge is no longer published as a plain global string**; it is
  reached through a symbol-keyed accessor.
* **The subprocess watchdog has an exponential backoff and a retry cap**,
  so a failing DING process cannot spin.
* **The per-monitor scale factor is used** instead of the stage-global
  one, so a secondary monitor with a different scale is laid out
  correctly.

### Fixed — settings and preferences

* **The sort-order setting round-trips correctly.** The GSettings enum
  nicks are upper-case and case-sensitive, but the values were
  lower-case, so the setting silently fell back to the default. The
  ordinal that `Gio.Settings.set_enum()` receives is now derived from
  the schema's own numbering.
* **The typed settings accessors use the right getters** (`get_int64`,
  `get_uint`) and the activation-key parser falls back to the schema
  default instead of returning `NaN`.
* **Migrations run exactly once**, guarded by a dedicated settings key,
  and the shortcut migration maps the array entry by entry instead of
  interpolating it into a string.
* **The behaviour group is added to the preferences page once.**
* **The dynamic-layout shortcuts are editable** in the preferences.
* **Shortcut array access is guarded** against an empty array.
* **`restoreToDefault()` resets the keys** instead of writing hard-coded
  `false` values over the user's configuration.
* **The preferences window unregisters its GResource bundle and CSS
  provider when it closes**, so opening the preferences a second time
  still loads the icons.
* **The gettext domain is `tilingshell` everywhere.** The `app/` code
  used the `ding` domain, for which no catalogue exists, so it was
  permanently English-only.
* **The shell-side and preferences-side gettext helpers are imported
  from two clearly separated modules**, so the two GNOME APIs can no
  longer be mixed up.

### Added

* **Applications can be excluded from tiling** through the
  `tiling-excluded-apps` setting and the preferences window.
* **A gettext template (`po/tilingshell.pot`) and the per-language `.po`
  sources** are shipped, so the translation catalogues can be regenerated
  and contributed to.
* **`po/update-pot.sh` and `po/compile-catalogues.sh`** automate the
  translation workflow.
* **A `Makefile`** with `build`, `schemas`, `resources`, `catalogues`,
  `pot`, `install`, `check` and `clean` targets.
* **A `LICENSE` file** (GPL-3.0-only), a `README.md` and this changelog.
* **`resources.gresource.xml`**, so the resource bundle is built from
  source instead of being a binary blob.
* **The edge-tiling icons are shipped as SVG sources** under
  `src/icons/scalable/actions/`.
* **A GitHub Actions CI workflow** (`.github/workflows/ci.yml`) that runs the
  syntax check, the schema compilation, the three verification harnesses, the
  GResource build, the catalogue compilation and `make build` on every push,
  validates the resulting archive and uploads it as an artefact.

### Changed

* **The GResource prefix is now project-owned**
  (`/com/spark/omnishell` instead of the upstream
  `/org/gnome/Shell/Extensions/tilingshell`), so two extensions can no
  longer fight over the same resource path.
* **The installer** validates the archive layout and its integrity,
  checks for `gjs` and the GTK 4 / libadwaita typelibs, compiles the
  schemas with `--strict`, and prints session-appropriate reload
  instructions (Wayland versus X11) in English.
* **The orphaned `app/meson.build`** was removed; it referred to a root
  `meson.build` that does not exist and was never used by the ZIP
  installer.

## [1.0.0]

* Initial merged release of Tiling Shell and Desktop Icons NG.
