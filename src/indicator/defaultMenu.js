import { GObject, St, Clutter, Gio, GLib } from "../gi/ext.js";
import SignalHandling from "../utils/signalHandling.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
  enableScalingFactorSupport,
  getMonitors,
  getMonitorScalingFactor,
  getScalingFactorOf
} from "../utils/ui.js";
import Settings from "../settings/settings.js";
import GlobalState from "../utils/globalState.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import LayoutButton from "./layoutButton.js";
import { logger } from "../utils/logger.js";
import { registerGObjectClass } from "../utils/gjs.js";
import { _ } from "../translations.js";
import { widgetOrientation } from "../utils/gnomesupport.js";
import { createButton, createIconButton } from "./utils.js";
const debug = logger("DefaultMenu");
const _LayoutsRow = class _LayoutsRow extends St.BoxLayout {
  _layoutsBox;
  _layoutsButtons;
  _layouts;
  _label;
  _monitor;
  constructor(parent, layouts, selectedId, showMonitorName, monitor, selectableIds) {
    super({
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      xExpand: true,
      yExpand: true,
      style: "spacing: 8px",
      ...widgetOrientation(true)
    });
    this._layoutsBox = new St.BoxLayout({
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      xExpand: true,
      yExpand: true,
      styleClass: "layouts-box-layout"
    });
    this._monitor = monitor;
    this._label = new St.Label({
      text: `Monitor ${this._monitor.index + 1}`,
      styleClass: "monitor-layouts-title"
    });
    this.add_child(this._label);
    if (!showMonitorName) this._label.hide();
    this.add_child(this._layoutsBox);
    parent.add_child(this);
    this._layouts = layouts;
    const selectedIndex = layouts.findIndex((lay) => lay.id === selectedId);
    const hasGaps = Settings.get_inner_gaps(1).top > 0;
    const layoutHeight = 36;
    const layoutWidth = 64;
    this._layoutsButtons = layouts.map((lay, ind) => {
      const btn = new LayoutButton(
        this._layoutsBox,
        lay,
        hasGaps ? 2 : 0,
        layoutHeight,
        layoutWidth
      );
      btn.connect(
        "clicked",
        () => !btn.checked && this.emit("selected-layout", lay.id)
      );
      if (ind === selectedIndex) btn.set_checked(true);
      if (selectableIds && !selectableIds.has(lay.id))
        btn.setDisabled(true);
      return btn;
    });
  }

  selectLayout(selectedId) {
    const selectedIndex = GlobalState.get().layouts.findIndex(
      (lay) => lay.id === selectedId
    );
    this._layoutsButtons.forEach(
      (btn, ind) => btn.set_checked(ind === selectedIndex)
    );
  }

  /**
   * While dynamic tiling is on, only layouts sharing the current
   * tile-count group can actually be switched to (see
   * `TilingManager.selectDynamicLayout`) — everything else is disabled so
   * it doesn't look clickable when it isn't. `undefined` (dynamic tiling
   * off, or nothing placed yet) re-enables every button.
   */
  setSelectable(selectableIds) {
    this._layoutsButtons.forEach((btn, ind) => {
      const lay = this._layouts[ind];
      btn.setDisabled(!!selectableIds && !selectableIds.has(lay.id));
    });
  }

  updateMonitorName(showMonitorName, monitorsDetails) {
    if (!showMonitorName) this._label.hide();
    else this._label.show();
    debug(`updateMonitorName: monitor=${this._monitor.index}, x=${this._monitor.x}, y=${this._monitor.y}`);
    debug(`updateMonitorName: monitorsDetails=${JSON.stringify(monitorsDetails)}`);
    let details = monitorsDetails.find(
      (m) => m.index === this._monitor.index
    );
    if (details) {
      debug(`updateMonitorName: matched by index ${this._monitor.index}`);
    }
    if (!details) {
      details = monitorsDetails.find(
        (m) => m.x === this._monitor.x && m.y === this._monitor.y
      );
      if (details) {
        debug(`updateMonitorName: matched by coordinates (${this._monitor.x}, ${this._monitor.y})`);
      }
    }
    if (!details) {
      debug(`updateMonitorName: no match found for monitor ${this._monitor.index}`);
      return;
    }
    debug(`updateMonitorName: setting label to "${details.name}"`);
    this._label.set_text(details.name);
  }
};
registerGObjectClass(_LayoutsRow, {
  GTypeName: "LayoutsRow",
  Signals: {
    "selected-layout": {
      param_types: [GObject.TYPE_STRING]
    }
  }
});
let LayoutsRow = _LayoutsRow;

