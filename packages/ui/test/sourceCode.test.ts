import { describe, expect, it } from 'vitest';
import type { SimulationModel } from '@simulador/shared';
import { toCpp, toGo, toJava } from '../src/export/sourceCode';

// Minimal model: one C.I. → one assignment → one decision → one salida.
// Plus a TPLL event-table to exercise the table-rewriting branch.
const model: SimulationModel = {
  schemaVersion: 2,
  metadata: { name: 'test' },
  behavior: {
    variables: [
      { name: 'T', kind: 'state', initialValue: 0 },
      { name: 'TF', kind: 'state', initialValue: 10 },
      { name: 'OUT', kind: 'result', initialValue: 0 },
      { name: 'TPLL', kind: 'event-table' },
    ],
    events: [],
  },
  diagram: {
    nodes: [
      { id: 'ci', type: 'initialConditions', label: 'T = 0\nTPLL = 0\nTF = 10' },
      { id: 'dec', type: 'decision', label: 'T <= TF' },
      { id: 'pop', type: 'assignment', label: 'T = TPLL' },
      { id: 'inc', type: 'assignment', label: 'OUT = OUT + 1\nTPLL = T + 1' },
      { id: 'out', type: 'salida', label: 'OUT' },
    ],
    edges: [
      { id: 'e1', source: 'ci', target: 'dec' },
      { id: 'e2', source: 'dec', target: 'pop', sourceHandle: 'yes' },
      { id: 'e3', source: 'dec', target: 'out', sourceHandle: 'no' },
      { id: 'e4', source: 'pop', target: 'inc' },
      { id: 'e5', source: 'inc', target: 'dec' },
    ],
  },
};

describe('source code emitters', () => {
  it('C++ output contains the expected scaffolding and translated logic', () => {
    const cpp = toCpp(model);
    // Header / class skeleton
    expect(cpp).toContain('class Sim');
    expect(cpp).toContain('class Rng');
    expect(cpp).toContain('class EventTable');
    expect(cpp).toContain('void run()');
    expect(cpp).toContain('int main()');
    // Declared state
    expect(cpp).toContain('double T = 0;');
    expect(cpp).toContain('EventTable TPLL');
    // Translated event-table push (TPLL = 0 → TPLL.push(0))
    expect(cpp).toContain('TPLL.push(0)');
    // Translated event-table pop (T = TPLL → T = TPLL.pop())
    expect(cpp).toContain('TPLL.pop()');
    // Translated decision
    expect(cpp).toMatch(/pc = \(T <= TF\) \?/);
    // Result printing
    expect(cpp).toContain('OUT = ');
  });

  it('Java output is syntactically reasonable', () => {
    const java = toJava(model);
    expect(java).toContain('public class Simulation');
    expect(java).toContain('static class Rng');
    expect(java).toContain('static class EventTable');
    expect(java).toContain('void run()');
    expect(java).toContain('public static void main');
    expect(java).toContain('TPLL.push(0)');
    expect(java).toContain('TPLL.pop()');
    expect(java).toContain('new EventTable()');
  });

  it('Go output is syntactically reasonable', () => {
    const go = toGo(model);
    expect(go).toContain('package main');
    expect(go).toContain('type Sim struct');
    expect(go).toContain('type Rng struct');
    expect(go).toContain('type EventTable struct');
    expect(go).toContain('func (s *Sim) Run()');
    expect(go).toContain('func main()');
    // Go: state references should be qualified with s.
    expect(go).toContain('s.TPLL.push(0)');
    expect(go).toContain('s.T = s.TPLL.pop()');
  });
});
