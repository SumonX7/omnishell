import { St, Clutter } from "../gi/ext.js";
import LayoutWidget from "../components/layout/LayoutWidget.js";
import SnapAssistTile from "../components/snapassist/snapAssistTile.js";
import { buildMarginOf, buildRectangle, getScalingFactorOf } from "../utils/ui.js";
import { registerGObjectClass } from "../utils/gjs.js";
const _LayoutButtonWidget = class _LayoutButtonWidget extends LayoutWidget {
  constructor(parent, layout, gapSize, height, width) {
    super({
      parent,
      layout,
      containerRect: buildRectangle({ x: 0, y: 0, width, height }),
      innerGaps: buildMarginOf(gapSize),
      outerGaps: new Clutter.Margin()
    });
    this.relayout();
  }

  buildTile(parent, rect, gaps, tile) {
    return new SnapAssistTile({ parent, rect, gaps, tile });
  }
};
registerGObjectClass(_LayoutButtonWidget);
let LayoutButtonWidget = _LayoutButtonWidget;
const _LayoutButton = class _LayoutButton extends St.Button {
  constructor(parent, layout, gapSize, height, width) {
    super({
      styleClass: "layout-button button",
      xExpand: false,
      yExpand: false
    });
    parent.add_child(this);
    const scalingFactor = getScalingFactorOf(this)[1];
    this.child = new St.Widget();
    new LayoutButtonWidget(
      this.child,
      layout,
      gapSize,
      height * scalingFactor,
      width * scalingFactor
    );
  }

  _canFocusWhenEnabled = null;
  setDisabled(disabled) {
    this.reactive = !disabled;
    if (disabled) {
      if (this._canFocusWhenEnabled === null)
        this._canFocusWhenEnabled = this.can_focus;
      this.can_focus = false;
    } else if (this._canFocusWhenEnabled !== null) {
      this.can_focus = this._canFocusWhenEnabled;
      this._canFocusWhenEnabled = null;
    }
    this.opacity = disabled ? 89 : 255;
  }
};
registerGObjectClass(_LayoutButton);
let LayoutButton = _LayoutButton;
export {
  LayoutButton as default
};