class DefaultMenu {
  _signals;
  _indicator;
  _layoutsRows;
  _container;
  _scalingFactor;
  _children;
  _openPrefsFn;
  constructor(indicator, enableScalingFactor, openPrefsFn) {
    this._indicator = indicator;
    this._signals = new SignalHandling();
    this._openPrefsFn = openPrefsFn;
    this._children = [];
    const dynamicToggle = new PopupMenu.PopupSwitchMenuItem(
      _("Dynamic tiling"),
      Settings.ENABLE_DYNAMIC_TILING,
      {}
    );
    this._children.push(dynamicToggle);
    dynamicToggle.connect("toggled", (_item, state) => {
      Settings.ENABLE_DYNAMIC_TILING = state;
    });
    this._signals.connect(
      Settings,
      Settings.KEY_ENABLE_DYNAMIC_TILING,
      () => {
        dynamicToggle.setToggleState(Settings.ENABLE_DYNAMIC_TILING);
        this._queueRefreshSelectedLayouts();
      }
    );
    this._indicator.menu.addMenuItem(
      dynamicToggle
    );
    const refreshTilingItem = new PopupMenu.PopupMenuItem(
      _("Refresh dynamic tiling")
    );
    this._signals.connect(
      Settings,
      Settings.KEY_ENABLE_DYNAMIC_TILING,
      () => refreshTilingItem.setSensitive(Settings.ENABLE_DYNAMIC_TILING)
    );
    refreshTilingItem.setSensitive(Settings.ENABLE_DYNAMIC_TILING);
    refreshTilingItem.connect("activate", () => {
      this._indicator.refreshDynamicTiling();
    });
    this._children.push(refreshTilingItem);
    this._indicator.menu.addMenuItem(refreshTilingItem);
    const layoutsPopupMenu = new PopupMenu.PopupBaseMenuItem({
      style_class: "indicator-menu-item"
    });
    this._children.push(layoutsPopupMenu);
    this._container = new St.BoxLayout({
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      xExpand: true,
      yExpand: true,
      styleClass: "default-menu-container",
      ...widgetOrientation(true)
    });
    layoutsPopupMenu.add_child(this._container);
    this._indicator.menu.addMenuItem(
      layoutsPopupMenu
    );
    if (enableScalingFactor) {
      const monitor = Main.layoutManager.findMonitorForActor(
        this._container
      );
      const scalingFactor = getMonitorScalingFactor(
        monitor?.index || Main.layoutManager.primaryIndex
      );
      enableScalingFactorSupport(this._container, scalingFactor);
    }
    this._scalingFactor = getScalingFactorOf(this._container)[1];
    this._layoutsRows = [];
    this._drawLayouts();
    this._signals.connect(
      Settings,
      Settings.KEY_SETTING_LAYOUTS_JSON,
      () => {
        this._drawLayouts();
      }
    );
    this._signals.connect(Settings, Settings.KEY_INNER_GAPS, () => {
      this._drawLayouts();
    });
    this._signals.connect(
      Settings,
      Settings.KEY_SETTING_SELECTED_LAYOUTS,
      () => {
        this._updateScaling();
        if (this._layoutsRows.length !== getMonitors().length)
          this._drawLayouts();
        this._refreshSelectedLayouts();
      }
    );
    this._signals.connect(
      global.workspaceManager,
      "active-workspace-changed",
      () => this._refreshSelectedLayouts()
    );
    this._signals.connect(
      this._indicator.menu,
      "open-state-changed",
      (_menu, isOpen) => {
        if (isOpen) this._refreshSelectedLayouts();
      }
    );
    this._signals.connect(Main.layoutManager, "monitors-changed", () => {
      if (!enableScalingFactor) return;
      const monitor = Main.layoutManager.findMonitorForActor(
        this._container
      );
      const scalingFactor = getMonitorScalingFactor(
        monitor?.index || Main.layoutManager.primaryIndex
      );
      enableScalingFactorSupport(this._container, scalingFactor);
      this._updateScaling();
      if (this._layoutsRows.length !== getMonitors().length)
        this._drawLayouts();
      this._computeMonitorsDetails();
    });
    this._computeMonitorsDetails();
    const desktopRow = this._buildDesktopIconsRow();
    this._indicator.menu.addMenuItem(desktopRow);
    this._children.push(desktopRow);
    const separator = new PopupMenu.PopupSeparatorMenuItem();
    this._indicator.menu.addMenuItem(separator);
    this._children.push(separator);
    const buttonsPopupMenu = this._buildEditingButtonsRow();
    this._indicator.menu.addMenuItem(
      buttonsPopupMenu
    );
    this._children.push(buttonsPopupMenu);
  }

