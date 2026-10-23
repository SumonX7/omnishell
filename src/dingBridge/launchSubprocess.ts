/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * LaunchSubprocess: Process supervisor for the GTK4 Desktop Icons application.
 * Manages Wayland client subprocess attachment, output streaming, and automatic recovery.
 */

import { Gio, GLib, Meta } from '../gi/ext';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class LaunchSubprocess {
    private readonly _processId: string;
    public cancellable: Gio.Cancellable | null;
    private _launcher: Gio.SubprocessLauncher | null;
    public subprocess: Gio.Subprocess | null;
    public processRunning: boolean;
    private _launchTimer: number;
    private _waitingForWindows: number;
    private _waylandClient: any;
    private _dataInputStream: Gio.DataInputStream | null;

    constructor(flags: Gio.SubprocessFlags, processId: string) {
        this._processId = processId;
        this.cancellable = new Gio.Cancellable();
        this._launcher = new Gio.SubprocessLauncher({
            flags: flags | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
        });
        this.subprocess = null;
        this.processRunning = false;
        this._launchTimer = 0;
        this._waitingForWindows = 0;
        this._waylandClient = null;
        this._dataInputStream = null;
    }

    public setCwd(cwd: string): void {
        this._launcher?.set_cwd(cwd);
    }

    public spawnv(argv: string[]): Gio.Subprocess | null {
        try {
            // Mutter WaylandClient subprocess API
            if ((Meta as any).WaylandClient && (Meta as any).WaylandClient.new_subprocess) {
                this._waylandClient = (Meta as any).WaylandClient.new_subprocess(
                    (global as any).context,
                    this._launcher,
                    argv,
                );
                this.subprocess = this._waylandClient.get_subprocess();
            } else {
                this.subprocess = this._launcher?.spawnv(argv) ?? null;
            }
        } catch (e: any) {
            this.subprocess = null;
            console.log(`[OmniShell] Error launching Desktop process: ${e.message}\n${e.stack}`);
        }

        try {
            this._launcher?.close();
        } catch {}
        this._launcher = null;

        if (this.subprocess) {
            const stdoutPipe = this.subprocess.get_stdout_pipe();
            if (stdoutPipe) {
                this._dataInputStream = Gio.DataInputStream.new(stdoutPipe);
                this._readOutput();
            }

            this.subprocess.wait_async(this.cancellable, () => {
                this.processRunning = false;
                this._dataInputStream = null;
                this.cancellable = null;
                this.cancelTimer();
            });

            this.processRunning = true;
            if (Main.layoutManager.monitors.length !== 0) {
                this._waitingForWindows = Main.layoutManager.monitors.length;
                this._launchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 6000, () => {
                    this._launchTimer = 0;
                    try {
                        this.subprocess?.force_exit();
                    } catch {}
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        return this.subprocess;
    }

    public cancelTimer(): void {
        if (this._launchTimer !== 0) {
            GLib.source_remove(this._launchTimer);
            this._launchTimer = 0;
            this._waitingForWindows = 0;
        }
    }

    private _readOutput(): void {
        if (!this._dataInputStream || !this.cancellable) return;

        this._dataInputStream.read_line_async(
            GLib.PRIORITY_DEFAULT,
            this.cancellable,
            (object, res) => {
                try {
                    const [output, length] = (object as Gio.DataInputStream).read_line_finish_utf8(res);
                    if (length && output) {
                        print(`[OmniShell-${this._processId}]: ${output}`);
                    }
                } catch (e: any) {
                    if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        return;
                    }
                    console.error(e, `[OmniShell-${this._processId}-Error]`);
                }

                if (this.processRunning) {
                    this._readOutput();
                }
            },
        );
    }

    public query_window_belongs_to(window: Meta.Window): boolean {
        if (!this.processRunning) return false;

        try {
            if (this._waylandClient && typeof this._waylandClient.owns_window === 'function') {
                const ownsWindow = this._waylandClient.owns_window(window);
                if (ownsWindow && this._launchTimer !== 0 && this._waitingForWindows !== 0) {
                    this._waitingForWindows--;
                    if (this._waitingForWindows === 0) {
                        this.cancelTimer();
                    }
                }
                return ownsWindow;
            }
        } catch (error: any) {
            console.log(`[OmniShell] query_window_belongs_to error: ${error.message}`);
        }

        return false;
    }
}
