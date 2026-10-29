# Dynamic Tiling Gap-Fill and Stability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 3-window gap filling issue (closing a window leaves empty space) and resolve Wayland workspace race, WindowBorderManager signal leaks, and reflow resilience in OmniShell.

**Architecture:** 
1. In `tilingManager.js`, make `_reflowDynamicWindows` resilient with per-window try/catch and check actual maximization state before skipping `omnishellUserMaximized`.
2. Ensure `_untrackDynamicWindow` triggers reflow when `Settings.ENABLE_DYNAMIC_TILING` is active, even if the window had an untracked slot or was closed during a grab.
3. Fix the Wayland workspace race in `_markDynamicNewcomer` by avoiding premature active-workspace fallback for `_splitTarget`.
4. In `windowBorderManager.js`, prevent stacked settings connections and disconnect `notify::focus-window` on `_turnOff`.
5. Track and clean up idle retry source IDs in `_dynamicAdd`.

**Tech Stack:** GNOME Shell 46/47/48, GJS, ESM, GLib, Mutter (Meta), Node.js (test runner).

---

### Task 1: Add automated tests for gap filling and reflow resilience

**Files:**
- Create: `verify_gap_fill.mjs`
- Test: `verify_gap_fill.mjs`

- [ ] **Step 1: Write test harness `verify_gap_fill.mjs`**
Test cases:
1. When 3 windows shrink to 2, verify `reflow` and `assign` coverage sums to 1.0 (no holes).
2. Simulate a failing placement in `windows.forEach` and ensure remaining windows still get placed.
3. Verify that `_markDynamicNewcomer` without workspace does not lock `_splitTarget` to active workspace.

- [ ] **Step 2: Run test harness to observe current behavior and failures**
Run: `node verify_gap_fill.mjs`

---

### Task 2: Fix Wayland workspace race in `_markDynamicNewcomer` and `_dynamicAdd`

**Files:**
- Modify: `src/components/tilingsystem/tilingManager.js:2073-2088, 2125-2135`

- [ ] **Step 1: Fix `_markDynamicNewcomer` in `tilingManager.js`**
Do not fall back to `global.workspaceManager.get_active_workspace()`. Only set `_splitTarget` if `window.get_workspace?.()` returns a real workspace.

- [ ] **Step 2: Fix `applyTiling` in `_dynamicAdd`**
When `ws` is assigned, re-resolve `_splitTarget` if `!this._splitTarget` or if `this._splitTarget.get_workspace?.() !== ws`.

- [ ] **Step 3: Track `_dynamicAdd` idle source IDs and cancel them on destroy**
Store `this._dynamicAddRetries = new Set()` and remove all scheduled sources on `destroy()`.

---

### Task 3: Fix blank space on window close and reflow loop resilience

**Files:**
- Modify: `src/components/tilingsystem/tilingManager.js:1930-1965, 2426-2440`

- [ ] **Step 1: Add per-window try/catch in `_reflowDynamicWindows`**
Wrap `this._easeWindowRectFromTile(...)` in `try { ... } catch (e) { ... }` so a transient error on one window does not abort placement of remaining windows.

- [ ] **Step 2: Check actual maximization before skipping in `_reflowDynamicWindows`**
Check `(window.maximizedHorizontally || window.maximizedVertically || window.maximized_horizontally || window.maximized_vertically)` alongside `window.omnishellUserMaximized`.

- [ ] **Step 3: Ensure `_queueDynamicReflow` runs when a window leaves**
In `_untrackDynamicWindow`, if `Settings.ENABLE_DYNAMIC_TILING` is true, ensure `this._queueDynamicReflow()` is triggered even if `slot < 0` to heal any leftover holes.

---

### Task 4: Fix `WindowBorderManager` signal leaks and handlers stacking

**Files:**
- Modify: `src/components/windowBorder/windowBorderManager.js:27-95`

- [ ] **Step 1: Prevent handler stacking in `enable()`**
Disconnect existing signals before connecting `KEY_ENABLE_WINDOW_BORDER`.

- [ ] **Step 2: Disconnect focus signal in `_turnOff()`**
Properly disconnect `notify::focus-window` and reset `_turnedOn = false`.

---

### Task 5: Verify all tests, build and install

**Files:**
- Test: `make check`
- Build: `make`
- Install: `make install`
- Copy to: `/home/spark/Desktop/SEO Automation/OmniShell/`

- [ ] **Step 1: Run `make check` to verify all test suites pass**
- [ ] **Step 2: Run `make install` to update installed extension**
- [ ] **Step 3: Update zip and extracted files in `/home/spark/Desktop/SEO Automation/OmniShell/`**
- [ ] **Step 4: Commit changes to Git**
