// verify_audit_round5.mjs
// Verifies Round-5 audit fixes: D1 to D9 and re-checks T1, T2, T6, T9

import assert from "node:assert";
import fs from "node:fs";

console.log("=== Round-5 Audit Verification (D1 to D9 & Re-checks) ===");

// 1. D1: Extension instance exports DesktopIconsUsableArea and SetMarginsForExtension
{
  const extContent = fs.readFileSync("src/extension.js", "utf8");
  assert(
    extContent.includes("this.DesktopIconsUsableArea = this._dingBridge?.visibleArea;"),
    "D1: extension.js must expose DesktopIconsUsableArea on extension instance"
  );
  assert(
    extContent.includes("this.DesktopIconsUsableArea = null;"),
    "D1: extension.js must clear DesktopIconsUsableArea on disable"
  );
  assert(
    extContent.includes("SetMarginsForExtension(extensionUUID, marginsJson)"),
    "D1: extension.js must provide SetMarginsForExtension method"
  );

  const dbusContent = fs.readFileSync("src/dbus.js", "utf8");
  assert(
    dbusContent.includes('name="SetMarginsForExtension"'),
    "D1: dbus.js must export SetMarginsForExtension in D-Bus interface"
  );
  console.log("  ok  : D1 DesktopIconsUsableArea and SetMarginsForExtension verified");
}

// 2. D2: visibleArea handles monitor keys and -1 for primary monitor
{
  const visibleAreaContent = fs.readFileSync("src/dingBridge/visibleArea.js", "utf8");
  assert(
    visibleAreaContent.includes("for (const monitorKey in margins)"),
    "D2: visibleArea.js must iterate monitor keys, not workspace"
  );
  assert(
    visibleAreaContent.includes("Number(monitorKey) < 0"),
    "D2: visibleArea.js must map negative monitor keys to primary index"
  );
  assert(
    visibleAreaContent.includes("isPrimary && !lookupKeys.includes(\"-1\")"),
    "D2: visibleArea.js must check primary monitor key in getMonitorGeometry"
  );
  console.log("  ok  : D2 monitor margins key and primary monitor resolution verified");
}

// 3. D5: dingBridge.js getDesktopGeometry fallback uses real monitor geometry
{
  const bridgeContent = fs.readFileSync("src/dingBridge/dingBridge.js", "utf8");
  assert(
    bridgeContent.includes("const mon = Main.layoutManager.monitors[monitorIndex];"),
    "D5: getDesktopGeometry must look up monitor object"
  );
  assert(
    bridgeContent.includes("width: mon?.width ?? 1920,"),
    "D5: getDesktopGeometry must use mon.width instead of hardcoded 1920"
  );
  assert(
    bridgeContent.includes("height: mon?.height ?? 1080,"),
    "D5: getDesktopGeometry must use mon.height instead of hardcoded 1080"
  );
  console.log("  ok  : D5 getDesktopGeometry monitor bounds fallback verified");
}

// 4. D6 & T1: Prefs window cleanup and keybindings dialog destruction
{
  const prefsContent = fs.readFileSync("src/prefs.js", "utf8");
  assert(
    prefsContent.includes("window.connect(\"destroy\", cleanupPrefs);"),
    "D6/T1: prefs.js must clean up on destroy signal"
  );
  assert(
    prefsContent.includes("keybindingsDialog?.destroy();"),
    "D6/T1: prefs.js must destroy keybindingsDialog on window destruction"
  );
  console.log("  ok  : D6 & T1 prefs window and child dialog destruction verified");
}

// 5. D7: tilingManager destroy protects all subcomponent teardown with try/catch
{
  const tmContent = fs.readFileSync("src/components/tilingsystem/tilingManager.js", "utf8");
  assert(
    tmContent.includes("try { tl.destroy(); } catch {}"),
    "D7: tilingManager.destroy must catch errors from workspace tiling layout teardown"
  );
  assert(
    tmContent.includes("try { this._snapAssist?.destroy(); } catch {}"),
    "D7: tilingManager.destroy must catch errors from snapAssist teardown"
  );
  assert(
    tmContent.includes("try { this._selectedTilesPreview?.destroy(); } catch {}"),
    "D7: tilingManager.destroy must catch errors from selectedTilesPreview teardown"
  );
  assert(
    tmContent.includes("try { this._tilingSuggestionsLayout?.destroy(); } catch {}"),
    "D7: tilingManager.destroy must catch errors from suggestions layout teardown"
  );
  console.log("  ok  : D7 tilingManager teardown error handling verified");
}

// 6. D8: overriddenWindowMenu enables scaling across all monitors
{
  const menuContent = fs.readFileSync("src/components/window_menu/overriddenWindowMenu.js", "utf8");
  assert(
    !menuContent.includes("window.get_monitor() === Main.layoutManager.primaryIndex;"),
    "D8: enableScaling must not be restricted to primary monitor"
  );
  assert(
    menuContent.includes("const enableScaling = Boolean(scalingFactor);"),
    "D8: enableScaling must enable scaling support whenever scalingFactor is present"
  );
  console.log("  ok  : D8 window menu multi-monitor scaling verified");
}

// 7. D9: LayoutTileButtons outerGapSize defaults to 0
{
  const ltbContent = fs.readFileSync("src/components/window_menu/layoutTileButtons.js", "utf8");
  assert(
    ltbContent.includes("constructor(parent, layout, gapSize, height, width, outerGapSize = 0)"),
    "D9: LayoutTileButtons constructor must support outerGapSize defaulting to 0"
  );
  assert(
    ltbContent.includes("outerGaps: buildMarginOf(outerGapSize)"),
    "D9: LayoutTileButtons must use outerGapSize for outerGaps"
  );
  console.log("  ok  : D9 LayoutTileButtons outer gap default verified");
}

// 8. T2: _updateShortcut preserves customized backward shortcut
{
  const prefsContent = fs.readFileSync("src/prefs.js", "utf8");
  assert(
    prefsContent.includes("currentBackward === `<Shift>${oldVal}`"),
    "T2: _updateShortcut must only overwrite backward key if it matches old derived value"
  );
  console.log("  ok  : T2 custom backward shortcut preservation verified");
}

// 9. T9: windowBorder.js borderWidth === _scaledBorderWidth
{
  const wbContent = fs.readFileSync("src/components/windowBorder/windowBorder.js", "utf8");
  assert(
    wbContent.includes("this._scaledBorderWidth = borderWidth;"),
    "T9: windowBorder.js must ensure borderWidth === _scaledBorderWidth"
  );
  assert(
    wbContent.includes("val + Settings.WINDOW_BORDER_WIDTH"),
    "T9: windowBorder.js must add unscaled WINDOW_BORDER_WIDTH to radius before scaling"
  );
  console.log("  ok  : T9 border width coordinate space parity verified");
}

// 10. D4: metadata.json version is 105 / 1.0.5
{
  const metadata = JSON.parse(fs.readFileSync("src/metadata.json", "utf8"));
  assert.strictEqual(metadata.version, 105, "D4: version must be 105");
  assert.strictEqual(metadata["version-name"], "1.0.5", "D4: version-name must be 1.0.5");
  const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
  assert(changelog.includes("## [1.0.5]"), "D4: CHANGELOG.md must contain [1.0.5] entry");
  console.log("  ok  : D4 version 105 / 1.0.5 and CHANGELOG entry verified");
}

console.log("\n=== ALL ROUND-5 AUDIT CHECKS PASSED ===");
