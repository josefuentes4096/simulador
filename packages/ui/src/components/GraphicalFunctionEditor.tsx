import type { DynamicGraphicalFunction } from '@simulador/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  initial?: DynamicGraphicalFunction;
  onClose: () => void;
  onSave: (g: DynamicGraphicalFunction) => void;
}

const W = 480;
const H = 320;
const MARGIN = 36;

// Graphical Function editor modal — see §4.5 of the spec. The user defines
// the (x, y) ranges, picks a number of data points, and either drags on the
// canvas to draw the curve or edits the y values numerically. Continuous /
// Discrete toggle determines how the engine samples the curve at runtime.
export function GraphicalFunctionEditor({ initial, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [inputExpression, setInputExpression] = useState(initial?.inputExpression ?? '');
  const [xMin, setXMin] = useState(initial?.xMin ?? 0);
  const [xMax, setXMax] = useState(initial?.xMax ?? 10);
  const [yMin, setYMin] = useState(initial?.yMin ?? 0);
  const [yMax, setYMax] = useState(initial?.yMax ?? 10);
  const [mode, setMode] = useState<'continuous' | 'discrete'>(initial?.mode ?? 'continuous');
  const [numPoints, setNumPoints] = useState(initial?.points.length ?? 11);
  const [points, setPoints] = useState<{ x: number; y: number }[]>(() => {
    if (initial?.points && initial.points.length >= 2) return [...initial.points];
    // Seed with a flat curve at yMin.
    const n = Math.max(2, Math.min(1500, initial?.points?.length ?? 11));
    const xs: { x: number; y: number }[] = [];
    const xLo = initial?.xMin ?? 0;
    const xHi = initial?.xMax ?? 10;
    const yLo = initial?.yMin ?? 0;
    for (let i = 0; i < n; i++) {
      xs.push({ x: xLo + (xHi - xLo) * (i / (n - 1)), y: yLo });
    }
    return xs;
  });
  const draggingRef = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Re-sample point Xs whenever the count or x-range changes. Y values are
  // preserved by index when possible so the user's freshly-drawn curve
  // doesn't reset on a "Data Points" tweak.
  const ensureCount = useCallback(
    (target: number) => {
      const n = Math.max(2, Math.min(1500, target));
      setNumPoints(n);
      setPoints((prev) => {
        const ys = prev.map((p) => p.y);
        const out: { x: number; y: number }[] = [];
        for (let i = 0; i < n; i++) {
          out.push({
            x: xMin + (xMax - xMin) * (i / (n - 1)),
            y: ys[i] ?? prev[prev.length - 1]?.y ?? yMin,
          });
        }
        return out;
      });
    },
    [xMin, xMax, yMin],
  );

  const issues = useMemo(() => {
    const out: string[] = [];
    if (xMin >= xMax) out.push(t('dynamic.graphical.minLessThanMax'));
    if (yMin >= yMax) out.push(t('dynamic.graphical.minLessThanMax'));
    if (points.length < 2) out.push(t('dynamic.graphical.needTwoPoints'));
    return out;
  }, [xMin, xMax, yMin, yMax, points.length, t]);

  // Canvas → flow coords.
  const screenToData = useCallback(
    (sx: number, sy: number): { x: number; y: number } => {
      const xs = (sx - MARGIN) / (W - 2 * MARGIN);
      const ys = 1 - (sy - MARGIN) / (H - 2 * MARGIN);
      return {
        x: xMin + xs * (xMax - xMin),
        y: yMin + ys * (yMax - yMin),
      };
    },
    [xMin, xMax, yMin, yMax],
  );
  const dataToScreen = useCallback(
    (x: number, y: number): { sx: number; sy: number } => {
      const xs = (x - xMin) / (xMax - xMin || 1);
      const ys = (y - yMin) / (yMax - yMin || 1);
      return {
        sx: MARGIN + xs * (W - 2 * MARGIN),
        sy: MARGIN + (1 - ys) * (H - 2 * MARGIN),
      };
    },
    [xMin, xMax, yMin, yMax],
  );

  // Update the y of the closest x-bin under the pointer. Click+drag to draw
  // a curve like a rough scribble; the points snap to the discrete x grid.
  const dragSet = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const { x, y } = screenToData(sx, sy);
      // Find the closest point's index.
      let bestIdx = 0;
      let bestDx = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dx = Math.abs(points[i]!.x - x);
        if (dx < bestDx) {
          bestDx = dx;
          bestIdx = i;
        }
      }
      const yClamped = Math.max(yMin, Math.min(yMax, y));
      setPoints((prev) =>
        prev.map((p, i) => (i === bestIdx ? { ...p, y: yClamped } : p)),
      );
    },
    [points, screenToData, yMin, yMax],
  );

  // Path string for the polyline (continuous) or step (discrete).
  const pathD = useMemo(() => {
    if (points.length === 0) return '';
    if (mode === 'continuous') {
      return points
        .map((p, i) => {
          const { sx, sy } = dataToScreen(p.x, p.y);
          return `${i === 0 ? 'M' : 'L'} ${sx},${sy}`;
        })
        .join(' ');
    }
    // Discrete: horizontal-then-vertical step segments.
    const segs: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1];
      const A = dataToScreen(a.x, a.y);
      segs.push(`${i === 0 ? 'M' : 'L'} ${A.sx},${A.sy}`);
      if (b) {
        const B = dataToScreen(b.x, a.y);
        segs.push(`L ${B.sx},${B.sy}`);
      }
    }
    return segs.join(' ');
  }, [points, mode, dataToScreen]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 6,
          padding: 18,
          width: 600,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>{t('dynamic.graphical.title')}</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <label style={{ flex: 1 }}>
            {t('dynamic.graphical.inputExpr')}&nbsp;
            <input
              value={inputExpression}
              onChange={(e) => setInputExpression(e.target.value)}
              placeholder="TIME"
              style={{ width: '100%' }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, fontSize: 12 }}>
          <label>
            xMin&nbsp;
            <input
              type="number"
              value={xMin}
              onChange={(e) => setXMin(parseFloat(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
          <label>
            xMax&nbsp;
            <input
              type="number"
              value={xMax}
              onChange={(e) => setXMax(parseFloat(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
          <label>
            yMin&nbsp;
            <input
              type="number"
              value={yMin}
              onChange={(e) => setYMin(parseFloat(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
          <label>
            yMax&nbsp;
            <input
              type="number"
              value={yMax}
              onChange={(e) => setYMax(parseFloat(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
          <label>
            {t('dynamic.graphical.points')}&nbsp;
            <input
              type="number"
              min={2}
              max={1500}
              value={numPoints}
              onChange={(e) => ensureCount(parseInt(e.target.value, 10) || 2)}
              style={{ width: 70 }}
            />
          </label>
          <label>
            {t('dynamic.graphical.mode')}&nbsp;
            <select value={mode} onChange={(e) => setMode(e.target.value as 'continuous' | 'discrete')}>
              <option value="continuous">{t('dynamic.graphical.continuous')}</option>
              <option value="discrete">{t('dynamic.graphical.discrete')}</option>
            </select>
          </label>
        </div>

        <svg
          ref={svgRef}
          width={W}
          height={H}
          style={{ border: '1px solid #ccc', background: '#fafafa', userSelect: 'none' }}
          onPointerDown={(e) => {
            draggingRef.current = true;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            dragSet(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) dragSet(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
        >
          {/* Axes */}
          <line x1={MARGIN} y1={H - MARGIN} x2={W - MARGIN} y2={H - MARGIN} stroke="#888" />
          <line x1={MARGIN} y1={MARGIN} x2={MARGIN} y2={H - MARGIN} stroke="#888" />
          <text x={MARGIN} y={H - 6} fontSize={10}>{xMin}</text>
          <text x={W - MARGIN - 18} y={H - 6} fontSize={10}>{xMax}</text>
          <text x={4} y={H - MARGIN} fontSize={10}>{yMin}</text>
          <text x={4} y={MARGIN + 6} fontSize={10}>{yMax}</text>
          {/* Curve */}
          <path d={pathD} fill="none" stroke="#1976d2" strokeWidth={1.6} />
          {/* Points */}
          {points.map((p, i) => {
            const { sx, sy } = dataToScreen(p.x, p.y);
            return <circle key={i} cx={sx} cy={sy} r={3} fill="#1976d2" />;
          })}
        </svg>

        {/* Numeric editor — column of y values aligned with point indices. */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' }}>
          {points.map((p, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 10 }}>
              <span>{Number(p.x.toFixed(2))}</span>
              <input
                type="number"
                value={p.y}
                disabled={mode === 'discrete' && i === points.length - 1}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setPoints((prev) => prev.map((q, j) => (j === i ? { ...q, y: v } : q)));
                }}
                style={{ width: 60, fontSize: 11 }}
              />
            </div>
          ))}
        </div>

        {issues.length > 0 && (
          <ul style={{ color: '#c0392b', fontSize: 12 }}>
            {issues.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={onClose}>
            {t('dynamic.graphical.cancel')}
          </button>
          <button
            type="button"
            disabled={issues.length > 0}
            onClick={() =>
              onSave({
                ...(inputExpression && { inputExpression }),
                xMin,
                xMax,
                yMin,
                yMax,
                points: points.map((p) => ({ x: p.x, y: p.y })),
                mode,
              })
            }
          >
            {t('dynamic.graphical.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
