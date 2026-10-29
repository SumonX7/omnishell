import { registerGObjectClass } from "../../utils/gjs.js";
import { St } from "../../gi/ext.js";
import SnapAssistTile from "../../components/snapassist/snapAssistTile.js";
const _SnapAssistTileButton = class _SnapAssistTileButton extends SnapAssistTile {
  _btn;
  _btnSignalIds;
  constructor(params) {
    super(params);
    this._btnSignalIds = new Set();
    this._btn = new St.Button({
      xExpand: true,
      yExpand: true,
      trackHover: true
    });
    this.add_child(this._btn);
    this._btn.set_size(this.innerWidth, this.innerHeight);
    this._btn.connect(
      "notify::hover",
      () => this.set_hover(this._btn.hover)
    );
  }

  get tile() {
    return this._tile;
  }

  get checked() {
    return this._btn.checked;
  }

  set_checked(newVal) {
    this._btn.set_checked(newVal);
  }

  connect(signal, callback) {
    if (signal === "clicked") {
      const id = this._btn.connect(signal, callback);
      this._btnSignalIds.add(id);
      return id;
    }
    return super.connect(signal, callback);
  }

  disconnect(id) {
    if (this._btnSignalIds.has(id)) {
      this._btnSignalIds.delete(id);
      try { this._btn.disconnect(id); } catch {}
      return;
    }
    try { super.disconnect(id); } catch {}
  }
};
registerGObjectClass(_SnapAssistTileButton);
let SnapAssistTileButton = _SnapAssistTileButton;
export {
  SnapAssistTileButton as default
};
