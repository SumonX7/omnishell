# OmniShell Stability & Audit Resolution Report

This document records the complete, multi-round technical audit of OmniShell (`omnishell@spark.dev`), providing the root cause analysis, code fixes, and automated verification tests for all confirmed issues across Rounds 1 through 5.

---

## Round 1: Core Dynamic Tiling & Gap Management

| ID | Issue & Impact | File & Lines | Root Cause | Fix Applied | Verification Test |
|---|---|---|---|---|---|
| **1.1** | Window close leaves unfilled gaps in 3→2 windows | `components/tilingsystem/tilingManager.js:1866, 2367` | `_untrackDynamicWindow` did not delete `assignedTile` or recompute slots before reflow. | Deleted `assignedTile` on untrack and triggered `_queueDynamicReflow()`. | `verify_gap_fill.mjs` |
| **1.2** | Wayland workspace race poisoning `_splitTarget` | `components/tilingsystem/tilingManager.js:2073-2081` | `window.get_workspace()` returned `null` at window-created time, falling back to active workspace. | Re-resolves `_splitTarget` on dynamic add and guards against cross-workspace leakage. | `verify_fixes.mjs` |
| **1.3** | Unguarded dynamic reflow loop | `components/tilingsystem/tilingManager.js:2432` | A non-reflowing window threw an unhandled error, halting subsequent window placements. | Added per-window `try/catch` and checked actual window maximized state before skipping placement. | `verify_fixes.mjs` |
| **1.4** | Layout hopping / exact-match pick | `components/layout/dynamic/pickLayout.js:3-4` | Window count changes triggered whole-tree layout hops instead of smooth expansion. | Maintained layout tree consistency across workspace resizing and removed premature arrangement deletion. | `test_dyn.mjs`, `verify_gap_fill.mjs` |
| **1.5** | Idle source leak on teardown | `components/tilingsystem/tilingManager.js:2160` | Dynamic add idle sources were not tracked or cancelled on destroy. | Added `_dynamicIdleSources` Set and cancelled all pending GLib sources on `destroy()`. | `verify_fixes.mjs` |

---

## Round 2: N1 to N11 Stability Hardening

| ID | Issue & Impact | File & Lines | Root Cause | Fix Applied | Verification Test |
|---|---|---|---|---|---|
| **N1** | `deleteLayout` crash on empty list | `utils/globalState.js:115` | Indexing `_layouts[0].id` without checking array length. | Guarded with `this._layouts[0]?.id ?? ""` fallback. | `verify_audit_round2.mjs` |
| **N2** | Indicator default menu crash | `indicator/defaultMenu.js:442` | Accessing first layout ID without empty guard. | Guarded with `this._layouts[0]?.id ?? ""` fallback. | `verify_audit_round2.mjs` |
| **N3** | Snap-assist invalid GType registration | `components/snapassist/snapAssist.js:382` | Used `String.$gtype` instead of `GObject.TYPE_STRING`. | Replaced with `GObject.TYPE_STRING`. | `verify_audit_round2.mjs` |
| **N4** | `get_layouts_json()` impure getter | `settings/settings.js:587` | Getter wrote defaults to GSettings as a side effect. | Extracted pure `getDefaultLayouts()` and made getter side-effect free. | `verify_audit_round2.mjs` |
| **N5** | Non-atomic settings import data loss | `settings/settingsExport.js:22` | Settings cleared before `dconf load`, leaving partial state on error. | Backed up current settings in-memory and restored on failure. | `verify_audit_round2.mjs` |
| **N6** | Alt+Tab `MetaWindowGroup` signal leak | `components/altTab/MetaWindowGroup.js:21` | Window `unmanaged` handlers never disconnected if all windows did not close. | Added explicit `destroy()` method and tracked signal IDs in `_signals`. | `verify_audit_round2.mjs` |
| **N7** | Layout editor dialog stale reference | `indicator/indicator.js:220` | Reference retained after external window closure. | Connected to `"destroy"` signal to nullify `this._editorDialog`. | `verify_audit_round2.mjs` |
| **N8** | Reference equality check on `outerGaps` | `components/layout/LayoutWidget.js:103` | Compared `Margin` objects with `!==`, triggering redundant relayouts. | Replaced with value equality `_areGapsEqual()`. | `verify_audit_round2.mjs` |
| **N9** | Crash on unmanaged Mutter window access | `utils/ui.js:192` | `isWindowAlive` failed when `get_compositor_private()` threw. | Hardened `isWindowAlive` with try/catch and checked actor lifecycle. | `verify_audit_round2.mjs` |
| **N10** | `SnapAssistTileButton` disconnect mismatch | `components/snapassist/snapAssistTileButton.js:145` | Calling `this._btn.disconnect()` with external ID caused GLib criticals. | Added `disconnect(id)` method matching inner button signal IDs. | `verify_audit_round2.mjs` |
| **N11** | Desktop filter substring false positive | `utils/desktopFilter.js:64` | `title.includes("@!")` matched accidental file/window names. | Changed to `title.startsWith("@!")`. | `verify_audit_round2.mjs` |

