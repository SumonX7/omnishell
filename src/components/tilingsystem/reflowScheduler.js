class ReflowScheduler {
  constructor(_queueIdle) {
    this._queueIdle = _queueIdle;
  }

  _running = false;
  _pending = false;

  run(reflow) {
    if (this._running) {
      this._pending = true;
      return "deferred";
    }
    this._running = true;
    try {
      reflow();
    } finally {
      this._running = false;
      if (this._pending) {
        this._pending = false;
        this._queueIdle();
      }
    }
    return "ran";
  }
}

export {
  ReflowScheduler
};
