import { describe, it, expect } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { runDynamic } from '../src/sim/dynamicStepper';

function stock(id: string, name: string, init: string, nonNeg = true): Node {
  return {
    id,
    type: 'stock',
    position: { x: 0, y: 0 },
    data: { name, initialExpression: init, nonNegative: nonNeg },
  };
}
function converter(id: string, name: string, expr: string): Node {
  return {
    id,
    type: 'stellaConverter',
    position: { x: 0, y: 0 },
    data: { name, expression: expr },
  };
}
function cloud(id: string): Node {
  return { id, type: 'cloud', position: { x: 0, y: 0 }, data: {} };
}
function flow(id: string, name: string, fromId: string, toId: string, expr: string): Edge {
  return {
    id,
    type: 'flow',
    source: fromId,
    target: toId,
    data: { name, expression: expr, flowType: 'uniflow' },
  };
}
function connector(id: string, fromId: string, toId: string): Edge {
  return { id, type: 'connector', source: fromId, target: toId, data: {} };
}

describe('dynamic engine', () => {
  it('empty model: no samples but no error', () => {
    const r = runDynamic([], [], { startTime: 0, stopTime: 10, dt: 1 });
    expect(r.errors).toEqual([]);
    // Just the t0 sample.
    expect(r.samples.length).toBeGreaterThanOrEqual(1);
  });

  it('Cash + income converter (acceptance #2)', () => {
    const c1 = cloud('c1');
    const cash = stock('s1', 'Cash', '0');
    const income = converter('m1', 'monthly_income', '100');
    const inflow = flow('f1', 'income', c1.id, cash.id, 'monthly_income');
    const conn = connector('k1', income.id, inflow.id);
    const r = runDynamic([c1, cash, income], [inflow, conn], {
      startTime: 0,
      stopTime: 1,
      dt: 0.25,
    });
    expect(r.errors).toEqual([]);
    // Stock grows by 100 per unit time → 100 in t=1.
    const last = r.samples[r.samples.length - 1]!;
    expect(last.vars['Cash']).toBeCloseTo(100, 5);
    expect(last.vars['monthly_income']).toBe(100);
  });

  it('exponential decay (Stock=10, outflow rate=0.5*Stock)', () => {
    const c1 = cloud('c1');
    const t = stock('s1', 'Temperature', '10');
    // Outflow expression references Stock — the connector must exist.
    const out = flow('f1', 'cooling', t.id, c1.id, 'Temperature * 0.5');
    const conn = connector('k1', t.id, out.id);
    const r = runDynamic([c1, t], [out, conn], { startTime: 0, stopTime: 4, dt: 0.5 });
    expect(r.errors).toEqual([]);
    // Numerical Euler: T_{n+1} = T_n - 0.5*T_n*dt = T_n*(1 - 0.25)
    // Final ratio after 8 steps: 0.75^8 ≈ 0.1001 → ~1.001
    const last = r.samples[r.samples.length - 1]!;
    expect(last.vars['Temperature']).toBeCloseTo(10 * Math.pow(0.75, 8), 4);
  });

  it('non-negative clamping prevents stock going below 0 (acceptance #7)', () => {
    const c1 = cloud('c1');
    const s = stock('s1', 'X', '10', true);
    // Constant outflow rate 100 — would drain 100 per dt=1, much more
    // than the 10 in stock.
    const out = flow('f1', 'drain', s.id, c1.id, '100');
    const r = runDynamic([c1, s], [out], { startTime: 0, stopTime: 2, dt: 1 });
    expect(r.errors).toEqual([]);
    const after1 = r.samples[1]!;
    expect(after1.vars['X']).toBe(0); // not -90 — stock clamped during step
    // The flow rate at sample time t=1 is the expression value at t=1 (100),
    // not the realized rate from t=0 → t=1. The realized rate is an internal
    // accounting detail for the stock update; samples show current rates.
    expect(after1.vars['drain']).toBe(100);
  });

  it('algebraic cycle is rejected', () => {
    const a = converter('a', 'a', 'b');
    const b = converter('b', 'b', 'a');
    const ka = connector('ka', a.id, b.id);
    const kb = connector('kb', b.id, a.id);
    const r = runDynamic([a, b], [ka, kb], { startTime: 0, stopTime: 1, dt: 0.5 });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/Circular/i);
  });

  it('STEP test input changes value at t=10', () => {
    const c = converter('c', 'StepInput', '5 + STEP(5, 10)');
    const r = runDynamic([c], [], { startTime: 0, stopTime: 20, dt: 1 });
    expect(r.errors).toEqual([]);
    const at5 = r.samples.find((s) => Math.abs(s.time - 5) < 0.01)!;
    const at12 = r.samples.find((s) => Math.abs(s.time - 12) < 0.01)!;
    expect(at5.vars['StepInput']).toBe(5);
    expect(at12.vars['StepInput']).toBe(10);
  });
});
