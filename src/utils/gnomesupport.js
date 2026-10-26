import { St, Clutter, Shell, Meta } from "../gi/ext.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

/**
 * Returns the orientation properties for a box layout.
 *
 * `orientation` is the modern API and is supported by every shell version the
 * extension targets (46+). The old `vertical` property is a legacy fallback
 * that St ignores on those versions, so it is only used when `orientation` is
 * genuinely unavailable.
 */
function widgetOrientation(vertical) {
  if (St.BoxLayout.prototype.get_orientation !== void 0) {
    return {
      orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL
    };
  }
  return { vertical };
}

function buildBlurEffect(sigma) {
  const effect = new Shell.BlurEffect();
  effect.set_mode(Shell.BlurMode.BACKGROUND);
  effect.set_brightness(1);
  if (effect.set_radius) {
    // `set_radius` and `set_sigma` do not take the same value: the radius is
    // roughly twice the sigma. Multiplying here keeps the *visual* blur
    // strength identical across the two API generations, instead of making
    // the blur twice as strong on the versions that expose `set_radius`.
    effect.set_radius(sigma * 2);
  } else {
    effect.set_sigma(sigma);
  }
  return effect;
}

function getEventCoords(event) {
  return event.get_coords ? event.get_coords() : [event.x, event.y];
}

function maximizeWindow(window) {
  window.get_maximized ? window.maximize(Meta.MaximizeFlags.BOTH) : window.maximize();
}

function unmaximizeWindow(window) {
  window.get_maximized ? window.unmaximize(Meta.MaximizeFlags.BOTH) : window.unmaximize();
}

/**
 * Skips the animation of the next effect on an actor.
 *
 * `Main.wm.skipNextEffect()` is an undocumented method of `Shell.WM`; it has
 * been renamed and removed across shell versions. Calling it unguarded makes
 * the unmaximize-and-place path throw, which aborts the whole operation.
 * The method is therefore feature-detected, and the failure is non-fatal --
 * the only consequence is that the window animates instead of jumping.
 *
 * @param {object} actor the compositor-private actor of a window
 */
function skipNextEffect(actor) {
  if (!actor) return false;
  try {
    const wm = Main?.wm ?? global.window_manager;
    if (!wm) return false;
    // The method has been spelled several ways over the years.
    if (typeof wm.skipNextEffect === "function") {
      wm.skipNextEffect(actor);
      return true;
    }
    if (typeof wm._skipNextEffect === "function") {
      wm._skipNextEffect(actor);
      return true;
    }
  } catch {}
  return false;
}
export {
  buildBlurEffect,
  getEventCoords,
  maximizeWindow,
  skipNextEffect,
  unmaximizeWindow,
  widgetOrientation
};
