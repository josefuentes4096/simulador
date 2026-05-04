import type { Dispatch, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { SimulationType } from '@simulador/shared';
import { NodeIcon } from './NodeIcon';
import { NODE_TYPE_OPTIONS, type NodeKind } from './nodes';
import { DYNAMIC_NODE_TYPE_OPTIONS, type DynamicNodeKind } from './dynamicNodes';

interface Props {
  onAddNode: (kind: NodeKind) => void;
  // Stella block creator. Receives the React Flow `node.type` string
  // (e.g. 'stock', 'stellaConverter') so the caller can mint a node
  // directly. Only invoked in dynamic mode.
  onAddDynamicNode?: (rfType: string, kind: DynamicNodeKind) => void;
  connectMode: boolean;
  onToggleConnectMode: () => void;
  // Dynamic-only: which edge tool is active. null = arrow/select; 'flow'
  // or 'connector' = drawing mode (click source then target).
  dynamicEdgeMode?: 'flow' | 'connector' | null;
  setDynamicEdgeMode?: (m: 'flow' | 'connector' | null) => void;
  snapToGrid: boolean;
  onToggleSnapToGrid: () => void;
  nodes: Node[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  simulationType: SimulationType;
}

// Tiny icons for the Stella palette buttons. Drawn inline so they don't pull
// from any external icon set.
function DynamicNodeIcon({ kind }: { kind: DynamicNodeKind }) {
  if (kind === 'stock') {
    return (
      <svg width="35" height="22" viewBox="0 0 28 18" aria-hidden="true">
        <rect x="2" y="2" width="24" height="14" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    );
  }
  if (kind === 'converter') {
    return (
      <svg width="35" height="22" viewBox="0 0 28 18" aria-hidden="true">
        <circle cx="14" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    );
  }
  if (kind === 'comment') {
    return (
      <svg width="35" height="22" viewBox="0 0 28 18" aria-hidden="true">
        <rect x="2" y="2" width="24" height="14" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" fill="none" />
      </svg>
    );
  }
  // label
  return (
    <svg width="35" height="22" viewBox="0 0 28 18" aria-hidden="true">
      <rect x="2" y="6" width="24" height="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

// Icons for the dynamic edge tools. The Flow icon is a thick pipe with a
// small valve circle in the middle; the Action Connector icon is a thin
// curved arrow.
// Stella-style Flow icon: double-line pipe entering from the left, then a
// regulator (valve circle + T-handle), then a hollow arrow tip on the right.
// Mirrors the visual in flow_example.png at icon scale.
function FlowToolIcon() {
  return (
    <svg width="44" height="32" viewBox="0 0 36 26" aria-hidden="true">
      {/* Double-pipe entering from the left up to the valve perimeter. */}
      <line x1="2" y1="17" x2="13" y2="17" stroke="currentColor" strokeWidth="1" />
      <line x1="2" y1="20" x2="13" y2="20" stroke="currentColor" strokeWidth="1" />
      {/* Hollow arrow on the right, exiting from the valve. The shaft is the
          rectangle, the head flares out to a tip. */}
      <path
        d="M 22,17 L 28,17 L 28,14 L 34,18.5 L 28,23 L 28,20 L 22,20 Z"
        fill="#fff"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      {/* Regulator valve: circle on the pipe centerline. */}
      <circle cx="17.5" cy="18.5" r="5" fill="#fff" stroke="currentColor" strokeWidth="1.1" />
      {/* Faucet T: horizontal handle (same width as circle ≈ 10) + short
          stem connecting to the valve's top. */}
      <line x1="12.5" y1="9" x2="22.5" y2="9" stroke="currentColor" strokeWidth="1.1" />
      <line x1="17.5" y1="9" x2="17.5" y2="13.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
function ConnectorToolIcon() {
  return (
    <svg width="35" height="22" viewBox="0 0 28 14" aria-hidden="true">
      <path
        d="M2 11 Q 14 -2 24 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <polygon points="20,7 26,9 21,12" fill="currentColor" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="35" height="22" viewBox="0 0 22 14" aria-hidden="true">
      <line x1="2" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <polygon points="15,3 21,7 15,11" fill="currentColor" />
    </svg>
  );
}

// "|·|·|" — three vertical bars with dots indicating same-X alignment.
function AlignVerticalIcon() {
  return (
    <svg width="35" height="22" viewBox="0 0 24 16" aria-hidden="true">
      <line x1="12" y1="1" x2="12" y2="15" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
      <rect x="3" y="3" width="18" height="3" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="6" y="10" width="12" height="3" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

// Three side-by-side rectangles with even gaps — "distribute horizontally".
function SpaceEvenlyHorizontalIcon() {
  return (
    <svg width="35" height="22" viewBox="0 0 24 16" aria-hidden="true">
      <rect x="1" y="3" width="4" height="10" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="10" y="3" width="4" height="10" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="19" y="3" width="4" height="10" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

// Three stacked rectangles with even gaps — "distribute vertically".
function SpaceEvenlyVerticalIcon() {
  return (
    <svg width="35" height="22" viewBox="0 0 24 16" aria-hidden="true">
      <rect x="6" y="0" width="12" height="3" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="6" y="6.5" width="12" height="3" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="6" y="13" width="12" height="3" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

// 3x3 dot grid with a small square hugging the bottom-right cell — "snap to grid".
function SnapToGridIcon() {
  return (
    <svg width="35" height="22" viewBox="0 0 24 16" aria-hidden="true">
      {[2, 8, 14].map((y) =>
        [4, 12, 20].map((x) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="currentColor" />
        )),
      )}
      <rect x="9" y="3" width="11" height="10" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

// "─·─" — horizontal line with two boxes stacked side-by-side, centers aligned.
function AlignHorizontalIcon() {
  return (
    <svg width="35" height="22" viewBox="0 0 24 16" aria-hidden="true">
      <line x1="1" y1="8" x2="23" y2="8" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
      <rect x="3" y="2" width="6" height="12" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="14" y="4" width="6" height="8" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

// Evenly distribute selected nodes along the given axis, keeping the two
// extremes pinned and re-spacing the interior nodes so consecutive *centers*
// are equidistant. Mirrors draw.io's "Space evenly" behavior.
function distributeSelected(nodes: Node[], axis: 'x' | 'y'): Node[] {
  const sel = nodes.filter((n) => n.selected);
  if (sel.length < 3) return nodes;
  const dim = (n: Node, which: 'width' | 'height') =>
    n.measured?.[which] ?? (which === 'width' ? 100 : 50);
  const center = (n: Node) =>
    axis === 'x'
      ? n.position.x + dim(n, 'width') / 2
      : n.position.y + dim(n, 'height') / 2;
  const sorted = [...sel].sort((a, b) => center(a) - center(b));
  const first = center(sorted[0]!);
  const last = center(sorted[sorted.length - 1]!);
  const step = (last - first) / (sorted.length - 1);
  const targets = new Map<string, number>();
  sorted.forEach((n, i) => {
    targets.set(n.id, first + i * step);
  });
  return nodes.map((n) => {
    const t = targets.get(n.id);
    if (t === undefined) return n;
    if (axis === 'x') {
      return { ...n, position: { x: t - dim(n, 'width') / 2, y: n.position.y } };
    }
    return { ...n, position: { x: n.position.x, y: t - dim(n, 'height') / 2 } };
  });
}

function alignSelected(nodes: Node[], axis: 'x' | 'y'): Node[] {
  const sel = nodes.filter((n) => n.selected);
  if (sel.length < 2) return nodes;
  // Use measured dims when available, else fall back to a nominal size.
  const dim = (n: Node, which: 'width' | 'height') =>
    n.measured?.[which] ?? (which === 'width' ? 100 : 50);
  const center = (n: Node) =>
    axis === 'x'
      ? n.position.x + dim(n, 'width') / 2
      : n.position.y + dim(n, 'height') / 2;
  const target = sel.reduce((s, n) => s + center(n), 0) / sel.length;
  return nodes.map((n) => {
    if (!n.selected) return n;
    if (axis === 'x') {
      return { ...n, position: { x: target - dim(n, 'width') / 2, y: n.position.y } };
    }
    return { ...n, position: { x: n.position.x, y: target - dim(n, 'height') / 2 } };
  });
}

export function BlockPalette({
  onAddNode,
  onAddDynamicNode,
  connectMode,
  onToggleConnectMode,
  dynamicEdgeMode,
  setDynamicEdgeMode,
  snapToGrid,
  onToggleSnapToGrid,
  nodes,
  setNodes,
  simulationType,
}: Props) {
  const { t } = useTranslation();
  const selectedCount = nodes.filter((n) => n.selected).length;
  const canAlign = selectedCount >= 2;
  const canDistribute = selectedCount >= 3;
  const isDynamic = simulationType === 'dynamic';
  return (
    <aside className="block-palette" aria-label={t('palette.ariaLabel')}>
      {/* Discrete-mode blocks (assignment, decision, routine, ...). */}
      {!isDynamic &&
        NODE_TYPE_OPTIONS.map((o) => {
          const label = t(`nodeTypes.${o.value}`);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onAddNode(o.value)}
              title={t('palette.addNodeTitle', { label })}
              aria-label={t('palette.addNodeAria', { label })}
              className="block-palette__btn"
            >
              <NodeIcon kind={o.value} />
            </button>
          );
        })}
      {/* Stella-mode blocks (Stock, Converter, Comment, Label). Flow and
          Action Connector live in the auxiliary tool group below — they're
          edges, drawn by drag-from-source. */}
      {isDynamic &&
        onAddDynamicNode !== undefined &&
        DYNAMIC_NODE_TYPE_OPTIONS.map((o) => {
          const label = t(`dynamicNodeTypes.${o.value}`);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onAddDynamicNode(o.rfType, o.value)}
              title={t('palette.addNodeTitle', { label })}
              aria-label={t('palette.addNodeAria', { label })}
              className="block-palette__btn"
            >
              <DynamicNodeIcon kind={o.value} />
            </button>
          );
        })}
      {/* Discrete mode keeps the existing single connect-mode toggle. */}
      {!isDynamic && (
        <button
          type="button"
          onClick={onToggleConnectMode}
          aria-pressed={connectMode}
          title={t('palette.connectModeTitle')}
          aria-label={t('palette.connectModeAria')}
          className={`block-palette__btn ${connectMode ? 'block-palette__btn--active' : ''}`}
        >
          <ArrowIcon />
        </button>
      )}
      {/* Dynamic mode: two mutually-exclusive edge tools — Flow (pipe with
          valve) and Action Connector (dependency arrow). The active one is
          highlighted; clicking the other switches. There's no "off" — every
          drag from a handle in dynamic mode produces some edge type. */}
      {isDynamic && setDynamicEdgeMode && (
        <>
          <button
            type="button"
            onClick={() =>
              setDynamicEdgeMode(dynamicEdgeMode === 'flow' ? null : 'flow')
            }
            aria-pressed={dynamicEdgeMode === 'flow'}
            title={t('palette.flowToolTitle')}
            aria-label={t('palette.flowToolAria')}
            className={`block-palette__btn ${
              dynamicEdgeMode === 'flow' ? 'block-palette__btn--active' : ''
            }`}
          >
            <FlowToolIcon />
          </button>
          <button
            type="button"
            onClick={() =>
              setDynamicEdgeMode(dynamicEdgeMode === 'connector' ? null : 'connector')
            }
            aria-pressed={dynamicEdgeMode === 'connector'}
            title={t('palette.connectorToolTitle')}
            aria-label={t('palette.connectorToolAria')}
            className={`block-palette__btn ${
              dynamicEdgeMode === 'connector' ? 'block-palette__btn--active' : ''
            }`}
          >
            <ConnectorToolIcon />
          </button>
        </>
      )}
      <div className="block-palette__divider" aria-hidden="true" />
      <button
        type="button"
        onClick={() => setNodes((ns) => alignSelected(ns, 'x'))}
        disabled={!canAlign}
        title={t('palette.alignVerticalTitle')}
        aria-label={t('palette.alignVerticalAria')}
        className="block-palette__btn"
      >
        <AlignVerticalIcon />
      </button>
      <button
        type="button"
        onClick={() => setNodes((ns) => alignSelected(ns, 'y'))}
        disabled={!canAlign}
        title={t('palette.alignHorizontalTitle')}
        aria-label={t('palette.alignHorizontalAria')}
        className="block-palette__btn"
      >
        <AlignHorizontalIcon />
      </button>
      <button
        type="button"
        onClick={() => setNodes((ns) => distributeSelected(ns, 'x'))}
        disabled={!canDistribute}
        title={t('palette.distributeHorizontalTitle')}
        aria-label={t('palette.distributeHorizontalAria')}
        className="block-palette__btn"
      >
        <SpaceEvenlyHorizontalIcon />
      </button>
      <button
        type="button"
        onClick={() => setNodes((ns) => distributeSelected(ns, 'y'))}
        disabled={!canDistribute}
        title={t('palette.distributeVerticalTitle')}
        aria-label={t('palette.distributeVerticalAria')}
        className="block-palette__btn"
      >
        <SpaceEvenlyVerticalIcon />
      </button>
      <div className="block-palette__divider" aria-hidden="true" />
      <button
        type="button"
        onClick={onToggleSnapToGrid}
        aria-pressed={snapToGrid}
        title={t('palette.snapTitle')}
        aria-label={t('palette.snapAria')}
        className={`block-palette__btn ${snapToGrid ? 'block-palette__btn--active' : ''}`}
      >
        <SnapToGridIcon />
      </button>
    </aside>
  );
}
