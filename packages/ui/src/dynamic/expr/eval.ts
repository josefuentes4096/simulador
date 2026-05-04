// Evaluator for parsed expressions.
//
// The evaluator takes a Scope (variable name → number) and a EvalContext
// (time, dt, prng) and returns a number. Booleans are encoded as 0/1 to
// match Stella conventions. Equality / comparison return 1 / 0.

import type { Expr } from './ast';
import { BUILTINS, SPECIAL_VARS, type EvalContext } from './builtins';
import { parse } from './parse';

export interface Scope {
  // Variable lookup. Names are case-sensitive so "Cash" and "cash" are
  // different (matches Stella). Returns NaN if undefined — the evaluator
  // surfaces NaN to the caller without aborting.
  get(name: string): number | undefined;
}

export class EvalError extends Error {}

function asBool(n: number): boolean {
  return n !== 0 && !Number.isNaN(n);
}
function fromBool(b: boolean): number {
  return b ? 1 : 0;
}

export function evalExpr(expr: Expr, scope: Scope, ctx: EvalContext): number {
  switch (expr.kind) {
    case 'number':
      return expr.value;
    case 'ref': {
      // Special vars (TIME, DT, etc.) resolve via context first.
      const upper = expr.name.toUpperCase();
      if (SPECIAL_VARS.has(upper)) {
        const fn = BUILTINS[upper];
        return fn ? fn([], ctx) : NaN;
      }
      const v = scope.get(expr.name);
      if (v === undefined) {
        throw new EvalError(`Reference to undefined variable: ${expr.name}`);
      }
      return v;
    }
    case 'unary': {
      const v = evalExpr(expr.operand, scope, ctx);
      if (expr.op === '+') return +v;
      if (expr.op === '-') return -v;
      // NOT
      return fromBool(!asBool(v));
    }
    case 'binary': {
      const l = evalExpr(expr.left, scope, ctx);
      const r = evalExpr(expr.right, scope, ctx);
      switch (expr.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return l / r;
        case '^':
          return Math.pow(l, r);
        case 'MOD':
          return l - Math.floor(l / r) * r;
        case 'AND':
          return fromBool(asBool(l) && asBool(r));
        case 'OR':
          return fromBool(asBool(l) || asBool(r));
        case '=':
          return fromBool(l === r);
        case '<>':
          return fromBool(l !== r);
        case '<':
          return fromBool(l < r);
        case '<=':
          return fromBool(l <= r);
        case '>':
          return fromBool(l > r);
        case '>=':
          return fromBool(l >= r);
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'if':
      return asBool(evalExpr(expr.cond, scope, ctx))
        ? evalExpr(expr.then, scope, ctx)
        : evalExpr(expr.else, scope, ctx);
    case 'call': {
      const upper = expr.name.toUpperCase();
      const fn = BUILTINS[upper];
      if (!fn) {
        throw new EvalError(`Unknown function: ${expr.name}`);
      }
      const args = expr.args.map((a) => evalExpr(a, scope, ctx));
      return fn(args, ctx);
    }
  }
}

// Convenience: parse + eval in one shot. Use sparingly — for repeated
// evaluation (every dt step) parse once and eval many times.
export function evalSource(source: string, scope: Scope, ctx: EvalContext): number {
  const ast = parse(source);
  return evalExpr(ast, scope, ctx);
}

// Sample a graphical function for the input value `x`. Mirrors §4.5 of the
// spec:
//   continuous → linear interpolation between adjacent points; clamps to
//                the first / last point's y outside [xMin, xMax].
//   discrete   → step function: in [x_i, x_{i+1}) returns y_i. The last
//                interval extends to xMax.
export interface GraphicalSpec {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  points: { x: number; y: number }[];
  mode: 'continuous' | 'discrete';
}
export function sampleGraphical(spec: GraphicalSpec, x: number): number {
  if (spec.points.length === 0) return spec.yMin;
  // Clamp to the first/last point.
  if (x <= spec.points[0]!.x) return spec.points[0]!.y;
  if (x >= spec.points[spec.points.length - 1]!.x) {
    return spec.points[spec.points.length - 1]!.y;
  }
  // Find the segment [p_i, p_{i+1}] containing x.
  for (let i = 0; i < spec.points.length - 1; i++) {
    const a = spec.points[i]!;
    const b = spec.points[i + 1]!;
    if (x >= a.x && x <= b.x) {
      if (spec.mode === 'discrete') return a.y;
      // Continuous: linear interp.
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return spec.points[spec.points.length - 1]!.y;
}
