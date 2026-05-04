import { Position, type InternalNode, type Node } from '@xyflow/react';
import { nodeFlipped } from '../components/nodes';

interface Point {
  x: number;
  y: number;
}

type Role = 'source' | 'target';

function getNodeIntersection(
  from: InternalNode<Node>,
  to: InternalNode<Node>,
  role: Role,
  handleId?: string | null,
): Point {
  const fullW = from.measured?.width ?? 0;
  const fullH = from.measured?.height ?? 0;
  const cx = from.internals.positionAbsolute.x + fullW / 2;
  const cy = from.internals.positionAbsolute.y + fullH / 2;
  const tx = to.internals.positionAbsolute.x + (to.measured?.width ?? 0) / 2;
  const ty = to.internals.positionAbsolute.y + (to.measured?.height ?? 0) / 2;

  // Decision (rhombus): always land on a vertex. The flowchart convention is
  // 1 entry (top vertex) + 2 exits (the SI / NO sides). Honor the edge's
  // sourceHandle to pick the right exit; fall back to geometric snap when the
  // handle isn't specified.
  if (from.type === 'decision') {
    const flipped = nodeFlipped({ data: from.data });

    if (role === 'target') {
      // Incoming edges always enter from the top vertex.
      return { x: cx, y: cy - fullH / 2 };
    }

    // role === 'source'
    if (handleId === 'yes') {
      // SI exit: left vertex by default, right when the diamond is flipped.
      return flipped
        ? { x: cx + fullW / 2, y: cy }
        : { x: cx - fullW / 2, y: cy };
    }
    if (handleId === 'no') {
      // NO exit: right by default, left when flipped.
      return flipped
        ? { x: cx - fullW / 2, y: cy }
        : { x: cx + fullW / 2, y: cy };
    }

    // No handle id (legacy edge or freshly drag-connected) — pick the closest
    // of the 4 vertices geometrically.
    const dx = tx - cx;
    const dy = ty - cy;
    if (Math.abs(dx) > Math.abs(dy)) {
      return { x: dx > 0 ? cx + fullW / 2 : cx - fullW / 2, y: cy };
    }
    return { x: cx, y: dy > 0 ? cy + fullH / 2 : cy - fullH / 2 };
  }

  // Iterador (loop): incoming always from top; outgoing depends on the
  // handle id — `yes` (right) and `yes-left` (left) are the two "continue"
  // sides; `no` exits from the bottom. The floating edge code consults
  // these so the visual exit point matches the handle the user picked.
  if (from.type === 'loop') {
    if (role === 'target') {
      return { x: cx, y: cy - fullH / 2 };
    }
    if (handleId === 'yes') return { x: cx + fullW / 2, y: cy };
    if (handleId === 'yes-left') return { x: cx - fullW / 2, y: cy };
    // 'no' or fallback: bottom.
    return { x: cx, y: cy + fullH / 2 };
  }

  // Connectors (GOTO targets / sources): edges may enter or exit from any
  // side. Pick the side closest to the other endpoint geometrically.
  if (from.type === 'connector') {
    const dx = tx - cx;
    const dy = ty - cy;
    if (Math.abs(dx) > Math.abs(dy)) {
      return { x: dx > 0 ? cx + fullW / 2 : cx - fullW / 2, y: cy };
    }
    return { x: cx, y: dy > 0 ? cy + fullH / 2 : cy - fullH / 2 };
  }

  // Stella nodes (Stocks/Converters/Clouds and the visual-only
  // Comment/Label boxes): a flow or action connector can enter/exit from
  // any side, choosing whichever face is closest to the other endpoint.
  // For Converters (circle) the same axis-aligned face works visually
  // because we still hand React Flow a bounding box rectangle. Without
  // this branch all Stella edges snapped to top/bottom (the default
  // "discrete shapes" convention), forcing arrows to take ugly detours
  // when the other node was off to the side.
  if (
    from.type === 'stock' ||
    from.type === 'stellaConverter' ||
    from.type === 'cloud' ||
    from.type === 'stellaComment' ||
    from.type === 'stellaLabel'
  ) {
    const dx = tx - cx;
    const dy = ty - cy;
    if (Math.abs(dx) > Math.abs(dy)) {
      return { x: dx > 0 ? cx + fullW / 2 : cx - fullW / 2, y: cy };
    }
    return { x: cx, y: dy > 0 ? cy + fullH / 2 : cy - fullH / 2 };
  }

  // Other shapes: convention is top-center for incoming, bottom-center for
  // outgoing. This keeps the flow direction unambiguous regardless of where
  // the other node is positioned (no more arrows hidden behind nodes when
  // the geometry was awkward).
  if (role === 'target') {
    return { x: cx, y: cy - fullH / 2 };
  }
  return { x: cx, y: cy + fullH / 2 };
}

function getEdgePosition(node: InternalNode<Node>, point: Point): Position {
  const cx = node.internals.positionAbsolute.x + (node.measured?.width ?? 0) / 2;
  const cy = node.internals.positionAbsolute.y + (node.measured?.height ?? 0) / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? Position.Left : Position.Right;
  return dy < 0 ? Position.Top : Position.Bottom;
}

export function getEdgeParams(
  source: InternalNode<Node>,
  target: InternalNode<Node>,
  sourceHandle?: string | null,
  targetHandle?: string | null,
) {
  const s = getNodeIntersection(source, target, 'source', sourceHandle);
  const t = getNodeIntersection(target, source, 'target', targetHandle);
  return {
    sx: s.x,
    sy: s.y,
    tx: t.x,
    ty: t.y,
    sourcePos: getEdgePosition(source, s),
    targetPos: getEdgePosition(target, t),
  };
}
