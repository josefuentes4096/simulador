// Continuous-time simulation engine for the Stella-style dynamic model.
//
// Inputs are React Flow nodes/edges (the same shapes the canvas uses) plus
// the user's RunSpecs. Output is the full trajectory (one sample per dt
// from STARTTIME to STOPTIME inclusive) as a list of {time, vars} samples.
//
// Pipeline per run:
//   1. Convert nodes/edges into internal "block" / "flow" / "connector"
//      structures with parsed expression ASTs.
//   2. Topological sort of converters + flows (Stocks break ciclos via
//      integration; only the algebraic dependency subgraph matters).
//   3. Initialize: evaluate each Stock's INIT, then converters and flows
//      with TIME = STARTTIME.
//   4. Iterate t → t + dt:
//        - Update each Stock from previous flows (Euler default).
//        - Apply non-negative clamping with prioritized outflows.
//        - Recompute converters (in topo order) at the new TIME.
//        - Recompute flows (in topo order) at the new TIME.
//      Record the sample.
//   5. Stop when t > STOPTIME (within DT/2 tolerance).

import type { Edge, Node } from '@xyflow/react';
import type { Expr } from '../dynamic/expr/ast';
import type { EvalContext } from '../dynamic/expr/builtins';
import { evalExpr, sampleGraphical, type GraphicalSpec } from '../dynamic/expr/eval';
import { parse, ParseError } from '../dynamic/expr/parse';
import { extractReferences } from '../dynamic/expr/refs';
import { TokenizeError } from '../dynamic/expr/tokenize';
import { normalizeName } from '../dynamic/equationGenerator';

export interface DynamicSample {
  time: number;
  // Snapshot of every named variable (stock, converter, flow) at this time.
  vars: Record<string, number>;
}

export interface DynamicRunResult {
  samples: DynamicSample[];
  // Surfaced for the UI: the order topo sort produced, useful for the
  // "by order of execution" Equation view sort and for debugging.
  evaluationOrder: string[];
  // Errors collected before the run started (parse failures, ciclos, etc.).
  // When non-empty, samples is empty too.
  errors: string[];
}

interface InternalBlock {
  id: string;
  kind: 'stock' | 'converter' | 'cloud' | 'comment' | 'label';
  name: string; // normalized identifier
  initialAst?: Expr;
  expressionAst?: Expr;
  // When set, the converter is a Graphical Function: at each evaluation we
  // compute the input expression (or TIME if missing) and sample the curve
  // instead of evaluating expressionAst.
  graphical?: GraphicalSpec;
  nonNegative: boolean;
}
interface InternalFlow {
  id: string;
  name: string;
  fromBlockId: string | null;
  toBlockId: string | null;
  expressionAst?: Expr;
}

const RF_TO_KIND: Record<string, InternalBlock['kind']> = {
  stock: 'stock',
  stellaConverter: 'converter',
  cloud: 'cloud',
  stellaComment: 'comment',
  stellaLabel: 'label',
};

function tryParse(source: string, errors: string[], where: string): Expr | undefined {
  if (source.trim() === '') return undefined;
  try {
    return parse(source);
  } catch (err) {
    if (err instanceof ParseError || err instanceof TokenizeError) {
      errors.push(`${where}: ${err.message}`);
    } else {
      errors.push(`${where}: ${(err as Error).message}`);
    }
    return undefined;
  }
}

// Build the algebraic dependency graph for converters + flows. Used both
// for cycle detection (Tarjan) and for topo sort. Stocks are excluded —
// they don't take part in algebraic dependencies (they're the integrator
// state that breaks ciclos).
function buildDependencyGraph(
  blocks: InternalBlock[],
  flows: InternalFlow[],
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  // Index by normalized name for fast lookup.
  const blockByName = new Map<string, InternalBlock>();
  for (const b of blocks) {
    if (b.kind === 'converter') blockByName.set(b.name, b);
  }
  // Also flows by name.
  const flowByName = new Map<string, InternalFlow>();
  for (const f of flows) flowByName.set(f.name, f);

  // Dependency: A depends on B  →  edge B → A.
  function addEdge(from: string, to: string) {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  }

  for (const c of blocks.filter((b) => b.kind === 'converter')) {
    if (!c.expressionAst) continue;
    const refs = extractReferences(c.expressionAst);
    for (const ref of refs) {
      // If the reference is another converter or flow, add a dep edge.
      if (blockByName.has(ref)) addEdge(ref, c.name);
      else if (flowByName.has(ref)) addEdge(ref, c.name);
      // Stock refs are fine — they don't induce algebraic dependency.
    }
  }
  for (const f of flows) {
    if (!f.expressionAst) continue;
    const refs = extractReferences(f.expressionAst);
    for (const ref of refs) {
      if (blockByName.has(ref)) addEdge(ref, f.name);
      else if (flowByName.has(ref)) addEdge(ref, f.name);
    }
  }
  return adj;
}

