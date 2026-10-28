const rectEquals = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const sizeEquals = (a, b) => a.width === b.width && a.height === b.height;
const copyRect = (r) => ({
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height
});

class WindowPlacer {
  constructor(_clock, opts = {}) {
    this._clock = _clock;
    this._opts = {
      monitorIndex: 0,
      settleTimeoutMs: 300,
      quietMs: 40,
      animationMs: 0,
      retryDelaysMs: [200, 400, 600],
      // How long a settled window is watched for a client that changes its
      // mind about its size. Every watched window costs two signal
      // connections and a timer, and after a reflow that is one set per
      // window on screen. Three seconds catches the clients that resize
      // themselves right after being placed without keeping the whole
      // desktop under observation.
      driftWatchMs: 3e3,
      // How many times a drifting client may be re-requested before the
      // placer gives up on it. Without this bound a client that keeps
      // changing its geometry re-arms the drift watch forever and the
      // placer stays permanently busy with it.
      maxDriftRetries: 3,
      ...opts
    };
  }

  _opts;
  _history = /* @__PURE__ */ new WeakMap();
  _inFlight = /* @__PURE__ */ new Set();
  place(target, dest, options = {}) {
    if (!target.isAlive()) return "skipped-dead";
    const hist = this._historyOf(target);
    const frame = target.getFrameRect();
    if (hist.pending && rectEquals(hist.pending.dest, dest))
      return "coalesced";
    if (hist.lastRequested === void 0 || !rectEquals(hist.lastRequested, dest)) {
      this._cancelVerification(hist);
      hist.retries = 0;
      // A new destination is a new placement: the drift budget is reset.
      hist.driftRetries = 0;
    }
    if (rectEquals(frame, dest) && !hist.pending) {
      hist.lastRequested = copyRect(dest);
      hist.settledFrame = copyRect(frame);
      return "skipped-identical";
    }
    const sameAsLast = hist.lastRequested !== void 0 && rectEquals(hist.lastRequested, dest) && hist.settledFrame !== void 0;
    if (sameAsLast && rectEquals(frame, hist.settledFrame)) {
      return "skipped-settled";
    }
    const userOp = options.userOp ?? false;
    if (sameAsLast && sizeEquals(frame, hist.settledFrame) && (frame.x !== dest.x || frame.y !== dest.y)) {
      const request = {
        x: dest.x,
        y: dest.y,
        width: frame.width,
        height: frame.height
      };
      this._request(target, hist, dest, request, frame, options, userOp, false, false, true);
      return "requested-move-only";
    }
    this._request(
      target,
      hist,
      dest,
      dest,
      frame,
      options,
      userOp,
      sameAsLast
    );
    return "requested";
  }

  /** Drop everything known about a window (it is no longer managed). */
  forget(target) {
    const hist = this._history.get(target);
    if (hist) {
      this._cancelPending(hist);
      this._cancelVerification(hist);
    }
    this._history.delete(target);
    this._inFlight.delete(target);
  }

  destroy() {
    for (const target of [...this._inFlight]) this.forget(target);
  }

