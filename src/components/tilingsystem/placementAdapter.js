const plainRect = (r) => ({
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height
});

function adaptActor(actor, easeMode) {
  return {
    setTransform(scaleX, scaleY, tx, ty) {
      actor.scale_x = scaleX;
      actor.scale_y = scaleY;
      actor.translation_x = tx;
      actor.translation_y = ty;
    },
    easeToIdentity(durationMs, onStopped) {
      actor.ease({
        scale_x: 1,
        scale_y: 1,
        translation_x: 0,
        translation_y: 0,
        duration: durationMs,
        mode: easeMode,
        onStopped
      });
    },
    cancelTransitions() {
      actor.remove_all_transitions();
    }
  };
}

function adaptWindow(window, easeMode) {
  return {
    isAlive: () => window.get_compositor_private() !== null,
    isMaximized: () => Boolean(
      (window.maximizedHorizontally && window.maximizedVertically) ||
      (window.maximized_horizontally && window.maximized_vertically)
    ),
    isUserMaximized: () => Boolean(window.omnishellUserMaximized),
    getFrameRect: () => plainRect(window.get_frame_rect()),
    getBufferRect: () => plainRect(window.get_buffer_rect()),
    moveToMonitor: (index) => window.move_to_monitor(index),
    moveFrame: (userOp, x, y) => window.move_frame(userOp, x, y),
    moveResizeFrame: (userOp, r) => window.move_resize_frame(userOp, r.x, r.y, r.width, r.height),
    getActor: () => {
      const actor = window.get_compositor_private();
      return actor ? adaptActor(actor, easeMode) : null;
    },
    onGeometryChanged: (cb) => {
      // "size-changed" and "position-changed" are reported separately so
      // that the handler can tell which kind of change happened and skip
      // the work it does not need. A position change fires at pointer rate
      // while a window is being dragged, and every firing used to cost a
      // `get_frame_rect()` round trip to mutter.
      const a = window.connect("size-changed", () => cb("size"));
      const b = window.connect("position-changed", () => cb("position"));
      return () => {
        window.disconnect(a);
        window.disconnect(b);
      };
    },
    onGone: (cb) => {
      const id = window.connect("unmanaging", cb);
      return () => window.disconnect(id);
    }
  };
}
export {
  adaptWindow
};
