// Catalog of builtin functions and special variables understood by the
// evaluator. Names are matched case-insensitively (PULSE / Pulse / pulse).
//
// Each builtin is either:
//   - a "function" with arity range and an evaluator closure, or
//   - a "special" 0-arg name resolved against the EvalContext (TIME, DT, ...)
//
// We keep this table flat so the evaluator can look up by uppercase name in
// O(1). The set is intentionally larger than what v1 needs (per spec §6.2)
// so the parser can recognize all of them as builtins (and not flag them as
// undefined identifiers) even if some are not yet implemented.

export interface EvalContext {
  // Current simulation time (read-only inside expressions; advanced by the
  // engine between steps).
  time: number;
  startTime: number;
  stopTime: number;
  dt: number;
  // PRNG returning [0, 1). Provided so tests can inject a deterministic
  // sequence; production uses mulberry32 seeded from the run.
  rand: () => number;
}

export type BuiltinFn = (
  args: number[],
  ctx: EvalContext,
) => number;

// Mathematical / general
function bMax(args: number[]) {
  if (args.length === 0) return 0;
  return Math.max(...args);
}
function bMin(args: number[]) {
  if (args.length === 0) return 0;
  return Math.min(...args);
}
function bSum(args: number[]) {
  return args.reduce((a, b) => a + b, 0);
}
function bMean(args: number[]) {
  if (args.length === 0) return 0;
  return bSum(args) / args.length;
}

export const BUILTINS: Record<string, BuiltinFn> = {
  // Math
  ABS: (a) => Math.abs(a[0] ?? 0),
  EXP: (a) => Math.exp(a[0] ?? 0),
  INT: (a) => Math.trunc(a[0] ?? 0),
  LOG10: (a) => Math.log10(a[0] ?? 0),
  LOGN: (a) => Math.log(a[0] ?? 0),
  MAX: bMax,
  MEAN: bMean,
  MIN: bMin,
  MOD: (a) => {
    const x = a[0] ?? 0;
    const y = a[1] ?? 1;
    return x - Math.floor(x / y) * y;
  },
  PCT: (a) => (a[0] ?? 0) / 100,
  PI: () => Math.PI,
  ROUND: (a) => Math.round(a[0] ?? 0),
  SQRT: (a) => Math.sqrt(a[0] ?? 0),
  SUM: bSum,
  // Trig
  SIN: (a) => Math.sin(a[0] ?? 0),
  COS: (a) => Math.cos(a[0] ?? 0),
  TAN: (a) => Math.tan(a[0] ?? 0),
  ARCTAN: (a) => Math.atan(a[0] ?? 0),
  // Test inputs
  PULSE: (a, ctx) => {
    // PULSE(volume, firstPulse?, interval?). When firing, returns volume/dt
    // for one DT step so the integral equals volume.
    const volume = a[0] ?? 0;
    const first = a[1] ?? ctx.startTime;
    const interval = a[2] ?? ctx.dt;
    const t = ctx.time;
    if (t < first - 1e-12) return 0;
    if (interval <= 0) {
      // single shot at `first`
      return Math.abs(t - first) < ctx.dt / 2 ? volume / ctx.dt : 0;
    }
    const k = Math.round((t - first) / interval);
    const fireTime = first + k * interval;
    return Math.abs(t - fireTime) < ctx.dt / 2 ? volume / ctx.dt : 0;
  },
  STEP: (a, ctx) => {
    const h = a[0] ?? 0;
    const t = a[1] ?? 0;
    return ctx.time >= t ? h : 0;
  },
  RAMP: (a, ctx) => {
    const slope = a[0] ?? 0;
    const t0 = a[1] ?? ctx.startTime;
    return ctx.time < t0 ? 0 : slope * (ctx.time - t0);
  },
  // Random / statistical
  RANDOM: (a, ctx) => {
    const min = a[0] ?? 0;
    const max = a[1] ?? 1;
    return min + ctx.rand() * (max - min);
  },
  NORMAL: (a, ctx) => {
    // Box-Muller; the optional seed argument (a[2]) is ignored — the engine
    // already controls the rand stream globally.
    const mean = a[0] ?? 0;
    const stddev = a[1] ?? 1;
    const u1 = Math.max(ctx.rand(), 1e-12);
    const u2 = ctx.rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stddev * z;
  },
  POISSON: (a, ctx) => {
    // Knuth's algorithm. Accurate enough for Stella's typical use cases.
    const mean = Math.max(a[0] ?? 0, 0);
    const L = Math.exp(-mean);
    let k = 0;
    let p = 1;
    while (p > L) {
      k++;
      p *= ctx.rand();
    }
    return k - 1;
  },
  EXPRND: (a, ctx) => {
    const mean = a[0] ?? 1;
    return -mean * Math.log(Math.max(ctx.rand(), 1e-12));
  },
  // Time / specials — implemented as 0-arg functions; the evaluator also
  // accepts them as bare identifiers (TIME, DT, ...).
  TIME: (_a, ctx) => ctx.time,
  DT: (_a, ctx) => ctx.dt,
  STARTTIME: (_a, ctx) => ctx.startTime,
  STOPTIME: (_a, ctx) => ctx.stopTime,
};

// Identifiers that resolve directly without parens (TIME, DT, ...).
export const SPECIAL_VARS = new Set(['TIME', 'DT', 'STARTTIME', 'STOPTIME', 'PI']);

// All identifier names recognized by the language (used by ref-extraction to
// distinguish "user variable" from "builtin").
export const ALL_BUILTIN_NAMES = new Set<string>([
  ...Object.keys(BUILTINS),
  // Aliases / future-reserved names so the parser doesn't flag them as
  // undefined when the user types one (the evaluator may still throw at
  // run time if not implemented).
  'IF',
  'THEN',
  'ELSE',
  'AND',
  'OR',
  'NOT',
  'INIT',
  'DELAY',
  'DELAY1',
  'DELAY3',
  'SMTH1',
  'SMTH3',
  'SWITCH',
]);
