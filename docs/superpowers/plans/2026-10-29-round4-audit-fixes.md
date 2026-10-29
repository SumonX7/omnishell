# Implementation Plan: Fix Audit Round-4 Bugs (T1 to T10)

## Scope
1. **T1**: Disconnect all global settings signals on prefs window `close-request`.
2. **T2 & T3**: Handle shortcut clearing with Backspace cleanly (empty array `[]` instead of invalid `["<Shift>"]`).
3. **T4**: Fix shortcut editor window leak in `prefs.js` by destroying previous instances instead of hiding.
4. **T5**: Excluded apps case-insensitive duplicate check in `prefs.js`.
5. **Bonus**: Clean up orphaned statement on line 1411 of `prefs.js`.
6. **T6 & T7**: Fix sliverTolerance and eliminate dead `preview.open()` in `src/components/tilingsystem/tilingLayout.js`.
7. **T8**: Listen to `Settings.KEY_ENABLE_SMART_WINDOW_BORDER_RADIUS` in `windowBorderManager.js`.
8. **T9**: Synchronize scaling factors between `borderWidth` and `_scaledBorderWidth` in `windowBorder.js`.
9. **Verification**: Write `verify_audit_round4.mjs`, update `Makefile`, run `make check`, build, and install.
