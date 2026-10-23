# 🚀 OmniShell — Tiling & Desktop Fusion for GNOME

<p align="center">
  <img src="https://raw.githubusercontent.com/SumonX7/omnishell/main/resources/icons/scalable/actions/omnishell-symbolic.svg" width="128" height="128" alt="OmniShell Logo" />
</p>

<p align="center">
  <b>The Unified Superpower Desktop Environment for GNOME 46 – 51+</b><br>
  <i>Seamlessly combining modern window tiling management with native, high-performance desktop icons.</i>
</p>

<p align="center">
  <a href="https://github.com/SumonX7/omnishell/releases"><img src="https://img.shields.io/github/v/release/SumonX7/omnishell?style=flat-square&color=blue" alt="Latest Release"></a>
  <a href="https://github.com/SumonX7/omnishell/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-GPL%20v3.0-green.svg?style=flat-square" alt="License: GPL v3.0"></a>
  <img src="https://img.shields.io/badge/GNOME-46%20--%2051+-purple?style=flat-square" alt="GNOME Shell Support">
  <img src="https://img.shields.io/badge/Platform-openSUSE%20%7C%20Fedora%20%7C%20Arch%20%7C%20Ubuntu-orange?style=flat-square" alt="Linux Distributions">
  <img src="https://img.shields.io/badge/Wayland-Native-success?style=flat-square" alt="Wayland Native">
  <img src="https://img.shields.io/badge/Telemetry-Zero%20%2F%20100%25%20Private-brightgreen?style=flat-square" alt="Zero Telemetry">
</p>

---

## 🌟 Overview

**OmniShell** is an all-in-one superpower GNOME Shell extension created by fusing two of the most popular and essential GNOME utilities into a single, cohesive, conflict-free system:

1. **[Tiling Shell](https://github.com/J4KE-B/tilingshell)** — Advanced window tiling, snap assistance, dynamic auto-tiling, and customizable multi-monitor grid layouts.
2. **[Desktop Icons NG (DING)](https://gitlab.com/rastersoft/desktop-icons-ng)** — Modern GTK4 desktop canvas with full file management, drag-and-drop, and emblem support.

### ✨ Why OmniShell?
Running separate tiling and desktop icon extensions often creates subtle conflicts on modern Wayland sessions:
- Desktop canvas windows accidentally get tiled or focused as regular app windows.
- Tiling snap margins overlap with desktop icon columns.
- Launching folders from the desktop opens them in constrained floating bounds (~80% size) instead of full view.
- Heavy dual DBus background daemons waste memory.

**OmniShell solves all of this.** It unifies both subsystems into a single lifecycle, eliminates DBus race conditions, introduces safe-zone synchronization, and provides a unified, beautiful Libadwaita preferences dashboard.

---

## ⚡ Superpower Features

### 🪟 Advanced Tiling System
* **Dynamic Auto-Tiling:** Windows automatically partition available screen space as you open or close them, honoring your customized grid layout.
* **Snap Assistant:** Windows dragged to the top or edges present an interactive snap preview for instant multi-window arrangement.
* **Smart Edge Snapping:** Drag windows to display borders with customizable gaps (inner & outer margins).
* **Multi-Monitor Perfection:** Independent layout configurations and workarea calculation per monitor.
* **Custom Layout Editor:** Visual in-app grid editor to craft any custom window layout with pixel precision.

### 🖥️ Native Desktop Icons (GTK4 Engine)
* **Direct Desktop Icon Resizing:** Instant choice between **Tiny (36px)**, **Small (48px)**, **Standard (64px)**, and **Large (96px)**.
* **Custom Label Font Sizes:** Change desktop icon text label size (**Small 9pt**, **Standard 11pt**, **Medium 13pt**, **Large 15pt**, **Extra Large 18pt**).
* **Desktop Shortcuts:** One-click toggles for Personal (Home) folder, Trash bin, and Connected External Drives / USB storage.
* **Full Drag-and-Drop:** Seamless file dragging into applications, folders, or between monitors.

### 🔗 Deep Fusion & Harmony (Exclusive to OmniShell)
* **⚡ Desktop Folder Auto-Maximize:** Double-clicking folders or files on the desktop instantly opens Nautilus (or your default file manager) in clean **100% maximized full screen**, bypassing Mutter's default 80% floating constrain.
* **🛡️ Desktop Canvas Filtering:** Mutter never mistakes the GTK4 desktop canvas for a tilable window.
* **📐 Dynamic Safe-Zone Synchronization:** Desktop icon grid boundaries automatically adapt when you adjust tiling outer gaps and screen margins.
* **🔒 100% Private & Local:** Zero telemetry, zero external network requests, rock-solid security.

---

## 📜 Credits & Attributions

OmniShell stands on the shoulders of giants. We provide full, deep, and sincere credit to the original creators and maintainers whose pioneering work made this possible:

| Component | Project | Original Creator & Maintainer | Upstream Repository |
| :--- | :--- | :--- | :--- |
| 🪟 **Tiling Engine** | **Tiling Shell** | **Domenico Ferraro** (`@domferr`) | [github.com/J4KE-B/tilingshell](https://github.com/J4KE-B/tilingshell) |
| 🖥️ **Desktop Engine** | **Desktop Icons NG (DING)** | **Sergio Costas** (`@rastersoft`) | [gitlab.com/rastersoft/desktop-icons-ng](https://gitlab.com/rastersoft/desktop-icons-ng) |

### 🛠️ Fusion Engineering & Optimization
* **Modified & Fusion Engineered by:** **Sumon Mahmud** ([@SumonX7](https://github.com/SumonX7))
* **Target Environment & QA:** openSUSE Tumbleweed, GNOME Shell 50.5+ (Wayland)

---

## 🚀 Installation

### Option 1: One-Line Automatic Install (Recommended)
Download the latest pre-built release package from [Releases](https://github.com/SumonX7/omnishell/releases):

```bash
# Clone the repository
git clone https://github.com/SumonX7/omnishell.git
cd omnishell

# Build and package
npm install
npm run build:package

# Install extension & compile schemas
mkdir -p ~/.local/share/gnome-shell/extensions/omnishell@spark.dev
unzip -o omnishell@spark.dev.zip -d ~/.local/share/gnome-shell/extensions/omnishell@spark.dev
mkdir -p ~/.local/share/glib-2.0/schemas
cp resources/schemas/* ~/.local/share/glib-2.0/schemas/
glib-compile-schemas ~/.local/share/glib-2.0/schemas/
```

### Option 2: Using the Release Zip
1. Download `omnishell@spark.dev.zip` from [Releases](https://github.com/SumonX7/omnishell/releases).
2. Extract to `~/.local/share/gnome-shell/extensions/omnishell@spark.dev/`.
3. Compile schemas:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/omnishell@spark.dev/schemas/
   ```
4. On Wayland, log out and log back in, then enable:
   ```bash
   gnome-extensions enable omnishell@spark.dev
   ```

---

## ⌨️ Default Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| <kbd>Super</kbd> + <kbd>Arrow Keys</kbd> | Move / swap window to adjacent tile |
| <kbd>Super</kbd> + <kbd>Shift</kbd> + <kbd>;</kbd> | Cycle through layouts matching current window count |
| <kbd>Super</kbd> + Drag | Move window with interactive Snap Assist / Tiling Guide |
| <kbd>Super</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd> | Toggle OmniShell Layout Selector |

*(All keyboard shortcuts can be completely customized inside Preferences)*

---

## 🛠️ Building from Source

### Requirements
* Node.js 18+ and `npm`
* `glib2` development tools (`glib-compile-schemas`, `glib-compile-resources`)
* `zip`

```bash
# Install dependencies
npm install

# Run unit test suite (99 passing tests)
npm run test

# Compile TypeScript and SCSS resources
npm run build

# Generate distributable extension zip
npm run build:package
```

---

## 📄 License

OmniShell is open-source software licensed under the **GNU General Public License v3.0 (GPL-3.0)**, preserving and respecting the original licenses of both Tiling Shell and Desktop Icons NG.