  // compute monitors details and update labels asynchronously (if we have successful results...)
  _computeMonitorsDetails() {
    if (getMonitors().length === 1) {
      this._layoutsRows.forEach((lr) => lr.updateMonitorName(false, []));
      return;
    }
    const monitorsDetails = this._get_display_name();
    if (monitorsDetails) {
      this._layoutsRows.forEach(
        (lr) => lr.updateMonitorName(true, monitorsDetails)
      );
      return;
    }
    try {
      const proc = Gio.Subprocess.new(
        ["gjs", "-m", `${this._indicator.path}/monitorDescription.js`],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
      );
      proc.communicate_utf8_async(
        null,
        null,
        (pr, res) => {
          if (!pr) return;
          try {
            const [, stdout, stderr] = pr.communicate_utf8_finish(res);
            if (pr.get_successful() && stdout) {
              debug(stdout);
              const parsedMonitorsDetails = JSON.parse(stdout);
              this._layoutsRows?.forEach(
                (lr) => lr.updateMonitorName(true, parsedMonitorsDetails)
              );
            } else {
              debug("error:", stderr);
            }
          } catch (err) {
            debug("communicate_utf8_finish error:", err);
          }
        }
      );
    } catch (e) {
      debug(e);
    }
  }

  // Use GNOME 49+'s Meta.Monitor with get_display_name()
  _get_display_name() {
    const monitorManager = global.backend.get_monitor_manager();
    if (!monitorManager.get_logical_monitors) return void 0;
    const logicalMonitors = monitorManager.get_logical_monitors();
    if (!logicalMonitors || logicalMonitors.length <= 0) return void 0;
    const monitorsDetails = [];
    logicalMonitors.forEach((logicalMonitor) => {
      const metaMonitors = logicalMonitor.get_monitors();
      if (metaMonitors.length <= 0) return;
      const metaMonitor = metaMonitors[0];
      if (!metaMonitor.get_display_name) return;
      const x = logicalMonitor.x ?? 0;
      const y = logicalMonitor.y ?? 0;
      monitorsDetails.push({
        name: metaMonitor.get_display_name(),
        index: logicalMonitor.get_number(),
        x,
        y
      });
    });
    return monitorsDetails;
  }

  _updateScaling() {
    const newScalingFactor = getScalingFactorOf(this._container)[1];
    if (this._scalingFactor === newScalingFactor) return;
    this._scalingFactor = newScalingFactor;
    this._drawLayouts();
  }

  _buildEditingButtonsRow() {
    const buttonsBoxLayout = new St.BoxLayout({
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      xExpand: true,
      yExpand: true,
      styleClass: "buttons-box-layout"
    });
    const editLayoutsBtn = createButton(
      "edit-symbolic",
      `${_("Edit Layouts")}...`,
      this._indicator.path
    );
    editLayoutsBtn.connect(
      "clicked",
      () => this._indicator.openLayoutEditor()
    );
    buttonsBoxLayout.add_child(editLayoutsBtn);
    const newLayoutBtn = createButton(
      "add-symbolic",
      `${_("New Layout")}...`,
      this._indicator.path
    );
    newLayoutBtn.connect(
      "clicked",
      () => this._indicator.newLayoutOnClick(true)
    );
    buttonsBoxLayout.add_child(newLayoutBtn);
    const prefsBtn = createIconButton(
      "prefs-symbolic",
      this._indicator.path
    );
    prefsBtn.connect("clicked", () => {
      this._openPrefsFn();
      this._indicator.menu.toggle();
    });
    buttonsBoxLayout.add_child(prefsBtn);
    const buttonsPopupMenu = new PopupMenu.PopupBaseMenuItem({
      style_class: "indicator-menu-item"
    });
    buttonsPopupMenu.add_child(buttonsBoxLayout);
    return buttonsPopupMenu;
  }

