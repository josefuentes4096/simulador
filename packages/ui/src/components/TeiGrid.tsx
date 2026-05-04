import { Fragment } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { EventTableMode, ModelVariable, TeiRow } from '@simulador/shared';
import { fieldRules } from '../validation/fieldRules';

interface Props {
  variables: ModelVariable[];
  tei: TeiRow[];
  setTei: Dispatch<SetStateAction<TeiRow[]>>;
  // Drives the plurality of the "Evento(s) Futuro(s)" column labels:
  // - 'independent' (TEI) → singular: "Evento Futuro No Condicionado"
  // - 'unified' (Tabla de Eventos) → plural: "Eventos Futuros No Condicionados"
  mode: EventTableMode;
}

// Picks `kind === target` from the variables list and returns just the names.
function namesOfKind(variables: ModelVariable[], target: ModelVariable['kind']): string[] {
  return variables.filter((v) => v.kind === target).map((v) => v.name);
}

export function TeiGrid({ variables, tei, setTei, mode }: Props) {
  const { t } = useTranslation();
  const plural = mode === 'unified';
  // The TEF column accepts both single TEFs and vectors of TEFs. Vectors
  // appear with an `[i]` suffix to make explicit that the row applies to
  // an arbitrary slot. Stored value is the literal string with the suffix.
  const eventTableNames = [
    ...namesOfKind(variables, 'event-table'),
    ...variables
      .filter((v) => v.kind === 'event-table-array')
      .map((v) => `${v.name}[i]`),
  ];
  const dataNames = namesOfKind(variables, 'data');
  const controlNames = namesOfKind(variables, 'control');
  // Each row's "Evento" column feeds the dropdowns for the conditioned /
  // unconditioned successors of the OTHER rows. Empty/duplicate names are
  // filtered to keep the dropdown clean.
  const eventNames = Array.from(
    new Set(tei.map((r) => r.event.trim()).filter((e) => e !== '')),
  );

  const update = (index: number, patch: Partial<TeiRow>) => {
    setTei((rows) =>
      rows.map((r, i) => {
        if (i !== index) return r;
        const next: TeiRow = { ...r, ...patch };
        // Strip optionals that were cleared so saved JSON stays minimal.
        for (const key of [
          'tef',
          'unconditionalNext',
          'conditionalNext',
          'condition',
          'chainer',
          'dimension',
        ] as const) {
          if (key in patch && (patch[key] === undefined || patch[key] === '')) {
            delete next[key];
          }
        }
        for (const key of ['regret', 'vector'] as const) {
          if (key in patch && patch[key] === false) {
            delete next[key];
          }
        }
        return next;
      }),
    );
  };

  const remove = (index: number) => {
    setTei((rows) => rows.filter((_, i) => i !== index));
  };

  const renderSelect = (
    value: string | undefined,
    onChange: (next: string) => void,
    options: string[],
    invalid = false,
  ) => (
    <select
      className={`tei-row__select ${invalid ? 'tei-row__select--invalid' : ''}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  return (
    <div className="tei-grid-wrap">
      <div className="tei-grid">
        <div className="tei-row tei-row--header">
          <span>{t('events.tei.tef')}</span>
          <span>{t('events.tei.event')}</span>
          <span
            title={t(
              plural
                ? 'events.tei.unconditionalNextFullPlural'
                : 'events.tei.unconditionalNextFull',
            )}
          >
            {t(plural ? 'events.tei.unconditionalNextPlural' : 'events.tei.unconditionalNext')}
          </span>
          <span
            title={t(
              plural
                ? 'events.tei.conditionalNextFullPlural'
                : 'events.tei.conditionalNextFull',
            )}
          >
            {t(plural ? 'events.tei.conditionalNextPlural' : 'events.tei.conditionalNext')}
          </span>
          <span>{t('events.tei.condition')}</span>
          <span>{t('events.tei.chainer')}</span>
          <span title={t('events.tei.regretFull')}>{t('events.tei.regret')}</span>
          <span>{t('events.tei.vector')}</span>
          <span>{t('events.tei.dimension')}</span>
          <span aria-hidden="true" />
        </div>
        {tei.map((row, i) => (
          <Fragment key={i}>
            <div className="tei-row">
              {renderSelect(row.tef, (v) => update(i, { tef: v }), eventTableNames)}
              <input
                className="tei-row__input"
                value={row.event}
                onChange={(e) => update(i, { event: e.target.value })}
                placeholder={t('events.tei.eventPlaceholder')}
                spellCheck={false}
              />
              {renderSelect(
                row.unconditionalNext,
                (v) => update(i, { unconditionalNext: v }),
                eventNames,
                fieldRules.teiUnconditionalNextInvalid(row),
              )}
              {renderSelect(
                row.conditionalNext,
                (v) => update(i, { conditionalNext: v }),
                eventNames,
              )}
              <input
                className="tei-row__input tei-row__input--code"
                value={row.condition ?? ''}
                onChange={(e) => update(i, { condition: e.target.value })}
                placeholder="x > 0"
                spellCheck={false}
              />
              {renderSelect(row.chainer, (v) => update(i, { chainer: v }), dataNames)}
              <input
                className="tei-row__check"
                type="checkbox"
                checked={!!row.regret}
                onChange={(e) => update(i, { regret: e.target.checked })}
                aria-label={t('events.tei.regret')}
              />
              <input
                className="tei-row__check"
                type="checkbox"
                checked={!!row.vector}
                onChange={(e) => update(i, { vector: e.target.checked })}
                aria-label={t('events.tei.vector')}
              />
              {renderSelect(row.dimension, (v) => update(i, { dimension: v }), controlNames)}
              <button
                className="tei-row__delete"
                onClick={() => remove(i)}
                aria-label={t('events.tei.deleteAria')}
                title={t('events.tei.deleteAria')}
              >
                ×
              </button>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
