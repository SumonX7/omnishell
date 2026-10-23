/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * EmulateX11WindowType: Ensures Desktop Icons windows behave as desktop
 * background canvases under Wayland and X11 without being treated as normal windows.
 */

import { GLib, Meta } from '../gi/ext';
import { MonitorGeometryData } from './visibleArea';

export class ManageWindow {
    private _window: Meta.Window | null;
    private _waylandClient: any;
    private _emulator: EmulateX11WindowType;
    private _signalIDs: number[];
    private _moveIntoPlaceID: number;
    private _keepAtTop: boolean;
    private _showInAllDesktops: boolean;
    private _fixed: boolean;
    private _x: number | null;
    private _y: number | null;
    public windowUnmanaged: boolean;
    public unmanagedID: number;

    constructor(window: Meta.Window, waylandClient: any, emulator: EmulateX11WindowType) {
        this._waylandClient = waylandClient;
        this._emulator = emulator;
        this._window = window;
        this._signalIDs = [];
        this._moveIntoPlaceID = 0;
        this.windowUnmanaged = false;
        this._keepAtTop = false;
        this._showInAllDesktops = false;
        this._fixed = false;
        this._x = null;
        this._y = null;
        this.unmanagedID = 0;

        this._signalIDs.push(
            window.connect('notify::title', () => {
                this._parseTitle();
            }),
        );
        this._parseTitle();
    }

    private _moveIntoPlace(): void {
        if (this._moveIntoPlaceID) {
            GLib.source_remove(this._moveIntoPlaceID);
            this._moveIntoPlaceID = 0;
        }

        this._moveIntoPlaceID = GLib.timeout_add(GLib.PRIORITY_LOW, 250, () => {
            if (this._fixed && this._x !== null && this._y !== null && this._window) {
                try {
                    this._window.move_frame(true, this._x, this._y);
                } catch {
                    // Ignored if window was already destroyed
                }
            }
            this._moveIntoPlaceID = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    public refreshWindowPosition(): void {
        this._moveIntoPlace();
    }

    public destroy(): void {
        if (this._window) {
            for (const signalID of this._signalIDs) {
                try {
                    this._window.disconnect(signalID);
                } catch {}
            }
            if (this._keepAtTop && !this.windowUnmanaged) {
                try {
                    this._window.unmake_above();
                } catch {}
            }
        }
        this._signalIDs = [];

        if (this._moveIntoPlaceID) {
            GLib.source_remove(this._moveIntoPlaceID);
            this._moveIntoPlaceID = 0;
        }

        this._window = null;
        this._waylandClient = null;
    }

    public setWaylandClient(client: any): void {
        this._waylandClient = client;
    }

    private _parseTitle(): void {
        if (!this._window) return;

        this._x = null;
        this._y = null;
        const keepAtTop = this._keepAtTop;
        this._keepAtTop = false;
        const showInAllDesktops = this._showInAllDesktops;
        this._showInAllDesktops = false;
        this._fixed = false;

        let title = this._window.get_title();
        if (title !== null) {
            if (title.length > 0 && title[title.length - 1] === ' ') {
                if (title.length > 1 && title[title.length - 2] === ' ') {
                    title = '@!HTD';
                } else {
                    title = '@!H';
                }
            }

            const pos = title.search('@!');
            if (pos !== -1) {
                const extraChars = title.substring(pos + 2).trim().toUpperCase();
                for (const char of extraChars) {
                    switch (char) {
                        case 'T':
                            this._keepAtTop = true;
                            break;
                        case 'D':
                            this._showInAllDesktops = true;
                            break;
                    }
                }
            }

            if (title.startsWith('Desktop Icons ')) {
                this._keepAtTop = false;
                this._fixed = true;
                try {
                    const desktopIndex = parseInt(title.substring(14).trim(), 10);
                    const desktopData = this._emulator.getMonitorData(desktopIndex - 1);
                    if (desktopData) {
                        this._x = desktopData.x + desktopData.windowMarginLeft;
                        this._y = desktopData.y + desktopData.windowMarginTop;
                    }
                } catch (e: any) {
                    console.log(`[OmniShell] Exception calculating window pos: ${e.message}`);
                }
                try {
                    this._window.set_type(Meta.WindowType.DESKTOP);
                } catch {}
            }

            if (this._keepAtTop !== keepAtTop) {
                if (this._keepAtTop) this._window.make_above();
                else this._window.unmake_above();
            }

            if (this._showInAllDesktops !== showInAllDesktops) {
                if (this._showInAllDesktops) this._window.stick();
                else this._window.unstick();
            }

            this._moveIntoPlace();
        }
    }
}

export class EmulateX11WindowType {
    private _windowList: Meta.Window[];
    private _waylandClient: any;
    private _monitorData: MonitorGeometryData[];

    constructor() {
        this._windowList = [];
        this._waylandClient = null;
        this._monitorData = [];
    }

    public setMonitorData(data: MonitorGeometryData[]): void {
        this._monitorData = data;
    }

    public getMonitorData(idx: number): MonitorGeometryData | null {
        if (idx >= this._monitorData.length || idx < 0) return null;
        return this._monitorData[idx];
    }

    public setWaylandClient(client: any): void {
        this._waylandClient = client;
        for (const window of this._windowList) {
            if ((window as any).customJS_ding) {
                (window as any).customJS_ding.setWaylandClient(this._waylandClient);
            }
        }
    }

    public enable(): void {
        (global.display as any).connectObject(
            'window-created',
            (_: any, window: Meta.Window) => {
                if (
                    (this._waylandClient && this._waylandClient.query_window_belongs_to(window)) ||
                    window.get_title()?.startsWith('Desktop Icons ')
                ) {
                    this.addWindow(window);
                }
            },
            this,
        );
    }

    public disable(): void {
        for (const window of this._windowList) {
            this._clearWindow(window);
        }
        this._windowList = [];

        try {
            (global.display as any).disconnectObject(this);
        } catch {}

        this.refreshWindowsPosition();
    }

    public addWindow(window: Meta.Window): void {
        if ((window as any).customJS_ding) return;

        const manageWindow = new ManageWindow(window, this._waylandClient, this);
        (window as any).customJS_ding = manageWindow;
        this._windowList.push(window);

        manageWindow.unmanagedID = window.connect('unmanaged', (iWindow: Meta.Window) => {
            if ((iWindow as any).customJS_ding) {
                (iWindow as any).customJS_ding.windowUnmanaged = true;
                this._clearWindow(iWindow);
            }
            this._windowList = this._windowList.filter((item) => item !== iWindow);
        });

        this.refreshWindowsPosition();
    }

    public refreshWindowsPosition(): void {
        this._windowList.forEach((window) => {
            if ((window as any).customJS_ding) {
                (window as any).customJS_ding.refreshWindowPosition();
            }
        });
    }

    private _clearWindow(window: Meta.Window): void {
        const custom = (window as any).customJS_ding;
        if (custom) {
            if (custom.unmanagedID) {
                try {
                    window.disconnect(custom.unmanagedID);
                } catch {}
            }
            custom.destroy();
            (window as any).customJS_ding = null;
        }
    }
}
