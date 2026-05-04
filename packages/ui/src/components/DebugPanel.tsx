import type { ScheduledEvent } from '@simulador/shared';
import type { Node } from '@xyflow/react';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  nodes: Node[];
  breakpoints: Set<string>;
  setBreakpoints: Dispatch<SetStateAction<Set<string>>>;
  log: ScheduledEvent[];
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
}

function getLabel(node: Node): string {
  const data = node.data as { label?: unknown } | undefined;
  return typeof data?.label === 'string' ? data.label : '';
}

// === Visual Studio-style debug icons =================================
// All 16x16 viewBox. `currentColor` for icons that follow text color; Run is
// pinned to green and Stop to red because that's the universally recognised
// VS / IDE convention and the cue users expect to find.

const VS_GREEN = '#2ea043';
const VS_RED = '#d73a49';

const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 1.6,
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function ContinueIcon() {
  // Filled green play triangle — F5 Continue.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <polygon points="4,3 13,8 4,13" fill={VS_GREEN} />
    </svg>
  );
}

function StopIcon() {
  // Filled red square — Shift+F5 Stop.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="9" rx="0.5" fill={VS_RED} />
    </svg>
  );
}

function RunNoDebugIcon() {
  // Hollow play — Ctrl+F5 Start without debugging. Same shape as Continue
  // but no fill so the eye reads it as the "lighter" of the two.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <polygon points="4,3 13,8 4,13" {...STROKE} />
    </svg>
  );
}

function StepIntoIcon() {
  // Down-arrow into a small dot — F11 Step Into.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M 8 2 V 9 M 5 6 L 8 9 L 11 6" {...STROKE} />
      <circle cx="8" cy="13" r="1.5" fill="currentColor" />
    </svg>
  );
}

function StepOverIcon() {
  // Curved arc that arches over a dot, with arrow descending on the right —
  // F10 Step Over the function call.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M 2.5 11 C 2.5 4 13.5 4 13.5 11" {...STROKE} />
      <path d="M 10.5 8 L 13.5 11 L 16.5 8" {...STROKE} />
      <circle cx="2.5" cy="13" r="1.5" fill="currentColor" />
    </svg>
  );
}

function StepOutIcon() {
  // Up-arrow leaving a small dot — Shift+F11 Step Out.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="13" r="1.5" fill="currentColor" />
      <path d="M 8 11 V 4 M 5 7 L 8 4 L 11 7" {...STROKE} />
    </svg>
  );
}

function ClearBreakpointsIcon() {
  // Filled circle (the breakpoint glyph) crossed with a slash — Ctrl+Shift+F9.
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" fill={VS_RED} />
      <line
        x1="3.5"
        y1="12.5"
        x2="12.5"
        y2="3.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DebugPanel({
  nodes,
  breakpoints,
  setBreakpoints,
  log,
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
}: Props) {
  const { t } = useTranslation();
  const remove = useCallback(
    (id: string) => {
      setBreakpoints((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
    },
    [setBreakpoints],
  );

  const bpRows = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return Array.from(breakpoints).map((id) => {
      const n = byId.get(id);
      const label = n
        ? getLabel(n).trim() || `(${n.type ?? t('debug.fallbackNode')})`
        : t('debug.deletedNode');
      return { id, label };
    });
  }, [breakpoints, nodes, t]);

  const reversed = log.slice().reverse();
  const nodeTypeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) if (n.type) m.set(n.id, n.type);
    return m;
  }, [nodes]);

  return (
    <section className="panel">
      <header className="panel__header">
        <h3>{t('debug.header')}</h3>
      </header>

      <div className="debug-icon-row">
        <button
          type="button"
          className="debug-icon-btn"
          onClick={onRun}
          disabled={isBusy || runBlockedReason !== null}
          title={runBlockedReason ?? t('debug.runTitle')}
          aria-label={t('debug.run')}
        >
          <ContinueIcon />
        </button>
        <button
          type="button"
          className="debug-icon-btn"
          onClick={onRunNoDebug}
          disabled={isBusy || runBlockedReason !== null}
          title={t('debug.runNoDebugTitle')}
          aria-label={t('debug.runNoDebug')}
        >
          <RunNoDebugIcon />
        </button>
        <button
          type="button"
          className="debug-icon-btn"
          onClick={onStop}
          title={t('debug.stopTitle')}
          aria-label={t('debug.stop')}
        >
          <StopIcon />
        </button>
        <span className="debug-icon-row__sep" aria-hidden="true" />
        <button
          type="button"
          className="debug-icon-btn"
          onClick={onStepOver}
          disabled={isBusy}
          title={t('debug.stepOverTitle')}
          aria-label={t('debug.stepOver')}
        >
          <StepOverIcon />
        </button>
        <button
          type="button"
          className="debug-icon-btn"
          onClick={onStep}
          disabled={isBusy}
          title={t('debug.stepIntoTitle')}
          aria-label={t('debug.stepInto')}
        >
          <StepIntoIcon />
        </button>
        <button
          type="button"
          className="debug-icon-btn"
          onClick={onStepOut}
          disabled={isBusy}
          title={t('debug.stepOutTitle')}
          aria-label={t('debug.stepOut')}
        >
          <StepOutIcon />
        </button>
      </div>

      <div className="debug-block">
        <h4>
          {t('debug.breakpointsTitle', { count: bpRows.length })}
          {bpRows.length > 0 && (
            <button
              type="button"
              className="debug-icon-btn debug-icon-btn--inline"
              onClick={onClearBreakpoints}
              title={t('debug.clearBreakpointsTitle')}
              aria-label={t('debug.clearBreakpoints')}
            >
              <ClearBreakpointsIcon />
            </button>
          )}
        </h4>
        {bpRows.length === 0 ? (
          <p className="panel__empty">{t('debug.breakpointsHint')}</p>
        ) : (
          <ul className="bp-list">
            {bpRows.map((row) => (
              <li key={row.id}>
                <code>{row.label}</code>
                <button
                  className="link-button"
                  onClick={() => remove(row.id)}
                  title={t('debug.removeBreakpointTitle')}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="debug-block">
        <h4>
          {t('debug.logTitle', { count: log.length })}
          {log.length > 0 && (
            <button className="link-button" onClick={onClearLog}>
              {t('debug.logClear')}
            </button>
          )}
        </h4>
        {log.length === 0 ? (
          <p className="panel__empty">{t('debug.logEmpty')}</p>
        ) : (
          <ol className="log-list">
            {reversed.map((e, i) => {
              const nodeId =
                typeof e.payload === 'object' && e.payload !== null && 'nodeId' in e.payload
                  ? String((e.payload as { nodeId: unknown }).nodeId)
                  : undefined;
              const isSalida = nodeId !== undefined && nodeTypeById.get(nodeId) === 'salida';
              const isBp = nodeId !== undefined && breakpoints.has(nodeId);
              const cls = [
                isBp ? 'log-list__bp' : '',
                isSalida ? 'log-list__salida' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <li key={`${e.seq}-${i}`} className={cls || undefined}>
                  <span className="log-time">#{e.seq}</span>
                  <code>{e.name}</code>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
