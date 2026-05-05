import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react';
import type { Node } from '@xyflow/react';

// Visual node components for the dynamic-simulation (Stella/iThink-style)
// editor surface. They live in this separate module so the discrete-mode
// `nodes.tsx` stays focused on flowchart blocks.
//
// Stella block kinds — see DynamicBlockKind in @simulador/shared:
//   - stock     rectangle reservoir
//   - converter circle (constant or formula)
//   - cloud     visual sink/source for flows when one end is a free endpoint
//   - comment   free text (no model semantics)
//   - label     small title/label box (no model semantics)
//
// Flows and Action Connectors are *edges*, not nodes — they're added in Fase 4
// as React Flow custom edges.

export type DynamicNodeKind = 'stock' | 'converter' | 'cloud' | 'comment' | 'label';

// What we store under `node.data` for these nodes. The canonical model lives
// in DynamicSection (shared); these are React Flow's view-state copies kept
// in sync by the Fase 6 inspector.
export interface DynamicNodeData extends Record<string, unknown> {
  // Visible name. For Stocks/Converters this is also the identifier in
  // equations (after normalization to snake_case in equationGenerator).
  name?: string;
  // Stock-only.
  initialExpression?: string;
  nonNegative?: boolean;
  // Converter-only.
  expression?: string;
  // Free text for comment/label nodes.
  text?: string;
  // Documentation field shown in the inspector for any block.
  documentation?: string;
  units?: string;
}

type DynamicNodeT = Node<DynamicNodeData>;

// --- Stock --------------------------------------------------------------
// Reservoir. Rectangle with the name on top. Has 4 source + 4 target handles
// (one per side) so flows can attach from any direction. The flow edge in
// Fase 4 picks the side closest to the other endpoint.
export function StockNode({ data, selected }: NodeProps<DynamicNodeT>) {
  return (
    <div className={`node node--stock ${selected ? 'node--selected' : ''}`}>
      <Handle type="target" id="t-top" position={Position.Top} />
      <Handle type="target" id="t-left" position={Position.Left} />
      <Handle type="target" id="t-right" position={Position.Right} />
      <Handle type="target" id="t-bottom" position={Position.Bottom} />
      <Handle type="source" id="s-top" position={Position.Top} />
      <Handle type="source" id="s-left" position={Position.Left} />
      <Handle type="source" id="s-right" position={Position.Right} />
      <Handle type="source" id="s-bottom" position={Position.Bottom} />
      <div className="node--stock__name">{data.name ?? 'Stock'}</div>
    </div>
  );
}

// --- Converter ----------------------------------------------------------
// Circle. Constants, formulas or graphical functions. Same handles as Stock.
export function ConverterNode({ data, selected }: NodeProps<DynamicNodeT>) {
  return (
    <div className={`node node--stella-converter ${selected ? 'node--selected' : ''}`}>
      <Handle type="target" id="t-top" position={Position.Top} />
      <Handle type="target" id="t-left" position={Position.Left} />
      <Handle type="target" id="t-right" position={Position.Right} />
      <Handle type="target" id="t-bottom" position={Position.Bottom} />
      <Handle type="source" id="s-top" position={Position.Top} />
      <Handle type="source" id="s-left" position={Position.Left} />
      <Handle type="source" id="s-right" position={Position.Right} />
      <Handle type="source" id="s-bottom" position={Position.Bottom} />
      <div className="node--stella-converter__name">{data.name ?? 'Converter'}</div>
    </div>
  );
}

// --- Cloud --------------------------------------------------------------
// Auto-created when a flow has a free end. Stella's cloud silhouette is
// built from four overlapping circle bumps in a "puffy" arrangement (see
// flow_example.png). Drawn hollow with the surrounding outline.
export function CloudNode({ selected }: NodeProps<DynamicNodeT>) {
  return (
    <div className={`node node--stella-cloud ${selected ? 'node--selected' : ''}`}>
      {/* Single anchor handle so React Flow lets a flow edge attach. The
          flow geometry uses the node center, not the handle position. */}
      <Handle type="target" id="anchor" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" id="anchor" position={Position.Top} style={{ opacity: 0 }} />
      <svg viewBox="0 0 60 48" width="60" height="48" aria-hidden="true">
        {/* Four bumps making the puffy cloud outline. The path traces the
            outer arc of each bump in order so the silhouette is one closed
            curve; the start/end meet at the bottom-left. */}
        <path
          d="M 14,28
             C 4,28 4,16 14,16
             C 14,4 30,4 32,14
             C 36,2 56,8 50,22
             C 60,22 60,38 48,34
             C 46,46 28,46 26,34
             C 16,42 4,38 14,28 Z"
          fill="#fff"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}

// --- Comment ------------------------------------------------------------
// Free text. No handles — comments are visual annotations, no model semantics.
export function StellaCommentNode({ data, selected }: NodeProps<DynamicNodeT>) {
  return (
    <div className={`node node--stella-comment ${selected ? 'node--selected' : ''}`}>
      <div className="node--stella-comment__text">{data.text ?? data.name ?? '...'}</div>
    </div>
  );
}

// --- Label --------------------------------------------------------------
// Small "label box". Like a title plate without grid lines. No handles.
export function StellaLabelNode({ data, selected }: NodeProps<DynamicNodeT>) {
  return (
    <div className={`node node--stella-label ${selected ? 'node--selected' : ''}`}>
      <div className="node--stella-label__text">{data.text ?? data.name ?? ''}</div>
    </div>
  );
}

export const DYNAMIC_NODE_TYPES: NodeTypes = {
  stock: StockNode,
  stellaConverter: ConverterNode,
  cloud: CloudNode,
  stellaComment: StellaCommentNode,
  stellaLabel: StellaLabelNode,
};

// Stable list for the palette — order matches the toolbar.
export const DYNAMIC_NODE_TYPE_OPTIONS: { value: DynamicNodeKind; rfType: string }[] = [
  { value: 'stock', rfType: 'stock' },
  { value: 'converter', rfType: 'stellaConverter' },
  { value: 'comment', rfType: 'stellaComment' },
  { value: 'label', rfType: 'stellaLabel' },
];