  _buildDesktopIconsRow() {
    const desktopMenu = new PopupMenu.PopupSwitchMenuItem(
      _("Desktop Icons"),
      Settings.ENABLE_DESKTOP_ICONS,
      { reactive: true }
    );
    desktopMenu.connect("toggled", (_item, state) => {
      Settings.ENABLE_DESKTOP_ICONS = state;
    });
    this._signals.connect(
      Settings.gioSetting,
      `changed::${Settings.KEY_ENABLE_DESKTOP_ICONS}`,
      () => {
        desktopMenu.setToggleState(Settings.ENABLE_DESKTOP_ICONS);
      }
    );
    return desktopMenu;
  }

  _drawLayouts() {
    const layouts = GlobalState.get().layouts;
    this._container.destroy_all_children();
    this._layoutsRows = [];
    const ws_index = global.workspaceManager.get_active_workspace_index();
    const monitors = getMonitors();
    this._layoutsRows = monitors.map((monitor) => {
      const selectedId = this._selectedIdFor(monitor.index, ws_index);
      const selectableIds = this._selectableIdsFor(
        monitor.index,
        ws_index
      );
      const row = new LayoutsRow(
        this._container,
        layouts,
        selectedId,
        monitors.length > 1,
        monitor,
        selectableIds
      );
      row.connect(
        "selected-layout",
        (r, layoutId) => {
          this._indicator.selectLayoutOnClick(
            monitor.index,
            layoutId
          );
        }
      );
      return row;
    });
  }

  /**
   * The layout that should show as selected for a monitor: while dynamic
   * tiling is on and actually placing windows on that monitor's
   * workspace, this is whichever saved layout it is using as its
   * template right now (see `TilingManager.getCurrentDynamicLayoutId`) —
   * otherwise it falls back to the static per-monitor selection.
   */
  _selectedIdFor(monitorIndex, wsIndex) {
    if (Settings.ENABLE_DYNAMIC_TILING) {
      const ws = global.workspaceManager.get_workspace_by_index(wsIndex);
      const dynamicId = ws ? this._indicator.getTilingManager(monitorIndex)?.getCurrentDynamicLayoutId(ws) : void 0;
      if (dynamicId) return dynamicId;
    }
    const selected_layouts = Settings.get_selected_layouts();
    const ws_selected_layouts = wsIndex < selected_layouts.length ? selected_layouts[wsIndex] : [];
    return monitorIndex < ws_selected_layouts.length ? ws_selected_layouts[monitorIndex] : (GlobalState.get().layouts[0]?.id ?? "");
  }

  /**
   * Which layouts are actually switchable to for a monitor right now —
   * `undefined` (every button enabled) unless dynamic tiling is on and
   * has a tile-count group to restrict to.
   */
  _selectableIdsFor(monitorIndex, wsIndex) {
    if (!Settings.ENABLE_DYNAMIC_TILING) return void 0;
    const ws = global.workspaceManager.get_workspace_by_index(wsIndex);
    return ws ? this._indicator.getTilingManager(monitorIndex)?.getCurrentDynamicLayoutGroupIds(ws) : void 0;
  }

  _refreshSelectedLayouts() {
    const wsIndex = global.workspaceManager.get_active_workspace_index();
    getMonitors().forEach((m, index) => {
      this._layoutsRows[index]?.selectLayout(
        this._selectedIdFor(m.index, wsIndex)
      );
      this._layoutsRows[index]?.setSelectable(
        this._selectableIdsFor(m.index, wsIndex)
      );
    });
  }

  _refreshSourceId = null;
  _queueRefreshSelectedLayouts() {
    if (this._refreshSourceId !== null) return;
    this._refreshSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._refreshSourceId = null;
      this._refreshSelectedLayouts();
      return GLib.SOURCE_REMOVE;
    });
  }

  destroy() {
    if (this._refreshSourceId !== null) {
      GLib.Source.remove(this._refreshSourceId);
      this._refreshSourceId = null;
    }
    this._signals.disconnect();
    this._layoutsRows.forEach((lr) => lr.destroy());
    this._layoutsRows = [];
    this._children.forEach((c) => c.destroy());
    this._children = [];
  }
}

export {
  DefaultMenu as default
};
