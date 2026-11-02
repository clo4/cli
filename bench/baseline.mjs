import { startTiming } from "./_timing.mjs";

// Measurement floor: start the timer and do no CLI work. The reported `self`
// time is the harness overhead (≈0), and the parent's wall-clock `total` for
// this row is effectively raw Node.js process startup — the baseline every
// library pays before doing anything. Scenario args are intentionally ignored.
startTiming();
