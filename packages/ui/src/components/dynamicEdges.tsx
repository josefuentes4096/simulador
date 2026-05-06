import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  useInternalNode,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { getEdgeParams } from '../utils/floatingEdgeUtils';

// Stella custom edges. Two flavors:
//   - flow:      double-pipe with regulator (valve + T-handle) and a chunky
//                arrow head. Connects Stocks/clouds. Carries a rate
//                expression. The arrow indicates positive flow direction.
//   - connector: thin curved bezier with arrow. Carries dependency. Connects
//                Stock/Flow/Converter to Flow/Converter (never to Stock).

// --- Flow edge (Stella-style) -----------------------------------------
// Geometry: orthogonal smooth-step path from source intersection to target
// intersection (same idiom as the discrete Event→Event arrow). We draw the
// pipe as two stacked strokes on the same path — outer thick colored, inner
// thinner background — to get the classic "double rail" look without
// computing offset paths analytically. Valve and arrow position are derived
// from the rendered SVG path via getPointAtLength so they sit correctly
// along whichever leg the regulator falls on.
const PIPE_OUTER = 7; // px: total pipe width (between outer rails)
const PIPE_INNER = 4; // px: hollow space between rails
const VALVE_R = 9; // px: valve circle radius
const ARROW_LEN = 14; // px: arrow head length (along pipe axis)
const ARROW_W = 14; // px: arrow head width (perpendicular)
// Match FloatingEdge so flow elbows look identical to event arrows.
const ELBOW_RADIUS = 12;
const ELBOW_OFFSET = 24;

