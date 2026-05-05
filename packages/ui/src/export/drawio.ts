import type { ModelEdge, ModelNode, SimulationModel } from '@simulador/shared';
import { nodeFlipped } from '../components/nodes';
import { PAPER_SIZES, type PaperSizeKey } from '../printPages';

// draw.io style strings per node type. Sizes are computed per-node from the
// label content (see computeSize) so blocks shrink-wrap their text.
const FALLBACK_STYLE = 'rounded=0;whiteSpace=wrap;html=1;';

const STYLES: Record<string, string> = {
  initialConditions: 'shape=process;whiteSpace=wrap;html=1;',
  assignment: FALLBACK_STYLE,
  decision: 'rhombus;whiteSpace=wrap;html=1;',
  routine: 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;',
  // draw.io's Document shape: rectangle with a wavy bottom edge — same visual
  // as the in-app salida block.
  salida: 'shape=document;whiteSpace=wrap;html=1;',
  // Small circle — the GOTO marker.
  connector: 'ellipse;whiteSpace=wrap;html=1;fillColor=#ffffff;',
  // Free-floating annotation: rounded rect with dashed border, no fill.
  comment:
    'rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=none;strokeColor=#888888;fontStyle=2;',
};

// Orthogonal routing with rounded corners ("curved" in draw.io's edge format
// panel). Each edge picks its source / target sides geometrically — works for
// connections in any direction.
const EDGE_STYLE =
  'endArrow=classic;html=1;edgeStyle=orthogonalEdgeStyle;curved=1;rounded=1;';

// Per-node sizing. Each shape gets a width/height computed from its label so
// blocks shrink-wrap their text instead of using fixed sizes that either
// truncate long labels or leave huge empty space around short ones.
//
// Char-width / line-height numbers are tuned for draw.io's default 12px font
// and biased slightly conservative — better to add a couple pixels than have
// the rhombus diagonals cut into a "Sí" label.
const CHAR_W = 7.5;
const LINE_H = 17;

interface Size {
  width: number;
  height: number;
}

function computeSize(label: string, type: string): Size {
  const lines = label.split('\n');
  const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const rows = Math.max(1, lines.length);
  const textW = cols * CHAR_W;
  const textH = rows * LINE_H;

  switch (type) {
    case 'initialConditions':
      return clamp(textW + 28, textH + 18, 60, 32);
    case 'assignment':
      return clamp(textW + 22, textH + 14, 60, 30);
    case 'decision':
      // A rhombus inscribes a rectangle whose width/H + height/V = 1, so for
      // the text rectangle to fit comfortably we want the bounding box at
      // ~2× each dimension.
      return clamp(2 * textW + 28, 2 * textH + 18, 80, 40);
    case 'routine':
      // Hexagon eats ~28px on each side for the angled tips.
      return clamp(textW + 56, textH + 18, 80, 36);
    case 'salida':
      // Bottom wave reserves ~22% of the height visually.
      return clamp(textW + 28, textH + 28, 60, 44);
    case 'connector': {
      // Stay circular for short single-letter labels (the GOTO α/β look),
      // grow into an oval when the label is longer.
      const d = Math.max(textW, textH) + 14;
      return { width: Math.max(40, Math.ceil(d)), height: Math.max(40, Math.ceil(d)) };
    }
    case 'comment':
      return clamp(textW + 20, textH + 12, 60, 28);
    default:
      return clamp(textW + 22, textH + 14, 60, 30);
  }
}

function clamp(w: number, h: number, minW: number, minH: number): Size {
  return {
    width: Math.max(minW, Math.ceil(w)),
    height: Math.max(minH, Math.ceil(h)),
  };
}

// Normalized (0..1) anchor points on a node's bounding box.
interface Anchor {
  x: number;
  y: number;
}

const TOP: Anchor = { x: 0.5, y: 0 };
const BOTTOM: Anchor = { x: 0.5, y: 1 };
const LEFT: Anchor = { x: 0, y: 0.5 };
const RIGHT: Anchor = { x: 1, y: 0.5 };

