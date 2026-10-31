/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * VisibleArea: Computes usable monitor work area and margins for Desktop Icons,
 * harmonizing with Tiling Shell's screen gaps and safe zones.
 */
import { GObject, GLib } from "../gi/ext.js";
import { registerGObjectClass } from "../utils/gjs.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Settings from "../settings/settings.js";

const MARGIN_SIDES = ["top", "bottom", "left", "right"];
const MAX_MARGIN_PX = 1e5;

function normalizeMargins(margins) {
  if (!margins || typeof margins !== "object" || Array.isArray(margins))
    throw new TypeError("Margins must be an object keyed by monitor index");
  const normalized = Object.create(null);
  const monitorCount = Main.layoutManager.monitors.length;
  for (const [monitorKey, values] of Object.entries(margins)) {
    if (!/^(?:-1|0|[1-9]\d*)$/.test(monitorKey))
      throw new TypeError(`Invalid monitor index: ${monitorKey}`);
    const monitorIndex = Number(monitorKey);
    if (monitorIndex < -1 || monitorIndex >= monitorCount)
      throw new RangeError(`Monitor index out of range: ${monitorKey}`);
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new TypeError(`Margins for monitor ${monitorKey} must be an object`);
    const sideValues = Object.create(null);
    for (const [side, value] of Object.entries(values)) {
      if (!MARGIN_SIDES.includes(side))
        throw new TypeError(`Invalid margin side: ${side}`);
      if (typeof value !== "number" || !Number.isFinite(value) ||
          value < 0 || value > MAX_MARGIN_PX)
        throw new RangeError(`Invalid ${side} margin for monitor ${monitorKey}`);
    }
    for (const side of MARGIN_SIDES)
      sideValues[side] = values[side] ?? 0;
    normalized[monitorKey] = sideValues;
  }
  return normalized;
}

const _VisibleArea = class _VisibleArea extends GObject.Object {
  _usableAreas;
  _marginsList;
  _refreshTimerId;
  _extensionUUID = "130cbc66-235c-4bd6-8571-98d2d8bba5e2";
  constructor() {
    super();
    this._usableAreas = Object.create(null);
    this._marginsList = new Map();
    this._refreshTimerId = null;
  }

  disable() {
    if (this._refreshTimerId !== null) {
      GLib.source_remove(this._refreshTimerId);
      this._refreshTimerId = null;
    }
    this._usableAreas = Object.create(null);
    this._marginsList = new Map();
  }

  setMarginsForExtension(extensionUUID, margins) {
    if (typeof extensionUUID !== "string" || extensionUUID.length === 0 ||
        extensionUUID.length > 255 || /[\u0000-\u001f\u007f]/.test(extensionUUID))
      throw new TypeError("Invalid extension UUID");
    if (margins === null) {
      if (!this._marginsList.has(extensionUUID)) return;
      this._marginsList.delete(extensionUUID);
    } else {
      this._marginsList.set(extensionUUID, normalizeMargins(margins));
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

  _refreshMargins() {
    this._usableAreas = Object.create(null);
    const primaryIndex = Main.layoutManager.primaryIndex ?? 0;
    for (const margins of this._marginsList.values()) {
      for (const [monitorKey, monitorMargins] of Object.entries(margins)) {
        let index = monitorKey;
        if (Number(monitorKey) < 0) {
          index = String(primaryIndex);
        }
        if (!(index in this._usableAreas)) {
          this._usableAreas[index] = {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0
          };
        }
        for (const side of MARGIN_SIDES) {
          this._usableAreas[index][side] = Math.max(
            this._usableAreas[index][side],
            monitorMargins[side]
          );
        }
      }
    }
    this.emit("updated-usable-area");
  }

  /**
   * Returns the margin and geometry values for a specific monitor.
   */
  getMonitorGeometry(ws, monitorIndex) {
    const display = ws?.get_display?.() || global.display;
    const geometry = display.get_monitor_geometry(monitorIndex);
    const scale = display.get_monitor_scale(monitorIndex);
    const area = ws?.get_work_area_for_monitor?.(monitorIndex) || Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
    let marginTop = area.y - geometry.y;
    let marginLeft = area.x - geometry.x;
    let marginRight = geometry.width - area.width - marginLeft;
    let marginBottom = geometry.height - area.height - marginTop;
    const windowMarginTop = marginTop;
    const windowMarginBottom = marginBottom;
    const windowMarginLeft = marginLeft;
    const windowMarginRight = marginRight;
    const strIndex = String(monitorIndex);
    const isPrimary = monitorIndex === (Main.layoutManager.primaryIndex ?? 0);
    const lookupKeys = [strIndex];
    if (isPrimary && !lookupKeys.includes("-1")) lookupKeys.push("-1");
    for (const key of lookupKeys) {
      if (key in this._usableAreas) {
        marginTop = Math.max(marginTop, this._usableAreas[key].top);
        marginBottom = Math.max(marginBottom, this._usableAreas[key].bottom);
        marginLeft = Math.max(marginLeft, this._usableAreas[key].left);
        marginRight = Math.max(marginRight, this._usableAreas[key].right);
      }
    }
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
      windowMarginRight
    };
  }

  get uuid() {
    return this._extensionUUID;
  }
};
registerGObjectClass(_VisibleArea, {
  GTypeName: "OmniShellVisibleArea",
  Signals: {
    "updated-usable-area": {}
  }
});
let VisibleArea = _VisibleArea;
export {
  VisibleArea
};
