import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  useInternalNode,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getEdgeParams } from '../utils/floatingEdgeUtils';

interface BendOffset {
  dx: number;
  dy: number;
}

const DEFAULT_BORDER_RADIUS = 12;
const DEFAULT_OFFSET = 24;

// Discrete-mode edge: orthogonal segments with rounded corners (smooth-step).
// The user can grab the bend handle and drag it to move the elbow of the
// path; the offset is stored relative to the natural midpoint between
// endpoints so the curve stays "attached" when the source or target node
// moves.
//
// Legacy `controlPoints` field on edge.data (cubic bezier override from the
// previous version) is intentionally ignored — the visual idiom changed
// from bezier curves to right-angle corners and the old offsets don't
// translate.
export function FloatingEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  markerEnd,
  style,
  label,
  selected,
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const { screenToFlowPosition, setEdges } = useReactFlow();
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGCircleElement>) => {
      e.stopPropagation();
      e.preventDefault();
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture may throw if the pointer is gone; the global
        // pointermove listeners below still drive the drag.
      }
    },
    [],
  );

  if (!sourceNode || !targetNode) return null;

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    sourceNode,
    targetNode,
    sourceHandleId,
    targetHandleId,
  );

  // Natural midpoint between source and target. The user-controllable
  // override is an offset from this midpoint so dragging a node moves the
  // elbow with it.
  const midX = (sx + tx) / 2;
  const midY = (sy + ty) / 2;
  const override = (data as { bend?: BendOffset } | undefined)?.bend;
  const centerX = midX + (override?.dx ?? 0);
  const centerY = midY + (override?.dy ?? 0);

  // S-shape guard: getSmoothStepPath leaves each endpoint by `offset` along
  // its perpendicular before bending. When source and target face each
  // other and are closer than 2 × offset on that axis, the two intermediate
  // legs overlap and the path back-tracks — drawing an S. Clamp the offset
  // to (gap/2 - small breathing room) when both ends exit on the same axis
  // so the elbow always fits inside the gap.
  const sourceVertical = sourcePos === Position.Top || sourcePos === Position.Bottom;
  const targetVertical = targetPos === Position.Top || targetPos === Position.Bottom;
  let safeOffset = DEFAULT_OFFSET;
  let safeRadius = DEFAULT_BORDER_RADIUS;
  if (sourceVertical && targetVertical) {
    const gap = Math.abs(ty - sy);
    safeOffset = Math.max(0, Math.min(DEFAULT_OFFSET, gap / 2 - 2));
  } else if (!sourceVertical && !targetVertical) {
    const gap = Math.abs(tx - sx);
    safeOffset = Math.max(0, Math.min(DEFAULT_OFFSET, gap / 2 - 2));
  }
  // Corner radius can never exceed the offset — otherwise the rounded
  // corner geometry overflows the leg and the path renders crookedly.
  safeRadius = Math.min(safeRadius, Math.max(0, safeOffset));

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
    borderRadius: safeRadius,
    offset: safeOffset,
    centerX,
    centerY,
  });

  // While dragging, every pointermove updates the bend offset relative to
  // the midpoint so the elbow follows the cursor.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setEdges((edges) =>
        edges.map((edge) => {
          if (edge.id !== id) return edge;
          const newDx = flowPos.x - midX;
          const newDy = flowPos.y - midY;
          return {
            ...edge,
            data: { ...(edge.data ?? {}), bend: { dx: newDx, dy: newDy } },
          };
        }),
      );
    };
    const onUp = () => setDragging(false);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, id, midX, midY, screenToFlowPosition, setEdges]);

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {selected && (
        <circle
          className="edge-cp-handle"
          cx={centerX}
          cy={centerY}
          r={6}
          onPointerDown={onPointerDown}
        />
      )}
      {label !== undefined && label !== null && label !== '' && (
        <EdgeLabelRenderer>
          <div
            className="edge-label nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