// Kahn's topological sort. Returns the eval order, or null if a cycle
// remains in the algebraic subgraph (which shouldn't happen if the editor
// validated correctly, but the engine guards regardless).
function topoSort(
  nodes: string[],
  adj: Map<string, string[]>,
): string[] | null {
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n, 0);
  for (const [, succ] of adj) {
    for (const v of succ) indeg.set(v, (indeg.get(v) ?? 0) + 1);
  }
  const q: string[] = [];
  for (const [n, d] of indeg) if (d === 0) q.push(n);
  const out: string[] = [];
  while (q.length > 0) {
    const n = q.shift()!;
    out.push(n);
    for (const v of adj.get(n) ?? []) {
      const d = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, d);
      if (d === 0) q.push(v);
    }
  }
  if (out.length !== nodes.length) return null;
  return out;
}

// Mulberry32: tiny seedable PRNG. Same algorithm the discrete sim uses, so
// runs across modes look "the same kind of random".
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DynamicRunSpecsLike {
  startTime: number;
  stopTime: number;
  dt: number;
  integrationMethod?: 'Euler' | 'RK2' | 'RK4';
}

export function runDynamic(
  rfNodes: Node[],
  rfEdges: Edge[],
  specs: DynamicRunSpecsLike,
  seed = 1,
): DynamicRunResult {
  const errors: string[] = [];
  if (specs.stopTime <= specs.startTime) {
    return {
      samples: [],
      evaluationOrder: [],
      errors: ['Stop time must be greater than start time.'],
    };
  }
  if (specs.dt <= 0) {
    return { samples: [], evaluationOrder: [], errors: ['DT must be positive.'] };
  }

  const blocks: InternalBlock[] = [];
  for (const n of rfNodes) {
    const data = (n.data ?? {}) as Record<string, unknown>;
    const kind = RF_TO_KIND[n.type ?? ''];
    if (!kind) continue;
    const rawName = typeof data['name'] === 'string' ? data['name'] : '';
    const block: InternalBlock = {
      id: n.id,
      kind,
      name: normalizeName(rawName),
      nonNegative: (data['nonNegative'] as boolean | undefined) ?? true,
    };
    if (typeof data['initialExpression'] === 'string') {
      block.initialAst = tryParse(data['initialExpression'], errors, `Init of ${rawName}`);
    }
    if (typeof data['expression'] === 'string') {
      block.expressionAst = tryParse(data['expression'], errors, `Expression of ${rawName}`);
    }
    if (data['graphical'] && typeof data['graphical'] === 'object') {
      const g = data['graphical'] as GraphicalSpec;
      if (Array.isArray(g.points) && g.points.length >= 2) {
        block.graphical = g;
      }
    }
    blocks.push(block);
  }

  const flows: InternalFlow[] = rfEdges
    .filter((e) => e.type === 'flow')
    .map((e) => {
      const data = (e.data ?? {}) as Record<string, unknown>;
      const rawName = typeof data['name'] === 'string' ? data['name'] : '';
      const expr =
        typeof data['expression'] === 'string'
          ? tryParse(data['expression'], errors, `Flow ${rawName}`)
          : undefined;
      return {
        id: e.id,
        name: normalizeName(rawName),
        fromBlockId: data['fromCloud'] === true ? null : e.source,
        toBlockId: data['toCloud'] === true ? null : e.target,
        expressionAst: expr,
      };
    });

  if (errors.length > 0) return { samples: [], evaluationOrder: [], errors };

  // Topo order for algebraic subgraph.
  const algebraicNames = [
    ...blocks.filter((b) => b.kind === 'converter').map((b) => b.name),
    ...flows.map((f) => f.name),
  ];
  const adj = buildDependencyGraph(blocks, flows);
  const order = topoSort(algebraicNames, adj);
  if (!order) {
    return {
      samples: [],
      evaluationOrder: [],
      errors: ['Circular connections are not allowed. Insert a stock somewhere in the loop.'],
    };
  }

  // Set up runtime state.
  const vars: Record<string, number> = {};
  const rand = mulberry32(seed);
  const ctxBase = (time: number): EvalContext => ({
    time,
    startTime: specs.startTime,
    stopTime: specs.stopTime,
    dt: specs.dt,
    rand,
  });
  const scope = {
    get: (name: string) => (name in vars ? vars[name] : undefined),
  };

  // Step 1: initial values for stocks.
  for (const s of blocks.filter((b) => b.kind === 'stock')) {
    const initial = s.initialAst
      ? evalExpr(s.initialAst, scope, ctxBase(specs.startTime))
      : 0;
    vars[s.name] = s.nonNegative ? Math.max(0, initial) : initial;
  }
  // Step 2: converters and flows in topo order at t = STARTTIME.
  const blockByName = new Map<string, InternalBlock>();
  for (const b of blocks) blockByName.set(b.name, b);
  const flowByName = new Map<string, InternalFlow>();
  for (const f of flows) flowByName.set(f.name, f);
  function evalAlgebraic(time: number) {
    for (const name of order!) {
      const c = blockByName.get(name);
      if (c && c.kind === 'converter') {
        if (c.graphical) {
          // Graphical functions: input is the parsed expression (or TIME
          // when there's none) — we sample the curve at that x.
          const x = c.expressionAst ? evalExpr(c.expressionAst, scope, ctxBase(time)) : time;
          vars[name] = sampleGraphical(c.graphical, x);
        } else {
          vars[name] = c.expressionAst ? evalExpr(c.expressionAst, scope, ctxBase(time)) : 0;
        }
        continue;
      }
      const f = flowByName.get(name);
      if (f) {
        const v = f.expressionAst ? evalExpr(f.expressionAst, scope, ctxBase(time)) : 0;
        // Uniflow clamps to ≥ 0.
        vars[name] = Math.max(0, v);
      }
    }
  }
  evalAlgebraic(specs.startTime);

  // Sample at t0.
  const samples: DynamicSample[] = [];
  samples.push({ time: specs.startTime, vars: { ...vars } });

  // Group flows by stock for fast in/out lookup. The "id" form is what we
  // use because clouds have no name and therefore no entry in blockByName.
  const idByName = new Map<string, string>();
  for (const b of blocks) idByName.set(b.name, b.id);
  const inflowsByStockId = new Map<string, InternalFlow[]>();
  const outflowsByStockId = new Map<string, InternalFlow[]>();
  for (const f of flows) {
    if (f.toBlockId) {
      if (!inflowsByStockId.has(f.toBlockId)) inflowsByStockId.set(f.toBlockId, []);
      inflowsByStockId.get(f.toBlockId)!.push(f);
    }
    if (f.fromBlockId) {
      if (!outflowsByStockId.has(f.fromBlockId)) outflowsByStockId.set(f.fromBlockId, []);
      outflowsByStockId.get(f.fromBlockId)!.push(f);
    }
  }

  // Iterate.
  let t = specs.startTime;
  // Guard against runaway loops with a hard cap (in samples).
  const maxSteps = Math.ceil((specs.stopTime - specs.startTime) / specs.dt) + 2;
  let step = 0;
  while (t + specs.dt <= specs.stopTime + specs.dt / 2 && step < maxSteps) {
    // Compute new stocks from previous-step flow values (Euler default).
    // RK2/RK4 follow the same skeleton with intermediate evaluations; we
    // start with Euler and add the others when needed (spec §7.3 says
    // most discrete builtins force Euler anyway).
    const stockIds = blocks.filter((b) => b.kind === 'stock').map((b) => b.id);
    for (const stockId of stockIds) {
      const stock = blocks.find((b) => b.id === stockId);
      if (!stock) continue;
      const ins = inflowsByStockId.get(stockId) ?? [];
      const outs = outflowsByStockId.get(stockId) ?? [];
      const inflowSum = ins.reduce((s, f) => s + (vars[f.name] ?? 0), 0);
      // Non-negative clamping: outflows are realized in priority order so
      // none drives the stock below zero. Priority = creation order, which
      // we approximate by id-string sort here.
      const sortedOuts = [...outs].sort((a, b) => (a.id < b.id ? -1 : 1));
      let remaining = (vars[stock.name] ?? 0) + inflowSum * specs.dt;
      for (const f of sortedOuts) {
        const requested = (vars[f.name] ?? 0) * specs.dt;
        const actual = stock.nonNegative ? Math.min(requested, Math.max(0, remaining)) : requested;
        // Realized rate (for the next algebraic eval).
        vars[f.name] = actual / specs.dt;
        remaining -= actual;
      }
      vars[stock.name] = stock.nonNegative ? Math.max(0, remaining) : remaining;
    }
    t = t + specs.dt;
    evalAlgebraic(t);
    samples.push({ time: t, vars: { ...vars } });
    step++;
  }

  return { samples, evaluationOrder: order, errors: [] };
}
