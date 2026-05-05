import { describe, it, expect } from 'vitest';
import { parse } from '../src/dynamic/expr/parse';
import { evalExpr, evalSource, sampleGraphical } from '../src/dynamic/expr/eval';
import { extractReferences } from '../src/dynamic/expr/refs';

const ctx = (overrides: Partial<{ time: number; startTime: number; stopTime: number; dt: number }> = {}) => ({
  time: 0,
  startTime: 0,
  stopTime: 12,
  dt: 0.25,
  rand: () => 0.5,
  ...overrides,
});

describe('expression parser/evaluator', () => {
  it('arithmetic precedence', () => {
    expect(evalSource('1 + 2 * 3', { get: () => undefined }, ctx())).toBe(7);
    expect(evalSource('(1 + 2) * 3', { get: () => undefined }, ctx())).toBe(9);
    expect(evalSource('2 ^ 3 ^ 2', { get: () => undefined }, ctx())).toBe(512); // right-assoc
  });

  it('STEP returns 0 before t and h after', () => {
    // Acceptance #4: 5 + STEP(5, 10) → 5 when TIME < 10, 10 when TIME >= 10.
    const src = '5 + STEP(5, 10)';
    expect(evalSource(src, { get: () => undefined }, ctx({ time: 5 }))).toBe(5);
    expect(evalSource(src, { get: () => undefined }, ctx({ time: 12 }))).toBe(10);
  });

  it('IF/THEN/ELSE', () => {
    expect(
      evalSource('IF 1 < 2 THEN 10 ELSE 20', { get: () => undefined }, ctx()),
    ).toBe(10);
    expect(
      evalSource('IF 1 > 2 THEN 10 ELSE 20', { get: () => undefined }, ctx()),
    ).toBe(20);
  });

  it('variable lookup is case-sensitive', () => {
    const scope = { get: (name: string) => (name === 'Cash' ? 100 : undefined) };
    expect(evalSource('Cash * 2', scope, ctx())).toBe(200);
    expect(() => evalSource('cash * 2', scope, ctx())).toThrow();
  });

  it('TIME and DT resolve from context', () => {
    expect(evalSource('TIME', { get: () => undefined }, ctx({ time: 7 }))).toBe(7);
    expect(evalSource('DT', { get: () => undefined }, ctx({ dt: 0.5 }))).toBe(0.5);
  });

  it('extracts only user references, not builtins', () => {
    const ast = parse('Cash * 2 + STEP(monthly_income, TIME)');
    const refs = extractReferences(ast);
    expect(refs.has('Cash')).toBe(true);
    expect(refs.has('monthly_income')).toBe(true);
    expect(refs.has('STEP')).toBe(false);
    expect(refs.has('TIME')).toBe(false);
  });

  it('logical operators', () => {
    expect(evalSource('1 AND 0', { get: () => undefined }, ctx())).toBe(0);
    expect(evalSource('1 OR 0', { get: () => undefined }, ctx())).toBe(1);
    expect(evalSource('NOT 0', { get: () => undefined }, ctx())).toBe(1);
  });

  it('parses then evaluates a previously-parsed AST', () => {
    const ast = parse('2 * x + 1');
    expect(evalExpr(ast, { get: () => 5 }, ctx())).toBe(11);
    expect(evalExpr(ast, { get: () => 10 }, ctx())).toBe(21);
  });

  it('sampleGraphical: continuous interpolation + clamping', () => {
    const spec = {
      xMin: 0,
      xMax: 10,
      yMin: 0,
      yMax: 10,
      mode: 'continuous' as const,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    expect(sampleGraphical(spec, 5)).toBeCloseTo(5);
    expect(sampleGraphical(spec, 0)).toBe(0);
    expect(sampleGraphical(spec, 10)).toBe(10);
    // Clamp outside.
    expect(sampleGraphical(spec, -5)).toBe(0);
    expect(sampleGraphical(spec, 15)).toBe(10);
  });

  it('sampleGraphical: discrete step (acceptance #8)', () => {
    const spec = {
      xMin: 0,
      xMax: 3,
      yMin: 0,
      yMax: 3,
      mode: 'discrete' as const,
      points: [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 3 },
        { x: 3, y: 99 }, // last value not editable per spec
      ],
    };
    // In [x_i, x_{i+1}) returns y_i.
    expect(sampleGraphical(spec, 0)).toBe(1);
    expect(sampleGraphical(spec, 0.5)).toBe(1);
    expect(sampleGraphical(spec, 1.5)).toBe(2);
    expect(sampleGraphical(spec, 2.5)).toBe(3);
  });
});
