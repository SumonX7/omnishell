/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * DingBridge: Complete manager for the Desktop Icons subsystem inside OmniShell.
 * Superpower integration with dynamic tiling layouts, margins, and DBus coordination.
 */

import { Gio, GLib, St } from '../gi/ext';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { EmulateX11WindowType } from './emulateX11WindowType';
import { VisibleArea, MonitorGeometryData } from './visibleArea';
import { LaunchSubprocess } from './launchSubprocess';
import Settings from '../settings/settings';

export class DingBridge {
    private readonly _extensionPath: string;
    public visibleArea: VisibleArea | null;
    private _x11Manager: EmulateX11WindowType | null;
    private _currentProcess: LaunchSubprocess | null;
    private _isEnabled: boolean;
    private _launchDesktopId: number;
    private _launchTime: number;
    private _dbusConnection: Gio.DBusConnection | null;
    private _dbusConnectionId: number;
    private _dbusConnectionGroupId: number;
    private _actionGroup: Gio.SimpleActionGroup | null;
    private _disableTimer: Gio.SimpleAction | null;
    private _disableTimerId: number;
    private _desktopGeometry: Gio.SimpleAction | null;
    private _startupPreparedId: number | null;
    private _scaleFactorId: number;
    private _visibleAreaId: number;
    private _monitorsChangedId: number;
    private _workareasChangedId: number;
    private _enabledSettingSignalId: number;
    private _safeZoneSettingSignalId: number;
    private _lastFolderOpenTime: number;
    private _folderOpenedAction: Gio.SimpleAction | null;

    constructor(extensionPath: string) {
        this._extensionPath = extensionPath;
        this.visibleArea = null;
        this._x11Manager = null;
        this._currentProcess = null;
        this._isEnabled = false;
        this._launchDesktopId = 0;
        this._launchTime = 0;
        this._lastFolderOpenTime = 0;
        this._folderOpenedAction = null;
        this._dbusConnection = null;
        this._dbusConnectionId = 0;
        this._dbusConnectionGroupId = 0;
        this._actionGroup = null;
        this._disableTimer = null;
        this._disableTimerId = 0;
        this._desktopGeometry = null;
        this._startupPreparedId = null;
        this._scaleFactorId = 0;
        this._visibleAreaId = 0;
        this._monitorsChangedId = 0;
        this._workareasChangedId = 0;
        this._enabledSettingSignalId = 0;
        this._safeZoneSettingSignalId = 0;
        (global as any).__omnishell_ding_bridge = this;
    }

    public enable(): void {
        this._enabledSettingSignalId = Settings.gioSetting.connect(
            `changed::${Settings.KEY_ENABLE_DESKTOP_ICONS}`,
            () => {
                if (Settings.ENABLE_DESKTOP_ICONS) {
                    this._startDesktopSystem();
                } else {
                    this._stopDesktopSystem();
                }
            },
        );

        this._safeZoneSettingSignalId = Settings.gioSetting.connect(
            `changed::${Settings.KEY_DESKTOP_ICONS_SAFE_ZONE}`,
            () => {
                this.updateDesktopGeometry();
            },
        );

        if (Settings.ENABLE_DESKTOP_ICONS) {
            this._startDesktopSystem();
        }
    }

    private _startDesktopSystem(): void {
        if (this._isEnabled) return;

        if (!this._x11Manager) {
            this._x11Manager = new EmulateX11WindowType();
        }
        if (!this.visibleArea) {
            this.visibleArea = new VisibleArea();
        }

        if (Main.layoutManager._startingUp) {
            this._startupPreparedId = Main.layoutManager.connect('startup-complete', () =>
                this._innerEnable(),
            );
        } else {
            this._startupPreparedId = null;
            this._innerEnable();
        }
    }

    private _innerEnable(): void {
        if (this._startupPreparedId !== null) {
            Main.layoutManager.disconnect(this._startupPreparedId);
            this._startupPreparedId = null;
        }

        // Hide overview if starting
        Main.overview.hide();

        this._x11Manager?.enable();

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () =>
            this.updateDesktopGeometry(),
        );
        this._workareasChangedId = global.display.connect('workareas-changed', () =>
            this.updateDesktopGeometry(),
        );

