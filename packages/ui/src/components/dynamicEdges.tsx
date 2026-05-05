import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';
import { getEdgeParams } from '../utils/floatingEdgeUtils';

// Stella custom edges. Two flavors:
//   - flow:      double-pipe with regulator (valve + T-handle) and a chunky
//                arrow head. Connects Stocks/clouds. Carries a rate
//                expression. The arrow indicates positive flow direction.
//   - connector: thin curved bezier with arrow. Carries dependency. Connects
//                Stock/Flow/Converter to Flow/Converter (never to Stock).

// --- Flow edge (Stella-style) -----------------------------------------
// Geometry: a straight pipe from source intersection to target intersection.
// We draw the pipe as two parallel lines (an outer thick stroke painted with
// the pipe color, then an inner thinner stroke painted with the background
// color), giving the classic "double rail" look without computing offset
// paths analytically. The valve assembly (small circle with a vertical "T"
// on top representing the handle) is placed at the regulator offset along
// the line; the arrow head is a chunky triangle at the target end.
const PIPE_OUTER = 7; // px: total pipe width (between outer rails)
const PIPE_INNER = 4; // px: hollow space between rails
const VALVE_R = 9; // px: valve circle radius
const ARROW_LEN = 14; // px: arrow head length (along pipe axis)
const ARROW_W = 14; // px: arrow head width (perpendicular)

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
  if (!sourceNode || !targetNode) return null;
  const { sx, sy, tx, ty } = getEdgeParams(
    sourceNode,
    targetNode,
    sourceHandleId,
    targetHandleId,
  );

  // Direction unit vector and perpendicular for placing labels and rotating
  // the valve handle.
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.max(Math.hypot(dx, dy), 1e-6);
  const ux = dx / len;
  const uy = dy / len;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  // Cut the pipe short of the target so the arrow head doesn't paint over
  // the target node's edge — the visual tip lands at (tx, ty) exactly.
  const pipeEndX = tx - ux * ARROW_LEN;
  const pipeEndY = ty - uy * ARROW_LEN;
  const pipePath = `M ${sx},${sy} L ${pipeEndX},${pipeEndY}`;

  // Regulator placement.
  const regulatorOffset =
    (data as { regulatorOffset?: number } | undefined)?.regulatorOffset ?? 0.5;
  const valveX = sx + ux * (len - ARROW_LEN) * regulatorOffset;
  const valveY = sy + uy * (len - ARROW_LEN) * regulatorOffset;

  // Hollow arrow head — Stella convention. Built as a single closed outline
  // path: shaft-edge → outer flare top → tip → outer flare bottom → back.
  // The shaft "necks down" at the head start so the inner (smaller) outline
  // visually continues from the double-pipe and flares out into the head.
  const baseX = tx - ux * ARROW_LEN;
  const baseY = ty - uy * ARROW_LEN;
  const px = -uy; // perpendicular unit
  const py = ux;
  // Inner shaft half-thickness (matches the inner pipe rail); outer flare
  // matches ARROW_W/2.
  const inner = (PIPE_INNER + 1) / 2; // ~2.5 — slightly wider than the rail gap so the necks meet the pipe rails cleanly
  const outer = ARROW_W / 2;
  const arrowPath = [
    `M ${baseX + px * inner},${baseY + py * inner}`,
    `L ${baseX + px * outer},${baseY + py * outer}`,
    `L ${tx},${ty}`,
    `L ${baseX - px * outer},${baseY - py * outer}`,
    `L ${baseX - px * inner},${baseY - py * inner}`,
    'Z',
  ].join(' ');

  const color = selected ? '#1976d2' : '#1f3aab';
  const fillBg = '#ffffff';

  const flowName = (data as { name?: string } | undefined)?.name;
  // Label position: just below the valve, perpendicular to the pipe.
  const labelOffset = 18;
  const labelX = valveX + px * labelOffset;
  const labelY = valveY + py * labelOffset;

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
      {/* Hollow arrow head (Stella style). */}
      <path d={arrowPath} fill={fillBg} stroke={color} strokeWidth={1.4} />
      {/* Valve assembly: T-handle (faucet stem + crossbar) drawn ABOVE the
          valve in the unrotated coord, then rotated by the pipe angle so
          the stem stays perpendicular to the pipe. With angleDeg=0
          (horizontal pipe) rotate is 0 and the T points up; with
          angleDeg=90 (downward pipe) rotate is 90 and the T points right
          — always perpendicular to the flow direction. */}
      <g transform={`translate(${valveX}, ${valveY}) rotate(${angleDeg})`}>
        {/* The T-handle: vertical stem + horizontal cap. "Up" relative to
            this rotated coord system is "perpendicular to pipe". */}
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
      {/* Optional name label, placed off the valve. */}
      {flowName !== undefined && flowName !== '' && (
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
