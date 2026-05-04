import { describe, it, expect } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { generateEquations, normalizeName } from '../src/dynamic/equationGenerator';

describe('equation generator', () => {
  it('normalizeName replaces non-identifier chars with underscore', () => {
    expect(normalizeName('Cash Flow')).toBe('Cash_Flow');
    expect(normalizeName('a-b/c')).toBe('a_b_c');
    expect(normalizeName('valid_name1')).toBe('valid_name1');
  });

  it('Cash + income converter (acceptance #2)', () => {
    const cloud: Node = {
      id: 'cl1',
      type: 'cloud',
      position: { x: 0, y: 0 },
      data: { name: '' },
    };
    const cash: Node = {
      id: 's1',
      type: 'stock',
      position: { x: 100, y: 0 },
      data: { name: 'Cash', initialExpression: '0', nonNegative: true },
    };
    const income: Node = {
      id: 'c1',
      type: 'stellaConverter',
      position: { x: 200, y: 0 },
      data: { name: 'monthly_income', expression: '100' },
    };
    const flow: Edge = {
      id: 'f1',
      source: cloud.id,
      target: cash.id,
      type: 'flow',
      data: { name: 'income', expression: 'monthly_income' },
    };
    const conn: Edge = {
      id: 'k1',
      source: income.id,
      target: flow.id,
      type: 'connector',
    };
    const lines = generateEquations([cloud, cash, income], [flow, conn]);
    const text = lines.map((l) => l.text).join('\n');
    // Acceptance #2 expects something like:
    //   Cash(t) = Cash(t - dt) + (income) * dt
    //   INIT Cash = 0
    //   INFLOWS:
    //     income = monthly_income
    //   monthly_income = 100
    expect(text).toContain('Cash(t) = Cash(t - dt) + (income) * dt');
    expect(text).toContain('INIT Cash = 0');
    expect(text).toContain('INFLOWS:');
    expect(text).toContain('income = monthly_income');
    expect(text).toContain('monthly_income = 100');
  });

  it('empty model yields empty output (acceptance #1)', () => {
    const lines = generateEquations([], []);
    expect(lines).toEqual([]);
  });
});