export function DynamicFlowEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  style,
  data,
  selected,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  // Hidden mirror of the pipe path used to query length/tangent for valve
  // placement. Hooks must run on every render, so the ref/state are
  // declared up front and the bail-out for missing nodes lives below.
  const pathRef = useRef<SVGPathElement>(null);
  const [valve, setValve] = useState<{ x: number; y: number; angle: number } | null>(
    null,
  );

  const params =
    sourceNode && targetNode
      ? getEdgeParams(sourceNode, targetNode, sourceHandleId, targetHandleId)
      : null;

  // Direction unit vector at the target side, pointing INTO the target node.
  // Used to shorten the pipe so the arrow head can fill the last ARROW_LEN
  // px without overpainting the rails.
  let ux = 0;
  let uy = 0;
  if (params) {
    switch (params.targetPos) {
      case Position.Left:
        ux = 1;
        break;
      case Position.Right:
        ux = -1;
        break;
      case Position.Top:
        uy = 1;
        break;
      case Position.Bottom:
        uy = -1;
        break;
    }
  }

  const pipeTx = params ? params.tx - ux * ARROW_LEN : 0;
  const pipeTy = params ? params.ty - uy * ARROW_LEN : 0;

  // S-shape / radius safety borrowed from FloatingEdge: when both ends face
  // each other on the same axis and are closer than 2×offset, getSmoothStepPath
  // would back-track and draw an S. Clamp the elbow offset and corner radius
  // to fit the actual gap.
  let safeOffset = ELBOW_OFFSET;
  let safeRadius = ELBOW_RADIUS;
  if (params) {
    const sourceVertical =
      params.sourcePos === Position.Top || params.sourcePos === Position.Bottom;
    const targetVertical =
      params.targetPos === Position.Top || params.targetPos === Position.Bottom;
    if (sourceVertical && targetVertical) {
      const gap = Math.abs(pipeTy - params.sy);
      safeOffset = Math.max(0, Math.min(ELBOW_OFFSET, gap / 2 - 2));
    } else if (!sourceVertical && !targetVertical) {
      const gap = Math.abs(pipeTx - params.sx);
      safeOffset = Math.max(0, Math.min(ELBOW_OFFSET, gap / 2 - 2));
    }
    safeRadius = Math.min(safeRadius, Math.max(0, safeOffset));
  }

  const pipePath = params
    ? getSmoothStepPath({
        sourceX: params.sx,
        sourceY: params.sy,
        sourcePosition: params.sourcePos,
        targetX: pipeTx,
        targetY: pipeTy,
        targetPosition: params.targetPos,
        borderRadius: safeRadius,
        offset: safeOffset,
      })[0]
    : '';

  const regulatorOffset =
    (data as { regulatorOffset?: number } | undefined)?.regulatorOffset ?? 0.5;

  // Walk the rendered SVG path to find the valve position + tangent at
  // `regulatorOffset * total length`. Runs synchronously after layout so the
  // valve is positioned before paint. Re-runs whenever the path string or
  // offset changes — that covers node moves, regulator drag, and selection.
  useLayoutEffect(() => {
    const el = pathRef.current;
    if (!el || !pipePath) return;
    const total = el.getTotalLength();
    if (total <= 0) return;
    const at = Math.max(0, Math.min(total, regulatorOffset * total));
    const p = el.getPointAtLength(at);
    const a = el.getPointAtLength(Math.max(0, at - 0.5));
    const b = el.getPointAtLength(Math.min(total, at + 0.5));
    const raw = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    // Snap to the nearest 90° so the T-handle stays perpendicular to the
    // pipe (axis-aligned) even when the regulator lands on a rounded
    // corner where the local tangent would otherwise be oblique.
    const snapped = Math.round(raw / 90) * 90;
    // On horizontal segments the T-handle must always point up regardless
    // of the flow direction. atan2 gives 0° for left→right and ±180° for
    // right→left; remap the latter so both render with the handle up.
    const angle = Math.abs(snapped) === 180 ? 0 : snapped;
    setValve({ x: p.x, y: p.y, angle });
  }, [pipePath, regulatorOffset]);

  if (!params) return null;

  // Hollow arrow head — Stella convention. Built as a single closed outline
  // path: shaft-edge → outer flare top → tip → outer flare bottom → back.
  // (ux, uy) is the local direction at the target (always axis-aligned),
  // so the arrow points along whichever side it enters.
  const px = -uy; // perpendicular unit at the target
  const py = ux;
  const inner = (PIPE_INNER + 1) / 2;
  const outer = ARROW_W / 2;
  const arrowPath = [
    `M ${pipeTx + px * inner},${pipeTy + py * inner}`,
    `L ${pipeTx + px * outer},${pipeTy + py * outer}`,
    `L ${params.tx},${params.ty}`,
    `L ${pipeTx - px * outer},${pipeTy - py * outer}`,
    `L ${pipeTx - px * inner},${pipeTy - py * inner}`,
    'Z',
  ].join(' ');

  const color = selected ? '#1976d2' : '#1f3aab';
  const fillBg = '#ffffff';

  const flowName = (data as { name?: string } | undefined)?.name;

  // Label position: perpendicular to the local tangent at the valve.
  let labelX = 0;
  let labelY = 0;
  if (valve) {
    const rad = (valve.angle * Math.PI) / 180;
    const lpx = -Math.sin(rad);
    const lpy = Math.cos(rad);
    const labelOffset = 18;
    labelX = valve.x + lpx * labelOffset;
    labelY = valve.y + lpy * labelOffset;
  }

  return (
    <>
      {/* Outer pipe stroke — wide, colored. */}
      <BaseEdge
        id={`${id}__outer`}
        path={pipePath}
        style={{
          ...style,
          strokeWidth: PIPE_OUTER,
          stroke: color,
          fill: 'none',
        }}
      />
      {/* Inner stroke — narrower, background color. The combination of
          outer-colored + inner-bg-colored leaves two parallel rails with the
          background showing through the middle. */}
      <BaseEdge
        id={`${id}__inner`}
        path={pipePath}
        style={{
          strokeWidth: PIPE_INNER,
          stroke: fillBg,
          fill: 'none',
        }}
      />
      {/* Invisible mirror used only as a length/tangent oracle for the
          valve. Stays in the DOM (not display:none) so getTotalLength /
          getPointAtLength have geometry to work with. */}
      <path
        ref={pathRef}
        d={pipePath}
        fill="none"
        stroke="none"
        pointerEvents="none"
      />
      {/* Hollow arrow head (Stella style). */}
      <path d={arrowPath} fill={fillBg} stroke={color} strokeWidth={1.4} />
      {/* Valve assembly: T-handle (faucet stem + crossbar) drawn ABOVE the
          valve in the unrotated coord, then rotated by the local pipe angle
          at the regulator so the stem stays perpendicular to the flow. */}
      {valve && (
        <g
          transform={`translate(${valve.x}, ${valve.y}) rotate(${valve.angle})`}
        >
          <line
            x1={0}
            y1={-VALVE_R}
            x2={0}
            y2={-VALVE_R - 8}
            stroke={color}
            strokeWidth={1.6}
          />
          <line
            x1={-6}
            y1={-VALVE_R - 8}
            x2={6}
            y2={-VALVE_R - 8}
            stroke={color}
            strokeWidth={1.6}
          />
          <circle
            cx={0}
            cy={0}
            r={VALVE_R}
            fill={fillBg}
            stroke={color}
            strokeWidth={1.6}
          />
        </g>
      )}
      {/* Optional name label, placed off the valve perpendicular to the
          local pipe tangent. */}
      {flowName !== undefined && flowName !== '' && valve && (
        <EdgeLabelRenderer>
          <div
            className="edge-label nodrag nopan dynamic-flow__label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {flowName}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// --- Action Connector edge ---------------------------------------------
// Thin curved bezier with arrow. No label by default (the relationship is
// expressed in the destination block's equation).
export function DynamicConnectorEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  markerEnd,
  style,
  selected,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
    sourceHandleId,
    targetHandleId,
  );
  const [edgePath] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
  });
  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        ...style,
        strokeWidth: 1.2,
        stroke: selected ? '#1976d2' : '#888',
        fill: 'none',
      }}
    />
  );
}

export const DYNAMIC_EDGE_TYPES: EdgeTypes = {
  flow: DynamicFlowEdge,
  connector: DynamicConnectorEdge,
};