---

## Round 3: R1 to R11 Audit & Refinements

| ID | Issue & Impact | File & Lines | Root Cause | Fix Applied | Verification Test |
|---|---|---|---|---|---|
| **R1** | Missing Gettext msgid entries | `po/tilingshell.pot`, `po/*.po` | Translation files out of sync with updated source strings. | Ran `make pot` and updated base template. | `verify_audit_round3.mjs` |
| **R2** | Alt+Tab `MultipleWindowsIcon` teardown | `components/altTab/MultipleWindowsIcon.js:45` | Parent icon destroyed without destroying `MetaWindowGroup`. | Connected `"destroy"` signal to invoke `this._window?.destroy?.()`. | `verify_audit_round3.mjs` |
| **R3** | Uncompiled `.mo` catalogues | `src/locale/*/LC_MESSAGES/` | Binary translation catalogues missing for UI locales. | Compiled all 14 locale catalogues with `make catalogues`. | `verify_audit_round3.mjs` |
| **R4** | Masonry layout clamp logic | `components/windowsSuggestions/masonryLayoutManager.js:36` | `Math.clamp(width, width, availableWidth)` threw if width exceeded available. | Replaced with `Math.min(width, availableWidth)`. | `verify_audit_round3.mjs` |
| **R5** | Masonry allocation cache invalidation | `components/windowsSuggestions/masonryLayoutManager.js:98` | Cache not invalidated on container width change. | Invalidate cache when container width changes. | `verify_audit_round3.mjs` |
| **R6** | Masonry row reference duplication | `components/windowsSuggestions/masonryLayoutManager.js:115` | Shared object references across masonry rows. | Used `Array.from` to instantiate distinct row objects. | `verify_audit_round3.mjs` |
| **R7** | Suggestions window focus crash | `components/windowsSuggestions/tilingLayoutWithSuggestions.js:221` | Activated unmanaged window without liveness check. | Guarded `Main.activateWindow` with `isWindowAlive(window)`. | `verify_audit_round3.mjs` |
| **R8** | Layout editor slider cursor crash | `components/editor/slider.js:256` | Resetting cursor on destroyed actor or missing display. | Guarded with `global.display?.set_cursor` try/catch. | `verify_audit_round3.mjs` |
| **R9** | `editableTilePreview` signal tracking | `components/editor/editableTilePreview.js:160` | Disconnect called on wrong GObject. | Implemented `_btnSignalIds = new Set()` for accurate signal routing. | `verify_audit_round3.mjs` |
| **R10** | Indicator button padding asymmetry | `indicator/utils.js:4` | Stripped `padding-right: 5px !important;` during cleanup. | Restored balanced CSS padding. | `verify_audit_round3.mjs` |
| **R11** | JSDoc comment inaccuracies | `translations.js:1-10` | Stale documentation referring to outdated APIs. | Cleaned up JSDoc comments. | `verify_audit_round3.mjs` |

---

## Round 4: T1 to T10 Preferences & UI Polish

| ID | Issue & Impact | File & Lines | Root Cause | Fix Applied | Verification Test |
|---|---|---|---|---|---|
| **T1** | Prefs window signal handler leak | `prefs.js:275, 368, 1546` | Settings signal handlers never disconnected on window close. | Added `_connectSetting` / `_disconnectSettings` on `close-request` and `destroy`. | `verify_audit_round4.mjs` |
| **T2** | Backward shortcut overwritten on forward change | `prefs.js:1875` | Custom backward binding blindly overridden with `<Shift>${val}`. | Preserved user custom backward shortcut; only derive if unset or old default. | `verify_audit_round4.mjs`, `verify_audit_round5.mjs` |
| **T3** | Shortcut clearing saved invalid `["<Shift>"]` | `prefs.js:1879` | Template literal `<Shift>${shortcut}` evaluated on empty string. | Saved clean empty array `[]` when shortcut is cleared. | `verify_audit_round4.mjs` |
| **T4** | Shortcut editor window leak | `prefs.js:1845, 1870` | `Adw.Window` hidden on close instead of destroyed. | Replaced `.close()` with `.destroy()` and destroyed previous editor on activation. | `verify_audit_round4.mjs` |
| **T5** | Excluded apps case sensitivity | `prefs.js:1546` | Checked app names with case-sensitive equality. | Used `.toLowerCase()` matching for WM class / app ID. | `verify_audit_round4.mjs` |
| **T6** | Sliver tolerance dimension consistency | `components/tilingsystem/tilingLayout.js:241` | Checked area instead of linear dimensions. | Filtered fragments with `r.width > tol && r.height > tol`. | `verify_audit_round4.mjs` |
| **T7** | Dead `preview.open()` in `hoverTilesInRect` | `components/tilingsystem/tilingLayout.js:197` | Unnecessary preview open call after restore. | Removed redundant call. | `verify_audit_round4.mjs` |
| **T8** | Smart window border radius dynamic toggle | `components/windowBorder/windowBorderManager.js:42` | Setting change did not trigger border radius update. | Connected `KEY_ENABLE_SMART_WINDOW_BORDER_RADIUS` change handler. | `verify_audit_round4.mjs` |
| **T9** | Border width coordinate space mismatch | `components/windowBorder/windowBorder.js:246` | `borderWidth` and `_scaledBorderWidth` scaled with different ratios. | Unified `borderWidth` and `_scaledBorderWidth` coordinate space. | `verify_audit_round4.mjs`, `verify_audit_round5.mjs` |
| **T10** | Excluded apps orphaned child call | `prefs.js:1438` | Dead `chipsBox.get_first_child();` statement. | Removed dead statement. | `verify_audit_round4.mjs` |

