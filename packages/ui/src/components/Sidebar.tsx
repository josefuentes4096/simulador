import type { ScheduledEvent, SimulationSnapshot } from '@simulador/shared';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelState } from '../state/useModelState';
import type { ValidationIssue } from '../validation/validate';
import { DebugPanel } from './DebugPanel';
import { EventsPanel } from './EventsPanel';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { RunSpecsPanel } from './RunSpecsPanel';
import { SimulationTypePanel } from './SimulationTypePanel';
import { ValidationPanel } from './ValidationPanel';
import { VariablesPanel } from './VariablesPanel';

// Render Infinity (= the HV sentinel for empty event-tables) as the literal
// "HV" instead of letting JSON.stringify turn it into null.
function stringifyState(state: Readonly<Record<string, unknown>>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(state)) {
    // The simulator only ever stores +Infinity (HV) — negative infinity isn't
    // produced anywhere in the engine, so a single check is enough.
    const rendered =
      v === Infinity ? 'HV' : JSON.stringify(v);
    lines.push(`  "${k}": ${rendered}`);
  }
  return lines.length === 0 ? '{}' : `{\n${lines.join(',\n')}\n}`;
}

interface Props {
  model: ModelState;
  snapshot: SimulationSnapshot | null;
  error: string | null;
  log: ScheduledEvent[];
  breakpoints: Set<string>;
  setBreakpoints: Dispatch<SetStateAction<Set<string>>>;
  onRun: () => void;
  onStop: () => void;
  onStep: () => void;
  onStepOver: () => void;
  onStepOut: () => void;
  onRunNoDebug: () => void;
  onClearBreakpoints: () => void;
  onClearLog: () => void;
  isBusy: boolean;
  runBlockedReason: string | null;
  validation: ValidationIssue[];
  // Dynamic-mode handler. Fase 9 will replace this with a full RunSpecsPanel.
  onRunDynamic?: () => void;
  dynamicResult?: { samples: { time: number; vars: Record<string, number> }[]; errors: string[] } | null;
}

export function Sidebar({
  model,
  snapshot,
  error,
  log,
  breakpoints,
  setBreakpoints,
  onRun,
  onStop,
  onStep,
  onStepOver,
  onStepOut,
  onRunNoDebug,
  onClearBreakpoints,
  onClearLog,
  isBusy,
  runBlockedReason,
  validation,
  onRunDynamic,
  dynamicResult,
}: Props) {
  const { t } = useTranslation();
  return (
    <aside className="sidebar">
      <ValidationPanel issues={validation} />
      <NodePropertiesPanel
        nodes={model.simulationType === 'dynamic' ? model.dynamicNodes : model.nodes}
        setNodes={model.simulationType === 'dynamic' ? model.setDynamicNodes : model.setNodes}
        edges={model.simulationType === 'dynamic' ? model.dynamicEdges : undefined}
        setEdges={model.simulationType === 'dynamic' ? model.setDynamicEdges : undefined}
        breakpoints={breakpoints}
        setBreakpoints={setBreakpoints}
      />
      <SimulationTypePanel
        simulationType={model.simulationType}
        setSimulationType={model.setSimulationType}
      />
      <VariablesPanel variables={model.variables} setVariables={model.setVariables} />
      {/* In dynamic mode the discrete event tables and the step-by-step
          debugger don't apply — hide them so the sidebar reflects the chosen
          methodology. The variables panel stays because variables are
          shared metadata (the user may still document control variables). */}
      {model.simulationType !== 'dynamic' && (
        <>
          <EventsPanel
            simulationType={model.simulationType}
            eventTableMode={model.eventTableMode}
            setEventTableMode={model.setEventTableMode}
            variables={model.variables}
            tei={model.tei}
            setTei={model.setTei}
            deltaT={model.deltaT}
            setDeltaT={model.setDeltaT}
          />

          <DebugPanel
            nodes={model.nodes}
            breakpoints={breakpoints}
            setBreakpoints={setBreakpoints}
            log={log}
            onRun={onRun}
            onStop={onStop}
            onStep={onStep}
            onStepOver={onStepOver}
            onStepOut={onStepOut}
            onRunNoDebug={onRunNoDebug}
            onClearBreakpoints={onClearBreakpoints}
            onClearLog={onClearLog}
            isBusy={isBusy}
            runBlockedReason={runBlockedReason}
          />
        </>
      )}

      {model.simulationType === 'dynamic' && onRunDynamic && (
        <RunSpecsPanel
          runSpecs={model.dynamicRunSpecs}
          setRunSpecs={model.setDynamicRunSpecs}
          onRun={onRunDynamic}
          result={dynamicResult ?? null}
        />
      )}

      <section className="panel sidebar__results">
        <header className="panel__header">
          <h3>{t('sidebar.state')}</h3>
        </header>
        {error && <pre className="sidebar__error">{error}</pre>}
        {snapshot && (
          <dl className="snapshot">
            <dt>{t('sidebar.time')}</dt>
            <dd>{Number(snapshot.time.toFixed(3))}</dd>
            <dt>{t('sidebar.pending')}</dt>
            <dd>{snapshot.pendingEvents}</dd>
            <dt>{t('sidebar.stateVar')}</dt>
            <dd>
              <pre>{stringifyState(snapshot.state)}</pre>
            </dd>
          </dl>
        )}
        {!error && !snapshot && <p className="panel__empty">{t('sidebar.noResults')}</p>}
      </section>
    </aside>
  );
}
