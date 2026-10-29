# Implementation Plan: Fix Audit Round-2 Bugs (N1 to N11)

All 11 findings from the Round-2 audit report are verified and will be systematically fixed.

## Proposed Changes

### 1. `src/utils/globalState.js` & `src/indicator/defaultMenu.js` (N1 & N2)
- Guard `this._layouts[0]?.id ?? ""` in `deleteLayout` when all layouts are deleted.
- Guard `GlobalState.get().layouts[0]?.id ?? ""` in `defaultMenu.js:442`.

### 2. `src/components/snapassist/snapAssist.js` (N3)
- Replace invalid `String.$gtype` with `GObject.TYPE_STRING` in `registerGObjectClass(_SnapAssist, ...)` signal signature.

### 3. `src/settings/settings.js` (N4)
- Extract `getDefaultLayouts()`.
- In `get_layouts_json()`, return `this.getDefaultLayouts()` on error/empty instead of calling `this.reset_layouts_json()` to eliminate getter write side-effects.

### 4. `src/settings/settingsExport.js` (N5)
- In `importFromString(content)`, take a backup before running import. If `dconf load` fails, restore from backup so user settings are never lost.

### 5. `src/components/altTab/MetaWindowGroup.js` & `src/components/editor/layoutEditor.js` (N6 & N9)
- Store unmanaged signal IDs on `MetaWindowGroup` and disconnect on window unmanaged or group cleanup.
- Replace `!win.unmanaged` with `isWindowAlive(win)`.
- Harden `isWindowAlive(window)` in `src/utils/ui.js` with `try/catch`.

### 6. `src/indicator/indicator.js` (N7)
- Add `this._editorDialog.connect("destroy", () => { this._editorDialog = null; });` in `openMenu()`.

### 7. `src/components/layout/LayoutWidget.js` (N8)
- Remove inconsistent object reference check `this._outerGaps !== params.outerGaps` so value equality is checked consistently with `innerGaps`.

### 8. `src/components/snapassist/snapAssistTileButton.js` (N10)
- Add `disconnect(id)` method matching overridden `connect(signal, callback)`.

### 9. `src/utils/desktopFilter.js` (N11)
- Change `title.includes("@!")` to `title.startsWith("@!")` to avoid false-positive exclusions on normal windows containing `@!`.

### 10. Automated Verification Harness (`verify_audit_round2.mjs`)
- Unit test for all N1–N11 fixes.
- Add to `Makefile` check target.
- Run `make check`, `make build`, `make install`, and sync.
