import { describe, it, expect } from 'vitest';
import { canonicalize, type SimulationModel } from '@simulador/shared';

// Round-trip: a model with a non-empty dynamic section must serialize
// (canonicalize) and deserialize identically. Acceptance #9 of the spec.

const SAMPLE: SimulationModel = {
  schemaVersion: 2,
  metadata: {
    name: 'roundtrip',
    simulationType: 'dynamic',
  },
  behavior: { variables: [], events: [] },
  diagram: { nodes: [], edges: [] },
  dynamic: {
    blocks: [
      {
        id: 's1',
        kind: 'stock',
        name: 'Cash',
        position: { x: 100, y: 100 },
        initialExpression: '0',
        nonNegative: true,
      },
      {
        id: 'c1',
        kind: 'converter',
        name: 'monthly_income',
        position: { x: 250, y: 200 },
        expression: '100',
      },
      {
        id: 'cl1',
        kind: 'cloud',
        name: '',
        position: { x: 50, y: 100 },
      },
    ],
    flows: [
      {
        id: 'f1',
        name: 'income',
        fromId: 'cl1',
        toId: 's1',
        expression: 'monthly_income',
        flowType: 'uniflow',
      },
    ],
    connectors: [
      {
        id: 'k1',
        fromId: 'c1',
        toId: 'f1',
      },
    ],
    runSpecs: {
      startTime: 0,
      stopTime: 12,
      dt: 0.25,
      timeUnit: 'Months',
      integrationMethod: 'Euler',
    },
  },
};

describe('dynamic round-trip', () => {
  it('canonicalize is idempotent', () => {
    const a = canonicalize(SAMPLE);
    const b = canonicalize(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('canonicalize preserves all dynamic content', () => {
    const a = canonicalize(SAMPLE);
    expect(a.dynamic).toBeDefined();
    expect(a.dynamic!.blocks).toHaveLength(3);
    expect(a.dynamic!.flows).toHaveLength(1);
    expect(a.dynamic!.connectors).toHaveLength(1);
    // Stock fields preserved.
    const stock = a.dynamic!.blocks.find((b) => b.id === 's1')!;
    expect(stock.kind).toBe('stock');
    expect(stock.initialExpression).toBe('0');
    expect(stock.nonNegative).toBe(true);
    // Flow fields preserved.
    const flow = a.dynamic!.flows[0]!;
    expect(flow.expression).toBe('monthly_income');
    expect(flow.fromId).toBe('cl1');
    expect(flow.toId).toBe('s1');
  });

  it('canonicalize drops dynamic when empty', () => {
    const empty: SimulationModel = {
      schemaVersion: 2,
      metadata: { name: 'empty' },
      behavior: { variables: [], events: [] },
      diagram: { nodes: [], edges: [] },
      dynamic: {
        blocks: [],
        flows: [],
        connectors: [],
        runSpecs: {
          startTime: 0,
          stopTime: 12,
          dt: 0.25,
          timeUnit: 'Months',
          integrationMethod: 'Euler',
        },
      },
    };
    const out = canonicalize(empty);
    expect(out.dynamic).toBeUndefined();
  });

  it('serialized JSON parses back identically', () => {
    const a = canonicalize(SAMPLE);
    const json = JSON.stringify(a);
    const parsed = JSON.parse(json) as SimulationModel;
    const b = canonicalize(parsed);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
