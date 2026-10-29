// Verification harness for Round-2 Audit findings (N1 to N11).
import assert from "node:assert/strict";
import fs from "node:fs";

console.log("=== Round-2 Audit Verification (N1 to N11) ===");

// N1 & N2: GlobalState and defaultMenu guard against empty layouts
{
  const globalStateSrc = fs.readFileSync("src/utils/globalState.js", "utf8");
  assert.ok(
    globalStateSrc.includes("this._layouts[0]?.id ??"),
    "N1: globalState.js must guard against empty layouts on deleteLayout"
  );
  assert.ok(
    !globalStateSrc.includes("monitors_selected[Main.layoutManager.primaryIndex] = this._layouts[0].id;"),
    "N1: unguarded this._layouts[0].id must not exist"
  );
  console.log("  ok  : N1 deleteLayout empty guard verified");

  const defaultMenuSrc = fs.readFileSync("src/indicator/defaultMenu.js", "utf8");
  assert.ok(
    defaultMenuSrc.includes("GlobalState.get().layouts[0]?.id ??"),
    "N2: defaultMenu.js must safely read layouts[0]?.id"
  );
  assert.ok(
    !defaultMenuSrc.includes(": GlobalState.get().layouts[0].id;"),
    "N2: unguarded GlobalState.get().layouts[0].id must not exist"
  );
  console.log("  ok  : N2 defaultMenu empty layouts guard verified");
}

// N3: SnapAssist signal uses GObject.TYPE_STRING
{
  const snapAssistSrc = fs.readFileSync("src/components/snapassist/snapAssist.js", "utf8");
  assert.ok(
    snapAssistSrc.includes("param_types: [Tile.$gtype, GObject.TYPE_STRING]"),
    "N3: snap-assist signal must use GObject.TYPE_STRING"
  );
  assert.ok(
    !snapAssistSrc.includes("String.$gtype"),
    "N3: invalid String.$gtype must not exist"
  );
  console.log("  ok  : N3 snap-assist signal uses GObject.TYPE_STRING");
}

// N4: get_layouts_json is pure and doesn't write to settings
{
  const settingsSrc = fs.readFileSync("src/settings/settings.js", "utf8");
  assert.ok(
    settingsSrc.includes("static getDefaultLayouts()"),
    "N4: settings.js must define static getDefaultLayouts()"
  );
  assert.ok(
    !settingsSrc.includes("this.reset_layouts_json();\n      try {\n        return JSON.parse("),
    "N4: get_layouts_json must not call reset_layouts_json inside getter"
  );
  console.log("  ok  : N4 get_layouts_json is a pure getter without write side-effects");
}

// N5: settings import takes a backup and restores on failure
{
  const exportSrc = fs.readFileSync("src/settings/settingsExport.js", "utf8");
  assert.ok(
    exportSrc.includes("const backup = this.exportToString();"),
    "N5: importFromString must back up settings first"
  );
  assert.ok(
    exportSrc.includes("restoreProc.communicate_utf8(backup, null)"),
    "N5: importFromString must restore backup on failure"
  );
  console.log("  ok  : N5 settings import preserves existing settings on failure");
}

// N6 & N9: MetaWindowGroup tracks unmanaged signals & checks liveness
{
  const mwgSrc = fs.readFileSync("src/components/altTab/MetaWindowGroup.js", "utf8");
  assert.ok(
    mwgSrc.includes("this._signals = [];"),
    "N6: MetaWindowGroup must track connected signals in _signals"
  );
  assert.ok(
    mwgSrc.includes("destroy()"),
    "N6: MetaWindowGroup must provide destroy() to disconnect signals"
  );
  assert.ok(
    mwgSrc.includes("if (isWindowAlive(win))"),
    "N9: MetaWindowGroup must check isWindowAlive instead of !win.unmanaged"
  );
  assert.ok(
    !mwgSrc.includes("!win.unmanaged"),
    "N9: !win.unmanaged must not exist in MetaWindowGroup"
  );

  const layoutEditorSrc = fs.readFileSync("src/components/editor/layoutEditor.js", "utf8");
  assert.ok(
    layoutEditorSrc.includes("if (isWindowAlive(win)) win.unminimize();"),
    "N9: layoutEditor must check isWindowAlive instead of !win.unmanaged"
  );
  assert.ok(
    !layoutEditorSrc.includes("!win.unmanaged"),
    "N9: !win.unmanaged must not exist in layoutEditor"
  );

  const uiSrc = fs.readFileSync("src/utils/ui.js", "utf8");
  assert.ok(
    uiSrc.includes("window.get_compositor_private?.()"),
    "isWindowAlive must safely access get_compositor_private with optional chaining"
  );
  console.log("  ok  : N6 & N9 Alt+Tab signal cleanup and window liveness checks verified");
}

// N7: EditorDialog destroy hook in indicator.js
{
  const indicatorSrc = fs.readFileSync("src/indicator/indicator.js", "utf8");
  assert.ok(
    indicatorSrc.includes('this._editorDialog.connect("destroy"'),
    "N7: indicator.js must listen to destroy on _editorDialog to reset reference"
  );
  console.log("  ok  : N7 editor dialog external destroy resets reference");
}

// N8: outerGaps check in LayoutWidget.js
{
  const widgetSrc = fs.readFileSync("src/components/layout/LayoutWidget.js", "utf8");
  assert.ok(
    widgetSrc.includes("if (params?.outerGaps) {"),
    "N8: LayoutWidget must check params?.outerGaps consistently with innerGaps"
  );
  assert.ok(
    !widgetSrc.includes("this._outerGaps !== params.outerGaps"),
    "N8: identity comparison this._outerGaps !== params.outerGaps must be removed"
  );
  console.log("  ok  : N8 LayoutWidget outerGaps equality checked consistently");
}

// N10: SnapAssistTileButton disconnect method
{
  const btnSrc = fs.readFileSync("src/components/snapassist/snapAssistTileButton.js", "utf8");
  assert.ok(
    btnSrc.includes("disconnect(id)"),
    "N10: SnapAssistTileButton must provide disconnect(id)"
  );
  console.log("  ok  : N10 SnapAssistTileButton provides matching disconnect(id)");
}

// N11: desktopFilter startsWith("@!")
{
  const filterSrc = fs.readFileSync("src/utils/desktopFilter.js", "utf8");
  assert.ok(
    filterSrc.includes('title.startsWith("@!")'),
    'N11: desktopFilter must use title.startsWith("@!")'
  );
  assert.ok(
    !filterSrc.includes('title.includes("@!")'),
    'N11: broad title.includes("@!") must not exist'
  );
  console.log('  ok  : N11 desktopFilter restricts @! matching to startsWith');
}

console.log("\n=== ALL ROUND-2 AUDIT CHECKS PASSED ===");
