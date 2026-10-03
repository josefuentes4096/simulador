import { describe, it, expect } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import {
  eventTableArraysOf,
  eventTablesOf,
  initialRuntime,
  step,
  type RuntimeState,
  type StepInput,
} from '../src/sim/flowchartStepper';

// Regression tests for the Iterador (loop) block. The exit edge is picked by
// its 'no' handle: when the loop-back edge is listed first in `edges[]` (the
// shape every bundled example has) the stepper must still leave the loop.

function node(id: string, type: string, data: Record<string, unknown>): Node {
  return { id, type, position: { x: 0, y: 0 }, data };
}

function edge(source: string, target: string, sourceHandle?: string): Edge {
  const e: Edge = { id: `${source}->${target}:${sourceHandle ?? ''}`, source, target };
  if (sourceHandle !== undefined) e.sourceHandle = sourceHandle;
  return e;
}

// init: I = 0, ACC = 0  →  body: ACC = ACC + I  →  iter (I <= 3)  →  exit
// Visits the body with I = 0, 1, 2, 3, so ACC = 6 and I ends at 4.
const NODES: Node[] = [
  node('init', 'initialConditions', { label: 'I = 0\nACC = 0' }),
  node('body', 'assignment', { label: 'ACC = ACC + I' }),
  node('iter', 'loop', { counter: 'I', init: '1', final: '3' }),
  node('exit', 'salida', { label: 'ACC' }),
];

function run(edges: Edge[], maxSteps = 100): RuntimeState {
  const input: StepInput = {
    nodes: NODES,
    edges,
    eventTables: eventTablesOf([]),
    eventTableArrays: eventTableArraysOf([]),
  };
  let state = initialRuntime([], 'init', 1);
  for (let i = 0; i < maxSteps && !state.halted; i++) {
    state = step(input, state);
  }
  return state;
}

describe('flowchart stepper: loop (Iterador) exit', () => {
  it('leaves the loop when the loop-back edge is listed before the exit edge', () => {
    const state = run([
      edge('init', 'body'),
      edge('body', 'iter'),
      edge('iter', 'body', 'yes-left'),
      edge('iter', 'exit', 'no'),
    ]);
    expect(state.halted).toBe(true);
    expect(state.haltCategory).toBe('normal');
    expect(state.vars.I).toBe(4);
    expect(state.vars.ACC).toBe(6);
    expect(state.output).toHaveLength(1);
    expect(state.output[0]?.nodeId).toBe('exit');
  });

  it('leaves the loop when the exit edge is listed first', () => {
    const state = run([
      edge('init', 'body'),
      edge('body', 'iter'),
      edge('iter', 'exit', 'no'),
      edge('iter', 'body', 'yes-left'),
    ]);
    expect(state.halted).toBe(true);
    expect(state.haltCategory).toBe('normal');
    expect(state.vars.ACC).toBe(6);
  });

  it('accepts the right-hand continue handle', () => {
    const state = run([
      edge('init', 'body'),
      edge('body', 'iter'),
      edge('iter', 'body', 'yes'),
      edge('iter', 'exit', 'no'),
    ]);
    expect(state.halted).toBe(true);
    expect(state.haltCategory).toBe('normal');
    expect(state.vars.ACC).toBe(6);
  });

  it('halts with no successor when the Iterador has no exit edge', () => {
    const state = run([
      edge('init', 'body'),
      edge('body', 'iter'),
      edge('iter', 'body', 'yes-left'),
    ]);
    expect(state.halted).toBe(true);
    // The loop finishes its three passes and then has nowhere to go: the
    // stepper halts rather than following the loop-back edge again.
    expect(state.haltCategory).toBe('normal');
    expect(state.vars.I).toBe(4);
    expect(state.vars.ACC).toBe(6);
  });
});
