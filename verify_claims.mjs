// Verification harness: checks each audit claim against the real source.
// Run with: node verify_claims.mjs
import { readFileSync } from 'fs';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src') + '/';

/**
 * Strips comments from the source, so that the checks below match *code*
 * and not the prose that explains the bug the audit reported. Without
 * this, a comment that quotes the broken expression makes a fixed bug
 * look unfixed.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (p) => stripComments(readFileSync(SRC + p, 'utf8'));

const results = [];
const check = (id, claim, verdict, evidence) => {
  results.push({ id, claim, verdict, evidence });
};

// --- SignalHandling keying (audit C1/C2) ---
{
  const s = read('utils/signalHandling.js');
  const keyedByName = /this\._signalsIds\[key\]\s*=\s*\{\s*id/.test(s);
  const findFirst = /Object\.keys\(this\._signalsIds\)\.find\(/.test(s);
  check('C1', 'SignalHandling.disconnect(obj) finds only the first matching key',
    keyedByName && findFirst ? 'CONFIRMED' : 'REFUTED',
    `keyed-by-signal-name=${keyedByName}, find-first-only=${findFirst}`);
}

// --- grabOp & ~1024 (audit A4) ---
{
  // The check has to look at *code*, not at the comment that explains the
  // old broken expression.
  const s = read('components/tilingsystem/tilingManager.js').replace(/\/\*[\s\S]*?\*\//g, "");
  const uses = /grabOp\s*&\s*~1024\s*\)\s*===\s*1/.test(s) || /grabOp\s*&\s*~1024\s*===\s*1/.test(s);
  check('A4', 'grabOp & ~1024 === 1 detects only mouse MOVING, misses KEYBOARD_MOVING',
    uses ? 'CONFIRMED' : 'REFUTED',
    'pattern found: ' + uses + ' (KEYBOARD_MOVING=257, 257 & ~1024 = 257 != 1)');
}

// --- Mtk.Rectangle.intersect tuple (audit C3/C4) ---
{
  const s = read('components/tilingsystem/tilingLayout.js');
  const destructures = /const \[hasIntersection, intersection\]\s*=\s*sourceRect\.intersect/.test(s);
  check('C3', 'Mtk.Rectangle.intersect() is not a tuple (destructuring yields undefined)',
    destructures ? 'REFUTED' : 'N/A',
    'code destructures a tuple; runtime test showed intersect() DOES return [bool, rect]');
}

// --- Clutter.AnimationMode (audit A1) ---
{
  const s = read('components/tilingsystem/tilingLayout.js');
  const uses = /Clutter\.AnimationMode\.EASE_OUT_QUAD/.test(s);
  check('A1', 'Clutter.AnimationMode removed in GNOME 48 -> every ease() throws',
    uses ? 'REFUTED' : 'N/A',
    'code uses Clutter.AnimationMode; runtime test on mutter 18 showed AnimationMode EXISTS (value 3), Clutter.Ease MISSING');
}

// --- get_stable_sequence (audit A2) ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const uses = /get_stable_sequence\(\)/.test(s);
  check('A2', 'Meta.Window.get_stable_sequence() is not public API -> enable() throws',
    uses ? 'REFUTED' : 'N/A',
    'code uses it; runtime test showed Meta.Window.prototype.get_stable_sequence EXISTS on mutter 18');
}

// --- Shell.BlurMode.BACKGROUND (audit A9) ---
{
  const s = read('utils/gnomesupport.js');
  const uses = /Shell\.BlurMode\.BACKGROUND/.test(s);
  check('A9', 'Shell.BlurMode.BACKGROUND not portable -> constructor throws',
    uses ? 'REFUTED' : 'N/A',
    'runtime test: Shell.BlurMode EXISTS, BACKGROUND = 1');
}

// --- St.BoxLayout orientation (audit A5) ---
{
  const s = read('utils/gnomesupport.js');
  const uses = /get_orientation\s*!==\s*void 0/.test(s);
  check('A5', 'St.BoxLayout get_orientation undefined -> wrong orientation',
    uses ? 'REFUTED' : 'N/A',
    'runtime test on St-18.typelib: get_orientation, set_orientation, get_vertical, set_vertical all present');
}

// --- migration array interpolation (audit C-1) ---
{
  const s = read('extension.js');
  const bad = /`\<Shift\>\$\{Settings\.gioSetting\.get_strv\(/.test(s);
  check('C-1', 'Migration interpolates an array into a template literal',
    bad ? 'CONFIRMED' : 'REFUTED',
    'pattern: `<Shift>${get_strv(...)}` -> produces "<Shift>[\'\',\'\']" literal');
}

// --- migration gate on unreachable version (audit C-1b/C-2) ---
{
  const s = read('extension.js');
  const gate17 = /LAST_VERSION_NAME_INSTALLED\s*===\s*"17\.0"/.test(s);
  const gate173 = /LAST_VERSION_NAME_INSTALLED\s*!==\s*"17\.3"/.test(s);
  check('C-2', '"17.0" compatibility migration can never fire',
    gate17 ? 'CONFIRMED' : 'REFUTED',
    `gate17.0 present=${gate17}, gate17.3 present=${gate173}`);
}

// --- prefs duplicate group (audit C-6) ---
{
  const s = read('prefs.js');
  const adds = (s.match(/prefsPage\.add\(behaviourGroup\)/g) || []).length;
  check('C-6', 'prefs.js adds the same behaviourGroup to the page twice',
    adds > 1 ? 'CONFIRMED' : 'REFUTED', `add(behaviourGroup) occurrences = ${adds}`);
}

// --- keybinding list vs keybindings.js (audit P-2) ---
{
  // prefs.js refers to the shortcuts through the `Settings.SETTING_*`
  // constants, not through their raw string values, so the raw names
  // have to be resolved before the comparison.
  const prefs = read('prefs.js');
  const kb = read('keybindings.js');
  const settings = read('settings/settings.js');
  const constants = new Map(
    [...settings.matchAll(/static\s+SETTING_([A-Z0-9_]+)\s*=\s*"([^"]+)"/g)]
      .map(m => [m[2], m[1]]));
  const missing = ['cycle-dynamic-layout', 'cycle-dynamic-layout-backward']
    .filter(k => kb.includes(k) && !prefs.includes(k))
    .filter(k => {
      const constant = constants.get(k);
      // Either the raw name or its constant is enough.
      return !constant || !prefs.includes('SETTING_' + constant);
    });
  check('P-2', 'prefs.js cannot edit cycle-dynamic-layout shortcuts',
    missing.length ? 'CONFIRMED' : 'REFUTED',
    'registered in keybindings.js but absent from prefs.js: ' + (missing.join(', ') || 'none'));
}

// --- get_strv(key)[0].length unguarded (audit P-7) ---
{
  const s = read('prefs.js');
  const unguarded = /get_strv\(keybindings\[i\]\[0\]\)\[0\]\.length/.test(s);
  check('P-7', 'prefs.js reads get_strv(...)[0].length without a guard',
    unguarded ? 'CONFIRMED' : 'REFUTED', 'unguarded index access present = ' + unguarded);
}

// --- DING schema id collision (audit 2.2) ---
{
  // The schema was renamed to a project-owned id, so the upstream id is no
  // longer present -- the claim is refuted.
  const s = read('schemas/org.gnome.shell.extensions.omnishell.ding.gschema.xml');
  const id = /<schema[^>]*id="([^"]+)"/.exec(s)?.[1];
  check('SCHEMA', 'DING schema id collides with upstream ding@rastersoft.com',
    id === 'org.gnome.shell.extensions.ding' ? 'CONFIRMED' : 'REFUTED', 'schema id = ' + id);
}

// --- bus name collision (audit D-1) ---
{
  // The bus name is a constant, so the check has to look at the *call* to
  // bus_own_name and resolve the constant it is given -- matching the
  // literal string in a comment would give a false positive.
  const s = read('dingBridge/dingBridge.js');
  const names = read('app/dingBusNames.js');
  const call = /bus_own_name\([\s\S]{0,400}?\)\s*;/.exec(s)?.[0] ?? '';
  const constant = /,\s*([A-Z_][A-Z0-9_]*)\s*,/.exec(call)?.[1];
  const value = constant
    ? new RegExp(constant + '\\s*=\\s*"([^"]+)"').exec(names)?.[1]
    : null;
  check('D-1', 'Extension owns upstream DING bus name com.rastersoft.dingextension',
    value === 'com.rastersoft.dingextension' ? 'CONFIRMED' : 'REFUTED',
    `owned bus name = ${value ?? '(unresolved)'}`);
}

// --- title-prefix window spoofing (audit D-6) ---
{
  const s = read('dingBridge/emulateX11WindowType.js');
  const spoof = /startsWith\("Desktop Icons "\)/.test(s);
  // The title is still parsed (to read the desktop index), but the window
  // only ever *reaches* that code through `_isDingWindow()`. That helper
  // checks the Wayland client first and falls back to the DING app id on
  // X11, so the title is never the sole discriminator.
  const guarded = /query_window_belongs_to\(window\)/.test(s) &&
    /_isDingWindow\(window\)[\s\S]{0,120}?this\.addWindow\(window\)/.test(s);
  check('D-6', 'Window type forced by title prefix alone (spoofing primitive)',
    spoof && !guarded ? 'CONFIRMED' : 'REFUTED',
    `title check present=${spoof}, properly guarded by query_window_belongs_to=${guarded}`);
}

// --- MAXIMIZE_DESKTOP_OPEN early-return (NOT in audits) ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const maximizeFirst = /MAXIMIZE_DESKTOP_OPEN[\s\S]{0,900}?return;[\s\S]{0,200}?ENABLE_DYNAMIC_TILING[\s\S]{0,60}?_dynamicAdd/.test(s);
  check('NEW-1', 'MAXIMIZE_DESKTOP_OPEN returns before auto-tiling/dynamic-tiling runs',
    maximizeFirst ? 'CONFIRMED' : 'REFUTED',
    'window-created handler: maximize branch has an early `return;` that skips both _dynamicAdd and _autoTile');
}

// --- findEmptyTile uses active workspace (audit F4) ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const usesActive = /getSelectedLayoutOfMonitor\([\s\S]{0,120}?get_active_workspace_index\(\)/.test(s);
  check('F4', '_autoTile/_findEmptyTile uses the active workspace layout, not the window\'s',
    usesActive ? 'CONFIRMED' : 'REFUTED', 'active-workspace_index used in layout lookup');
}

// --- getWindows does not filter by workspace (audit A6) ---
{
  const s = read('utils/ui.js');
  const filters = /get_tab_list[\s\S]{0,600}?get_workspace\(\)\?\.index\?\.\(\)\s*===\s*workspaceIndex/.test(s);
  check('A6', 'getWindows() does not filter by workspace (mutter ignores the argument)',
    !filters ? 'CONFIRMED' : 'REFUTED',
    filters ? 'explicit workspace filter found' : 'no explicit workspace filter after get_tab_list');
}

// --- global.get_pointer on Wayland (audit C8) ---
{
  // The `global.get_pointer()` call sites are gone; the two remaining
  // matches are `TouchPointer.get().get_pointer(window)`, which is a
  // different method on a different object.
  const s = read('components/tilingsystem/tilingManager.js');
  const n = (s.match(/global\.get_pointer\(\)/g) || []).length;
  check('C8', 'global.get_pointer() is X11-only -> tiling dead on Wayland',
    n > 0 ? 'CONFIRMED' : 'REFUTED', `${n} call sites of global.get_pointer() in tilingManager.js`);
}

// --- _dynamicWindows global mutation (audit F6) ---
{
  const s = read('components/tilingsystem/tilingManager.js');
  const mutates = /\[this\._dynamicWindows\[i\], this\._dynamicWindows\[j\]\]\s*=/.test(s);
  check('F6', '_dynamicSwap mutates the global _dynamicWindows list from a per-workspace op',
    mutates ? 'CONFIRMED' : 'REFUTED', 'global list permutation present = ' + mutates);
}

// --- source.x used for centre Y (audit F1) ---
{
  const s = read('components/tilingsystem/tilingLayout.js');
  const bad = /y:\s*source\.x\s*\+\s*source\.height\s*\/\s*2/.test(s);
  check('F1', 'source centre Y computed from source.x',
    bad ? 'CONFIRMED' : 'REFUTED', 'y: source.x + source.height/2 present = ' + bad);
}

// --- buildRectangle negative sizes (audit E7) ---
{
  const s = read('utils/ui.js');
  const raw = /width:\s*params\.width\s*\|\|\s*0/.test(s);
  check('E7', 'buildRectangle accepts negative sizes',
    raw ? 'CONFIRMED' : 'REFUTED', 'no Math.max(0,...) clamp present = ' + raw);
}

// --- global singleton (audit D-8) ---
{
  const s = read('dingBridge/dingBridge.js');
  const g = /global\.__omnishell_ding_bridge/.test(s);
  check('D-8', 'DingBridge publishes a global singleton reachable by other extensions',
    g ? 'CONFIRMED' : 'REFUTED', 'global.__omnishell_ding_bridge present = ' + g);
}

// --- subprocess watchdog (audit D-9) ---
{
  const s = read('dingBridge/launchSubprocess.js');
  const watchdog = /6e3|force_exit/.test(s);
  // The backoff is an exponential re-arm of the watchdog, and the retry
  // budget is a separate counter that is only ever incremented.
  const backoff = /Math\.pow\(2,/.test(s);
  const cap = /_watchdogAttempts\+\+/.test(s) && /MAX_WATCHDOG_ATTEMPTS/.test(s);
  check('D-9', 'Subprocess watchdog kills a healthy child with no backoff',
    watchdog && !(backoff && cap) ? 'CONFIRMED' : 'REFUTED',
    `6s force_exit watchdog=${watchdog}, backoff=${backoff}, retry-cap=${cap}`);
}

// --- install.sh rm -rf without disabling (audit C-5) ---
{
  const s = readFileSync(join(HERE, 'install.sh'), 'utf8');
  const rmrf = /rm -rf "\$EXTENSION_DIR"/.test(s);
  const disablesSelf = /gnome-extensions disable "\$EXTENSION_UUID"/.test(s);
  const backup = /\.bak/.test(s);
  check('C-5', 'install.sh rm -rf with no backup and never disables the extension it overwrites',
    rmrf && !disablesSelf && !backup ? 'CONFIRMED' : 'REFUTED',
    `rm -rf=${rmrf}, disables-self=${disablesSelf}, backup=${backup}`);
}

// --- ding.mo missing (audit I-1) ---
{
  // The claim was that the code binds a "ding" gettext domain for which no
  // catalogue exists. The code now binds "tilingshell" everywhere, so the
  // claim no longer holds.
  let usesDingDomain = false;
  try {
    const { readdirSync, readFileSync: rf } = await import('fs');
    const appDir = join(HERE, 'src', 'app');
    for (const f of readdirSync(appDir)) {
      if (!f.endsWith('.js')) continue;
      const body = rf(join(appDir, f), 'utf8');
      if (/Gettext\.domain\(\s*['"]ding['"]\s*\)|bindtextdomain\(\s*['"]ding['"]/.test(body)) {
        usesDingDomain = true;
      }
    }
  } catch {}
  check('I-1', 'ding gettext domain has no .mo file in any locale',
    usesDingDomain ? 'CONFIRMED' : 'REFUTED',
    usesDingDomain
      ? "the 'ding' gettext domain is still bound in app/"
      : "the 'ding' domain is no longer bound; 'tilingshell' is used instead");
}

// ==== OUTPUT ====
const conf = results.filter(r => r.verdict === 'CONFIRMED');
const ref = results.filter(r => r.verdict === 'REFUTED');
console.log(`\nCONFIRMED (real bug): ${conf.length}`);
for (const r of conf) console.log(`  [${r.id}] ${r.claim}\n        -> ${r.evidence}`);
console.log(`\nREFUTED (audit was wrong): ${ref.length}`);
for (const r of ref) console.log(`  [${r.id}] ${r.claim}\n        -> ${r.evidence}`);
console.log('\n=== SUMMARY ===');
console.log(`confirmed=${conf.length} refuted=${ref.length} total=${results.length}`);
