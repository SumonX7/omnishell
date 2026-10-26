/*!
 * OmniShell: Desktop & Tiling Fusion
 *
 * Meta.GrabOp classification helpers.
 *
 * `Meta.GrabOp` is a bit field. On mutter 18 the values are:
 *
 *   NONE                    = 0
 *   WINDOW_BASE             = 1
 *   KEYBOARD_MOVING         = 257    (WINDOW_BASE | 0x100)
 *   KEYBOARD_RESIZING_*     = 769, 4353, 8449, ...   (WINDOW_BASE | 0x100 | 0x800 | edge)
 *   MOVING_UNCONSTRAINED    = 1025   (WINDOW_BASE | 0x400)
 *   RESIZING_W              = 4097   (WINDOW_BASE | 0x1000 | edge)
 *   RESIZING_E              = 8193
 *   RESIZING_S              = 16385
 *   ...
 *
 * The single-bit tests that are tempting to write are wrong:
 *
 *   (grabOp & ~1024) === 1
 *
 * matches WINDOW_BASE and MOVING_UNCONSTRAINED but *misses* KEYBOARD_MOVING,
 * because 257 & ~1024 is still 257. A window dragged with the keyboard then
 * never enters the tiling machinery and never snaps into a tile.
 *
 * Likewise `grabOp & ~1024` does NOT normalise the resize ops: RESIZING_E is
 * 8193 and 8193 & ~1024 is 8193, so the value survives, but the keyboard
 * resize ops keep their 0x100 bit and must be matched explicitly.
 */

const GRAB_OP_WINDOW_BASE = 1;
const GRAB_OP_KEYBOARD = 0x100;
const GRAB_OP_MOVING_UNCONSTRAINED = 0x400;

/**
 * True when the grab operation is a window *move* rather than a resize.
 *
 * Covers WINDOW_BASE (plain pointer drag), MOVING_UNCONSTRAINED (alt-drag)
 * and KEYBOARD_MOVING (move-window shortcut).
 */
function isMovingGrabOp(grabOp) {
  if (typeof grabOp !== "number") return false;
  // Strip the "unconstrained" and "keyboard" modifier bits, then look for the
  // WINDOW_BASE bit that every move operation carries.
  const base = grabOp & ~(GRAB_OP_MOVING_UNCONSTRAINED | GRAB_OP_KEYBOARD);
  return base === GRAB_OP_WINDOW_BASE;
}

export {
  isMovingGrabOp
};
