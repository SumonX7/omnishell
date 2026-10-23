/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * VisibleArea: Computes usable monitor work area and margins for Desktop Icons,
 * harmonizing with Tiling Shell's screen gaps and safe zones.
 */

import { GObject, GLib } from '../gi/ext';
import { registerGObjectClass } from '../utils/gjs';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Settings from '../settings/settings';

export interface MonitorGeometryData {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
    marginTop: number;
    marginBottom: number;
    marginLeft: number;
    marginRight: number;
    windowMarginTop: number;
    windowMarginBottom: number;
    windowMarginLeft: number;
    windowMarginRight: number;
}

export class VisibleArea extends GObject.Object {
    static {
        registerGObjectClass(this, {
            GTypeName: 'OmniShellVisibleArea',
            Signals: {
                'updated-usable-area': {},
            },
        });
    }

    private _usableAreas: Record<string, { top: number; bottom: number; left: number; right: number }>;
    private _marginsList: Record<string, any>;
    private _refreshTimerId: number | null;
    private readonly _extensionUUID: string = '130cbc66-235c-4bd6-8571-98d2d8bba5e2';

    constructor() {
        super();
        this._usableAreas = {};
        this._marginsList = {};
        this._refreshTimerId = null;
    }

    public disable(): void {
        if (this._refreshTimerId !== null) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = null;
        }
        this._usableAreas = {};
        this._marginsList = {};
    }

    public setMarginsForExtension(extensionUUID: string, margins: any): void {
        if (margins === null) {
            if (!(extensionUUID in this._marginsList)) return;
            delete this._marginsList[extensionUUID];
        } else {
            this._marginsList[extensionUUID] = margins;
        }

        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
        }

        this._refreshTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._refreshMargins();
            this._refreshTimerId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    private _refreshMargins(): void {
        this._usableAreas = {};
        for (const extensionUUID in this._marginsList) {
            const margins = this._marginsList[extensionUUID];
            for (const workspace in margins) {
                let index = workspace;
                if (Number(workspace) < 0) {
                    index = String(Main.layoutManager.primaryIndex);
                }

                if (!(index in this._usableAreas)) {
                    this._usableAreas[index] = {
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0,
                    };
                }
                for (const side of ['top', 'bottom', 'left', 'right'] as const) {
                    this._usableAreas[index][side] = Math.max(
                        this._usableAreas[index][side],
                        margins[workspace][side] || 0,
                    );
                }
            }
        }
        this.emit('updated-usable-area');
    }

    /**
     * Returns the margin and geometry values for a specific monitor.
     */
    public getMonitorGeometry(ws: any, monitorIndex: number): MonitorGeometryData {
        const display = ws.get_display();
        const geometry = display.get_monitor_geometry(monitorIndex);
        const scale = display.get_monitor_scale(monitorIndex);
        const area = ws.get_work_area_for_monitor(monitorIndex);

        let marginTop = area.y - geometry.y;
        let marginLeft = area.x - geometry.x;
        let marginRight = geometry.width - area.width - marginLeft;
        let marginBottom = geometry.height - area.height - marginTop;

        const windowMarginTop = marginTop;
        const windowMarginBottom = marginBottom;
        const windowMarginLeft = marginLeft;
        const windowMarginRight = marginRight;

        const strIndex = String(monitorIndex);
        if (strIndex in this._usableAreas) {
            marginTop = Math.max(marginTop, this._usableAreas[strIndex].top);
            marginBottom = Math.max(marginBottom, this._usableAreas[strIndex].bottom);
            marginLeft = Math.max(marginLeft, this._usableAreas[strIndex].left);
            marginRight = Math.max(marginRight, this._usableAreas[strIndex].right);
        }

        // Tiling Shell Outer Gap harmonization
        if (Settings.DESKTOP_ICONS_SAFE_ZONE) {
            const outerGaps = Settings.OUTER_GAPS || 0;
            marginTop += outerGaps;
            marginBottom += outerGaps;
            marginLeft += outerGaps;
            marginRight += outerGaps;
        }

        return {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
            scale,
            marginTop,
            marginBottom,
            marginLeft,
            marginRight,
            windowMarginTop,
            windowMarginBottom,
            windowMarginLeft,
            windowMarginRight,
        };
    }

    public get uuid(): string {
        return this._extensionUUID;
    }
}
