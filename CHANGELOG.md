# 📋 OmniShell Changelog

All notable changes, engineering overhauls, new features, and bug fixes in **OmniShell** are documented in this file.

---

## [1.0.0] - 2026-10-23

### 🚀 Major Architectural Fusion: The Superpower Era
* **Unified Two Independent GNOME Extensions:**
  * Merged **Tiling Shell v17.3** (by Domenico Ferraro) with **Desktop Icons NG / DING** (by Sergio Costas).
  * Resolved all multi-instance DBus conflicts and session registration overlaps.
  * Consolidated separate extension lifecycles into a single performant master process.
* **Engineered & Modified by:** **Sumon Mahmud** ([@SumonX7](https://github.com/SumonX7)).
* **Target Compatibility:** GNOME Shell 46, 47, 48, 49, 50, and 51+ (optimized for openSUSE Tumbleweed Wayland sessions).

---

### ✨ New Features & Enhancements

#### 🖥️ Desktop Icons & Text Customization
* **In-App Desktop Icon Sizing:**
  * Added direct dropdown selector in OmniShell Preferences:
    * `Tiny (36px)`
    * `Small (48px)`
    * `Standard (64px)`
    * `Large (96px)`
  * Dynamically hot-reloads icon sizes and recalculates desktop grids on the fly.
* **Desktop Icon Text Font Sizing:**
  * Added text/font size customizer in Preferences:
    * `Small (9 pt)`
    * `Standard (11 pt)`
    * `Medium (13 pt)`
    * `Large (15 pt)`
    * `Extra Large (18 pt)`
  * Instantly updates GTK4 desktop label CSS providers across all active monitors.
* **Quick Desktop Toggles:**
  * Toggle switches directly exposed for **Personal (Home) Folder**, **Trash Bin**, and **External Drives / USB Storage**.
  * Added direct action button to open advanced DING script templates and ordering configurations.

#### ⚡ Wayland & Window Management Harmony
* **Folder Auto-Maximize on Desktop Launch:**
  * Fixed an issue where opening folders from the desktop opened Nautilus in an 80% constrained floating bounds.
  * Implemented `wasFolderOpenedRecently()` DBus tracker in `DingBridge` with `first-frame` actor detection and idle fallback in `TilingManager`.
  * Desktop-launched folders now instantly open in pristine **100% maximized full screen**.
  * Added user preference toggle `Auto-Maximize Folders Opened from Desktop`.
* **Desktop Canvas Filtering (`desktopFilter.ts`):**
  * Built specialized window filtering to ensure Mutter never misidentifies the GTK4 transparent desktop layer as an ordinary application window.
  * Prevents accidental tiling, snap-assist previewing, or focus hijacking on the desktop canvas.
* **Dynamic Safe-Zone Synchronization:**
  * Added bidirectional synchronization so desktop icons automatically respect tiling outer margins and panel dock boundaries.

#### 🎨 Modern Libadwaita Preferences & Credits UI
* **Revamped Credits & Attributions Section:**
  * Transformed the preferences footer into modern Libadwaita cards with symbolic icons and direct repository links.
  * **Full, explicit credit** to **Domenico Ferraro** for Tiling Shell.
  * **Full, explicit credit** to **Sergio Costas** for Desktop Icons NG.
  * Proud attribution: **"Modified and Fusion Engineered by Sumon Mahmud"**.
  * Direct action links for GitHub repos, GitLab repos, and issue trackers.

---

### 🛡️ Security & Performance
* **100% Local & Zero Telemetry:**
  * Completely stripped out all third-party analytics and remote phone-home mechanisms.
  * Strict adherence to open-source privacy and local-only execution.
* **Test Suite & Reliability:**
  * Comprehensive test suite of 99 unit tests passing with 100% success rate.
  * Zero memory leaks during workspace switching and monitor re-plugging.