  _request(target, hist, dest, request, before, options, userOp, nudge = false, fromDrift = false, sizeOnly = false) {
    const earlierBefore = hist.pending?.before;
    if (hist.pending) this._cancelPending(hist);
    this._cancelVerification(hist);
    const animate = options.animate ?? false;
    if (animate) target.getActor()?.cancelTransitions();
    hist.lastOptions = options;
    const pending = {
      dest: copyRect(dest),
      before: copyRect(earlierBefore ?? before),
      animate,
      fromDrift,
      onSettled: options.onSettled,
      // True when the request asked for the size the window already has
      // and only wanted it moved. A size change cannot then settle the
      // placement, so the position-only fast path may skip reading the
      // frame rect back.
      sizeOnly,
      // A drift watch only makes sense when this placement asked the
      // client to change its size. A move-only placement did not, and
      // watching it would cost a timer and two signal handlers per
      // window for three seconds without a request to defend.
      watchDrift: nudge || !sizeEquals(before, request),
      disconnectGeometry: () => {
      },
      disconnectGone: () => {
      },
      timeout: null,
      quiet: null
    };
    hist.pending = pending;
    this._inFlight.add(target);
    pending.disconnectGeometry = target.onGeometryChanged((change) => {
      if (hist.pending !== pending) return;
      if (target.isUserMaximized?.()) {
        this.forget(target);
        return;
      }
      // A position-only change is reported at pointer rate while a window
      // is dragged, and reading the frame rect back from mutter is not
      // free. When the request only ever asked for a move — the size was
      // already right — the position is the only thing that can have
      // changed, and a size change cannot settle it.
      if (change === "position" && pending.sizeOnly) {
        if (pending.quiet !== null) this._clock.cancel(pending.quiet);
        pending.quiet = this._clock.timeout(this._opts.quietMs, () => {
          pending.quiet = null;
          if (target.isUserMaximized?.()) {
            this.forget(target);
            return;
          }
          this._settle(target, hist, pending);
        });
        return;
      }
      if (rectEquals(target.getFrameRect(), pending.dest)) {
        this._settle(target, hist, pending);
        return;
      }
      if (pending.quiet !== null) this._clock.cancel(pending.quiet);
      pending.quiet = this._clock.timeout(this._opts.quietMs, () => {
        pending.quiet = null;
        if (target.isUserMaximized?.()) {
          this.forget(target);
          return;
        }
        this._settle(target, hist, pending);
      });
    });
    pending.disconnectGone = target.onGone(() => {
      if (hist.pending === pending) this.forget(target);
    });
    pending.timeout = this._clock.timeout(
      this._opts.settleTimeoutMs,
      () => {
        pending.timeout = null;
        if (hist.pending === pending)
          this._settle(target, hist, pending);
      }
    );
    target.moveToMonitor(this._opts.monitorIndex);
    if (options.forceMove) target.moveFrame(userOp, request.x, request.y);
    if (nudge)
      target.moveResizeFrame(userOp, {
        ...request,
        width: request.width + 1
      });
    target.moveResizeFrame(userOp, request);
  }

  _settle(target, hist, pending) {
    this._cancelPending(hist);
    this._inFlight.delete(target);
    if (!target.isAlive()) return;
    const frame = target.getFrameRect();
    hist.lastRequested = copyRect(pending.dest);
    hist.settledFrame = copyRect(frame);
    if (pending.animate && this._opts.animationMs > 0 && !rectEquals(pending.before, frame)) {
      const actor = target.getActor();
      if (actor) {
        const before = pending.before;
        const scaleX = before.width / frame.width;
        const scaleY = before.height / frame.height;
        const buffer = target.getBufferRect();
        const left = frame.x - buffer.x;
        const top = frame.y - buffer.y;
        actor.setTransform(
          scaleX,
          scaleY,
          before.x - frame.x + left * (1 - scaleX),
          before.y - frame.y + top * (1 - scaleY)
        );
        actor.easeToIdentity(this._opts.animationMs, () => {
          actor.setTransform(1, 1, 0, 0);
        });
      }
    }
    const final = sizeEquals(frame, pending.dest) || !pending.fromDrift && hist.retries >= this._opts.retryDelaysMs.length;
    pending.onSettled?.(copyRect(pending.dest), copyRect(frame), final);
    this._verify(target, hist, pending.dest, frame, pending.watchDrift);
  }

