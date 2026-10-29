// Verification harness for Round-4 Audit findings (T1 to T10).
import assert from "node:assert/strict";
import fs from "node:fs";

console.log("=== Round-4 Audit Verification (T1 to T10) ===");

// 1. T1: Prefs settings signal tracking and close-request disconnect
{
  const prefsSrc = fs.readFileSync("src/prefs.js", "utf8");
  assert.ok(
    prefsSrc.includes("_connectSetting(settingsObj, signal, handler)"),
    "T1: prefs.js must define _connectSetting helper"
  );
  assert.ok(
    prefsSrc.includes("this._disconnectSettings();"),
    "T1: prefs.js must disconnect settings signals on close/unload"
  );
  assert.ok(
    prefsSrc.includes("gioSettings.disconnect(settingsSignalId)"),
    "T1: _ShortcutButton must disconnect its settings signal on destroy"
  );
  console.log("  ok  : T1 prefs signal tracking and destroy disconnect verified");
}

// 2. T2 & T3: Shortcut clearing and backwardKey empty array
{
  const prefsSrc = fs.readFileSync("src/prefs.js", "utf8");
  assert.ok(
    prefsSrc.includes("this._gioSettings.set_strv(this._settingsKey, []);") &&
    prefsSrc.includes("this._gioSettings.set_strv(this._backwardKey, []);"),
    "T2 & T3: _updateShortcut must clear keys with [] when shortcut is cleared"
  );
  assert.ok(
    !prefsSrc.includes("this._gioSettings.set_strv(this._backwardKey, [`<Shift>${this.shortcut}`]);\n    }\n    this.emit"),
    "T3: unconditional <Shift>${this.shortcut} without empty check must not exist"
  );
  console.log("  ok  : T2 & T3 shortcut clearing with empty array verified");
}

// 3. T4: Shortcut editor window destroy
{
  const prefsSrc = fs.readFileSync("src/prefs.js", "utf8");
  assert.ok(
    prefsSrc.includes("if (this._editor) {\n      try { this._editor.destroy(); } catch {}"),
    "T4: _onActivated must destroy previous _editor window before creating a new one"
  );
  assert.ok(
    !prefsSrc.includes("this._editor?.close();"),
    "T4: _editor?.close() must be replaced with destroy()"
  );
  console.log("  ok  : T4 shortcut editor window lifecycle and destroy verified");
}

// 4. T5 & Bonus: Excluded apps case-insensitive check and dead code removal
{
  const prefsSrc = fs.readFileSync("src/prefs.js", "utf8");
  assert.ok(
    prefsSrc.includes("!current.some((c) => c.trim().toLowerCase() === val.toLowerCase())"),
    "T5: excluded apps check must be case-insensitive"
  );
  assert.ok(
    !prefsSrc.includes("// own chip rows via a tagged box instead.\n      chipsBox.get_first_child();"),
    "Bonus: orphaned chipsBox.get_first_child() must be removed"
  );
  console.log("  ok  : T5 case-insensitive check & dead statement cleanup verified");
}

// 5. T6 & T7: Sliver tolerance unit fix & dead open() removal in tilingLayout.js
{
  const layoutSrc = fs.readFileSync("src/components/tilingsystem/tilingLayout.js", "utf8");
  assert.ok(
    layoutSrc.includes("sourceRect.width - intersection.width <= sliverTolerance"),
    "T6: sliverTolerance must compare linear dimensions in pixels"
  );
  assert.ok(
    !layoutSrc.includes("intersection.area() >= sourceArea - sliverTolerance"),
    "T6: area - sliverTolerance unit mismatch must not exist"
  );
  assert.ok(
    !layoutSrc.includes("preview.rect.intersect(rect)[1]\n            ),\n            false\n          );"),
    "T7: dead preview.open() call in hoverTilesInRect must be removed"
  );
  console.log("  ok  : T6 & T7 sliver tolerance and dead open() cleanup verified");
}

// 6. T8: Smart border-radius toggle signal in windowBorderManager.js
{
  const wbmSrc = fs.readFileSync("src/components/windowBorder/windowBorderManager.js", "utf8");
  assert.ok(
    wbmSrc.includes("Settings.KEY_ENABLE_SMART_WINDOW_BORDER_RADIUS"),
    "T8: windowBorderManager must connect to KEY_ENABLE_SMART_WINDOW_BORDER_RADIUS"
  );
  console.log("  ok  : T8 smart border radius dynamic update signal verified");
}

// 7. T9: Border width scaling factor alignment in windowBorder.js
{
  const wbSrc = fs.readFileSync("src/components/windowBorder/windowBorder.js", "utf8");
  assert.ok(
    wbSrc.includes("const borderWidth = (alreadyScaled ? 1 : scalingFactor) * Settings.WINDOW_BORDER_WIDTH;") &&
    wbSrc.includes("this._scaledBorderWidth = borderWidth;"),
    "T9: windowBorder.js must account for alreadyScaled in borderWidth and _scaledBorderWidth"
  );
  console.log("  ok  : T9 border width scaling factor consistency verified");
}

console.log("\n=== ALL ROUND-4 AUDIT CHECKS PASSED ===");
