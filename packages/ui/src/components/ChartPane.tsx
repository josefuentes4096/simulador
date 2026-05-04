import type { ModelVariable, TraceSample } from '@simulador/shared';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const COLORS = ['#0a84ff', '#ff9f0a', '#30d158', '#ff375f', '#bf5af2', '#5e5ce6', '#ffd60a'];
const MAX_RENDER_POINTS = 2000;

interface Props {
  trace: TraceSample[];
  variables: ModelVariable[];
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
}

interface ChartRow {
  time: number;
  [key: string]: number | null;
}

function downsample<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  const stride = Math.ceil(items.length / cap);
  const out: T[] = [];
  for (let i = 0; i < items.length; i += stride) out.push(items[i]!);
  if (out[out.length - 1] !== items[items.length - 1]) out.push(items[items.length - 1]!);
  return out;
}

export function ChartPane({ trace, variables, selected, setSelected }: Props) {
  const { t } = useTranslation();
  // Only numeric variables can be charted; let user pick from those.
  const numericVarNames = useMemo(() => {
    const sampled = trace[trace.length - 1]?.state ?? {};
    return variables
      .filter((v) => {
        if (typeof v.initialValue === 'number') return true;
        const liveValue = sampled[v.name];
        return typeof liveValue === 'number';
      })
      .map((v) => v.name);
  }, [trace, variables]);

  const toggle = useCallback(
    (name: string) => {
      setSelected((cur) => {
        const next = new Set(cur);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    },
    [setSelected],
  );

  const data = useMemo<ChartRow[]>(() => {
    const sampled = downsample(trace, MAX_RENDER_POINTS);
    return sampled.map((s) => {
      const row: ChartRow = { time: s.time };
      for (const name of selected) {
        const value = s.state[name];
        row[name] = typeof value === 'number' ? value : null;
      }
      return row;
    });
  }, [trace, selected]);

  const visibleSeries = useMemo(
    () => Array.from(selected).filter((n) => numericVarNames.includes(n)),
    [numericVarNames, selected],
  );

  return (
    <section className="chart-pane">
      <aside className="chart-pane__legend">
        <h4>{t('chart.series')}</h4>
        {numericVarNames.length === 0 && (
          <p className="panel__empty">
            {trace.length === 0
              ? t('chart.runToPopulate')
              : t('chart.noNumericVars')}
          </p>
        )}
        <ul>
          {numericVarNames.map((name, i) => (
            <li key={name}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(name)}
                  onChange={() => toggle(name)}
                />
                <span
                  className="chart-pane__swatch"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                <code>{name}</code>
              </label>
            </li>
          ))}
        </ul>
        <p className="chart-pane__hint">
          {trace.length > MAX_RENDER_POINTS
            ? t('chart.samplesDownsampled', { count: trace.length, max: MAX_RENDER_POINTS })
            : t('chart.samples', { count: trace.length })}
        </p>
      </aside>

      <div className="chart-pane__chart">
        {visibleSeries.length === 0 || trace.length === 0 ? (
          <div className="chart-pane__placeholder">
            {trace.length === 0
              ? t('chart.placeholderEmpty')
              : t('chart.placeholderPickVar')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
              <XAxis
                dataKey="time"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t: number) => Number(t.toFixed(2)).toString()}
              />
              <YAxis />
              <Tooltip
                labelFormatter={(t: number) => `t=${Number(t.toFixed(3))}`}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {visibleSeries.map((name) => {
                const idx = numericVarNames.indexOf(name);
                return (
                  <Line
                    key={name}
                    type="stepAfter"
                    dataKey={name}
                    stroke={COLORS[idx % COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
