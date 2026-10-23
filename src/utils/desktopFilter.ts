/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * Conflict Protection Utility: identifies Desktop Icons NG windows
 * to ensure zero interference with tiling management, window borders,
 * snap assistant, and Alt+Tab switchers.
 */

import { Meta } from '../gi/ext';

/**
 * Checks whether a MetaWindow is a desktop background / desktop icons window.
 *
 * @param window The Meta.Window to check
 * @returns true if the window is part of the Desktop Icons subsystem
 */
export function isDesktopWindow(window: Meta.Window | null | undefined): boolean {
    if (!window) return false;

    // 1. Direct type check: DESKTOP window type
    try {
        if (window.get_window_type() === Meta.WindowType.DESKTOP) {
            return true;
        }
    } catch {
        // Ignored
    }

    // 2. Title inspection for DING markers
    try {
        const title = window.get_title();
        if (title) {
            if (
                title.startsWith('Desktop Icons ') ||
                title.includes('@!H') ||
                title.includes('@!HTD') ||
                title === 'DING'
            ) {
                return true;
            }
        }
    } catch {
        // Ignored
    }

    // 3. WM class and App ID check
    try {
        const wmClass = window.get_wm_class();
        if (wmClass === 'com.rastersoft.ding' || wmClass === 'ding') {
            return true;
        }

        const gtkId = window.get_gtk_application_id();
        if (gtkId === 'com.rastersoft.ding' || gtkId === 'ding') {
            return true;
        }
    } catch {
        // Ignored
    }

    // 4. Custom DING tracking object attached to window
    if ((window as any).customJS_ding !== undefined && (window as any).customJS_ding !== null) {
        return true;
    }

    return false;
}
