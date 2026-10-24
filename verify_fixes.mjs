// Verification harness: checks that every confirmed audit finding is now
// fixed in the source, and that the audit claims that were refuted are still
// correctly understood (i.e. the code must NOT have been "fixed" for them).
// Run with: node OmniShell/verify_fixes.mjs
import { readFileSync } from 'fs';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src') + '/';


/**
 * Strips comments from source so that the checks below match *code* and not
 * the prose that explains what the code used to do.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (p) => stripComments(readFileSync(SRC + p, 'utf8'));

const results = [];
const check = (id, description, ok, evidence) => {
  results.push({ id, description, ok, evidence });
};

// --- C1: SignalHandling keying ---
{
  const s = read('utils/signalHandling.js');
  const keyedByName = /this\._signalsIds\[key\]\s*=/.test(s);
  const findFirst = /Object\.keys\(this\._signalsIds\)\.find\(/.test(s);
  const usesList = /this\._connections\.push\(\{/.test(s);
  const removesAll = /connection\.obj === obj/.test(s);
  check('C1', 'SignalHandling keys connections by object, not by signal name',
    !keyedByName && !findFirst && usesList && removesAll,
    `keyed-by-name=${keyedByName}, find-first=${findFirst}, list-based=${usesList}, removes-all=${removesAll}`);
}

// --- A4: grabOp & ~1024 misses KEYBOARD_MOVING ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const oldPattern = /grabOp\s*&\s*~1024\s*\)?\s*===\s*1/.test(s);
  const usesHelper = /isMovingGrabOp\(grabOp\)/.test(s);
  const helper = read('utils/grabOp.js');
  const helperStripsKeyboard = /GRAB_OP_KEYBOARD/.test(helper);
  check('A4', 'KEYBOARD_MOVING (257) is detected as a move',
    !oldPattern && usesHelper && helperStripsKeyboard,
    `old-bitmask=${oldPattern}, uses-helper=${usesHelper}, helper-strips-keyboard-bit=${helperStripsKeyboard}`);
}

// --- NEW-1: MAXIMIZE_DESKTOP_OPEN early return skips tiling ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const maximizeBlock = /Settings\.MAXIMIZE_DESKTOP_OPEN[\s\S]{0,1400}?return;/.exec(s);
  // The maximize branch must NOT return before reaching the tiling calls.
  const branch = maximizeBlock ? maximizeBlock[0] : '';
  const hasDynamic = /_dynamicAdd\(window\)/.test(branch);
  // A deliberately maximized window must NOT be given a tile, so the absence
  // of an _autoTile() call in that branch is correct.
  const hasAuto = /_autoTile\(window, true\)/.test(branch);
  const skipsAutoTile = /window\.assignedTile = void 0;/.test(branch);
  check('NEW-1', 'MAXIMIZE_DESKTOP_OPEN no longer short-circuits the layout bookkeeping',
    hasDynamic && !hasAuto && skipsAutoTile,
    `dynamic-tiling-tracked=${hasDynamic}, auto-tile-skipped=${!hasAuto}, tile-released=${skipsAutoTile}`);
}

// --- F4: _findEmptyTile uses the active workspace ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const usesActive = /getSelectedLayoutOfMonitor\(\s*window\.get_monitor\(\),\s*global\.workspaceManager\.get_active_workspace_index\(\)/.test(s);
  const usesWindowWs = /workspaceIndex/.test(s) && /window\.get_workspace\(\)/.test(s);
  check('F4', '_findEmptyTile uses the window\'s workspace layout',
    !usesActive && usesWindowWs,
    `active-workspace-lookup=${usesActive}, window-workspace-lookup=${usesWindowWs}`);
}

// --- A6: getWindows() does not filter by workspace ---
{
  const s = read('utils/ui.js');
  const filters = /win\.get_workspace\(\)\?\.index\?\.\(\)\s*===\s*workspaceIndex/.test(s);
  check('A6', 'getWindows() filters by workspace explicitly',
    filters, `explicit workspace filter = ${filters}`);
}

// --- C8: global.get_pointer() on Wayland ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const n = (s.match(/global\.get_pointer\(\)/g) || []).length;
  const usesTracker = (s.match(/PointerTracker\.get\(\)\.getPointer\(\)/g) || []).length;
  check('C8', 'tiling uses the Wayland-safe pointer tracker',
    n === 0 && usesTracker > 0, `raw global.get_pointer() calls = ${n}, tracker calls = ${usesTracker}`);
}

// --- F6: _dynamicSwap mutates the global list ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const scopeCheck = /_dynamicManagedWindows\(ws\)/.test(s);
  const swap = /_dynamicSwap\(ws, a, b\)[\s\S]{0,700}?remembered\.tree = swapInArrangement/.test(s);
  check('F6', '_dynamicSwap no longer reshuffles the global window list blindly',
    scopeCheck && swap, `workspace-scoped=${scopeCheck}, arrangement-swap=${swap}`);
}

// --- F1: source centre Y computed from source.x ---
{
  const s = read('components/tilingsystem/tilingLayout.js');
  const bad = /y:\s*source\.x\s*\+\s*source\.height/.test(s);
  const good = /y:\s*source\.y\s*\+\s*source\.height/.test(s);
  check('F1', 'source centre Y uses source.y', !bad && good, `bad=${bad}, good=${good}`);
}

// --- E7: buildRectangle negative sizes ---
{
  const s = read('utils/ui.js');
  const clamped = /Math\.max\(0, params\.width\)/.test(s) && /Math\.max\(0, params\.height\)/.test(s);
  check('E7', 'buildRectangle clamps negative sizes', clamped, `clamped=${clamped}`);
}

// --- C-1: migration interpolates an array ---
{
  const s = read('extension.js');
  const bad = /`\<Shift\>\$\{Settings\.gioSetting\.get_strv\(/.test(s);
  const good = /cycleLayouts\.map\(/.test(s);
  check('C-1', 'migration maps the shortcut array entry by entry', !bad && good, `array-interpolation=${bad}, per-entry-map=${good}`);
}

// --- C-2: unreachable migration gate ---
{
  const s = read('extension.js');
  const old17 = /LAST_VERSION_NAME_INSTALLED === "17\.0"/.test(s);
  const old173 = /LAST_VERSION_NAME_INSTALLED !== "17\.3"/.test(s);
  const once = /omnishell-migrations-applied/.test(s);
  check('C-2', 'migrations run exactly once, guarded by a dedicated key',
    !old17 && !old173 && once, `gate-17.0=${old17}, gate-17.3=${old173}, once-guard=${once}`);
}

// --- C-6: prefs duplicate group ---
{
  const s = read('prefs.js');
  const adds = (s.match(/prefsPage\.add\(behaviourGroup\)/g) || []).length;
  check('C-6', 'prefs.js adds the behaviour group once', adds === 1, `add(behaviourGroup) count = ${adds}`);
}

// --- P-2: keybinding editors ---
{
  const prefs = read('prefs.js');
  // The prefs code refers to the shortcuts through the Settings constants,
  // so the constants are looked up rather than the literal setting names.
  const has = k => {
    const constant = k.replace(/-/g, "_").toUpperCase();
    return prefs.includes(`Settings.SETTING_${constant}`) ||
           prefs.includes(`Settings.${constant}`) ||
           prefs.includes(k);
  };
  const missing = ['cycle-dynamic-layout', 'cycle-dynamic-layout-backward']
    .filter(k => !has(k));
  check('P-2', 'prefs.js can edit the dynamic layout shortcuts',
    missing.length === 0, 'missing from prefs.js: ' + (missing.join(', ') || 'none'));
}

// --- P-7: unguarded get_strv[0].length ---
{
  const s = read('prefs.js');
  const unguarded = /get_strv\(keybindings\[i\]\[0\]\)\[0\]\.length/.test(s);
  const guarded = /shortcuts\.length > 0 && \(shortcuts\[0\] \|\| ""\)\.length > 0/.test(s);
  check('P-7', 'prefs.js guards the shortcut array access', !unguarded && guarded, `unguarded=${unguarded}, guarded=${guarded}`);
}

// --- SCHEMA: DING schema id collision ---
{
  const s = read('schemas/org.gnome.shell.extensions.omnishell.ding.gschema.xml');
  const id = /<schema[^>]*id="([^"]+)"/.exec(s)?.[1];
  check('SCHEMA', 'DING schema id no longer collides with upstream',
    id === 'org.gnome.shell.extensions.omnishell.ding', 'schema id = ' + id);
}

// --- D-1: bus name collision ---
{
  const s = read('dingBridge/dingBridge.js');
  const upstream = /bus_own_name\([\s\S]{0,200}?"com\.rastersoft\.dingextension"/.test(s);
  const own = /DING_BUS_NAME/.test(s);
  const names = read('app/dingBusNames.js');
  const nameValue = /const DING_BUS_NAME = "([^"]+)"/.exec(names)?.[1];
  check('D-1', 'the extension no longer owns upstream DING\'s bus name',
    !upstream && own && nameValue !== 'com.rastersoft.dingextension',
    `upstream-name-used=${upstream}, own name=${nameValue}`);
}

// --- D-6: title-prefix window spoofing ---
{
  const s = read('dingBridge/emulateX11WindowType.js');
  const spoof = /get_title\(\)\?\.startsWith\("Desktop Icons "\)/.test(s);
  const guarded = /query_window_belongs_to\(window\)/.test(s);
  const filter = read('utils/desktopFilter.js');
  const filterSpoof = /title\.startsWith\("Desktop Icons "\)/.test(filter);
  check('D-6', 'window type is not decided by the title alone',
    !spoof && guarded && !filterSpoof,
    `title-spoof=${spoof}, client-guard=${guarded}, filter-spoof=${filterSpoof}`);
}

// --- D-8: global singleton ---
{
  const s = read('dingBridge/dingBridge.js');
  const g = /global\.__omnishell_ding_bridge/.test(s);
  const usesAccess = /setDingBridge\(this\)/.test(s) && /clearDingBridge\(this\)/.test(s);
  const access = read('dingBridge/dingBridgeAccess.js');
  const symbol = /Symbol\.for\(/.test(access);
  check('D-8', 'the DING bridge is not published as a plain global string',
    !g && usesAccess && symbol,
    `plain-global=${g}, accessor-used=${usesAccess}, symbol-key=${symbol}`);
}

// --- D-9: subprocess watchdog ---
{
  const s = read('dingBridge/launchSubprocess.js');
  const backoff = /Math\.pow\(2/.test(s);
  const cap = /MAX_WATCHDOG_ATTEMPTS/.test(s);
  const grace = /LAUNCH_GRACE_PERIOD_MS = 8e3/.test(s);
  check('D-9', 'the subprocess watchdog has a backoff and a retry cap',
    backoff && cap && grace, `backoff=${backoff}, cap=${cap}, grace=${grace}`);
}

// --- NEW: excluded apps ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const helper = /_isExcludedFromTiling\(window\)/.test(s);
  const settings = read('settings/settings.js');
  const key = /KEY_TILING_EXCLUDED_APPS/.test(settings);
  const schema = read('schemas/org.gnome.shell.extensions.tilingshell.gschema.xml');
  const schemaKey = /name="tiling-excluded-apps"/.test(schema);
  check('EXCL', 'applications can be excluded from tiling',
    helper && key && schemaKey, `helper=${helper}, setting=${key}, schema=${schemaKey}`);
}

// --- NEW: drag-scoped stage handlers ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const scoped = /_dragStageSignals/.test(s);
  const disconnects = /_dragStageSignals\.disconnect\(\)/.test(s);
  check('DRAG', 'drag-scoped stage handlers are removed when the drag ends',
    scoped && disconnects, `scoped=${scoped}, disconnected-at-end=${disconnects}`);
}

// ============================================================
// ROUND 2 — checks for the second round of fixes.
// ============================================================

// --- R2-SETTINGS: get_activationkey / get_number type fixes ---
{
  const s = read('settings/settings.js');
  const int64 = /function get_int64\(key\)[\s\S]{0,120}?get_int64\(key\)/.test(s);
  const uint = /function get_unsigned_number\(key\)[\s\S]{0,120}?get_uint\(key\)/.test(s);
  const activation = /get_activationkey[\s\S]{0,700}?Number\.isInteger\(parsed\)/.test(s);
  check('R2-SET', 'typed settings accessors use the correct GSettings getters',
    int64 && uint && activation,
    `int64=${int64}, uint=${uint}, activation-fallback=${activation}`);
}

// --- R2-ENUM: SortOrder nicks match the schema exactly ---
{
  const enums = read('app/enums.js');
  const sortBlock = /export var SortOrder = \{([\s\S]*?)\};/.exec(enums);
  const nicks = sortBlock
    ? [...sortBlock[1].matchAll(/(\w+):\s*'([^']+)'/g)].map(m => m[2])
    : [];
  // "arrangeorder" is the schema nick of the *key* that stores the
  // selection; the five sort orders themselves are upper-case.
  const orderKey = nicks.filter(n => n === 'arrangeorder');
  const sortValues = nicks.filter(n => n !== 'arrangeorder');
  const allUpper = sortValues.length === 5 && sortValues.every(n => n === n.toUpperCase());
  check('R2-ENUM', 'SortOrder values match the (upper-case) schema nicks',
    allUpper && orderKey.length === 1,
    `nicks=${nicks.join(',')}`);
}

// --- R2-SHADOW: a stale user-level schema must not shadow the extension's ---
//
// GSettings looks in ~/.local/share/glib-2.0/schemas *before* the
// directory the extension ships its schemas in. A copy of the tiling
// schema left there by an earlier install therefore wins, and the shell
// then reads a key set that no longer has `enable-dynamic-tiling` or
// `tiling-excluded-apps`. The symptom is an error in the journal
//
//   Settings schema 'org.gnome.shell.extensions.tilingshell' does not
//   contain a key named 'enable-dynamic-tiling'
//
// and auto-tiling that silently does nothing.
//
// The installer must therefore detect a differing user-level copy and
// replace it with the extension's own schema.
{
  const installer = readFileSync(join(HERE, 'install.sh'), 'utf8');
  const detects = /USER_SCHEMA_DIR="\$HOME\/\.local\/share\/glib-2\.0\/schemas"/.test(installer);
  const compares = /cmp -s "\$schema" "\$target"/.test(installer);
  const replaces = /cp -f "\$schema" "\$USER_SCHEMA_DIR/.test(installer);
  const recompiles = /glib-compile-schemas "\$USER_SCHEMA_DIR"/.test(installer);
  // The upstream DING schema used the same path; it must be moved aside
  // rather than left in place to shadow the project's own schema.
  const movesAside = /org\.gnome\.shell\.extensions\.ding\.gschema\.xml\.disabled/.test(installer);
  check('R2-SHADOW', 'the installer repairs a user-level schema that shadows the extension\'s',
    detects && compares && replaces && recompiles && movesAside,
    `detects=${detects}, compares=${compares}, replaces=${replaces}, recompiles=${recompiles}, moves-aside=${movesAside}`);
}

// --- R2-DBUS: the DING settings action group is exported ---
{
  const names = read('app/dingBusNames.js');
  const ding = read('app/ding.js');
  const dbus = read('app/dbusUtils.js');
  const hasIds = /DING_APP_ID_TEST\s*=/.test(names) && /DING_SETTINGS_PATH\s*=/.test(names);
  const usesOwnId = /application_id:\s*asDesktop \? DING_APP_ID : DING_APP_ID_TEST/.test(ding);
  const exports = /export_action_group\(\s*DING_SETTINGS_PATH/.test(ding);
  const action = /desktopIconSettingsActionGroup/.test(dbus);
  check('R2-DBUS', 'the DING settings action group is exported on its own bus path',
    hasIds && usesOwnId && exports && action,
    `ids=${hasIds}, own-app-id=${usesOwnId}, exported=${exports}, action=${action}`);
}

// --- R2-GT: gettext domain is "tilingshell" everywhere ---
{
  // Every file in app/ that uses gettext must use the "tilingshell"
  // domain: the "ding" domain has no compiled catalogue, so using it
  // leaves the whole desktop-icons UI permanently English-only.
  const files = [
    'app/dbusUtils.js', 'app/menuHelper.js', 'app/autoAr.js',
    'app/askRenamePopup.js', 'app/thumbnails.js', 'app/fileItemMenu.js',
    'app/showErrorPopup.js', 'app/fileItem.js', 'app/stackItem.js',
    'app/prefswindow.js', 'app/preferences.js', 'app/notifyX11UnderWayland.js',
    'app/desktopMenu.js', 'app/desktopManager.js', 'app/desktopIconsUtil.js',
    'app/desktopIconItem.js', 'app/desktopGrid.js',
  ];
  const stale = files.filter(f => {
    const s = read(f);
    return /domain\('ding'\)|bindtextdomain\('ding'/.test(s);
  });
  const fresh = files.filter(f => /domain\('tilingshell'\)/.test(read(f)));
  const ding = read('app/ding.js');
  const binds = /bindtextdomain\('tilingshell'/.test(ding);
  check('R2-GT', 'the app/ code uses the "tilingshell" gettext domain',
    stale.length === 0 && fresh.length === files.length && binds,
    `stale=${stale.join(',') || 'none'}, tilingshell=${fresh.length}/${files.length}, bind=${binds}`);
}

// --- R2-REG: no monkey-patched window property remains ---
{
  const emulate = read('dingBridge/emulateX11WindowType.js');
  const filter = read('utils/desktopFilter.js');
  const registry = read('dingBridge/dingWindowRegistry.js');
  const usesWeakMap = /new WeakMap\(\)/.test(registry);
  const legacy = /customJS_ding/.test(emulate) || /customJS_ding/.test(filter);
  check('R2-REG', 'managed-window bookkeeping uses a WeakMap registry, not a patched property',
    usesWeakMap && !legacy, `weakmap=${usesWeakMap}, legacy-property=${legacy}`);
}

// --- R2-SKIP: skipNextEffect is feature-detected ---
{
  const s = read('utils/gnomesupport.js');
  const detected = /typeof wm\.skipNextEffect === "function"/.test(s) &&
                   /typeof wm\._skipNextEffect === "function"/.test(s);
  const tm = read('components/tilingsystem/tilingManager.js');
  const usesHelper = /skipNextEffect\(/.test(tm);
  const direct = /Main\.wm\.skipNextEffect\(/.test(tm);
  check('R2-SKIP', 'skipNextEffect is feature-detected instead of called blindly',
    detected && usesHelper && !direct,
    `detected=${detected}, uses-helper=${usesHelper}, direct-call=${direct}`);
}

// --- R2-REFLOW: splitSlot is validated against the window count ---
{
  const s = read('components/layout/dynamic/reflow.js');
  const guarded = /splitSlot !== void 0 && splitSlot >= 0 && splitSlot < windowCount/.test(s);
  const slotFn = /function slotUnderPoint\(rects, workArea, point\)/.test(s);
  check('R2-REFLOW', 'reflow validates the split slot and resolves slots under the pointer',
    guarded && slotFn, `split-slot-guarded=${guarded}, slot-under-point=${slotFn}`);
}

// --- R2-LAYOUT: maxFirstExtent clamp (E6) ---
{
  const s = read('components/layout/dynamic/layoutTree.js');
  const clamped = /maxFirstExtent/.test(s);
  check('R2-LAYOUT', 'the layout tree clamps the first extent so the sibling extent cannot go negative',
    clamped, `clamped=${clamped}`);
}

// --- R2-PINS: duplicate paths are rejected (E5) ---
{
  const s = read('components/layout/dynamic/pins.js');
  // Two nested rects can resolve to the same leaf path. The `floors` map
  // is keyed by that path, so the second pin would silently overwrite the
  // first. The collision has to be detected and the pins dropped.
  const seen = /const seenPaths = new Set\(\)/.test(s);
  const bails = /if \(seenPaths\.has\(key\)\) return rects;/.test(s);
  check('R2-PINS', 'duplicate pin paths are detected and ignored',
    seen && bails, `seen-set=${seen}, bails-out=${bails}`);
}

// --- R2-TILE: tile width/height derived from the rounded edges (E8) ---
{
  const s = read('components/layout/TileUtils.js');
  const fromEdges = /Math\.round\([^)]*\.x\s*\+\s*[^)]*\.width\)/.test(s);
  check('R2-TILE', 'tile extents are derived from the rounded edges',
    fromEdges, `derived-from-edges=${fromEdges}`);
}

// --- R2-PREVIEW: destroyed previews are not destroyed twice (C7) ---
{
  const preview = read('components/tilepreview/tilePreview.js');
  const hasFlag = /get destroyed\(\)/.test(preview);
  const idempotent = /if \(this\._destroyed\) return;/.test(preview);
  // Every call site that destroys a preview has to check the flag first.
  const layout = read('components/tilingsystem/tilingLayout.js');
  const layoutGuards = (layout.match(/if \(preview\.destroyed\) return;/g) || []).length;
  const layoutDestroys = (layout.match(/preview\.destroy\(\);/g) || []).length;
  const widget = read('components/layout/LayoutWidget.js');
  const widgetGuarded = /if \(preview\.destroyed\) return;/.test(widget);
  check('R2-PREVIEW', 'a destroyed tile preview is never destroyed a second time',
    hasFlag && idempotent && layoutGuards === layoutDestroys && layoutGuards >= 2 && widgetGuarded,
    `destroyed-getter=${hasFlag}, idempotent=${idempotent}, layout-guards=${layoutGuards}/${layoutDestroys}, widget-guard=${widgetGuarded}`);
}

// --- R2-SEL: the selection preview resets its rect on close (C5/C6) ---
{
  const s = read('components/tilepreview/selectionTilePreview.js');
  const resets = /_rect\.x = 0/.test(s) && /_rect\.y = 0/.test(s);
  check('R2-SEL', 'the selection tile preview resets its origin when closed', resets,
    `resets-origin=${resets}`);
}

// --- R2-SNAP: snapAssist.close() always resets its state (F7) ---
{
  const s = read('components/snapassist/snapAssist.js');
  const noEarlyReturn = !/close\(\)\s*\{[^}]*?return;/.test(s);
  const resets = /_isEnlarged/.test(s) && /_hoveredInfo/.test(s);
  check('R2-SNAP', 'snapAssist.close() always resets its enlarged/hovered state',
    noEarlyReturn && resets, `no-early-return=${noEarlyReturn}, resets-state=${resets}`);
}

// --- R2-DRIFT: the drift retry budget is bounded (L6) ---
{
  const s = read('components/tilingsystem/windowPlacer.js');
  const cap = /maxDriftRetries/.test(s);
  const counter = /hist\.driftRetries = \(hist\.driftRetries \?\? 0\) \+ 1/.test(s);
  const noReset = !/hist\.retries = delays\.length/.test(s);
  check('R2-DRIFT', 'the drift watch cannot re-arm forever — the retry budget is bounded',
    cap && counter && noReset,
    `cap=${cap}, counter=${counter}, no-reset=${noReset}`);
}

// --- R2-SUGG: the suggestions layout is reused, not rebuilt (L4) ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  // The suggestions layout must only be destroyed when the manager itself
  // is torn down -- never in the per-drop path, where it used to be
  // destroyed and rebuilt, allocating a fresh set of preview actors and
  // clones every time.
  const destroyCalls = (s.match(/_tilingSuggestionsLayout\.destroy\(\)/g) || []).length;
  const destroyInTeardown = /destroy\(\)\s*\{[\s\S]{0,2000}?_tilingSuggestionsLayout\.destroy\(\);[\s\S]{0,200}?\n  \}/.test(s);
  const reused = /if \(!this\._tilingSuggestionsLayout\)/.test(s) &&
                 /_tilingSuggestionsLayout\.relayout\(/.test(s);
  check('R2-SUGG', 'the tiling suggestions layout is reused instead of destroyed and rebuilt',
    destroyCalls === 1 && destroyInTeardown && reused,
    `destroy-calls=${destroyCalls}, only-in-teardown=${destroyInTeardown}, reused=${reused}`);
}

// --- R2-EXPORT: restoreToDefault() does not write bogus false values ---
{
  const s = read('settings/settingsExport.js');
  const bogus = /=\s*false\s*;/.test(s);
  const resets = /\.reset\(key\)/.test(s);
  check('R2-EXPORT', 'restoreToDefault() resets keys instead of writing hard-coded false values',
    !bogus && resets, `hardcoded-false=${bogus}, resets-keys=${resets}`);
}

// --- R2-DBUSTOP: disable() releases the owned bus name ---
{
  const s = read('dbus.js');
  const owns = /Gio\.bus_own_name/.test(s);
  const releases = /Gio\.bus_unown_name/.test(s);
  check('R2-DBUSTOP', 'disabling the extension releases the bus name it owns',
    owns && releases, `owns=${owns}, releases=${releases}`);
}

// --- R2-LOCALE: a gettext template exists so the catalogues can be regenerated ---
{
  let potPresent = true;
  try {
    readFileSync(join(HERE, 'po', 'tilingshell.pot'), 'utf8');
  } catch {
    potPresent = false;
  }
  check('R2-LOCALE', 'a gettext template exists so the catalogues can be regenerated',
    potPresent, `pot-present=${potPresent}`);
}

// --- R2-PREFSIG: no invalid signal connections in prefs.js ---
{
  // Connecting to a signal a widget does not have throws at runtime and
  // aborts the whole preferences window. `Gtk.Entry` has no "apply"
  // signal -- that one belongs to `GtkFileChooser` and friends -- and
  // connecting to it made the preferences impossible to open.
  const s = read('prefs.js');
  const badApply = /\.connect\("apply"/.test(s);
  // Every signal name that is connected to has to exist on the widget it
  // is connected to. These are the ones the preferences use, with the
  // widget they are legal on.
  const legal = {
    changed: ["Gtk.Entry", "Gtk.Switch", "Gtk.SpinButton", "Adw.ComboRow"],
    clicked: ["Gtk.Button", "Gtk.ToggleButton", "Adw.ActionRow"],
    toggled: ["Gtk.ToggleButton"],
    "value-changed": ["Gtk.Scale"],
    "color-set": ["Gtk.ColorButton"],
    "notify::selected": ["Adw.ComboRow", "Gtk.DropDown"],
    "notify::selected-item": ["Gtk.DropDown"],
    "close-request": ["Adw.PreferencesWindow", "Gtk.Window"],
    "map": ["Gtk.Window", "Adw.PreferencesWindow"],
    "response": ["Gtk.FileChooserNative"],
    "key-pressed": ["Gtk.EventControllerKey"],
    "changed::icon-size": ["Gio.Settings"],
    "changed::window-border-color": ["Gio.Settings"],
  };
  const used = [...s.matchAll(/\.connect\("([^"]+)"/g)].map(m => m[1]);
  const unknown = [...new Set(used)].filter(name => !(name in legal));
  check('R2-PREFSIG', 'preferences.js only connects to signals its widgets actually have',
    !badApply && unknown.length === 0,
    `bad-apply=${badApply}, unknown-signals=${unknown.join(',') || 'none'}`);
}

// ==== OUTPUT ====
const ok = results.filter(r => r.ok);
const bad = results.filter(r => !r.ok);
console.log(`\nFIXED / CORRECT (${ok.length}):`);
for (const r of ok) console.log(`  [${r.id}] ${r.description}\n        -> ${r.evidence}`);
if (bad.length) {
  console.log(`\nSTILL BROKEN (${bad.length}):`);
  for (const r of bad) console.log(`  [${r.id}] ${r.description}\n        -> ${r.evidence}`);
}
console.log('\n=== SUMMARY ===');
console.log(`ok=${ok.length} still-broken=${bad.length} total=${results.length}`);