function exitAnchor(
  source: ModelNode,
  sourceSize: Size,
  edge: ModelEdge,
  target: ModelNode | undefined,
  targetSize: Size | undefined,
): Anchor {
  if (source.type === 'decision') {
    const flipped = nodeFlipped({ data: source.data });
    if (edge.sourceHandle === 'yes') return flipped ? RIGHT : LEFT;
    if (edge.sourceHandle === 'no') return flipped ? LEFT : RIGHT;
    return BOTTOM;
  }
  if (source.type === 'connector') {
    return closestSide(source, sourceSize, target, targetSize);
  }
  return BOTTOM;
}

function entryAnchor(
  target: ModelNode,
  targetSize: Size,
  source: ModelNode | undefined,
  sourceSize: Size | undefined,
): Anchor {
  if (target.type === 'connector') {
    return closestSide(target, targetSize, source, sourceSize);
  }
  return TOP;
}

function closestSide(
  node: ModelNode,
  size: Size,
  other: ModelNode | undefined,
  otherSize: Size | undefined,
): Anchor {
  if (!other || !otherSize || !node.position || !other.position) return TOP;
  const cx = (node.position.x ?? 0) + size.width / 2;
  const cy = (node.position.y ?? 0) + size.height / 2;
  const ox = (other.position.x ?? 0) + otherSize.width / 2;
  const oy = (other.position.y ?? 0) + otherSize.height / 2;
  const dx = ox - cx;
  const dy = oy - cy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? RIGHT : LEFT;
  return dy > 0 ? BOTTOM : TOP;
}

function xmlEscape(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function toDrawioXml(model: SimulationModel): string {
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const byId = new Map(model.diagram.nodes.map((n) => [n.id, n]));
  // Pre-compute the rendered size of every node so anchor calculations and the
  // <mxGeometry> emission share the same numbers.
  const sizeById = new Map<string, Size>(
    model.diagram.nodes.map((n) => [n.id, computeSize(n.label ?? '', n.type)]),
  );

  for (const node of model.diagram.nodes) {
    const style = STYLES[node.type] ?? FALLBACK_STYLE;
    const size = sizeById.get(node.id)!;
    const x = node.position?.x ?? 0;
    const y = node.position?.y ?? 0;
    const value = xmlEscape(node.label ?? '');
    const id = xmlEscape(node.id);
    cells.push(
      `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${x}" y="${y}" width="${size.width}" height="${size.height}" as="geometry"/>` +
        `</mxCell>`,
    );
  }

  for (const edge of model.diagram.edges) {
    const id = xmlEscape(edge.id);
    const sourceId = xmlEscape(edge.source);
    const targetId = xmlEscape(edge.target);
    const value = edge.label ? xmlEscape(edge.label) : '';

    const sourceNode = byId.get(edge.source);
    const targetNode = byId.get(edge.target);
    const sourceSize = sourceNode ? sizeById.get(sourceNode.id) : undefined;
    const targetSize = targetNode ? sizeById.get(targetNode.id) : undefined;
    let style = EDGE_STYLE;
    if (sourceNode && sourceSize) {
      const a = exitAnchor(sourceNode, sourceSize, edge, targetNode, targetSize);
      style += `exitX=${a.x};exitY=${a.y};exitDx=0;exitDy=0;`;
    }
    if (targetNode && targetSize) {
      const a = entryAnchor(targetNode, targetSize, sourceNode, sourceSize);
      style += `entryX=${a.x};entryY=${a.y};entryDx=0;entryDy=0;`;
    }

    cells.push(
      `<mxCell id="${id}" value="${value}" style="${style}" edge="1" source="${sourceId}" target="${targetId}" parent="1">` +
        `<mxGeometry relative="1" as="geometry"/>` +
        `</mxCell>`,
    );
  }

  // Paper size mirrors the model's metadata.paperSize so the draw.io page
  // matches the same A4/Letter/Legal/A3/A5 the user picked in the toolbar.
  const paperKey = (model.metadata.paperSize ?? 'a4') as PaperSizeKey;
  const orientation = model.metadata.paperOrientation ?? 'portrait';
  const paper = PAPER_SIZES[paperKey];
  const pageW = orientation === 'landscape' ? paper.h : paper.w;
  const pageH = orientation === 'landscape' ? paper.w : paper.h;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}" math="0" shadow="0">\n` +
    `  <root>\n    ${cells.join('\n    ')}\n  </root>\n` +
    `</mxGraphModel>\n`
  );
}
