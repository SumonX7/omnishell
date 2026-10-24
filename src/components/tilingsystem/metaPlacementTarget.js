import { Clutter, GLib } from "../../gi/ext.js";
import { adaptWindow } from "./placementAdapter.js";
const targets = /* @__PURE__ */ new WeakMap();
const gjsPlacerClock = {
  timeout: (ms, cb) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    cb();
    return GLib.SOURCE_REMOVE;
  }),
  cancel: (handle) => {
    GLib.Source.remove(handle);
  }
};

function toRect(r) {
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function placementTargetFor(window) {
  let target = targets.get(window);
  if (!target) {
    target = adaptWindow(window, Clutter.AnimationMode.EASE_OUT_QUAD);
    targets.set(window, target);
  }
  return target;
}
export {
  gjsPlacerClock,
  placementTargetFor,
  toRect
};
