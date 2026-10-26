// Static verification for the DING desktop-refresh debounce/single-flight fix.
// Run with: node verify_ding_refresh.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src', 'app', 'desktopManager.js');

const raw = readFileSync(SRC, 'utf8');
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const code = stripComments(raw);

function findMethod(name) {
  const m = new RegExp(`^    (?:async\\s+)?${name}\\s*\\(`, 'm').exec(code);
  if (!m) return null;
  const brace = code.indexOf('{', m.index);
  if (brace === -1) return null;
  let depth = 0;
  for (let i = brace; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return { start: m.index, body: code.slice(brace, i + 1) };
    }
  }
  return null;
}

const results = [];
const check = (id, description, ok, evidence) => {
  results.push({ id, description, ok, evidence });
};

const count = (pattern) => (code.match(pattern) || []).length;
const scheduleMethod = findMethod('_scheduleDesktopUpdate');
const updateMethod = findMethod('_updateDesktop');
const readMethod = findMethod('_doReadAsync');
const monitorMethod = findMethod('_updateDesktopIfChanged');
const scheduleBody = scheduleMethod?.body || '';
const updateBody = updateMethod?.body || '';
const readBody = readMethod?.body || '';
const monitorBody = monitorMethod?.body || '';
const sigterm = /this\._sigtermID = signalAdd\([\s\S]*?return false;/.exec(code)?.[0] || '';

// --- Scheduler ---
{
  const debounce = /const DESKTOP_UPDATE_DEBOUNCE_MS = (\d+);/.exec(code);
  const ms = debounce ? Number(debounce[1]) : NaN;
  check('S1', 'debounce window is 150-250 ms',
    ms >= 150 && ms <= 250, `DESKTOP_UPDATE_DEBOUNCE_MS=${debounce ? ms : 'missing'}`);
}
check('S2', 'one scheduler method owns the debounce timer',
  scheduleBody.length > 0 &&
  scheduleBody.includes('GLib.timeout_add') &&
  scheduleBody.includes('_desktopUpdateRequested = true') &&
  scheduleBody.includes('if (this._desktopUpdateSourceId)'),
  `found=${scheduleBody.length > 0}, single-pending-guard=${scheduleBody.includes('if (this._desktopUpdateSourceId)')}`);
check('S3', 'only one debounce timeout is created',
  (scheduleBody.match(/GLib\.timeout_add\(/g) || []).length === 1 &&
  count(/this\._desktopUpdateSourceId = GLib\.timeout_add\(/g) === 1,
  `debounce-timeouts=${count(/this\._desktopUpdateSourceId = GLib\.timeout_add\(/g)}`);
check('S4', 'the timeout clears its source id before refreshing',
  /this\._desktopUpdateSourceId = 0;[\s\S]{0,200}this\._updateDesktop\(\)/.test(scheduleBody),
  'source-id-cleared-before-update');
check('S5', 'scheduler ignores requests after forced exit',
  /if \(this\._forcedExit\)\s*return;/.test(scheduleBody), 'forced-exit-guard');

// --- Call sites ---
{
  const direct = [...code.matchAll(/this\._updateDesktop\(\)/g)];
  const initial = /\/\/ Initial load runs immediately[\s\S]{0,200}?this\._updateDesktop\(\)/.test(raw);
  const inScheduler = direct.some(m => scheduleMethod &&
    m.index >= scheduleMethod.start &&
    m.index < scheduleMethod.start + scheduleBody.length);
  check('C1', 'only the initial load calls _updateDesktop() directly',
    direct.length === 2 && initial && inScheduler,
    `direct-calls=${direct.length}, initial-documented=${initial}, scheduler-call=${inScheduler}`);
}
check('C2', 'event-driven call sites use the scheduler',
  count(/this\._scheduleDesktopUpdate\(/g) >= 10,
  `scheduled-call-sites=${count(/this\._scheduleDesktopUpdate\(/g)}`);
check('C3', 'directory monitor goes through the scheduler',
  monitorBody.includes('this._scheduleDesktopUpdate(') &&
  !monitorBody.includes('this._updateDesktop()'),
  `scheduled=${monitorBody.includes('this._scheduleDesktopUpdate(')}, direct=${monitorBody.includes('this._updateDesktop()')}`);

// --- Single flight ---
check('F1', 'a request during a running pass is folded into one follow-up',
  /if \(this\._readingDesktopFiles\)\s*\{[\s\S]{0,200}this\._desktopUpdateRequested = true;/.test(updateBody),
  'reading-guard-sets-request');
check('F2', 'pass loop runs while a request is pending',
  /do\s*\{[\s\S]*\} while \(this\._desktopUpdateRequested && !this\._forcedExit\);/.test(updateBody),
  'do-while-present');
check('F3', 'invalidated enumerations are rejected before any draw',
  (() => {
    const nullCheck = updateBody.indexOf('if (fileList === null)');
    const draw = updateBody.indexOf('this._drawDesktop(fileList)');
    const readGuard = readBody.indexOf('if (this._desktopUpdateRequested)');
    const build = readBody.indexOf('getExtraFolders()');
    return nullCheck !== -1 && draw !== -1 && nullCheck < draw &&
      readGuard !== -1 && build !== -1 && readGuard < build;
  })(), 'null-not-drawn, read-guard-before-build');
check('F4', '_updateDesktop keeps its try/finally and clears the reading flag',
  updateBody.includes('try {') && updateBody.includes('} finally {') &&
  /finally\s*\{\s*this\._readingDesktopFiles = false;/.test(updateBody),
  'try-finally-present');

// --- Old retry loop removed ---
check('R1', 'fixed 500 ms retry loop is gone',
  !code.includes('waitDelayMs(500)') && !code.includes('_lastDesktopUpdateRequest'),
  `waitDelayMs500=${code.includes('waitDelayMs(500)')}, lastRequest=${code.includes('_lastDesktopUpdateRequest')}`);
check('R2', '_forceDraw heuristic is gone',
  !code.includes('_forceDraw'), `forceDraw=${code.includes('_forceDraw')}`);

// --- Cancellation / teardown ---
check('T1', 'SIGTERM removes the debounce source and cancels the read',
  sigterm.includes('_forcedExit = true') &&
  sigterm.includes('_clearDesktopUpdateSource()') &&
  sigterm.includes('_desktopEnumerateCancellable.cancel()'),
  `forcedExit=${sigterm.includes('_forcedExit = true')}, sourceRemoved=${sigterm.includes('_clearDesktopUpdateSource()')}, readCancelled=${sigterm.includes('_desktopEnumerateCancellable.cancel()')}`);
check('T2', 'only one cancellable is created for the live read',
  count(/new Gio\.Cancellable\(\)/g) === 1,
  `cancellables=${count(/new Gio\.Cancellable\(\)/g)}`);
check('T3', 'the enumerable cancellable is cleared only by its owner',
  readBody.includes('if (this._desktopEnumerateCancellable === cancellable)') &&
  readBody.includes('this._desktopEnumerateCancellable = null'),
  'owner-check-present');
check('T4', 'failed or cancelled reads destroy partial FileItems',
  /catch\s*\{[\s\S]*?_destroyFileList\(fileList\)/.test(readBody),
  'cleanup-in-catch');
check('T5', 'the read path is still single-enumeration',
  count(/enumerate_children_async\(/g) === 1,
  `enumerations=${count(/enumerate_children_async\(/g)}`);

// --- Preserved semantics ---
check('P1', 'directory enumeration keeps attributes, extras, mounts and hidden filter',
  readBody.includes('Enums.DEFAULT_ATTRIBUTES') &&
  readBody.includes('getExtraFolders()') &&
  readBody.includes('getMounts(') &&
  readBody.includes('this._showHidden'),
  'attributes-extras-mounts-hidden');
check('P2', 'pending drop coordinates are still applied',
  readBody.includes('_pendingDropFiles'), `pendingDrops=${readBody.includes('_pendingDropFiles')}`);
check('P3', 'one draw per completed pass',
  count(/this\._drawDesktop\(fileList\)/g) === 1,
  `draw-calls=${count(/this\._drawDesktop\(fileList\)/g)}`);

// --- Ownership ---
check('O1', 'no pointer tracker call in the DING manager',
  !code.includes('global.get_pointer('), `getPointer=${code.includes('global.get_pointer(')}`);
check('O2', 'no tiling-core imports in the DING manager',
  !code.includes('components/tilingsystem'), `tilingImport=${code.includes('components/tilingsystem')}`);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id}: ${r.description} (${r.evidence})`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);

if (failed) {
  console.log('DING refresh verification FAILED');
  process.exit(1);
}
console.log('DING refresh verification PASSED');
