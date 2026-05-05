import type { NodeKind } from './nodes';

interface Props {
  kind: NodeKind;
}

const STROKE = 'currentColor';
const SW = 1.5;

// Width/height are 1.6× the original 22/14 sizing to fit the larger
// vertical-palette buttons. The viewBox is unchanged so the shape geometry
// stays identical — only the rasterized size grows.
const W = 35;
const H = 22;
const W_SQ = 22;
const H_SHORT = 19;

export function NodeIcon({ kind }: Props) {
  switch (kind) {
    case 'initialConditions':
      return (
        <svg width={W} height={H} viewBox="0 0 22 14" aria-hidden="true">
          <rect x="1" y="1" width="20" height="12" stroke={STROKE} strokeWidth={SW} fill="none" />
          <rect x="3.5" y="3.5" width="15" height="7" stroke={STROKE} strokeWidth={SW} fill="none" />
        </svg>
      );
    case 'assignment':
      return (
        <svg width={W} height={H_SHORT} viewBox="0 0 22 12" aria-hidden="true">
          <rect x="1" y="1" width="20" height="10" stroke={STROKE} strokeWidth={SW} fill="none" />
        </svg>
      );
    case 'decision':
      return (
        <svg width={W} height={H} viewBox="0 0 22 14" aria-hidden="true">
          <polygon points="11,1 21,7 11,13 1,7" stroke={STROKE} strokeWidth={SW} fill="none" />
        </svg>
      );
    case 'routine':
      return (
        <svg width={W} height={H} viewBox="0 0 22 14" aria-hidden="true">
          <polygon
            points="5,1 17,1 21,7 17,13 5,13 1,7"
            stroke={STROKE}
            strokeWidth={SW}
            fill="none"
          />
        </svg>
      );
    case 'salida':
      return (
        <svg width={W} height={H_SHORT} viewBox="0 0 22 12" aria-hidden="true">
          <path
            d="M 1,1 L 21,1 L 21,10 C 17,13 6,7 1,10 Z"
            stroke={STROKE}
            strokeWidth={SW}
            fill="none"
          />
        </svg>
      );
    case 'connector':
      return (
        <svg width={W_SQ} height={H} viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" stroke={STROKE} strokeWidth={SW} fill="none" />
        </svg>
      );
    case 'comment':
      return (
        <svg width={W} height={H_SHORT} viewBox="0 0 22 12" aria-hidden="true">
          <rect
            x="1"
            y="1"
            width="20"
            height="10"
            stroke={STROKE}
            strokeWidth={SW}
            fill="none"
            strokeDasharray="2,2"
          />
        </svg>
      );
    case 'titleBlock':
      // Heavy outer rect with two internal divider lines — title block / cartouche.
      return (
        <svg width={W} height={H} viewBox="0 0 22 14" aria-hidden="true">
          <rect x="1" y="1" width="20" height="12" stroke={STROKE} strokeWidth={2.4} fill="none" />
          <line x1="1" y1="6" x2="21" y2="6" stroke={STROKE} strokeWidth={SW} />
          <line x1="11" y1="6" x2="11" y2="13" stroke={STROKE} strokeWidth={SW} />
        </svg>
      );
    case 'loop':
      // Circle with horizontal diameter line and a vertical half-line in
      // the bottom — Iterador (for-loop) symbol.
      return (
        <svg width={W_SQ} height={H} viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" stroke={STROKE} strokeWidth={SW} fill="none" />
          <line x1="1.5" y1="7" x2="12.5" y2="7" stroke={STROKE} strokeWidth={SW} />
          <line x1="7" y1="7" x2="7" y2="12.5" stroke={STROKE} strokeWidth={SW} />
        </svg>
      );
  }
}
