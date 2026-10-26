// Test harness for OmniShell's pin handling.
//
// A pin records the size a window's client refused to shrink below, so
// that its slot can be grown to fit. Learning that size is what makes the
// layout settle; but a client that answers every request with a different
// size would make the system pin, reflow, see a new answer and pin again,
// forever. The idle queue would then never drain and the tiling would
// appear to have stopped working.
//
// This harness exercises the pin rules directly: the tolerance, the budget
// and the unpin path.

const TOLERANCE = 2;
const MAX_REVISIONS = 3;

/**
 * A model of `TilingManager._onPlacementSettled`, with the same rules.
 */
class PinModel {
  constructor() {
    this.pins = new Map();
    this.budgets = new Map();
    this.reflows = 0;
  }

  settle(window, requested, actual, final = true) {
    if (!final) return;
    const pin = { ...(this.pins.get(window) ?? {}) };
    const tolerance = TOLERANCE;
    let revised = false;
    const update = (axis) => {
      const current = pin[axis];
      if (actual[axis] > requested[axis]) {
        if (actual[axis] - requested[axis] <= tolerance) return;
        if (current !== void 0 && actual[axis] - current <= tolerance) return;
        pin[axis] = actual[axis];
        revised = true;
        return;
      }
      if (current === void 0) return;
      if (requested[axis] >= current) return;
      if (current - requested[axis] <= tolerance) return;
      delete pin[axis];
      revised = true;
    };
    update("width");
    update("height");

    if (!revised) {
      if (actual.width === requested.width && actual.height === requested.height)
        this.budgets.delete(window);
      return;
    }

    const before = this.pins.get(window);
    const changed = (before?.width ?? null) !== (pin.width ?? null) ||
      (before?.height ?? null) !== (pin.height ?? null);
    if (!changed) return;

    const removed = pin.width === void 0 && pin.height === void 0;
    if (!removed) {
      const budget = (this.budgets.get(window) ?? 0) + 1;
      this.budgets.set(window, budget);
      if (budget > MAX_REVISIONS) return;
    } else {
      // A pin that has just been removed was wrong, and the client has
      // proved it: the budget is restored, so that a later refusal is
      // believed again.
      this.budgets.delete(window);
    }

    if (removed) this.pins.delete(window);
    else this.pins.set(window, pin);
    this.reflows++;
  }
}

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok  : ${name}`);
  } else {
    failures++;
    console.log(`  FAIL: ${name} ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// 1. A refusal that is larger than the tolerance is learned.
// ---------------------------------------------------------------------------
{
  const m = new PinModel();
  m.settle("w", { width: 800, height: 600 }, { width: 900, height: 600 });
  check("a refusal larger than the tolerance becomes a pin",
    m.pins.get("w")?.width === 900, `pin=${JSON.stringify(m.pins.get("w"))}`);
  check("the pin triggers exactly one reflow", m.reflows === 1, `reflows=${m.reflows}`);
}

// ---------------------------------------------------------------------------
// 2. A refusal within the tolerance is rounding noise and is ignored.
// ---------------------------------------------------------------------------
{
  const m = new PinModel();
  m.settle("w", { width: 800, height: 600 }, { width: 801, height: 600 });
  check("a refusal within the tolerance is ignored",
    !m.pins.has("w"), `pin=${JSON.stringify(m.pins.get("w"))}`);
  check("an ignored refusal does not reflow", m.reflows === 0, `reflows=${m.reflows}`);
}

// ---------------------------------------------------------------------------
// 3. A client that answers differently every time is not believed.
////
// This is the livelock. Without the budget the system would pin, reflow,
// see a new answer and pin again, without end.
// ---------------------------------------------------------------------------
{
  const m = new PinModel();
  let size = 900;
  for (let i = 0; i < 50; i++) {
    m.settle("w", { width: 800, height: 600 }, { width: size, height: 600 });
    size += 10;
  }
  check("a client that keeps changing its size stops being corrected",
    m.reflows <= MAX_REVISIONS, `reflows=${m.reflows}`);
  check("the livelock is bounded well below the number of answers",
    m.reflows < 50, `reflows=${m.reflows}`);
}

// ---------------------------------------------------------------------------
// 4. The same size answered twice is not a new pin.
// ---------------------------------------------------------------------------
{
  const m = new PinModel();
  m.settle("w", { width: 800, height: 600 }, { width: 900, height: 600 });
  const after = m.reflows;
  m.settle("w", { width: 800, height: 600 }, { width: 900, height: 600 });
  check("the same size answered twice does not reflow again",
    m.reflows === after, `reflows=${m.reflows}`);
}

// ---------------------------------------------------------------------------
// 5. A client that honours the request restores the budget, so a later
//    refusal is believed again.
// ---------------------------------------------------------------------------
{
  const m = new PinModel();
  for (let i = 0; i < MAX_REVISIONS; i++)
    m.settle("w", { width: 800, height: 600 }, { width: 900 + i * 10, height: 600 });
  const frozen = m.reflows;
  check("the budget runs out", frozen <= MAX_REVISIONS, `reflows=${frozen}`);
  // The client now behaves.
  m.settle("w", { width: 800, height: 600 }, { width: 800, height: 600 });
  check("a client that behaves restores the budget",
    !m.budgets.has("w"), `budget=${m.budgets.get("w")}`);
}

// ---------------------------------------------------------------------------
// 6. A pin is removed when the client accepts a size below it.
// ---------------------------------------------------------------------------
{
  const m = new PinModel();
  m.settle("w", { width: 800, height: 600 }, { width: 900, height: 600 });
  check("the pin is set", m.pins.get("w")?.width === 900);
  // The client is asked for a size below its pin and accepts it.
  m.settle("w", { width: 700, height: 600 }, { width: 700, height: 600 });
  check("a pin is removed when the client accepts a smaller size",
    !m.pins.has("w"), `pin=${JSON.stringify(m.pins.get("w"))}`);
}

// ---------------------------------------------------------------------------
// 7. A client that ends up below its own pin has proved the pin wrong, so
//    the pin goes. A client that shrinks itself without a pin involved
//    does not gain one.
// ---------------------------------------------------------------------------
{
  const m = new PinModel();
  m.settle("w", { width: 800, height: 600 }, { width: 900, height: 600 });
  const before = m.reflows;
  // The client ends up smaller than asked, and smaller than its pin.
  m.settle("w", { width: 800, height: 600 }, { width: 700, height: 600 });
  check("a client that ends up below its pin proves the pin wrong",
    !m.pins.has("w"), `pin=${JSON.stringify(m.pins.get("w"))}`);
  check("removing a wrong pin reflows once", m.reflows === before + 1,
    `reflows=${m.reflows}`);

  // A client that shrinks itself and was never pinned gains no pin.
  const m2 = new PinModel();
  m2.settle("w", { width: 800, height: 600 }, { width: 700, height: 600 });
  check("a client that shrinks itself gains no pin",
    !m2.pins.has("w") && m2.reflows === 0,
    `pin=${JSON.stringify(m2.pins.get("w"))} reflows=${m2.reflows}`);
}

console.log("");
if (failures === 0) {
  console.log("=== SUMMARY ===");
  console.log("NO FAILURES");
} else {
  console.log("=== SUMMARY ===");
  console.log(`${failures} FAILURES`);
  process.exitCode = 1;
}
