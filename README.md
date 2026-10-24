# OmniShell — Tiling & Desktop Fusion for GNOME Shell

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Zero Telemetry](https://img.shields.io/badge/Telemetry-Zero%20%2F%20100%25%20Private-brightgreen.svg)](#privacy)
[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46%20--%2051%2B-orange.svg)](#)
[![Open Source](https://img.shields.io/badge/Open%20Source-%E2%99%A5-red.svg)](https://github.com/SumonX7/OmniShell)

A unified superpower GNOME Shell extension that seamlessly fuses **advanced automatic window tiling** with the native **Desktop Icons NG** engine. Terminals, browsers, and applications automatically tile side-by-side with customizable margins — while the desktop displays smooth, fully-featured desktop icons.

* **UUID:** `omnishell@spark.dev`
* **GNOME Shell:** 46, 47, 48, 49, 50, 51+
* **License:** GNU GPL-3.0-only (see [`LICENSE`](LICENSE))
* **Privacy:** 🛡️ 100% Free & Open Source, Zero Telemetry, No Tracking, Fully Offline.
* **Modified & Fusion Engineered by:** **Sumon Mahmud**

OmniShell is built upon two legendary upstream GNOME Shell extensions, maintaining full credit to their original authors:

| Upstream project | Author | What was taken |
| --- | --- | --- |
| [Tiling Shell](https://extensions.gnome.org/extension/3732/) | Domenico Ferraro | Tiling engine, layouts, snap assist, indicator and preferences |
| [DING](https://extensions.gnome.org/extension/560/) | Sergio Costas | Desktop-icons application, icon grid and D-Bus integration |

OmniShell is a *combined* work: the two code bases are merged, the D-Bus
names and GSettings schema IDs are project-owned (so a separately installed
upstream extension is never displaced), and a number of correctness and
packaging bugs were fixed. See [`REVIEW.md`](REVIEW.md) for the full
engineering review.

---

## Features

### Tiling

* **Static tiling** — a set of predefined layouts, cycled with a keyboard
  shortcut. Each layout is a tree of splits that can be edited
  interactively in the layout editor.
* **Dynamic tiling** — windows are placed automatically into a growing
  tree as they open. The tree splits the free space in half at every
  insertion, so a new terminal always lands in a sensible slot.
* **Auto-tiling** — the dynamic layout is applied automatically to
  newly opened windows. This is the feature that "just works" for
  terminals and file managers.
* **Move and resize** — dedicated keybindings for moving, resizing and
  swapping windows, plus edge tiling by dragging a window against a
  screen edge.
* **Snap assistant** — an overlay that shows the layout choices while a
  window is being dragged, with a live preview of the resulting tile.
* **Span multiple tiles** — a window can be told to occupy more than one
  tile of the layout.
* **Window suggestions** — the layouts can be offered as suggestions in
  the screen-edge, window-menu and snap-assistant contexts.

### Desktop icons

* Real desktop icons rendered on the background, with drag-and-drop,
  cut/copy/paste, renaming, and a context menu.
* The icon grid is integrated with the tiling engine, so the desktop
  reacts correctly when the screen layout changes.

### Everything else

* **Indicator menu** in the top bar for switching layouts and toggling
  features.
* **Per-application opt-out** — any application can be excluded from
  tiling (`tiling-excluded-apps`).
* **Configurable gaps, animation and border radius.**
* **Settings export/import** so a configuration can be moved between
  machines.
* **14 translations** (cs, de, es, fr, it, ka, nl, pl, pt_BR, ru, tr, uk,
  zh_CN, zh_TW).

---

## Installation

### ⚡ One-Line Automatic Install / Update (Recommended)

Run this single command in your terminal to automatically download the latest version, verify dependencies, install, and enable OmniShell:

```bash
curl -sSL https://raw.githubusercontent.com/SumonX7/OmniShell/main/install.sh | bash
```

*(Alternatively with wget: `wget -qO- https://raw.githubusercontent.com/SumonX7/OmniShell/main/install.sh | bash`)*

After installation, **Log out and log back in** (on Wayland) to load the new version into GNOME Shell.

---

### Method 2: Build & Install From Source

```bash
# First time install:
git clone https://github.com/SumonX7/OmniShell.git
cd OmniShell
make install

# Update existing repository to the latest release:
cd OmniShell
make update
```

---

### Method 3: Direct GNOME Extensions CLI

If you downloaded `omnishell@spark.dev.zip`:

```bash
gnome-extensions install --force omnishell@spark.dev.zip
gnome-extensions enable omnishell@spark.dev
```

---

## Development

### Layout of the tree

```
src/
  extension.js        the ExtensionBase subclass; enable()/disable()
  prefs.js            the ExtensionPreferences subclass
  translations.js     shell-side gettext helpers
  prefsTranslations.js preferences-side gettext helpers
  dbus.js             the extension's own D-Bus service
  keybindings.js      the keyboard shortcut model
  monitorDescription.js
  settings/           GSettings access, export/import, overrides
  components/         the tiling engine and the UI
    layout/           layout trees, tiles, pins, reflow
    tilingsystem/     the tiling manager and window placer
    snapassist/       the snap-assist overlay
    tilepreview/      the tile preview actors
    windowsSuggestions/
    editor/           the interactive layout editor
    ...
  app/                the desktop-icons (DING) application
  dingBridge/         the bridge between the shell and the DING app
  schemas/            the GSettings schemas
  locale/             the compiled gettext catalogues
po/                   the gettext template and the catalogue sources
```

### Common tasks

```bash
make check         # run the verification harnesses
make pot           # regenerate the .pot template and merge it
make catalogues    # recompile the .mo files from po/*.po
make clean         # remove the build artefacts
```

The harnesses are plain Node scripts with no dependencies, so they can also be run
individually:

```bash
node check_syntax.mjs              # syntax check every source file
node verify_fixes.mjs              # the fix checks
node verify_round2.mjs             # the SortOrder round-trip checks
node verify_perf.mjs               # the dynamic-layout cache checks
node verify_claims.mjs             # re-tests every original audit claim
```

All of them also run automatically in CI on every push and pull request —
see [`.github/workflows/ci.yml`](.github/workflows/ci.yml). The workflow also
builds the ZIP, validates the archive layout and uploads it as an artefact.

### Translating

1. Copy `po/tilingshell.pot` to `po/<your-locale>.po`.
2. Translate the `msgstr` entries.
3. Run `make catalogues` to compile them.
4. Open a pull request.

The `po/` directory holds the authoritative translation sources; the
compiled `src/locale/<lang>/LC_MESSAGES/tilingshell.mo` files are build
products.

---

## Troubleshooting

**The extension does not appear.**
Make sure the schemas were compiled:

```bash
glib-compile-schemas --strict ~/.local/share/gnome-shell/extensions/omnishell@spark.dev/schemas
```

**Auto-tiling does not happen for a new terminal.**
Check that *Enable auto tiling* and *Enable dynamic tiling* are both on in
the preferences, and that the application is not in the excluded list.
Also check for a conflicting extension — `tilingshell@ferrarodomenico.com`
and `ding@rastersoft.com` must be disabled.

If the journal shows

```
Settings schema 'org.gnome.shell.extensions.tilingshell' does not contain a key named 'enable-dynamic-tiling'
```

then a **stale copy** of the schema in `~/.local/share/glib-2.0/schemas/` is
shadowing the one that ships with the extension — GSettings searches the user
directory first. Re-run `make install`; the installer detects the stale copy,
replaces it and recompiles the directory.

```bash
# Check for yourself
gjs -c "imports.gi.versions.Gio='2.0'; \
  const s = new imports.gi.Gio.Settings({schema_id:'org.gnome.shell.extensions.tilingshell'}); \
  print(s.get_boolean('enable-dynamic-tiling'));"
```

**The extension does not load.**
Read the log:

```bash
journalctl --user -f | grep -i omnishell
```

**The icons are missing from the desktop.**
The desktop-icons feature needs `gjs` plus the GTK 4 and libadwaita
typelibs. The installer checks for them and warns if they are missing.

---

## Contributing

Issues and pull requests are welcome at
<https://github.com/SumonX7/omnishell>.

Please read [`REVIEW.md`](REVIEW.md) first — it documents the architecture,
the bugs that were found and fixed, and the areas that are still known to
need work.

## Credits

* **Domenico Ferraro** — Tiling Shell
* **Sergio Costas** — DING (Desktop Icons NG)
* **Sumon Mahmud** — OmniShell

Licensed under the GNU General Public License v3.0 only. The full text is
in [`LICENSE`](LICENSE).
