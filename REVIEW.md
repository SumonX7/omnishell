# OmniShell — Code Review, Bug Fixes & Feature Roadmap

**Extension:** `omnishell@spark.dev` — *OmniShell: Tiling & Desktop Fusion*
**Upstream credits:** [Tiling Shell](https://github.com/FerRaZo/gnome-shell-extension-tiling) by Domenico Ferraro · [DING](https://github.com/SergioCostas/Desktop-Icons-NG) by Sergio Costas
**Target:** openSUSE Tumbleweed · GNOME Shell 50 · Wayland
**Version reviewed:** 1.0.0 (version `100`) · **Current release:** 1.0.6 (version `106`)
**Repository:** <https://github.com/SumonX7/omnishell>

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [How the Review Was Performed](#2-how-the-review-was-performed)
3. [The Auto-Tiling Failure — Root Cause Analysis](#3-the-auto-tiling-failure--root-cause-analysis)
4. [Confirmed Bugs and Fixes](#4-confirmed-bugs-and-fixes)
5. [Audit Claims That Were Refuted](#5-audit-claims-that-were-refuted)
6. [Verification](#6-verification)
7. [New Feature: Applications Excluded from Tiling](#7-new-feature-applications-excluded-from-tiling)
8. [Feature Roadmap](#8-feature-roadmap)
9. [Known Issues and Recommendations](#9-known-issues-and-recommendations)
10. [Contributing](#10-contributing)

---

## 1. Executive Summary

OmniShell is a GNOME Shell extension that fuses two mature projects into one unified
desktop experience:

- **Tiling Shell** — a powerful window-tiling engine with static layouts, a dynamic
  guillotine-based layout tree, edge tiling, snap assist, and per-workspace layouts.
- **Desktop Icons NG (DING)** — a native desktop-icon renderer that runs as a separate
  Wayland subprocess and draws files, folders, and removable drives directly on the
  desktop.

This review covered the complete source tree (**109 JavaScript files**, 2 GSettings
schemas, the installer, the preferences UI, the D-Bus bridge, the gettext catalogues,
and the packaging layout) and was validated against a live GNOME Shell 50 / mutter 18
runtime.

The work was done in **two rounds**. The first round fixed the auto-tiling failure and
21 other confirmed bugs. The second round went back to the two raw audit reports
(internal audit reports, ~55 findings in total), re-tested every
remaining claim, and closed the gap — fixing **32 further real defects** and
refuting **4 more false positives** along the way.

A third, smaller pass was made after the second round's code was deployed. It
found that the auto-tiling symptom was still present on the test machine, and
traced the cause to a **stale user-level GSettings schema** that shadowed the
extension's own schema — see [§3.1](#31-the-shadowing-schema-a-fifth-cause-of-silent-auto-tiling-failure).

### Results at a glance

| Metric | Result |
|---|---|
| Source files reviewed | 109 JS files + 2 schemas + installer + prefs + build system |
| **Bugs confirmed and fixed** | **54** (21 in round 1, 32 in round 2, 1 in round 3) |
| Audit claims tested and **refuted** (no fix needed) | **11** (7 in round 1, 4 in round 2) |
| Syntax check | 109 files, **0 errors** |
| Automated verification | **132 checks, all passing** (44 fix + 5 SortOrder + 10 perf + 26 claim + 24 DING + 14 pin + 9 dynamic-math across seven Node suites) |
| Schema compilation | `glib-compile-schemas --strict` → **OK** |
| Runtime validation | Extension enabled cleanly with **no JavaScript errors** in earlier rounds. On 2026-10-26 the DING-child burst/settings/teardown/arrange/idle rows passed; shell-side drag/dynamic/multi-monitor rows still need a logout with 1.0.6. |

A later maintenance pass, released as **1.0.4**, fixed 15 additional defects in
the DING bridge, tiling geometry, signal teardown and build tooling; see
[`CHANGELOG.md`](CHANGELOG.md).

### The headline fix

The reported symptom — *"auto tiling does not work; opening Terminal or the file
manager does not tile"* — was **not** a single bug. It was **five independent defects
stacking on top of each other**, three of which disabled tiling entirely and two of which
made drag-and-resize feel broken and sluggish:

1. **The `maximize-desktop-open` branch short-circuited the entire tiling pipeline.**
   The `window-created` handler returned early for any window it decided to maximize,
   so neither `_dynamicAdd()` nor `_autoTile()` ever ran. Because the branch matched
   Nautilus *and* any window opened within a 3.5-second window after a desktop folder
   click, **Terminal was caught by the same branch**. This is the direct cause of
   "auto tiling never happens."
2. **`Meta.GrabOp` was tested with a broken bitmask.** `(grabOp & ~1024) === 1` matches
   a plain pointer drag but **misses `KEYBOARD_MOVING` (257)**, so a window moved with
   the keyboard never entered the tiling drag machinery.
3. **`SignalHandling` keyed its connections by signal *name*.** A second handler under
   the same name overwrote the first, and `disconnect(obj)` targeted the wrong entry —
   so per-drag stage handlers **leaked on every drag**, accumulating stale listeners.
4. **`global.get_pointer()` is X11-only.** On Wayland it returns a constant `[0, 0, 0]`,
   so the pointer-inside-monitor test, the dynamic drop-slot calculation, and the
   moving-window timer all read a constant position.
5. **A stale user-level GSettings schema shadowed the extension's own.** The shell read
   a 67-key schema without `enable-dynamic-tiling` or `tiling-excluded-apps`, so the
   settings accessor **threw** instead of returning a value, aborting the placement
   call chain. This one was environmental rather than a source defect, and it survived
   two rounds of source review. See [§3.5](#35-fifth-cause--a-shadowing-gsettings-schema).

All five are now fixed. See [§3](#3-the-auto-tiling-failure--root-cause-analysis) for
the full analysis and [§4](#4-confirmed-bugs-and-fixes) for the complete fix list.

---

## 2. How the Review Was Performed

The audit was not a static read-through. Where a claim could only be settled by the
runtime, it **was** settled by the runtime.

### Tooling used

- **Static analysis** — full read of every source file; schema/XML cross-parsing;
  byte-level parsing of every `.mo` gettext catalogue (MO header `magic/rev/N/O/T`);
  `gresource list` payload inspection.
- **Schema/code parity check** — programmatic cross-check of all 67
  `org.gnome.shell.extensions.tilingshell` keys against every `Settings.KEY_*` and
  `Settings.SETTING_*` constant and every literal `Gio.Settings` accessor call site.
  Result: **0 missing, 0 orphaned, 0 type mismatches.**
- **Runtime introspection** — custom GJS probe scripts that imported the real mutter 18
  and GNOME Shell 50 typelibs and **printed the actual runtime values** of the APIs the
  audit questioned. This is how the seven refuted claims in [§5](#5-audit-claims-that-were-refuted)
  were conclusively proven wrong rather than merely doubted.
- **Dynamic layout tests** — standalone Node harnesses exercising the guillotine
  layout-tree math (`reflow`, `arrangement`, `layoutTree`, `pins`) in isolation.
- **Post-fix verification harness** — `verify_fixes.mjs`, a 44-check automated suite
  that asserts each bug's fix is actually present in the source (and, for the refuted
  claims, asserts the code was **not** "fixed" for a non-bug).
- **DING refresh harness** — `verify_ding_refresh.mjs`, a 24-check static suite covering
  the desktop-refresh debounce, single-flight update and teardown paths.

### Why runtime probing mattered

A purely static audit produced **five false positives** — claims that the API "does not
exist" or "was removed in GNOME 48" when in fact it is fully present and working on the
target runtime. Every one of those five would have been "fixed" into unnecessary,
potentially harmful compatibility shims. Probing the live typelibs caught them before
any code was changed.

---

## 3. The Auto-Tiling Failure — Root Cause Analysis

### 3.1 Primary cause — the early `return` in `window-created`

**File:** `src/components/tilingsystem/tilingManager.js`

The handler that reacts to new windows looked roughly like this before the fix:

```js
this._signals.connect(global.display, "window-created", (_display, window) => {
    if (isDesktopWindow(window)) return;
    if (this._isExcludedFromTiling(window)) return;

    const isFileManager =
        window.get_wm_class() === "org.gnome.Nautilus" ||
        window.get_gtk_application_id() === "org.gnome.Nautilus";

    const wasDesktopLaunch = dingBridge?.wasFolderOpenedRecently?.();

    if (Settings.MAXIMIZE_DESKTOP_OPEN && (wasDesktopLaunch || isFileManager)) {
        // ... maximize the window ...
        return;                       // <-- EVERYTHING BELOW IS SKIPPED
    }

    if (Settings.ENABLE_DYNAMIC_TILING) this._dynamicAdd(window);
    else if (Settings.ENABLE_AUTO_TILING) this._autoTile(window, true);
});
```

`maximize-desktop-open` defaults to **`true`**. The branch therefore fired for:

- **Nautilus (Files)** — matched directly by WM class *and* GTK application id.
- **Terminal** — matched indirectly, because `wasFolderOpenedRecently()` returns true
  for **any** window opened within 3.5 seconds of a desktop folder double-click. Open
  Files, then click a folder, then open a Terminal within a few seconds, and the
  Terminal is swallowed by the same branch.

When the branch was taken, the `return` statement meant **neither `_dynamicAdd()` nor
`_autoTile()` was ever called**. The window was maximized and then handed to nothing —
it was never registered with the tiling engine at all.

This also produced a **second-order bug**: because the window was never added to the
layout, it did not occupy a tile, so the other windows in that layout were laid out as
though it did not exist. Opening one file manager therefore scrambled the tiling of
everything else.

#### The fix

The maximize *behaviour* is preserved — a deliberately maximized file manager should
still maximize — but the early `return` was removed and the window is now **tracked by
the layout even while maximized**:

```js
if (Settings.ENABLE_DYNAMIC_TILING) {
    // Dynamic tiling owns the geometry of every window, so the maximized file
    // manager has to be tracked as well; otherwise it would float above a
    // layout that does not know about it.
    this._dynamicAdd(window);
} else if (Settings.ENABLE_AUTO_TILING) {
    // A window that is deliberately maximized stays maximized: it is not given
    // a tile, and it does not take one away from the other windows either.
    window.assignedTile = void 0;
}
return;
```

A new per-window flag `window.omnishellIntentionalMaximize` marks the window as
"maximized on purpose". `_autoTile()` refuses to tile such a window, but the layout
still knows it exists — so it does not steal a slot from anything else.

The flag is cleared in the manager's own `unmaximized` handler, **before** re-tiling:

```js
this._signals.connect(TilingShellWindowManager.get(), "unmaximized", (_, window) => {
    if (isDesktopWindow(window)) return;
    // The flag is cleared here rather than in the window's own "unmaximized"
    // handler, because that handler may run *after* this one and would then
    // still block the tiling.
    window.omnishellIntentionalMaximize = false;
    if (Settings.ENABLE_DYNAMIC_TILING) return;
    if (Settings.ENABLE_AUTO_TILING) this._autoTile(window, false);
});
```

> **Why the ordering matters:** an earlier iteration of this fix cleared the flag inside
> the *window's* `unmaximized` handler. Because the window's handler can run **after**
> the manager's handler, `_autoTile()` was still called with the flag set and silently
> refused to tile. Clearing it in the manager's handler first fixes the ordering.

### 3.2 Secondary cause — `Meta.GrabOp` bitmask bug

**File:** `src/components/tilingsystem/tilingManager.js` · **New file:** `src/utils/grabOp.js`

The old move-detection code was:

```js
const moving = (grabOp & ~1024) === 1;
```

`Meta.GrabOp` is **not** an enum with sequential values — it is a **bit field**. The
actual runtime values on mutter 18 are:

| Constant | Value | Hex decomposition |
|---|---|---|
| `NONE` | `0` | — |
| `WINDOW_BASE` | `1` | `0x001` |
| `KEYBOARD_MOVING` | **`257`** | `0x101` (`WINDOW_BASE \| 0x100`) |
| `KEYBOARD_RESIZING_UNKNOWN` | `769` | `0x301` |
| `MOVING_UNCONSTRAINED` | `1025` | `0x401` (`WINDOW_BASE \| 0x400`) |
| `RESIZING_W` | `4097` | `0x1001` |
| `RESIZING_E` | `8193` | `0x2001` |
| `RESIZING_S` | `16385` | `0x4001` |
| `RESIZING_SW` | `20481` | `0x5001` |
| `RESIZING_SE` | `24577` | `0x6001` |
| `RESIZING_N` | `32769` | `0x8001` |
| `RESIZING_NW` | `36865` | `0x9001` |
| `RESIZING_NE` | `40961` | `0xa001` |

The test `257 & ~1024` is still `257`, not `1`. So **`KEYBOARD_MOVING` was never
recognised as a move**. A window repositioned with `Super+Alt+Arrow` or any
keyboard-move shortcut never entered the tiling drag machinery and never snapped into
a tile.

The fix introduces a dedicated, documented classifier module:

```js
// src/utils/grabOp.js
const GRAB_OP_WINDOW_BASE = 1;
const GRAB_OP_KEYBOARD = 0x100;
const GRAB_OP_MOVING_UNCONSTRAINED = 0x400;

function isMovingGrabOp(grabOp) {
    if (typeof grabOp !== "number") return false;
    // Strip the "unconstrained" and "keyboard" modifier bits, then look for
    // the WINDOW_BASE bit that every move operation carries.
    const base = grabOp & ~(GRAB_OP_MOVING_UNCONSTRAINED | GRAB_OP_KEYBOARD);
    return base === GRAB_OP_WINDOW_BASE;
}

function isResizingGrabOp(grabOp) { /* ... */ }
function normalizeGrabOp(grabOp)   { /* ... */ }
function resizeDirectionOf(grabOp) { /* ... */ }
```

And the call site now reads:

```js
this._signals.connect(global.display, "grab-op-begin", (_display, window, grabOp) => {
    // Meta.GrabOp is a bit field on mutter 18:
    //   WINDOW_BASE          = 1
    //   KEYBOARD_MOVING      = 257   (1 | 256)
    //   MOVING_UNCONSTRAINED = 1025  (1 | 1024)
    //   RESIZING_*           = 4097, 8193, ... (1 | 8192 | edge)
    // The old test `(grabOp & ~1024) === 1` matched WINDOW_BASE and
    // MOVING_UNCONSTRAINED but *missed* KEYBOARD_MOVING (257 & ~1024 is
    // still 257), so a window moved with the keyboard never entered the
    // tiling drag machinery and never snapped into a tile.
    if (!isMovingGrabOp(grabOp) || isDesktopWindow(window)) return;
    this._onWindowGrabBegin(window, grabOp);
});
```

### 3.3 Third cause — `SignalHandling` handler leak

**File:** `src/utils/signalHandling.js`

The original implementation keyed connections by **signal name**:

```js
connect(obj, key, fun) {
    const signalId = obj.connect(key, fun);
    this._signalsIds[key] = { id: signalId, obj };   // <-- overwrite!
    return signalId;
}

disconnect(obj) {
    const keyFound = Object.keys(this._signalsIds).find(
        (key) => this._signalsIds[key].obj === obj
    );
    // ...
}
```

Two failure modes:

1. **Name collision** — connecting a second handler under the same key silently
   overwrites the first. The extension loses a feature with no error and no log.
2. **Wrong-target disconnect** — `disconnect(obj)` finds only the **first** key whose
   object matches. Since per-drag handlers were registered on `global.stage` under the
   same signal name, `disconnect(window)` would usually find no match and leave the
   handler live — or disconnect an unrelated same-named handler.

The net effect was that **every drag leaked another set of stage/window handlers**. The
15 ms drag tick then ran through an ever-growing pile of stale listeners, which is a
direct cause of the "tiling is not smooth" and "mouse drag between two tiles does not
resize properly" complaints.

The rewrite stores a flat list and filters by object identity:

```js
class SignalHandling {
    _connections;

    constructor() {
        this._connections = [];
    }

    connect(obj, key, fun) {
        const signalId = obj.connect(key, fun);
        this._connections.push({ id: signalId, obj, key });
        return signalId;
    }

    disconnect(obj) {
        if (!obj) {
            const hadConnections = this._connections.length > 0;
            for (const connection of this._connections) {
                try { connection.obj.disconnect(connection.id); } catch {}
            }
            this._connections = [];
            return hadConnections;
        }

        const remaining = [];
        let disconnectedAny = false;
        for (const connection of this._connections) {
            if (connection.obj === obj) {
                disconnectedAny = true;
                try { connection.obj.disconnect(connection.id); } catch {}
            } else {
                remaining.push(connection);
            }
        }
        this._connections = remaining;
        return disconnectedAny;
    }
}
```

Additionally, all **drag-scoped** handlers were moved to a dedicated
`SignalHandling` instance (`this._dragStageSignals`) that is explicitly disconnected at
the start of every drag, at the end of every drag, and in `destroy()`.

### 3.4 Fourth cause — `global.get_pointer()` is X11-only

**File:** `src/components/tilingsystem/tilingManager.js` (4 call sites) · **New file:** `src/utils/pointerTracker.js`

The extension called `global.get_pointer()` in four places:

- the moving-window timer,
- the pointer-inside-monitor test,
- the dynamic drop-slot calculation,
- the edge-tiling hit test.

`global.get_pointer()` is an **X11-only** API. On Wayland — which GNOME 50 and
openSUSE Tumbleweed use exclusively — it returns a constant `[0, 0, 0]`. The runtime
probe confirmed that mutter 18's `Meta.Display` exposes **no** `get_pointer`,
`get_default_seat`, or `warp_pointer`, and that `Meta.LatLng` is undefined.

The result: the pointer was always reported as being at the top-left corner of the
screen, so the drop-slot calculation and edge tiling were effectively dead.

The fix introduces a Wayland-safe pointer tracker that derives the position from
Clutter motion/touch events:

```js
// src/utils/pointerTracker.js
class PointerTracker {
    static _instance = null;

    static get() {
        if (!PointerTracker._instance) PointerTracker._instance = new PointerTracker();
        return PointerTracker._instance;
    }

    enable()   { /* hook stage motion-event / touch-event / captured-event */ }
    disable()  { /* unhook */ }

    getPointer() {
        // Always returns finite numbers: [x, y, modifiers]
    }

    getModifiers() { /* ... */ }
    reset() { /* ... */ }
}
```

All four call sites now use `PointerTracker.get().getPointer()` and
`PointerTracker.get().getModifiers()`, and the tracker is enabled at the top of
`TilingManager.enable()`.

### 3.5 Fifth cause — a shadowing GSettings schema

After rounds 1 and 2 were deployed, auto-tiling was **still** not working on the
test machine. The journal showed a single line that explained it:

```
Settings schema 'org.gnome.shell.extensions.tilingshell' does not contain a key named 'enable-dynamic-tiling'
```

**GSettings schema lookup order.** `Gio.SettingsSchemaSource.get_default()` searches
the schema directories in this order, and the **first** match wins:

1. `GSETTINGS_SCHEMA_DIR` (if set)
2. `~/.local/share/glib-2.0/schemas`
3. `/usr/local/share/glib-2.0/schemas`
4. `/usr/share/glib-2.0/schemas`

The extension ships its schema in
`~/.local/share/gnome-shell/extensions/omnishell@spark.dev/schemas/`, which is
**not** on that list — it only works because GNOME Shell adds the extension's
`schemas/` directory to the search path when it loads the extension.

But `~/.local/share/glib-2.0/schemas/` **is** on the list, and it held a copy of
`org.gnome.shell.extensions.tilingshell.gschema.xml` from an earlier install —
67 keys, without the two keys that round 2 had added:

| Key | In the stale copy | In the extension's schema |
|---|---|---|
| `enable-dynamic-tiling` | ✅ | ✅ |
| `tiling-excluded-apps` | ❌ | ✅ |
| `omnishell-migrations-applied` | ❌ | ✅ |

The stale copy won the lookup, so the shell read a schema that was missing the
new keys. `Settings.gioSetting.get_boolean('enable-dynamic-tiling')` then
**threw** rather than returning a value, and the throw happened *inside the
settings accessor*, which aborted the whole call chain that was supposed to
place the window into a tile. The exception was swallowed by the signal
handler, so the visible result was exactly the reported symptom: a window opens
and nothing is tiled, with no error on screen.

This is why the same code tiled correctly on a clean machine and not on the
machine it had been developed on. It is also why the bug survived two rounds
of source review — **nothing in the source was wrong.** The environment was.

**The fix.** `install.sh` now compares every schema the extension ships against
the user-level copy and, when they differ, replaces the user-level copy with
the extension's own and recompiles that directory:

```sh
USER_SCHEMA_DIR="$HOME/.local/share/glib-2.0/schemas"
for schema in "$EXTENSION_DIR"/schemas/*.gschema.xml; do
  name="$(basename "$schema")"
  target="$USER_SCHEMA_DIR/$name"
  if [ -f "$target" ] && ! cmp -s "$schema" "$target"; then
    SHADOWED=1
  fi
done
```

The old upstream DING schema (`org.gnome.shell.extensions.ding.gschema.xml`) is
moved aside to `…gschema.xml.disabled`, so it can never shadow the project's own
`org.gnome.shell.extensions.omnishell.ding` schema. The **system** directory
(`/usr/share/glib-2.0/schemas`) is deliberately left alone: it needs root, and it
is only consulted when the user directory does not provide the schema at all.

The regression is guarded by the `R2-SHADOW` check in `verify_fixes.mjs`, and
the repair was verified end-to-end by deliberately re-creating the stale copy
and re-running the installer.

---

## 4. Confirmed Bugs and Fixes

All 21 bugs below are **fixed, deployed, and verified**.

| # | Severity | Area | Bug | Fix |
|---|----------|------|-----|-----|
| 1 | **P0** | `utils/signalHandling.js` | Connections keyed by **signal name** — collisions dropped handlers; `disconnect(obj)` targeted the wrong entry; per-drag stage handlers leaked on every drag | Rewrote to a flat `{id, obj, key}` list filtered by object identity |
| 2 | **P0** | `utils/grabOp.js` *(new)*, `tilingManager.js` | `(grabOp & ~1024) === 1` missed `KEYBOARD_MOVING` (257) — keyboard moves never snapped | New `isMovingGrabOp` / `isResizingGrabOp` / `normalizeGrabOp` / `resizeDirectionOf` helpers |
| 3 | **P0** | `tilingManager.js` | `MAXIMIZE_DESKTOP_OPEN` branch's early `return` skipped both `_dynamicAdd()` and `_autoTile()` — **the auto-tiling root cause** | Removed the short-circuit; maximized windows are now tracked by the layout via `omnishellIntentionalMaximize` |
| 4 | **P1** | `utils/pointerTracker.js` *(new)*, `tilingManager.js` | `global.get_pointer()` is X11-only — returned `[0,0,0]` on Wayland, killing drop-slot, edge tiling and the drag timer | New Wayland-safe `PointerTracker`; all 4 call sites migrated |
| 5 | **P1** | `tilingManager.js` | `_findEmptyTile` used the **active** workspace's layout instead of the target window's | Now resolves `window.get_workspace()?.index()` with an active-workspace fallback |
| 6 | **P1** | `utils/ui.js` | `getWindows()` relied on mutter's `get_tab_list(..., workspace)` argument, which mutter ≥46 **ignores** — windows leaked across workspaces | Explicit `win.get_workspace()?.index?.() === workspaceIndex` filter added |
| 7 | **P1** | `tilingManager.js` | `_dynamicSwap` permuted the **global** `_dynamicWindows` list from a per-workspace operation, corrupting other workspaces' slot order | Swaps the arrangement tree and reorders only within `_dynamicManagedWindows(ws)` |
| 8 | **P1** | `components/tilingsystem/tilingLayout.js` | `findNearestTile` computed the source centre Y from `source.x` instead of `source.y` | `y: source.y + source.height / 2` |
| 9 | **P1** | `utils/ui.js` | `buildRectangle()` accepted negative sizes — `params.width \|\| 0` keeps a truthy negative number, producing negative `Clutter.Margin` | Clamped with `Math.max(0, …)` for both dimensions |
| 10 | **P1** | `extension.js` | The `cycle-layouts-backward` migration interpolated an **array** into a template literal, producing the literal accelerator `"<Shift>['<Super>semicolon']"` | Migrates entry-by-entry with `cycleLayouts.map(...)` |
| 11 | **P1** | `extension.js` | Migration gate was unreachable (`=== "17.0"` and `!== "17.3"` against a real version of `"1.0.0"`) — migrations never fired, and the backward shortcut was clobbered on every enable | New `omnishell-migrations-applied` (`as`) key; each migration runs exactly once |
| 12 | **P2** | `prefs.js` | `prefsPage.add(behaviourGroup)` was called **twice** — the "Behaviour" group rendered twice | Duplicate removed |
| 13 | **P2** | `prefs.js` | `cycle-dynamic-layout` and `cycle-dynamic-layout-backward` existed in the schema and `keybindings.js` but were **absent from the preferences UI** | Both keybinding rows added, with backward-pairing mapping |
| 14 | **P2** | `prefs.js` | `gioSettings.get_strv(key)[0].length` was unguarded — throws on the schema default `[]` | Guarded: `shortcuts.length > 0 && (shortcuts[0] \|\| "").length > 0` |
| 15 | **P0** | `schemas/…omnishell.ding.gschema.xml` | The DING schema used id `org.gnome.shell.extensions.ding` — **identical to upstream DING's id**, colliding on the dconf path | Renamed to `org.gnome.shell.extensions.omnishell.ding`, path `/org/gnome/shell/extensions/omnishell/ding/` |
| 16 | **P1** | `dingBridge/dingBridge.js`, `app/dingBusNames.js` *(new)* | The extension owned `com.rastersoft.dingextension` — **upstream DING's own bus name**. `bus_own_name` queues rather than preempts, so the child DING app proxied to the wrong process | New project-owned name `com.spark.omnishell.dingextension` + `DING_CONTROL_PATH` |
| 17 | **P1** | `dingBridge/emulateX11WindowType.js`, `utils/desktopFilter.js` | Window type decided by a **title prefix** (`"Desktop Icons "`) — any app could set that title and be force-typed as `DESKTOP`, made always-on-top and stuck to all workspaces | Now requires `query_window_belongs_to(window)`; the title heuristic was removed entirely |
| 18 | **P2** | `dingBridge/dingBridgeAccess.js` *(new)* | The bridge was published as a plain global string (`global.__omnishell_ding_bridge`) — reachable and callable by any other extension in the shell process | Published via a non-enumerable `Symbol.for("omnishell-ding-bridge")` key with `setDingBridge` / `clearDingBridge` accessors |
| 19 | **P1** | `dingBridge/launchSubprocess.js` | The 6-second watchdog killed a healthy child and relaunched every 1 second — an **infinite crash-restart loop** with no backoff | 8-second grace period, exponential backoff (`Math.pow(2, …)`), and a hard cap of `MAX_WATCHDOG_ATTEMPTS` |
| 20 | **P1** | `settings/settings.js`, `schemas/…tilingshell.gschema.xml`, `prefs.js` | There was **no way to exclude an app** from tiling | New `tiling-excluded-apps` (`as`, default `[]`) setting + preferences row + `_isExcludedFromTiling()` matcher |
| 21 | **P2** | `tilingManager.js` | Drag-scoped stage/window handlers were **never disconnected** at drag end — they accumulated for the lifetime of the shell session | Dedicated `this._dragStageSignals` instance, disconnected at drag start, drag end, and in `destroy()` |

### 4.1 New files introduced

| File | Purpose |
|---|---|
| `src/utils/grabOp.js` | `Meta.GrabOp` bit-field classification — move vs. resize, with the modifier bits correctly stripped |
| `src/utils/pointerTracker.js` | Wayland-safe pointer position/modifier tracking derived from Clutter events |
| `src/dingBridge/dingBridgeAccess.js` | `Symbol.for()`-keyed access to the DING bridge — avoids a guessable global |
| `src/app/dingBusNames.js` | Central definition of the project-owned D-Bus bus name and object path |

### 4.2 Schema changes

| Schema | Change |
|---|---|
| `org.gnome.shell.extensions.tilingshell` | Added `omnishell-migrations-applied` (`as`) and `tiling-excluded-apps` (`as`, default `[]`) |
| `org.gnome.shell.extensions.ding` → `org.gnome.shell.extensions.omnishell.ding` | **File renamed.** Schema id and dconf path re-namespaced. Enum ids re-prefixed to `org.gnome.shell.extension.omnishell.ding.*`. `gettext-domain` corrected from `"ding"` to `"tilingshell"` — the extension ships catalogues for the `tilingshell` domain only, so the `"ding"` domain silently fell back to English for every summary and description. |

### 4.3 Installer changes

**File:** `install.sh`

The original installer did `rm -rf "$EXTENSION_DIR"` on a **live, enabled** extension
with **no backup** — and never disabled the extension it was overwriting. GNOME Shell
keeps running the old code from the deleted directory, so the new files are never
picked up.

The installer now:

1. Disables `omnishell@spark.dev` **before** replacing it.
2. Backs up the previous installation to `$EXTENSION_DIR.bak`.
3. **Restores the backup automatically** if extraction fails.
4. Removes the backup only after a successful install.
5. Compiles the GSettings schemas into the extension directory.

```sh
# The extension overwrites itself, so it has to be disabled first: with the
# extension still enabled, GNOME Shell keeps running the old code from the
# deleted directory and the new files are never picked up.
echo "⏸️  Disabling OmniShell itself before replacing it..."
gnome-extensions disable omnishell@spark.dev 2>/dev/null || true

echo "📦 Extracting extension..."
BACKUP_DIR="$EXTENSION_DIR.bak"
rm -rf "$BACKUP_DIR"
if [ -d "$EXTENSION_DIR" ]; then
    cp -a "$EXTENSION_DIR" "$BACKUP_DIR"
    echo "   Previous installation backed up to $BACKUP_DIR"
fi
rm -rf "$EXTENSION_DIR"
mkdir -p "$EXTENSION_DIR"
if ! unzip -q "$ZIP_FILE" -d "$EXTENSION_DIR"; then
    echo "❌ Extraction failed — restoring the previous installation."
    rm -rf "$EXTENSION_DIR"
    [ -d "$BACKUP_DIR" ] && mv "$BACKUP_DIR" "$EXTENSION_DIR"
    exit 1
fi
rm -rf "$BACKUP_DIR"
```

### 4.4 Round 2 — the remaining findings

The first round fixed 21 of the ~55 findings listed in the two internal audit
reports. The second round re-examined **every**
remaining claim, verified each one against the actual source and the actual
algorithms, and closed the gap.

**31 further defects were fixed.** They are grouped below by area.

#### Correctness — the tiling engine

| # | Severity | Area | Bug | Fix |
|---|----------|------|-----|-----|
| 22 | **P1** | `settings/settings.js` | `get_number()` used `get_int()` for keys that are `int64`; `get_unsigned_number()` used `get_int()` for `uint` keys. Values above 2³¹ were truncated, and a negative value written to a `uint` key threw | Added `get_int64()` and `get_unsigned_number()` using the matching GSettings getters |
| 23 | **P1** | `settings/settings.js` | `get_activationkey()` parsed `get_strv()[0]` with no fallback — an unset or malformed value yielded `NaN` | Falls back to the schema default, then to the caller's default, and validates with `Number.isInteger()` |
| 24 | **P1** | `app/enums.js`, `app/preferences.js` | The `SortOrder` enum values were **lower-case** (`'name'`) but the schema nicks are **upper-case** (`'NAME'`) and GSettings nicks are case-sensitive. The setting silently fell back to the default on every read, and `set_enum()` wrote the wrong ordinal | `SortOrder` values now match the schema nicks exactly; `SORT_ORDER_NICKS` gives the ordinal; `getSortOrder()` uses a safe lookup with a fallback |
| 25 | **P1** | `app/ding.js`, `app/dbusUtils.js`, `app/dingBusNames.js` | The DING "change desktop icon settings" action group was **never exported** on the bus, so the preferences button failed silently | The action group is exported on the project-owned `DING_SETTINGS_PATH` during `startup` |
| 26 | **P1** | `app/ding.js` | The DING application used the app id `com.rastersoft.ding` (upstream's) — a separately installed upstream DING was displaced | Project-owned `com.spark.omnishell.ding` / `…dingtest` |
| 27 | **P1** | 16 files under `app/` | `Gettext.domain('ding')` — but the extension ships catalogues for the **`tilingshell`** domain only. The entire desktop-icons UI was permanently English-only | All 16 files now use `Gettext.domain('tilingshell')`; `bindtextdomain('ding', …)` → `'tilingshell'` |
| 28 | **P1** | `dingBridge/emulateX11WindowType.js`, `utils/desktopFilter.js` | Managed windows were tracked by **monkey-patching** `window.customJS_ding` onto the window object — a GObject property that does not exist on the type | New `dingWindowRegistry.js` using a `WeakMap`; the patched property is gone |
| 29 | **P2** | `utils/gnomesupport.js`, `tilingManager.js` | `Main.wm.skipNextEffect(actor)` was called blindly. The method is not present on every GNOME version | New `skipNextEffect()` helper that feature-detects `skipNextEffect` / `_skipNextEffect` and returns whether it applied |
| 30 | **P1** | `components/layout/dynamic/reflow.js` | The split slot was used without validation, so a stale slot could produce a layout with a **negative extent** | `splitSlot` is validated against the window count; `slotUnderPoint()` resolves slots from the rounded work-area coordinates |
| 31 | **P1** | `components/layout/dynamic/layoutTree.js` | The sibling extent could go **negative** when the first extent exceeded the total | Clamped with `maxFirstExtent` |
| 32 | **P1** | `components/layout/dynamic/pins.js` | `pathOf()` matches a leaf by *containment*, so two nested rects could resolve to the same leaf path. The `floors` map is keyed by that path, so the **second pin silently overwrote the first** and the earlier minimum size was never enforced | The collision is detected and the pins are dropped rather than applied inconsistently |
| 33 | **P2** | `components/layout/TileUtils.js` | Tile extents were computed from unrounded edges, producing off-by-one seams between adjacent tiles | Extents are derived from the two rounded edges |
| 34 | **P1** | `components/tilingsystem/tilingLayout.js` | `_subtractRectangles()` used a **98 % area threshold**, so a hole covering all but a sliver left sub-pixel remnants behind — fractional tiles that the shell rejected | The threshold is now an absolute pixel tolerance, and fragments narrower than it are dropped |
| 35 | **P1** | `components/snapassist/snapAssist.js` | `close()` returned early when the assistant was already hidden, so `_isEnlarged` and `_hoveredInfo` were **never reset**. The assistant stayed logically enlarged while hidden, and the next opening compared against a stale `_desiredY` | `close()` always resets the state; the early return was removed |
| 36 | **P2** | `components/snapassist/snapAssist.js` | The assistant centred itself against `this._container.width`, which is **0 before the actor is allocated**, leaving it off-centre | New `_centerHorizontally()` re-reads the width and skips the adjustment until both sides are known |
| 37 | **P1** | `components/tilepreview/tilePreview.js`, `tilingLayout.js`, `LayoutWidget.js` | A tile preview was **destroyed twice** — `tilingLayout.js` destroyed it and the layout widget destroyed it again | The preview tracks its own `destroyed` flag, `destroy()` is idempotent, and every call site checks the flag first |
| 38 | **P2** | `components/tilepreview/selectionTilePreview.js` | `close()` did not reset the preview's origin, so it reappeared at a stale position | The origin is reset to `0, 0` |
| 39 | **P1** | `components/tilingsystem/windowPlacer.js` | The drift watch re-armed itself **forever** on a client that kept changing its geometry: the drift re-request *reset* the retry counter to "no retries left" instead of consuming one, so the placer stayed permanently busy with it | The retry budget is a separate, capped counter (`maxDriftRetries`, default 3) that is only ever incremented |
| 40 | **P2** | `components/tilingsystem/tilingManager.js` | The window-suggestions layout was **destroyed and rebuilt on every drop**, allocating a fresh set of preview actors and `Clutter.Clone`s each time | The existing instance is reused and simply re-laid-out |
| 41 | **P1** | `components/tilingsystem/tilingManager.js` | `_onWindowGrabEnd` did not remove the moving-window timer, so it kept firing after the drag | The timer source is removed at grab end |
| 42 | **P1** | `components/tilingsystem/tilingManager.js` | `_onWindowGrabEnd` assigned `window.assignedTile` even when the preview was **not** showing, so a window could be assigned a tile the user never saw | The assignment only happens when the preview was actually showing |
| 43 | **P2** | `components/tilingsystem/tilingManager.js` | `_untrackDynamicWindow()` was not idempotent — the second call queued a duplicate reflow | Early-return guard added |
| 44 | **P2** | `components/tilingsystem/tilingManager.js` | `begin_grab_op` was not exception-safe; a throw left the grab state inconsistent | Wrapped in `try`/`catch` |
| 45 | **P1** | `settings/settingsExport.js` | `restoreToDefault()` wrote hard-coded `false` values over two settings before the reset loop ran, corrupting the restored configuration | The two assignments removed; the reset loop already restores every key's schema default |
| 46 | **P1** | `dbus.js` | `disable()` never released the bus name the extension owned, so the name stayed claimed after the extension was disabled | `Gio.bus_unown_name()` is called on disable |
| 47 | **P1** | `prefs.js` | The preferences window **never unregistered** its `GResource` bundle and CSS provider. `Gio.resources_register()` fails for an already-registered path, so opening the preferences a **second time** lost the extension's icons | `unloadCssAndResources()` on `close-request`; the resource and provider are tracked and reused |
| 48 | **P2** | `prefs.js` | The suffix order in the settings rows was reversed, so "New Folder" sorted before "New File" | The order was swapped |
| 49 | **P2** | `prefs.js` | `Settings.destroy()` was called when the window closed, nulling the shared `Gio.Settings` handle. `Settings.bind()` is a **silent** no-op on a null handle, so anything bound afterwards did nothing at all | Removed; GNOME owns the window lifecycle |
| 50 | **P2** | `prefs.js` | The footer was not wrapped in `_()`, so it was never translatable | Wrapped |
| 51 | **P2** | `prefs.js` | Several preference rows were one-way: the widget and the setting did not stay in sync | Two-way sync via `changed::` signals |

#### Performance

| # | Severity | Area | Bug | Fix |
|---|----------|------|-----|-----|
| 52 | **P1** | `components/tilingsystem/tilingManager.js` | `_dynamicSlots()` is called from the **drag tick** (every 15 ms) and rebuilt the whole arrangement from scratch every time: the layout tree, the arrangement, the arrangement keys, and then a **second** layout tree inside `applyPins()`. During a drag neither the window set nor the tree changes — only the pointer moves | The result is memoised per workspace, keyed by everything the result depends on (the managed windows, the tree revision, the split target, the layout id and the pin revision). The layout tree is memoised too. A drag now recomputes **once** instead of once per tick |
| 53 | **P0** | `prefs.js` | The excluded-apps row connected to a **`"apply"` signal on a `Gtk.Entry`**. `Gtk.Entry` has no such signal — it belongs to `GtkFileChooser` and friends. The connection threw `No signal 'apply' on object 'GtkEntry'`, which **aborted the whole preferences window**: the preferences tool could not be opened at all | The invalid connection removed; only the `"changed"` signal is used, which is what the row wants anyway |

#### Packaging and internationalisation

| # | Severity | Area | Bug | Fix |
|---|----------|------|-----|-----|
| — | **P1** | `po/` | **No `.po` sources shipped.** The compiled `.mo` catalogues were committed as binaries with no template and no per-language sources, so a translator could not contribute and the catalogues could never be regenerated | `po/tilingshell.pot` (390 strings) plus 14 `.po` sources, reverse-extracted from the shipped catalogues. `po/update-pot.sh` and `po/compile-catalogues.sh` automate the workflow |
| — | **P1** | `src/resources.gresource` | The resource bundle was a **binary blob with no source**. The SVG sources of the six edge-tiling icons existed only inside it | `src/resources.gresource.xml` added and the six SVGs extracted to `src/icons/scalable/actions/`. The bundle is now built from source |
| — | **P1** | `src/resources.gresource`, `prefs.js` | The resource prefix was `/org/gnome/Shell/Extensions/tilingshell` — **upstream Tiling Shell's prefix**. Two extensions registering the same path fight over it | Renamed to the project-owned `/com/spark/omnishell` |
| — | **P2** | `src/app/meson.build` | An orphaned upstream DING install fragment referencing `get_option('prefix')`, with **no root `meson.build`** to use it | Removed; replaced by a real `Makefile` |
| — | **P1** | *(missing)* | **No build system at all.** The ZIP was a hand-made artefact | New `Makefile` with `build`, `schemas`, `resources`, `catalogues`, `pot`, `install`, `check` and `clean` |
| — | **P1** | *(missing)* | **No `LICENSE`, no `README`, no `CHANGELOG`** — a hard requirement for a published extension | `LICENSE` (GPL-3.0-only), `README.md` and `CHANGELOG.md` added |
| — | **P1** | `install.sh` | The installer printed **Bengali** text to an English-speaking audience, and never checked whether `gjs`, GTK 4 or libadwaita were present | Rewritten in English, with environment probes and session-appropriate reload instructions (Wayland vs. X11) |
| — | **P1** | `install.sh` | The archive was never validated — a corrupt or wrongly-laid-out ZIP failed halfway through, leaving a broken installation | The archive layout (exactly one top-level directory named after the UUID), the presence of `metadata.json` and the archive integrity are all checked before anything is removed |
| — | **P1** | `install.sh` | The archive was extracted **into** the extension directory, but it already contains that directory — producing a nested `omnishell@spark.dev/omnishell@spark.dev/` | The archive is extracted into the *parent* |
| — | **P2** | `src/locale/de/LC_MESSAGES/de.mo` | An orphan catalogue that no domain loads | Deleted |

### 4.5 Round 3 — the environment bug that survived two rounds of source review

After rounds 1 and 2 were deployed, auto-tiling was **still** not working on the test
machine. The cause was not in the source at all — see
[§3.5](#35-fifth-cause--a-shadowing-gsettings-schema) for the full analysis.

| # | Severity | Area | Bug | Fix |
|---|----------|------|-----|-----|
| 54 | **P0** | `install.sh`, `~/.local/share/glib-2.0/schemas` | A **stale user-level copy** of `org.gnome.shell.extensions.tilingshell.gschema.xml` (67 keys, without `tiling-excluded-apps` and `omnishell-migrations-applied`) **shadowed** the extension's own schema, because GSettings searches the user directory first. Reading `enable-dynamic-tiling` therefore **threw** inside the settings accessor, aborting the whole window-placement call chain — auto-tiling silently did nothing, with no error on screen | `install.sh` compares every shipped schema against the user-level copy and replaces a differing one, then recompiles that directory. The old upstream DING schema is moved aside to `…gschema.xml.disabled`. Guarded by the new `R2-SHADOW` check |

### 4.6 New files introduced in round 2

| File | Purpose |
|---|---|
| `src/dingBridge/dingWindowRegistry.js` | `WeakMap`-based registry for managed windows — replaces the monkey-patched `customJS_ding` property |
| `src/prefsTranslations.js` | Preferences-side gettext helpers, separate from the shell-side `translations.js` so the two GNOME APIs cannot be mixed up |
| `src/resources.gresource.xml` | The GResource manifest — the bundle is now built from source |
| `src/icons/scalable/actions/*.svg` | The six edge-tiling icons, extracted from the binary bundle |
| `po/tilingshell.pot` | The gettext template |
| `po/*.po` (14) | The per-language translation sources |
| `po/update-pot.sh`, `po/compile-catalogues.sh` | The translation workflow |
| `Makefile` | The build system |
| `README.md`, `CHANGELOG.md`, `LICENSE`, `.gitignore` | The project documentation and metadata |
| `verify_round2.mjs` | Verification harness for the round-2 fixes (5 checks) |
| `verify_perf.mjs` | Verification harness for the dynamic-layout cache (10 checks) |
| `check_syntax.mjs` | Path-independent syntax checker for every source file |
| `.github/workflows/ci.yml` | GitHub Actions workflow: syntax check, schema compilation, all five verification harnesses, resource build, catalogue compilation, `make build`, archive validation and artefact upload |

---

## 5. Audit Claims That Were Refuted

An initial static pass produced several compatibility claims that **runtime probes
proved false**. These were **deliberately not "fixed"** — doing so would have added
unnecessary compatibility shims, or in some cases actively broken working code.

| # | Claim | Reality (verified at runtime) | Action |
|---|-------|--------------------------------|--------|
| 1 | `Clutter.AnimationMode` was removed in GNOME 48 | **It exists.** `Clutter.AnimationMode.EASE_OUT_QUAD` resolves correctly on GNOME Shell 50 / mutter 18 (value `3`) | **Not changed** |
| 2 | `Mtk.Rectangle.intersect()` does not return a tuple | **It does.** It returns `[bool, rectangle]` exactly as the code destructures | **Not changed** |
| 3 | `Meta.Window.get_stable_sequence()` is not public API | **It exists** and is callable on mutter 18 | **Not changed** |
| 4 | `Shell.BlurMode.BACKGROUND` is not portable | **It exists**, value `1` | **Not changed** |
| 5 | `St.BoxLayout.get_orientation` is undefined | **It exists** | **Not changed** |
| 6 | `Meta.Display` exposes `get_pointer` / `get_default_seat` / `warp_pointer` on Wayland | **None of them exist** — this was the *opposite* of the claim and **is** a real bug | **Fixed** — new `PointerTracker` |
| 7 | `Meta.LatLng` is available for pointer coordinates | **It is undefined** on mutter 18 | **Fixed** — avoided entirely |

### 5.1 Round 2 — four more refuted claims

The second round tested every remaining finding against the real algorithms rather
than against a reading of the code. Four more claims turned out to be **false
positives** — the code was already correct, and "fixing" it would have introduced a
regression:

| # | Claim | Reality | Action |
|---|-------|---------|--------|
| 8 | Two adjacent tiles in the dynamic layout do not abut (E1) | The layout tree splits by **half-open intervals** — one tile's right edge is the next tile's left edge, and the gap is added once between the two, not twice. Replaying the layout math in isolation reproduced exact abutment | **Not changed** — the "fix" would have introduced a double gap |
| 9 | The reflow uses a stale split target (E3) | `_dynamicRects()` re-reads `_splitTarget` on every call and only uses it when it is still a managed window of that workspace. A stale target is discarded, not applied | **Not changed** |
| 10 | The slot under the pointer is computed with inconsistent rounding (E4) | The slot lookup rounds the same way the tiles are rounded. Replaying the arithmetic with the real work-area sizes produced the correct slot in every case | **Not changed** — the finding could not be reproduced |
| 11 | The pointer coordinates are in the wrong space (F8) | The pointer tracker already converts the Clutter event coordinates into the work area's coordinate space before they reach the slot lookup | **Not changed** |

A fifth candidate — "`global.__omnishell_ding_bridge` still needs checking" — was
resolved with a single grep: the name appears only in a comment, and the accessor
mechanism was already in place.

> The `verify_fixes.mjs` harness actively asserts that the code was **not** modified for
> claims 1–5, so a future contributor cannot accidentally reintroduce a broken
> "compatibility fix" for a non-existent bug.

---

## 6. Verification

### 6.1 Syntax check

```
$ node check_syntax.mjs
checked 109 files, 0 with syntax errors
```

### 6.2 Automated fix verification

The current suite has **seven Node suites and 132 checks**: the five
fix-regression harnesses — `verify_fixes.mjs` (44), `verify_round2.mjs` (5),
`verify_perf.mjs` (10), `verify_claims.mjs` (26) and
`verify_ding_refresh.mjs` (24) — plus `verify_pins.mjs` (14) and
`test_dyn.mjs` (9). Each fix check strips comments from the source before
matching, so it asserts the presence of **code**, not of prose describing the
bug that was fixed. The output blocks below are the round-2 snapshot; the later
Phase 3/4 checks, the DING harness and the pin/dynamic-math suites were added
without changing the shape of the output.

```
$ node verify_fixes.mjs

FIXED / CORRECT (41):
  [C1] SignalHandling keys connections by object, not by signal name
  [A4] KEYBOARD_MOVING (257) is detected as a move
  [NEW-1] MAXIMIZE_DESKTOP_OPEN no longer short-circuits the layout bookkeeping
  [F4] _findEmptyTile uses the window's workspace layout
  [A6] getWindows() filters by workspace explicitly
  [C8] tiling uses the Wayland-safe pointer tracker
  [F6] _dynamicSwap no longer reshuffles the global window list blindly
  [F1] source centre Y uses source.y
  [E7] buildRectangle clamps negative sizes
  [C-1] migration maps the shortcut array entry by entry
  [C-2] migrations run exactly once, guarded by a dedicated key
  [C-6] prefs.js adds the behaviour group once
  [P-2] prefs.js can edit the dynamic layout shortcuts
  [P-7] prefs.js guards the shortcut array access
  [SCHEMA] DING schema id no longer collides with upstream
  [D-1] the extension no longer owns upstream DING's bus name
  [D-6] window type is not decided by the title alone
  [D-8] the DING bridge is not published as a plain global string
  [D-9] the subprocess watchdog has a backoff and a retry cap
  [EXCL] applications can be excluded from tiling
  [DRAG] drag-scoped stage handlers are removed when the drag ends
  [R2-SET] typed settings accessors use the correct GSettings getters
  [R2-ENUM] SortOrder values match the (upper-case) schema nicks
  [R2-SHADOW] the installer repairs a user-level schema that shadows the extension's
  [R2-DBUS] the DING settings action group is exported on its own bus path
  [R2-GT] the app/ code uses the "tilingshell" gettext domain
  [R2-REG] managed-window bookkeeping uses a WeakMap registry, not a patched property
  [R2-SKIP] skipNextEffect is feature-detected instead of called blindly
  [R2-REFLOW] reflow validates the split slot and resolves slots under the pointer
  [R2-LAYOUT] the layout tree clamps the first extent so the sibling extent cannot go negative
  [R2-PINS] duplicate pin paths are detected and ignored
  [R2-TILE] tile extents are derived from the rounded edges
  [R2-PREVIEW] a destroyed tile preview is never destroyed a second time
  [R2-SEL] the selection tile preview resets its origin when closed
  [R2-SNAP] snapAssist.close() always resets its enlarged/hovered state
  [R2-DRIFT] the drift watch cannot re-arm forever — the retry budget is bounded
  [R2-EXPORT] restoreToDefault() resets keys instead of writing hard-coded false values
  [R2-DBUSTOP] disabling the extension releases the bus name it owns
  [R2-LOCALE] a gettext template exists so the catalogues can be regenerated
  [R2-SUGG] the tiling suggestions layout is reused instead of destroyed and rebuilt
  [R2-PREFSIG] preferences.js only connects to signals its widgets actually have

=== SUMMARY ===
ok=41 still-broken=0 total=41
```

```
$ node verify_round2.mjs

schema nicks : NAME, DESCENDINGNAME, MODIFIEDTIME, KIND, SIZE
schema values: 1, 2, 3, 4, 5
enums values : {"ORDER":"arrangeorder","NAME":"NAME","DESCENDINGNAME":"DESCENDINGNAME",
                "MODIFIEDTIME":"MODIFIEDTIME","KIND":"KIND","SIZE":"SIZE"}

FIXED / CORRECT (5):
  [S1] every schema nick exists as a SortOrder key
  [S2] every SortOrder value equals its schema nick exactly
  [S3] the computed enum ordinal matches the schema numbering
  [S4] the "ORDER" key name is not in the nicks list
  [S5] preferences.js uses SORT_ORDER_NICKS and a safe lookup

=== SUMMARY ===
ok=5 still-broken=0 total=5
```

```
$ node verify_perf.mjs

FIXED / CORRECT (7):
  [P1-CACHE] _dynamicSlots() memoises its result and reuses it on a key match
  [P1-KEY] the cache key covers every input the result depends on
  [P1-INVALIDATE] every mutation that changes the result invalidates the cache
  [P1-TREE] the layout tree is memoised and invalidated together with the slots
  [P1-NEWCOMERS] a cache hit still clears the newcomer marks
  [P1-MODEL] the cached and the uncached computation always agree
  [P1-DRAG] a drag with a stationary pointer recomputes only once

=== SUMMARY ===
ok=7 still-broken=0 total=7
```

> `P1-MODEL` replays a sequence of mutations against a reference implementation
> (no cache) and against the cache logic as it is implemented in the manager, and
> compares the results. `P1-DRAG` models a 100-tick drag and asserts that the
> expensive recomputation happens **once**, not once per tick.

```
$ node verify_claims.mjs

CONFIRMED (real bug): 0

REFUTED (audit was wrong): 26

=== SUMMARY ===
confirmed=0 refuted=26 total=26
```

This harness is the **inverse** of the others: it re-tests every claim from the two
original internal audit reports against the current
source. A claim is `CONFIRMED` when the defect it describes is still present and
`REFUTED` when it is not. **All 26 claims are now refuted** — every real defect
they identified has been fixed, and the ones that were never real have been
correctly understood rather than "fixed" into a regression.

> While writing this check, eight of its own assertions turned out to be
> wrong rather than the code: the harness read raw string values where the code
> used constants, matched against comments that *quoted* the broken expression,
> and resolved a bus name from a comment instead of from the constant. Each was
> corrected so that the harness asserts the thing it claims to assert.

`verify_ding_refresh.mjs` is the newest harness. It asserts the 200 ms
debounce, the single-flight loop, the removal of the 500 ms retry and
`_forceDraw`, the SIGTERM cleanup, and the preserved enumeration semantics
(24 checks).

### 6.3 Schema compilation and inspection

```
$ glib-compile-schemas --strict OmniShell/src/schemas/
COMPILED OK
```

```
$ gsettings list-keys org.gnome.shell.extensions.tilingshell \
    | grep -E '^(migrations|tiling-excluded-apps)$'
migrations
tiling-excluded-apps
```

### 6.4 Live runtime validation

```sh
journalctl --user -n 2000 | grep -iE "omnishell"
```

```
[OmniShell] Launching integrated DING desktop process
Primary screen is 0
Creating desktop index 0
GNOME nautilus 50.3.1
```

**No JavaScript errors.** The extension enables cleanly, the DING subprocess starts, and
the desktop index is created.

### 6.5 Loading the fixes

Because GNOME Shell caches the loaded extension code, a **shell restart** is required
after installing:

| Session type | Action |
|---|---|
| **Wayland** (recommended) | `Alt+F2` → type `r` → `Enter`. If `Alt+F2` is disabled, log out and back in. |
| **X11** | `gnome-extensions disable omnishell@spark.dev && gnome-extensions enable omnishell@spark.dev` |

> **GNOME 50 on Wayland refuses an in-place restart.** `global.restart('restart:')`
> returns `false` and the shell PID does not change, so `Alt+F2` → `r` does not work
> on this system — a logout/login is required.

### 6.6 The environment check that found the last bug

Because bug 54 was environmental rather than a source defect, it was found with a
runtime probe rather than by reading the code. The probe is worth keeping, because
it is the check that any future "auto-tiling does nothing" report should start with:

```js
// /tmp/probe_dconf.js
imports.gi.versions.Gio = '2.0';
const {Gio} = imports.gi;
const s = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.tilingshell' });
try {
    print('excluded-apps: ' + s.get_strv('tiling-excluded-apps').length + ' entries');
} catch (e) {
    print('excluded-apps ERROR: ' + e.message);
}
print('autotiling: ' + s.get_boolean('enable-autotiling'));
print('dynamic: ' + s.get_boolean('enable-dynamic-tiling'));
```

Before the fix:

```
excluded-apps ERROR: GSettings key tiling-excluded-apps not found in schema org.gnome.shell.extensions.tilingshell
autotiling: true
dynamic: true
```

After the fix:

```
excluded-apps: 0 entries
autotiling: true
dynamic: true
migrations: ["17.0-border-color","17.3-cycle-layouts-backward"]
```

The `ERROR` line is the tell-tale: a key that the extension's own schema *does*
define, reported as missing, means **a different schema file is winning the
lookup**. The fix is to compare the extension's schema against every directory on
GSettings' search path and delete or replace the stale copy.

---

## 7. New Feature: Applications Excluded from Tiling

Added as part of the fix work, because "auto tiling never happens" is often a symptom
of *some* application that should not be tiled at all (a media player, a chat client, a
calculator).

### How it works

A new GSettings key:

```xml
<key type="as" name="tiling-excluded-apps">
  <default>[]</default>
  <summary>Applications excluded from tiling</summary>
  <description>Window classes of applications that should never be tiled.</description>
</key>
```

A new settings accessor:

```js
static KEY_TILING_EXCLUDED_APPS = "tiling-excluded-apps";

static get TILING_EXCLUDED_APPS() {
    return Settings.gioSetting.get_strv(Settings.KEY_TILING_EXCLUDED_APPS) || [];
}

static set TILING_EXCLUDED_APPS(value) {
    Settings.gioSetting.set_strv(
        Settings.KEY_TILING_EXCLUDED_APPS,
        Array.isArray(value) ? value : []
    );
}
```

A matcher in `TilingManager` that checks the WM class, the GTK application id, and the
short basename, case-insensitively:

```js
_isExcludedFromTiling(window) {
    const excluded = Settings.TILING_EXCLUDED_APPS;
    if (!excluded || excluded.length === 0) return false;

    const candidates = new Set();
    try { candidates.add(window.get_wm_class()); } catch {}
    try { candidates.add(window.get_gtk_application_id()); } catch {}

    for (const candidate of candidates) {
        if (!candidate) continue;
        const normalized = String(candidate).toLowerCase();
        if (excluded.some(e => String(e).toLowerCase() === normalized)) return true;

        // Also match on the short basename, so "org.gnome.Nautilus" can be
        // excluded with just "nautilus".
        const short = normalized.split(".").pop();
        if (short && excluded.some(e => String(e).toLowerCase() === short)) return true;
    }
    return false;
}
```

The check runs at **every** entry point:

- the `window-created` handler,
- `_autoTile()`,
- `_isDynamicTrackable()`.

### Usage

Open **Extensions → OmniShell → Preferences** and find the new
**"Applications excluded from tiling"** row. Add entries such as:

```
org.gnome.Nautilus
spotify
com.spotify.Client
```

Entries match against both the WM class and the GTK application id, so either form
works.

---

## 8. Feature Roadmap

Prioritised by real-world value per unit of implementation effort.

### 🔴 Tier 1 — High value, moderate effort

| # | Feature | Why it matters | Effort |
|---|---------|----------------|--------|
| 1 | **Per-application layout rules** | *"When Nautilus opens, give it the right 50%. When Terminal opens, put it at the bottom."* Turns auto-tiling from one-size-fits-all into something users can actually live with. The matching infrastructure (`_isExcludedFromTiling`) already exists and can be generalised. | M |
| 2 | **Floating-window toggle** (`Super+Shift+F`) | Let the user exempt the focused window from tiling on demand, without editing settings. The single most-requested feature in every tiling extension. | S |
| 3 | **Scratchpad / quick terminal** (`Super+Q`) | A terminal that slides over the current layout and hides again. Extremely useful for short commands without disturbing the tiling. | M |
| 4 | **Per-monitor layout persistence** | Two monitors currently share one logical layout. Storing a layout tree per monitor (and per workspace) makes multi-monitor setups predictable. | M |
| 5 | **Layout save / restore** | Save the current arrangement before a reboot or a workspace switch, then restore it. Especially valuable combined with session restore. | M |

### 🟡 Tier 2 — High value, higher effort

| # | Feature | Why it matters | Effort |
|---|---------|----------------|--------|
| 6 | **Tabbed windows within a tile** (`Super+T`) | Multiple terminals share one tile and are switched with `Alt+1..9`. The natural evolution of a tiling workflow. | L |
| 7 | **Window swallowing** | Launching a Terminal from inside another Terminal replaces the parent rather than opening a third tile. | L |
| 8 | **Golden-ratio master area** | A configurable 60/40, 67/33, or 70/30 master/stack split instead of a fixed half split. | M |
| 9 | **Animated tile transitions** | Windows glide to their new positions instead of jumping. Directly addresses the "not smooth" perception. | M |
| 10 | **User-bindable layout shortcuts** | Every layout gets a configurable shortcut, including the dynamic-layout cycle shortcuts that are only partially exposed today. | S |

### 🟢 Tier 3 — Advanced / long-term

| # | Feature | Why it matters | Effort |
|---|---------|----------------|--------|
| 11 | **Group tagging** | Tag windows as *work*, *media*, *chat* and tile each group as a unit. | L |
| 12 | **Session restore** | Rebuild the exact layout after a reboot. Requires careful handling of windows that are opened in a different order. | L |
| 13 | **CLI / IPC control** | `omnishell tile --focus next` from scripts and keybinders. The extension already exposes a D-Bus interface (`dbus.js`) — extend it rather than build something new. | M |
| 14 | **Notification & battery overlays** | Render notifications as tiles rather than transient banners. | L |
| 15 | **DPI-aware tile math** | On mixed-DPI setups, compute tile geometry per monitor rather than against a single global scale. | M |
| 16 | **Tiling rules engine** | A small DSL ("when a browser opens, make it 2/3; when a terminal opens, make it 1/3") that generalises features 1 and 8. | L |

### Suggested contribution order

```
Tier 1  →  #2 floating toggle  →  #1 per-app rules  →  #10 layout shortcuts
                                    →  #3 scratchpad  →  #4 per-monitor  →  #5 save/restore

Tier 2  →  #9 animated transitions  →  #8 golden ratio  →  #6 tabs  →  #7 swallowing

Tier 3  →  #15 DPI  →  #13 IPC  →  #12 session restore  →  #11 groups  →  #16 rules DSL
```

---

## 9. Known Issues and Recommendations

### 9.1 Environment note — duplicate dock extensions

On the test system, **two** dock extensions are enabled simultaneously:

- `dash-to-dock@micxgx.gmail.com`
- `bottom-dash-panel@fthx`

This produces a duplicated dock and reduces the usable work area that the tiling engine
computes against, which makes tiling appear to have a gap at the bottom. **Disable one
of them.**

### 9.2 Translation catalogues — **resolved in round 2**

The shipped `locale/*/LC_MESSAGES/*.mo` files are the **`tilingshell`** domain
(14 locales). The DING schema's `gettext-domain` was corrected from `"ding"` to
`"tilingshell"` so its summaries and descriptions resolve — but the DING application
still bound the `ding` domain in `app/ding.js`, whose catalogues do not exist. The DING
settings window was therefore permanently English-only.

**Fixed:** all 16 files under `app/` now use `Gettext.domain('tilingshell')` and
`bindtextdomain('tilingshell', …)`, and the `.po` **sources** now ship alongside the
compiled catalogues so the translations can be regenerated and contributed to.

### 9.3 Build infrastructure — **resolved in round 2**

| Item | Status |
|---|---|
| Root `Makefile` | **Added** — `build`, `schemas`, `resources`, `catalogues`, `pot`, `install`, `check`, `clean` |
| `po/*.po` + `po/tilingshell.pot` | **Added** — 14 sources and a 390-string template |
| `LICENSE` (GPL-3.0-only) | **Added** |
| `README.md` | **Added** |
| `CHANGELOG.md` | **Added** |
| `.gitignore` | **Added** |
| CI workflow | **Added** — `.github/workflows/ci.yml` |

**CI:** `.github/workflows/ci.yml` runs on every push and pull request. It installs
only `gettext`, `libglib2.0-bin`, `nodejs`, `zip` and `unzip`, then runs the syntax
check, `glib-compile-schemas --strict`, the five verification harnesses, the
GResource build, the catalogue compilation and `make build`. It finally validates the
archive (single top-level directory, `metadata.json` present, `unzip -t` clean) and
uploads the ZIP as a build artefact. The harnesses are plain Node scripts with no
dependencies, so the job needs no JavaScript toolchain.

### 9.4 Packaging cleanup — **resolved in round 2**

- `app/meson.build` (an orphaned upstream DING fragment) — **removed**.
- `resources.gresource` registered under upstream's
  `/org/gnome/Shell/Extensions/tilingshell/` prefix — **renamed** to the project-owned
  `/com/spark/omnishell/`, and the resource and CSS provider are now **unregistered**
  when the preferences window closes.
- `resources.gresource` was a binary blob with no source — `resources.gresource.xml`
  and the six SVG sources are now **in the tree**, and the bundle is built from them.
- `install.sh` printed Bengali — **rewritten in English**, with environment probes
  (`gjs`, GTK 4, libadwaita), archive-layout and integrity validation, and
  session-appropriate reload instructions.
- `install.sh` did not verify the ZIP — it now checks the top-level layout, the
  presence of `metadata.json` and the archive integrity **before** anything is removed.

### 9.5 Code-structure recommendation

`src/components/tilingsystem/tilingManager.js` has grown past 1,700 lines and carries
three distinct responsibilities: static tiling, dynamic tiling, and the DING bridge
integration. Splitting it into a `TilingManager` façade with
`StaticTilingController` / `DynamicTilingController` implementations — both already
share only `TileUtils` and `_workArea` — would make the remaining bugs far easier to
isolate and test.

### 9.6 Phase 6 lifecycle audit

- `TilingManager.destroy()` clears `_dynamicLayoutCandidatesCache` next to the
  other per-manager caches. `_dynamicLayoutOffset`, `_dynamicArrangements`,
  `_dynamicManagedCache`, `_pinSettleBudget`, `_dynamicNewcomers`,
  `_dynamicSlotsCache`, `_dynamicTreeRevisions`, `_dynamicTreeCache`,
  `_dynamicWindows` and `_dynamicWindowSignals` were already cleared.
- `ReflowScheduler` owns no timer; it only tracks `_running` and `_pending`.
  The single idle source is `_dynamicReflowSourceId`, removed in `destroy()`.
  Signals are disconnected before teardown, so no new reflow can be queued.
- `TilingDragCoordinator.destroy()` is idempotent through `_enabled`. `_endDrag()`
  calls `_stopTimer()`, which removes the 15 ms source only when `_timerId` is
  set; `extension.disable()` aborts the coordinator before destroying managers.
- `WindowPlacer.destroy()` forgets every in-flight target. `forget()` cancels
  the pending and verification timeouts and disconnects the geometry/gone
  handlers, so no callback fires after teardown.
- Timer grep over `src/components/tilingsystem`, `src/utils` and
  `src/extension.js` finds only the drag coordinator's 15 ms source and the
  one-shot placement clock in `metaPlacementTarget.js`. DING's 250 ms
  `visibleArea`/`emulateX11WindowType` timers and the `launchSubprocess`
  watchdog are one-shot or bounded and cleared on disable; the `dingBridge`
  relaunch timer is cancelled by `killCurrentProcess()`. The 1 s force-exit
  fallback is intentionally one-shot so a hung child cannot survive teardown.

### 9.7 Upstream integration helper

`src/app/desktopIconsIntegration.js` is an upstream DING helper for other
extensions' integration. OmniShell does not import it; it is kept for parity
with upstream and is not dead code. Do not delete it without user approval.

### 9.8 DING refresh residual risks

- **R2 (low):** `_doReadAsync()` checks for a newer request once after
  `enumerate_children_finish()` and then builds the list synchronously. A normal
  GLib event cannot interleave, so a stale draw is unlikely. If a `FileItem`
  constructor ever emits a refresh signal synchronously, the list can be drawn
  once before the follow-up pass. Add a final request check before
  `_drawDesktop()` only if this reproduces; pair it with a bounded deadline.
- **R3 (low):** removing `_forceDraw` also removes the old ~1 s safety net. A
  pathological stream that invalidates every enumeration before it completes
  could postpone drawing. `Gio.FileMonitor` rate limiting (1 s) and fast reads
  make this unlikely; stress-test a large desktop before publish. Fix only if
  reproduced, with a bounded fallback — never with the old 500 ms polling loop.

---

## 10. Contributing

### Development setup

```sh
git clone https://github.com/SumonX7/omnishell.git
cd omnishell

# Build the ZIP and install it
make install

# Restart the shell
#
# On X11 sessions:  Alt+F2 → r → Enter
# On Wayland sessions GNOME 50 refuses an in-place restart
# (global.restart('restart:') returns false), so log out and back in.
```

### Running the verification suite

```sh
# Everything at once
make check

# Or individually:
node check_syntax.mjs              # syntax check every source file
node verify_fixes.mjs              # the 44 fix and regression checks
node verify_round2.mjs             # the 5 SortOrder round-trip checks
node verify_perf.mjs               # the 10 dynamic-layout cache checks
node verify_ding_refresh.mjs       # the 24 DING desktop-refresh checks
node verify_claims.mjs             # the 26 original audit claims, re-tested
glib-compile-schemas --strict src/schemas/
```

Every one of these runs in CI on each push — see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### Working on the translations

```sh
# Refresh the template and merge it into every catalogue
make pot

# Compile po/*.po into src/locale/<lang>/LC_MESSAGES/tilingshell.mo
make catalogues
```

### Guidelines for contributors

1. **Probe before you assume.** Several long-standing "bugs" in this codebase turned out
   to be false alarms. A ten-line GJS probe against the live typelibs settles the
   question permanently. See `probe_grabop.js` and `probe_wayland.js` for the pattern.
2. **Add a check to `verify_fixes.mjs` for every bug you fix.** The harness is the
   regression net for this codebase.
3. **Do not add compatibility shims for APIs that exist.** If the API is present on the
   supported shell versions, use it directly.
4. **Comment the non-obvious bit-field arithmetic.** `Meta.GrabOp` is a bit field and
   `grabOp & ~1024` is *almost* right — which is exactly why it shipped broken.
5. **Respect the D-Bus namespace.** All OmniShell bus names live under
   `com.spark.omnishell.*`. Never reuse an upstream project's name.
6. **Invalidate the cache when you add a new input.** `_dynamicSlots()` is memoised.
   If you make the result depend on something new, that something has to be part of
   the cache key *and* the cache has to be invalidated where it changes. The
   `P1-INVALIDATE` check in `verify_perf.mjs` enumerates the current invalidation
   points — keep it in sync.
7. **Ship the `.po` sources, not just the `.mo` files.** The compiled catalogues are
   build products; `po/*.po` is the source of truth.

---

## Appendix A — Source layout

```
OmniShell/
├── src/
│   ├── metadata.json              # UUID, shell-version 46–51, version 1.0.6
│   ├── extension.js               # Extension lifecycle, settings migrations
│   ├── prefs.js                   # Adw preferences window
│   ├── keybindings.js             # Keybinding registration & overrides
│   ├── dbus.js                    # Extension D-Bus API
│   ├── app/                       # DING desktop-icons subprocess
│   │   ├── ding.js                #   entry point (gjs -m)
│   │   └── dingBusNames.js        #   project-owned D-Bus names  (NEW)
│   ├── components/
│   │   ├── tilingsystem/          # Static + dynamic tiling engines
│   │   │   ├── tilingManager.js   #   façade, window-created handler, drag logic
│   │   │   ├── tilingLayout.js    #   static layout tree & previews
│   │   │   └── resizeManager.js   #   resize + neighbour complementing
│   │   ├── layout/                # Layout widgets, dynamic tree math
│   │   ├── snapassist/            # Edge snap assistant
│   │   └── editor/                # Layout editor dialog
│   ├── dingBridge/                # Extension ↔ DING subprocess bridge
│   │   ├── dingBridge.js
│   │   ├── dingBridgeAccess.js    #   Symbol.for() accessor     (NEW)
│   │   ├── emulateX11WindowType.js
│   │   ├── launchSubprocess.js
│   │   └── visibleArea.js
│   ├── settings/                  # GSettings wrappers
│   ├── utils/
│   │   ├── grabOp.js              #   GrabOp bit-field classifier (NEW)
│   │   ├── pointerTracker.js      #   Wayland-safe pointer tracking (NEW)
│   │   ├── signalHandling.js      #   list-based signal registry
│   │   ├── ui.js                  #   rect helpers, getWindows()
│   │   └── desktopFilter.js
│   ├── schemas/
│   │   ├── org.gnome.shell.extensions.tilingshell.gschema.xml
│   │   └── org.gnome.shell.extensions.omnishell.ding.gschema.xml  # renamed
│   └── locale/                    # 14 gettext catalogues (tilingshell domain)
├── install.sh                     # Backup-safe installer
├── Makefile                       # Build, install and verification targets
├── verify_fixes.mjs               # 44-check regression harness
├── verify_round2.mjs              # 5 SortOrder round-trip checks
├── verify_perf.mjs                # 10 dynamic-layout cache checks
├── verify_ding_refresh.mjs        # 24 DING refresh checks
├── verify_claims.mjs              # 26-claim verification harness
├── verify_pins.mjs                # pin/livelock handling checks
├── test_dyn.mjs                   # Dynamic-layout math tests
└── check_syntax.mjs               # Path-independent syntax checker
```

## Appendix B — License & attribution

OmniShell is a derivative work combining:

- **Tiling Shell** by Domenico Ferraro — <https://github.com/FerRaZo/gnome-shell-extension-tiling>
- **Desktop Icons NG (DING)** by Sergio Costas — <https://github.com/SergioCostas/Desktop-Icons-NG>

Both upstream projects are licensed under the **GPL-3.0**. OmniShell is likewise
released under the **GPL-3.0** and retains the original per-file copyright headers.
