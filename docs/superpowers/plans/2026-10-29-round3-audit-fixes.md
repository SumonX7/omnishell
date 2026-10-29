# Implementation Plan: Fix Audit Round-3 Bugs (R1 to R11 and Patch Follow-ups)

## Scope
1. **N4 Seeding**: Add layout seeding in `_onInstall()` and `_validateSettings()` in `src/extension.js`.
2. **R2 / N6**: Connect `destroy` signal in `src/components/altTab/MultipleWindowsIcon.js` to call `this._window?.destroy?.()`.
3. **N10 & R9**: Implement `_btnSignalIds` Set in `snapAssistTileButton.js` and `editableTilePreview.js` with exact `disconnect(id)` matching.
4. **R4, R5, R6**: Fix Masonry layout clamp, allocation cache size check, and unique row object instances in `masonryLayoutManager.js`.
5. **R7**: Guard `Main.activateWindow` with `isWindowAlive` in `tilingLayoutWithSuggestions.js:221`.
6. **R8**: Guard cursor setting and dragging check in `slider.js`.
7. **R10**: Fix inline padding in `src/indicator/utils.js:4` (`padding-right: 5px !important;`).
8. **R11**: Update doc comment in `src/translations.js`.
9. **R1 & R3**: Run `make pot && make catalogues` to regenerate gettext template and compile catalogues.
10. **Verification**: Add `verify_audit_round3.mjs`, run `make check`, `make build`, `make install`, and sync.
