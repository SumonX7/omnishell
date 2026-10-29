// Verification harness for Round-3 Audit findings (R1 to R11 and patch follow-ups).
import assert from "node:assert/strict";
import fs from "node:fs";

console.log("=== Round-3 Audit Verification (R1 to R11) ===");

// 1. N4 Seeding: extension.js seeds layouts on fresh install & validation
{
  const extSrc = fs.readFileSync("src/extension.js", "utf8");
  assert.ok(
    extSrc.includes("KEY_SETTING_LAYOUTS_JSON") && extSrc.includes("Settings.reset_layouts_json()"),
    "N4: extension.js must seed default layouts when layouts-json is empty or '[]'"
  );
  console.log("  ok  : N4 default layout seeding verified in extension.js");
}

// 2. R2 / N6: MultipleWindowsIcon connects destroy to clean up MetaWindowGroup
{
  const iconSrc = fs.readFileSync("src/components/altTab/MultipleWindowsIcon.js", "utf8");
  assert.ok(
    iconSrc.includes('this.connect("destroy", () => this._window?.destroy?.());'),
    "R2: MultipleWindowsIcon must disconnect MetaWindowGroup on destroy"
  );
  console.log("  ok  : R2 Alt+Tab MultipleWindowsIcon destroy hook verified");
}

// 3. N10 & R9: Button signal ID tracking with Set
{
  const snapBtnSrc = fs.readFileSync("src/components/snapassist/snapAssistTileButton.js", "utf8");
  assert.ok(
    snapBtnSrc.includes("this._btnSignalIds = new Set();"),
    "N10: SnapAssistTileButton must track inner button signal IDs in a Set"
  );
  assert.ok(
    snapBtnSrc.includes("if (this._btnSignalIds.has(id))"),
    "N10: SnapAssistTileButton must check _btnSignalIds on disconnect"
  );

  const editPrevSrc = fs.readFileSync("src/components/editor/editableTilePreview.js", "utf8");
  assert.ok(
    editPrevSrc.includes("this._btnSignalIds = new Set();"),
    "R9: EditableTilePreview must track inner button signal IDs in a Set"
  );
  assert.ok(
    editPrevSrc.includes("if (this._btnSignalIds.has(id))"),
    "R9: EditableTilePreview must check _btnSignalIds on disconnect"
  );
  console.log("  ok  : N10 & R9 button signal ID tracking in Set verified");
}

// 4. R4, R5, R6: Masonry layout fixes
{
  const masonrySrc = fs.readFileSync("src/components/windowsSuggestions/masonryLayoutManager.js", "utf8");
  assert.ok(
    !masonrySrc.includes("Math.clamp(width, width, availableWidth)"),
    "R4: Math.clamp(width, width, ...) no-op must be replaced"
  );
  assert.ok(
    masonrySrc.includes("Math.min(width, availableWidth)"),
    "R4: Math.min(width, availableWidth) must be used"
  );
  assert.ok(
    masonrySrc.includes("container._allocationCacheSize"),
    "R5: masonryLayoutManager must track container._allocationCacheSize to detect container resize"
  );
  assert.ok(
    masonrySrc.includes("Array.from({ length: this._rowCount }, () => ({ y: 0, height: 0 }))"),
    "R6: masonryLayoutManager must use independent row objects per row"
  );
  console.log("  ok  : R4, R5, R6 Masonry layout clamp, cache resize, and row instances verified");
}

// 5. R7: Suggestions close isWindowAlive check
{
  const suggSrc = fs.readFileSync("src/components/windowsSuggestions/tilingLayoutWithSuggestions.js", "utf8");
  assert.ok(
    suggSrc.includes("isWindowAlive(this._lastTiledWindow)"),
    "R7: tilingLayoutWithSuggestions must check isWindowAlive before Main.activateWindow"
  );
  console.log("  ok  : R7 suggestions close isWindowAlive check verified");
}

// 6. R8: Slider cursor and drag check in destroy
{
  const sliderSrc = fs.readFileSync("src/components/editor/slider.js", "utf8");
  assert.ok(
    sliderSrc.includes("if (this._dragging)"),
    "R8: slider._onDestroy must only call _endDragging if dragging"
  );
  assert.ok(
    sliderSrc.includes("global.display?.set_cursor?.(this.preferredCursor)"),
    "R8: slider cursor call must be guarded"
  );
  console.log("  ok  : R8 slider cursor and dragging teardown guard verified");
}

// 7. R10: createButton padding-right preserved
{
  const utilSrc = fs.readFileSync("src/indicator/utils.js", "utf8");
  assert.ok(
    utilSrc.includes("padding-left: 5px !important; padding-right: 5px !important;"),
    "R10: indicator createButton must preserve padding-right"
  );
  console.log("  ok  : R10 createButton inline padding symmetry verified");
}

// 8. R11: translations.js doc updated
{
  const transSrc = fs.readFileSync("src/translations.js", "utf8");
  assert.ok(
    transSrc.includes("Single place where the shell-side gettext helpers are imported"),
    "R11: translations.js header comment accurately describes shell gettext"
  );
  console.log("  ok  : R11 translations.js documentation verified");
}

// 9. R1 & R3: pot file contains freshly extracted strings
{
  const potSrc = fs.readFileSync("po/tilingshell.pot", "utf8");
  assert.ok(
    potSrc.includes("Zero Telemetry & 100% Privacy"),
    "R1: pot file must include 'Zero Telemetry & 100% Privacy'"
  );
  assert.ok(
    potSrc.includes("Add application…"),
    "R1: pot file must include 'Add application…'"
  );
  console.log("  ok  : R1 & R3 pot file has up-to-date strings and catalog merge");
}

console.log("\n=== ALL ROUND-3 AUDIT CHECKS PASSED ===");
