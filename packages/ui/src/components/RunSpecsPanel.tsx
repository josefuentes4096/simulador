import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { DynamicRunSpecs } from '@simulador/shared';

interface Props {
  runSpecs: DynamicRunSpecs;
  setRunSpecs: Dispatch<SetStateAction<DynamicRunSpecs>>;
  onRun: () => void;
  result: {
    samples: { time: number; vars: Record<string, number> }[];
    errors: string[];
    evaluationOrder?: string[];
  } | null;
}

const TIME_UNITS = [
  'Seconds',
  'Minutes',
  'Hours',
  'Days',
  'Weeks',
  'Months',
  'Quarters',
  'Years',
  'Time',
];

const METHODS: DynamicRunSpecs['integrationMethod'][] = ['Euler', 'RK2', 'RK4'];

// Sidebar panel for the dynamic-mode run controls. Replaces the temporary
// "Run dynamic" button used during Fase 8 prototyping. Mirrors the Stella
// "Run Specs" dialog layout: From/To/DT, time unit, integration method,
// followed by the Run button and the latest run's output.
export function RunSpecsPanel({ runSpecs, setRunSpecs, onRun, result }: Props) {
  const { t } = useTranslation();
  const set = useCallback(
    <K extends keyof DynamicRunSpecs>(key: K, value: DynamicRunSpecs[K]) => {
      setRunSpecs((prev) => ({ ...prev, [key]: value }));
    },
    [setRunSpecs],
  );

  const stopLeFrom = runSpecs.stopTime <= runSpecs.startTime;
  const dtBad = runSpecs.dt <= 0;

  return (
    <section className="panel">
      <header className="panel__header">
        <h3>{t('dynamic.runSpecs.header')}</h3>
      </header>
      <label className="node-props__row">
        <span className="node-props__label">{t('dynamic.runSpecs.from')}</span>
        <input
          className="node-props__control"
          type="number"
          value={runSpecs.startTime}
          onChange={(e) => set('startTime', parseFloat(e.target.value) || 0)}
        />
      </label>
      <label className="node-props__row">
        <span className="node-props__label">{t('dynamic.runSpecs.to')}</span>
        <input
          className="node-props__control"
          type="number"
          value={runSpecs.stopTime}
          onChange={(e) => set('stopTime', parseFloat(e.target.value) || 0)}
        />
      </label>
      {stopLeFrom && (
        <p className="node-props__hint" style={{ color: '#c0392b' }}>
          {t('dynamic.runSpecs.stopMustBeGreater')}
        </p>
      )}
      <label className="node-props__row">
        <span className="node-props__label">{t('dynamic.runSpecs.dt')}</span>
        <input
          className="node-props__control"
          type="number"
          step="0.05"
          min="0.001"
          value={runSpecs.dt}
          onChange={(e) => set('dt', parseFloat(e.target.value) || 0)}
        />
      </label>
      {dtBad && (
        <p className="node-props__hint" style={{ color: '#c0392b' }}>
          {t('dynamic.runSpecs.dtMustBePositive')}
        </p>
      )}
      <label className="node-props__row">
        <span className="node-props__label">{t('dynamic.runSpecs.timeUnit')}</span>
        <select
          className="node-props__control"
          value={runSpecs.timeUnit}
          onChange={(e) => set('timeUnit', e.target.value)}
        >
          {TIME_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label className="node-props__row">
        <span className="node-props__label">{t('dynamic.runSpecs.integration')}</span>
        <select
          className="node-props__control"
          value={runSpecs.integrationMethod}
          onChange={(e) =>
            set('integrationMethod', e.target.value as DynamicRunSpecs['integrationMethod'])
          }
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={onRun}
        disabled={stopLeFrom || dtBad}
        className="panel__btn"
        style={{ marginTop: 8 }}
      >
        {t('dynamic.runSpecs.run')}
      </button>
      {result && result.errors.length > 0 && (
        <ul style={{ color: '#c0392b', fontSize: 12, marginTop: 8 }}>
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {result && result.errors.length === 0 && result.samples.length > 0 && (
        <>
          <p className="node-props__hint">
            {t('dynamic.runSpecs.samplesSummary', {
              count: result.samples.length,
              time: Number(result.samples[result.samples.length - 1]!.time.toFixed(3)),
            })}
          </p>
          <pre style={{ fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
            {JSON.stringify(
              result.samples[result.samples.length - 1]?.vars ?? {},
              null,
              2,
            )}
          </pre>
        </>
      )}
    </section>
  );
}
