// Numeric caps that gate hot loops or bound in-memory state. Centralized so
// they're easy to tune from one place rather than hunting through the
// codebase for "200" or "100_000" magic numbers.

// Hard ceiling on iterations inside one runLoop call. Prevents the UI from
// freezing when an infinite loop is hit; surfaces an error message instead.
export const STEP_SAFETY = 100_000;

// Maximum entries kept in the event-log panel and chart trace. Older entries
// drop off the head as new ones are pushed.
export const LOG_CAP = 200;
export const TRACE_CAP = 10_000;

// History stack depth for undo/redo. Past this many edits the oldest gets
// evicted FIFO.
export const MAX_HISTORY = 50;

// Flowchart-stepper guards.
export const MAX_OUTPUT = 200; // entries appended to a single salida block
export const MAX_CALL_DEPTH = 64; // nested rutina/función calls