---

## Round 5: D1 to D9 Fusion Engine & Multi-Monitor Integrity

| ID | Issue & Impact | File & Lines | Root Cause | Fix Applied | Verification Test |
|---|---|---|---|---|---|
| **D1** | Desktop icon safe area margins never received | `src/extension.js:244`, `src/dbus.js:4` | `DesktopIconsUsableArea` was not exposed on extension `stateObj` and missing from D-Bus. | Exposed `this.DesktopIconsUsableArea` and added `SetMarginsForExtension` D-Bus method. | `verify_audit_round5.mjs` |
| **D2** | Margins stored with workspace key instead of monitor | `dingBridge/visibleArea.js:53` | Variable named `workspace` treated monitor keys incorrectly. | Handled monitor keys properly and resolved `-1` to primary monitor. | `verify_audit_round5.mjs` |
| **D3** | CI workflow only ran 3 of 13 tests | `.github/workflows/ci.yml:32` | CI missed regression suites added in recent rounds. | Updated CI to run `make check` (all 13 suites) on `main`, `master`, and `fix/*`. | `verify_audit_round5.mjs` |
| **D4** | Metadata version stuck at 1.0.8 | `src/metadata.json:13`, `CHANGELOG.md` | Version bump missing for user updates. | Bumped version to `109` / `1.0.9` and documented in `CHANGELOG.md`. | `verify_audit_round5.mjs` |
| **D5** | Desktop geometry fallback hardcoded 1920x1080 | `dingBridge/dingBridge.js:234` | Fallback did not inspect live monitor bounds. | Replaced hardcoded fallback with live `Main.layoutManager.monitors[index]` bounds. | `verify_audit_round5.mjs` |
| **D6** | Prefs child dialog lifecycle | `src/prefs.js:1288, 1537` | Child dialogs persisted in memory after parent closure. | Explicitly destroy child dialogs on parent destruction and on cancel/add. | `verify_audit_round5.mjs` |
| **D7** | `tilingManager.destroy()` abort on component failure | `components/tilingsystem/tilingManager.js:707` | Uncaught error during child component teardown aborted teardown. | Wrapped all teardown calls in `try/catch` blocks. | `verify_audit_round5.mjs` |
| **D8** | Window menu layout preview scaling on primary only | `components/window_menu/overriddenWindowMenu.js:105` | Scaling gated on `window.get_monitor() === primaryIndex`. | Enabled scaling support whenever `scalingFactor` is present. | `verify_audit_round5.mjs` |
| **D9** | `LayoutTileButtons` outer gap equaled inner gap | `components/window_menu/layoutTileButtons.js:12` | Miniature button outer gaps were set to full `gapSize`. | Defaulted `outerGapSize` to 0 to prevent artificially thick outer borders. | `verify_audit_round5.mjs` |

---

## Complete Verification Test Matrix (`make check`)

1. `check_syntax.mjs`: ESM syntax and parsing validation across all `.js` and `.mjs` files
2. `verify_fixes.mjs`: Verifies core tiling fixes and Wayland actor ready pipeline
3. `verify_round2.mjs`: Verifies layout SortOrder round-trip integrity
4. `verify_perf.mjs`: Verifies dynamic-layout memoization and performance optimizations
5. `verify_ding_refresh.mjs`: Verifies DING desktop refresh coordination
6. `verify_claims.mjs`: Verifies resolution of all 26 initial audit claims
7. `test_dyn.mjs`: Verifies dynamic tiling mathematics and layout coverage
8. `verify_pins.mjs`: Verifies window size pinning and live-lock prevention
9. `verify_gap_fill.mjs`: Verifies gap-fill auto-healing and 100% workspace coverage on window close
10. `verify_audit_round2.mjs`: Verifies N1 through N11 fixes
11. `verify_audit_round3.mjs`: Verifies R1 through R11 fixes
12. `verify_audit_round4.mjs`: Verifies T1 through T10 fixes
13. `verify_audit_round5.mjs`: Verifies D1 through D9 fixes and re-checked invariants
14. `glib-compile-schemas --strict`: Validates all GSettings schemas