        if (this.visibleArea) {
            this._visibleAreaId = this.visibleArea.connect('updated-usable-area', () =>
                this.updateDesktopGeometry(),
            );
        }

        this._scaleFactorId = St.ThemeContext.get_for_stage(global.stage).connect(
            'notify::scale-factor',
            () => this.updateDesktopGeometry(),
        );

        this._isEnabled = true;
        if (this._launchDesktopId) {
            GLib.source_remove(this._launchDesktopId);
            this._launchDesktopId = 0;
        }

        this._dbusConnectionId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            'com.rastersoft.dingextension',
            Gio.BusNameOwnerFlags.NONE,
            null,
            (connection: Gio.DBusConnection) => {
                this._dbusConnection = connection;

                this._disableTimer = new Gio.SimpleAction({
                    name: 'disableTimer',
                });
                this._desktopGeometry = Gio.SimpleAction.new_stateful(
                    'desktopGeometry',
                    new GLib.VariantType('av'),
                    this.getDesktopGeometry(),
                );
                this._desktopGeometry.set_enabled(true);

                this._disableTimerId = this._disableTimer.connect('activate', () => {
                    if (this._currentProcess?.subprocess) {
                        this._currentProcess.cancelTimer();
                    }
                });

                this._folderOpenedAction = new Gio.SimpleAction({
                    name: 'folderOpened',
                });
                this._folderOpenedAction.connect('activate', () => {
                    this._lastFolderOpenTime = GLib.get_monotonic_time();
                });

                this._actionGroup = new Gio.SimpleActionGroup();
                this._actionGroup.add_action(this._disableTimer);
                this._actionGroup.add_action(this._desktopGeometry);
                this._actionGroup.add_action(this._folderOpenedAction);

                this._dbusConnectionGroupId = this._dbusConnection.export_action_group(
                    '/com/rastersoft/dingextension/control',
                    this._actionGroup,
                );

                this._launchDesktop();
            },
            null,
        );
    }

    public wasFolderOpenedRecently(): boolean {
        if (!this._lastFolderOpenTime) return false;
        // within 3.5 seconds
        return GLib.get_monotonic_time() - this._lastFolderOpenTime < 3500000;
    }

    public notifyFolderOpened(): void {
        this._lastFolderOpenTime = GLib.get_monotonic_time();
    }

    public consumeFolderOpened(): void {
        this._lastFolderOpenTime = 0;
    }

    public updateDesktopGeometry(): void {
        if (this._actionGroup && Main.layoutManager.monitors.length !== 0) {
            this._actionGroup.change_action_state('desktopGeometry', this.getDesktopGeometry());
            this._x11Manager?.refreshWindowsPosition();
        }
    }

    public getDesktopGeometry(): GLib.Variant {
        const desktopVariantList: GLib.Variant[] = [];
        const desktopList: MonitorGeometryData[] = [];
        const ws = (global as any).workspaceManager?.get_active_workspace?.() ||
                   (global as any).workspace_manager?.get_active_workspace?.();
        const { scaleFactor } = St.ThemeContext.get_for_stage(global.stage);

        for (let monitorIndex = 0; monitorIndex < Main.layoutManager.monitors.length; monitorIndex++) {
            const area = this.visibleArea?.getMonitorGeometry(ws, monitorIndex) ?? {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
                scale: 1,
                marginTop: 0,
                marginBottom: 0,
                marginLeft: 0,
                marginRight: 0,
                windowMarginTop: 0,
                windowMarginBottom: 0,
                windowMarginLeft: 0,
                windowMarginRight: 0,
            };

            const monitorData = {
                x: area.x,
                y: area.y,
                width: area.width,
                height: area.height,
                scaleFactor,
                marginTop: area.marginTop,
                marginBottom: area.marginBottom,
                marginLeft: area.marginLeft,
                marginRight: area.marginRight,
                monitorIndex,
                primaryMonitor: Main.layoutManager.primaryIndex,
                windowMarginTop: area.windowMarginTop,
                windowMarginBottom: area.windowMarginBottom,
                windowMarginLeft: area.windowMarginLeft,
                windowMarginRight: area.windowMarginRight,
            };

            const desktopListElement = new GLib.Variant('a{sd}', monitorData);
            desktopVariantList.push(desktopListElement);
            desktopList.push(area);
        }

        this._x11Manager?.setMonitorData(desktopList);
        return new GLib.Variant('av', desktopVariantList);
    }

    private _launchDesktop(): void {
        console.log('[OmniShell] Launching integrated DING desktop process');
        const argv: string[] = [];
        argv.push(GLib.build_filenamev([this._extensionPath, 'app', 'ding.js']));
        argv.push('-E');
        argv.push('-P');
        argv.push(GLib.build_filenamev([this._extensionPath, 'app']));

        this._currentProcess = new LaunchSubprocess(0, 'DING');
        this._currentProcess.setCwd(GLib.get_home_dir());

        if (this._currentProcess.spawnv(argv) === null) {
            this._doRelaunch(1000);
            return;
        }

        this._x11Manager?.setWaylandClient(this._currentProcess);
        this._launchTime = GLib.get_monotonic_time();

        this._currentProcess.subprocess?.wait_async(null, (obj: Gio.Subprocess, res: Gio.AsyncResult) => {
            const delta = GLib.get_monotonic_time() - this._launchTime;
            let reloadTime = 1;
            if (delta < 1000000) {
                reloadTime = 1000;
            }
            try {
                obj.wait_finish(res);
            } catch {}

            if (!this._currentProcess || obj !== this._currentProcess.subprocess) return;

            this._doRelaunch(reloadTime);
        });
    }

    private _doRelaunch(reloadTime: number): void {
        this._currentProcess = null;
        this._x11Manager?.setWaylandClient(null);

        if (this._isEnabled && Settings.ENABLE_DESKTOP_ICONS) {
            if (this._launchDesktopId) {
                GLib.source_remove(this._launchDesktopId);
            }
            this._launchDesktopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, reloadTime, () => {
                this._launchDesktopId = 0;
                this._launchDesktop();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    public killCurrentProcess(): void {
        if (this._launchDesktopId) {
            GLib.source_remove(this._launchDesktopId);
            this._launchDesktopId = 0;
        }

        if (this._currentProcess?.subprocess) {
            this._currentProcess.cancelTimer();
            this._currentProcess.cancellable?.cancel();
            try {
                this._currentProcess.subprocess.send_signal(15);
            } catch {}
        }
        this._currentProcess = null;
        this._x11Manager?.setWaylandClient(null);
    }

    private _stopDesktopSystem(): void {
        this._isEnabled = false;
        this.killCurrentProcess();
        this._x11Manager?.disable();
        this.visibleArea?.disable();
        this.visibleArea = null;

        if (this._disableTimerId && this._disableTimer) {
            this._disableTimer.disconnect(this._disableTimerId);
            this._disableTimerId = 0;
            this._disableTimer = null;
        }

        this._desktopGeometry = null;

        if (this._dbusConnectionGroupId && this._dbusConnection) {
            this._dbusConnection.unexport_action_group(this._dbusConnectionGroupId);
            this._dbusConnectionGroupId = 0;
            this._dbusConnection = null;
        }

        if (this._dbusConnectionId) {
            Gio.bus_unown_name(this._dbusConnectionId);
            this._dbusConnectionId = 0;
        }
        this._actionGroup = null;

        if (this._scaleFactorId) {
            St.ThemeContext.get_for_stage(global.stage).disconnect(this._scaleFactorId);
            this._scaleFactorId = 0;
        }
        if (this._visibleAreaId && this.visibleArea) {
            (this.visibleArea as any).disconnect(this._visibleAreaId);
            this._visibleAreaId = 0;
        }
        if (this._startupPreparedId) {
            Main.layoutManager.disconnect(this._startupPreparedId);
            this._startupPreparedId = null;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._workareasChangedId) {
            global.display.disconnect(this._workareasChangedId);
            this._workareasChangedId = 0;
        }
    }

    public disable(): void {
        if (this._enabledSettingSignalId) {
            Settings.gioSetting.disconnect(this._enabledSettingSignalId);
            this._enabledSettingSignalId = 0;
        }
        if (this._safeZoneSettingSignalId) {
            Settings.gioSetting.disconnect(this._safeZoneSettingSignalId);
            this._safeZoneSettingSignalId = 0;
        }
        (global as any).__omnishell_ding_bridge = null;
        this._stopDesktopSystem();
    }
}
