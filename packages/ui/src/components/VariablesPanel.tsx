import type { Dispatch, SetStateAction } from 'react';
import { Fragment, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelVariable, VariableKind } from '@simulador/shared';
import { DiagramAnalysisContext } from '../state/diagramAnalysisContext';
import { fieldRules } from '../validation/fieldRules';

interface Props {
  variables: ModelVariable[];
  setVariables: Dispatch<SetStateAction<ModelVariable[]>>;
}

const KINDS: VariableKind[] = ['state', 'result', 'control', 'data', 'array', 'event-table', 'event-table-array'];

// Sort order for "Ordenar por tipo": Datos first (generated each step),
// Control next (fixed parameters), then Estado (mutable internals), then
// Resultado (output metrics), and finally Tabla de eventos isolated below
// a double separator since it's the only non-scalar kind.
const SORT_KIND_ORDER: VariableKind[] = ['data', 'control', 'state', 'result', 'array', 'event-table', 'event-table-array'];

function parseInitialValue(raw: string, kind: VariableKind): ModelVariable['initialValue'] {
  if (raw === '') return undefined;
  if (kind === 'event-table-array') {
    // Outer-array length only — inner TEFs always start empty.
    const n = Number(raw.trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  }
  if (kind === 'array') {
    // Two accepted forms: a JSON array (`[0, 1, 2]`) or a length number (`3`).
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'number')) {
          return parsed;
        }
      } catch {
        // Fall through — treat as a malformed array literal, drop the value.
      }
      return undefined;
    }
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== '') return n;
  return raw;
}

function formatInitialValue(v: ModelVariable['initialValue']): string {
  if (v === undefined) return '';
  if (Array.isArray(v)) return JSON.stringify(v);
  return String(v);
}

export function VariablesPanel({ variables, setVariables }: Props) {
  const { t } = useTranslation();
  const analysis = useContext(DiagramAnalysisContext);
  const onAdd = useCallback(() => {
    setVariables((vs) => [
      ...vs,
      { name: `var${vs.length + 1}`, kind: 'state', initialValue: 0 },
    ]);
  }, [setVariables]);

  const onUpdate = useCallback(
    (index: number, patch: Partial<ModelVariable>) => {
      setVariables((vs) =>
        vs.map((v, i) => {
          if (i !== index) return v;
          let next: ModelVariable = { ...v, ...patch };
          if (patch.initialValue === undefined && 'initialValue' in patch) {
            const { initialValue: _drop, ...rest } = next;
            next = rest;
          }
          if ('description' in patch && (patch.description === undefined || patch.description === '')) {
            const { description: _drop, ...rest } = next;
            next = rest;
          }
          // Variables of kind 'data' are generated at runtime — drop any
          // initialValue when switching to that kind so the saved JSON stays
          // clean and the input doesn't display a stale value.
          if (next.kind === 'data' && next.initialValue !== undefined) {
            const { initialValue: _drop, ...rest } = next;
            next = rest;
          }
          return next;
        }),
      );
    },
    [setVariables],
  );

  const onDelete = useCallback(
    (index: number) => {
      setVariables((vs) => vs.filter((_, i) => i !== index));
    },
    [setVariables],
  );

  const onSortByKind = useCallback(() => {
    setVariables((vs) =>
      [...vs].sort((a, b) => {
        const ka = SORT_KIND_ORDER.indexOf(a.kind);
        const kb = SORT_KIND_ORDER.indexOf(b.kind);
        if (ka !== kb) return ka - kb;
        return a.name.localeCompare(b.name);
      }),
    );
  }, [setVariables]);

  return (
    <section className="panel">
      <header className="panel__header">
        <h3>{t('variables.header')}</h3>
        <div className="panel__actions">
          <button
            className="panel__action"
            onClick={onSortByKind}
            disabled={variables.length < 2}
            title={t('variables.sortByKindTitle')}
          >
            {t('variables.sortByKind')}
          </button>
          <button className="panel__add" onClick={onAdd} aria-label={t('variables.addAria')}>
            +
          </button>
        </div>
      </header>
      {variables.length === 0 && <p className="panel__empty">{t('variables.empty')}</p>}
      {variables.length > 0 && (
        // Single grid container so column widths are shared between the
        // header row and every data row. Each row uses `display: contents`
        // so its children become direct children of `.var-grid` and align
        // to the same column tracks.
        <div className="var-grid">
          <div className="var-row var-row--header">
            <span>{t('variables.colName')}</span>
            <span>{t('variables.colKind')}</span>
            <span>{t('variables.colInit')}</span>
            <span>{t('variables.colDescription')}</span>
            <span aria-hidden="true" />
          </div>
          {variables.map((v, i) => {
            const prev = i > 0 ? variables[i - 1] : null;
            // Double-line section header introduces the event-table group
            // (rendered when the previous row is non-event-table and this row
            // is event-table — i.e. crossing the boundary).
            const showSectionHeader =
              v.kind === 'event-table' && prev !== null && prev.kind !== 'event-table';
            return (
              <Fragment key={i}>
                {showSectionHeader && (
                  <div className="var-grid__section-header">
                    {t('variables.tefSectionHeader')}
                  </div>
                )}
                <div className="var-row">
                  <input
                    className={`var-row__name ${fieldRules.variableUnused(v, analysis) ? 'var-row__name--unused' : ''}`}
                    value={v.name}
                    onChange={(e) => onUpdate(i, { name: e.target.value })}
                    placeholder={t('variables.namePlaceholder')}
                    spellCheck={false}
                    title={fieldRules.variableUnused(v, analysis) ? t('variables.unusedHint') : undefined}
                  />
                  <select
                    className={`var-row__kind badge--${v.kind}`}
                    value={v.kind}
                    onChange={(e) => onUpdate(i, { kind: e.target.value as VariableKind })}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`variables.kindLabel.${k}`)}
                      </option>
                    ))}
                  </select>
                  <input
                    className="var-row__init"
                    value={v.kind === 'data' ? '' : formatInitialValue(v.initialValue)}
                    onChange={(e) =>
                      onUpdate(i, { initialValue: parseInitialValue(e.target.value, v.kind) })
                    }
                    placeholder={
                      v.kind === 'data'
                        ? '—'
                        : v.kind === 'array'
                          ? t('variables.arrayInitPlaceholder')
                          : t('variables.initPlaceholder')
                    }
                    spellCheck={false}
                    disabled={v.kind === 'data'}
                    title={
                      v.kind === 'data'
                        ? t('variables.dataNoInitHint')
                        : v.kind === 'array'
                          ? t('variables.arrayInitHint')
                          : undefined
                    }
                  />
                  <input
                    className="var-row__desc"
                    value={v.description ?? ''}
                    onChange={(e) => onUpdate(i, { description: e.target.value })}
                    placeholder={t('variables.descriptionPlaceholder')}
                  />
                  <button
                    className="var-row__delete"
                    onClick={() => onDelete(i)}
                    aria-label={t('variables.deleteAria')}
                    title={t('variables.deleteTitle')}
                  >
                    ×
                  </button>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </section>
  );
}
