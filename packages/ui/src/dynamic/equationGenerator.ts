// Build the human-readable Equation view from the dynamic model.
//
// Reads from React Flow nodes/edges (the same shapes the canvas uses) so the
// view stays in sync without a separate snapshot step. The output is a list
// of grouped sections so the renderer can space them visually.

import type { Edge, Node } from '@xyflow/react';

export interface EquationLine {
  // Free text rendered as-is. The renderer doesn't apply markdown.
  text: string;
  // Visual emphasis: 'header' = bold section header, 'normal' = body.
  kind?: 'header' | 'normal';
}

// Normalize a name for use as an equation identifier. Spaces and other
// non-identifier characters → underscore. Mirrors §5.4 of the spec.
export function normalizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

interface BlockInfo {
  id: string;
  name: string;
  kind: 'stock' | 'converter' | 'cloud' | 'comment' | 'label';
  initialExpression?: string;
  expression?: string;
  hasGraphical?: boolean;
}

function nodeToBlock(n: Node): BlockInfo | null {
  const data = (n.data ?? {}) as Record<string, unknown>;
  const name = typeof data['name'] === 'string' ? data['name'] : '';
  const KIND_BY_RF: Record<string, BlockInfo['kind']> = {
    stock: 'stock',
    stellaConverter: 'converter',
    cloud: 'cloud',
    stellaComment: 'comment',
    stellaLabel: 'label',
  };
  const kind = KIND_BY_RF[n.type ?? ''];
  if (!kind) return null;
  return {
    id: n.id,
    name: normalizeName(name),
    kind,
    initialExpression:
      typeof data['initialExpression'] === 'string' ? data['initialExpression'] : undefined,
    expression: typeof data['expression'] === 'string' ? data['expression'] : undefined,
    hasGraphical: data['graphical'] !== undefined,
  };
}

interface FlowInfo {
  id: string;
  name: string;
  fromId: string;
  toId: string;
  expression: string;
}

function edgeToFlow(e: Edge): FlowInfo | null {
  if (e.type !== 'flow') return null;
  const data = (e.data ?? {}) as Record<string, unknown>;
  return {
    id: e.id,
    name: normalizeName(typeof data['name'] === 'string' ? data['name'] : ''),
    fromId: e.source,
    toId: e.target,
    expression: typeof data['expression'] === 'string' ? data['expression'] : '',
  };
}

export function generateEquations(nodes: Node[], edges: Edge[]): EquationLine[] {
  const blocks = nodes.map(nodeToBlock).filter((b): b is BlockInfo => b !== null);
  const flows = edges.map(edgeToFlow).filter((f): f is FlowInfo => f !== null);
  const out: EquationLine[] = [];

  // Group flows around their stocks. For each stock, collect its inflows
  // (toId === stock.id) and outflows (fromId === stock.id). Clouds simply
  // don't participate in any stock's accumulator.
  for (const stock of blocks.filter((b) => b.kind === 'stock')) {
    const inflows = flows.filter((f) => f.toId === stock.id);
    const outflows = flows.filter((f) => f.fromId === stock.id);
    const inNames = inflows.map((f) => f.name);
    const outNames = outflows.map((f) => `- ${f.name}`);
    const change = [...inNames, ...outNames].join(' ');
    out.push({
      text: `${stock.name}(t) = ${stock.name}(t - dt) + (${change || '0'}) * dt`,
      kind: 'normal',
    });
    out.push({ text: `INIT ${stock.name} = ${stock.initialExpression ?? '0'}`, kind: 'normal' });
    if (inflows.length > 0) {
      out.push({ text: 'INFLOWS:', kind: 'header' });
      for (const f of inflows) {
        out.push({ text: `  ${f.name} = ${f.expression || '0'}`, kind: 'normal' });
      }
    }
    if (outflows.length > 0) {
      out.push({ text: 'OUTFLOWS:', kind: 'header' });
      for (const f of outflows) {
        out.push({ text: `  ${f.name} = ${f.expression || '0'}`, kind: 'normal' });
      }
    }
    out.push({ text: '', kind: 'normal' }); // visual gap
  }

  // Cloud-to-cloud or floating flows that don't belong to any stock.
  const referencedFlowIds = new Set<string>();
  for (const stock of blocks.filter((b) => b.kind === 'stock')) {
    for (const f of flows.filter((f) => f.toId === stock.id || f.fromId === stock.id))
      referencedFlowIds.add(f.id);
  }
  const orphans = flows.filter((f) => !referencedFlowIds.has(f.id));
  if (orphans.length > 0) {
    out.push({ text: 'FLOWS:', kind: 'header' });
    for (const f of orphans) {
      out.push({ text: `  ${f.name} = ${f.expression || '0'}`, kind: 'normal' });
    }
    out.push({ text: '', kind: 'normal' });
  }

  // Converters at the end — alphabetical for stable diffs. The user can
  // toggle "by order of execution" once Fase 8 lands the topo sort.
  const converters = blocks
    .filter((b) => b.kind === 'converter')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (converters.length > 0) {
    for (const c of converters) {
      const rhs = c.hasGraphical
        ? `GRAPH(${c.expression || 'TIME'})`
        : c.expression || '0';
      out.push({ text: `${c.name} = ${rhs}`, kind: 'normal' });
    }
  }
  return out;
}