  /**
   * The client has answered. If it did not give the size that was asked
   * for, ask again a little later (bounded); once it has, keep an eye on it
   * for a while in case it changes its mind on its own.
   */
  _verify(target, hist, dest, frame, watchDrift = true) {
    const delays = this._opts.retryDelaysMs;
    if (!sizeEquals(frame, dest)) {
      if (hist.retries >= delays.length) return;
      const delay = delays[hist.retries++];
      this._inFlight.add(target);
      hist.retryTimeout = this._clock.timeout(delay, () => {
        hist.retryTimeout = null;
        this._inFlight.delete(target);
        if (hist.pending || !target.isAlive()) return;
        this._request(
          target,
          hist,
          dest,
          dest,
          target.getFrameRect(),
          hist.lastOptions ?? {},
          hist.lastOptions?.userOp ?? false,
          true
        );
      });
      return;
    }
    if (!watchDrift) return;
    if (this._opts.driftWatchMs <= 0) return;
    const watch = {
      disconnect: () => {
      },
      timeout: null,
      quiet: null
    };
    hist.watch = watch;
    this._inFlight.add(target);
    const stop = () => {
      if (hist.watch !== watch) return;
      this._cancelVerification(hist);
      this._inFlight.delete(target);
    };
    watch.disconnect = target.onGeometryChanged((change) => {
      if (hist.watch !== watch || hist.pending) return;
      if (target.isUserMaximized?.()) {
        stop();
        return;
      }
      // If user is actively performing a grab operation (resizing or moving with pointer/keyboard),
      // do not revert the window! Disarm drift watching and let the user's manual change stick.
      try {
        const grabOp = global.display?.get_grab_op?.() ?? 0;
        if (grabOp !== 0) {
          stop();
          return;
        }
      } catch {}
      // Only a *size* drift matters here: the check below compares sizes,
      // and a position change cannot alter a window's size. Position
      // changes are reported at pointer rate during a drag, and reading
      // the frame rect back from mutter for each of them is pure waste.
      if (change === "position") return;
      if (sizeEquals(target.getFrameRect(), frame)) return;
      if (watch.quiet !== null) this._clock.cancel(watch.quiet);
      watch.quiet = this._clock.timeout(this._opts.quietMs, () => {

        watch.quiet = null;
        stop();
        if (!target.isAlive() || target.isUserMaximized?.()) return;
        // The drift-triggered re-request used to *reset* the retry counter
        // to `delays.length` instead of consuming one retry. Because the
        // counter was then read as "no retries left" by the `final` check,
        // every drift re-armed the 10 second drift watch, and a client
        // that oscillated kept the placer permanently busy with it.
        //
        // The retry budget is now a separate counter that is only ever
        // incremented, so the total number of attempts is bounded.
        hist.driftRetries = (hist.driftRetries ?? 0) + 1;
        if (hist.driftRetries > this._opts.maxDriftRetries) {
          // Give up: the client is not going to hold still.
          return;
        }
        this._request(
          target,
          hist,
          dest,
          dest,
          target.getFrameRect(),
          hist.lastOptions ?? {},
          hist.lastOptions?.userOp ?? false,
          true,
          true
        );
      });
    });
    watch.timeout = this._clock.timeout(this._opts.driftWatchMs, () => {
      watch.timeout = null;
      stop();
    });
  }

  _cancelVerification(hist) {
    if (hist.retryTimeout !== null && hist.retryTimeout !== void 0) {
      this._clock.cancel(hist.retryTimeout);
      hist.retryTimeout = null;
    }
    const w = hist.watch;
    if (w) {
      hist.watch = void 0;
      w.disconnect();
      if (w.timeout !== null) this._clock.cancel(w.timeout);
      if (w.quiet !== null) this._clock.cancel(w.quiet);
    }
  }

  _cancelPending(hist) {
    const p = hist.pending;
    if (!p) return;
    hist.pending = void 0;
    p.disconnectGeometry();
    p.disconnectGone();
    if (p.timeout !== null) this._clock.cancel(p.timeout);
    if (p.quiet !== null) this._clock.cancel(p.quiet);
  }

  _historyOf(target) {
    let hist = this._history.get(target);
    if (!hist) {
      hist = { retries: 0, retryTimeout: null };
      this._history.set(target, hist);
    }
    return hist;
  }
}

export {
  WindowPlacer
};
