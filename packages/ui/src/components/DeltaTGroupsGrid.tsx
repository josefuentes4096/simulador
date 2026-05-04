import { Fragment } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeltaTRow, ModelVariable } from '@simulador/shared';

interface Props {
  variables: ModelVariable[];
  deltaT: DeltaTRow[];
  setDeltaT: Dispatch<SetStateAction<DeltaTRow[]>>;
}

type StringField = 'tef' | 'propios' | 'prevCommitted' | 'futureCommitted';

export function DeltaTGroupsGrid({ variables, deltaT, setDeltaT }: Props) {
  const { t } = useTranslation();
  const eventTableNames = variables
    .filter((v) => v.kind === 'event-table')
    .map((v) => v.name);

  const update = (index: number, field: StringField, value: string) => {
    setDeltaT((rows) =>
      rows.map((r, i) => {
        if (i !== index) return r;
        const next: DeltaTRow = { ...r };
        if (value === '') delete next[field];
        else next[field] = value;
        return next;
      }),
    );
  };

  const remove = (index: number) => {
    setDeltaT((rows) => rows.filter((_, i) => i !== index));
  };

  return (
    <div className="delta-t-grid">
      <div className="delta-t-row delta-t-row--header">
        <span>{t('events.deltaT.tef')}</span>
        <span>{t('events.deltaT.propios')}</span>
        <span>{t('events.deltaT.prevCommitted')}</span>
        <span>{t('events.deltaT.futureCommitted')}</span>
        <span aria-hidden="true" />
      </div>
      {deltaT.map((row, i) => (
        <Fragment key={i}>
          <div className="delta-t-row">
            <select
              className="delta-t-row__select"
              value={row.tef ?? ''}
              onChange={(e) => update(i, 'tef', e.target.value)}
            >
              <option value="">—</option>
              {eventTableNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <input
              className="delta-t-row__input"
              value={row.propios ?? ''}
              onChange={(e) => update(i, 'propios', e.target.value)}
              placeholder={t('events.deltaT.placeholder')}
              spellCheck={false}
            />
            <input
              className="delta-t-row__input"
              value={row.prevCommitted ?? ''}
              onChange={(e) => update(i, 'prevCommitted', e.target.value)}
              placeholder={t('events.deltaT.placeholder')}
              spellCheck={false}
            />
            <input
              className="delta-t-row__input"
              value={row.futureCommitted ?? ''}
              onChange={(e) => update(i, 'futureCommitted', e.target.value)}
              placeholder={t('events.deltaT.placeholder')}
              spellCheck={false}
            />
            <button
              className="delta-t-row__delete"
              onClick={() => remove(i)}
              aria-label={t('events.deltaT.deleteAria')}
              title={t('events.deltaT.deleteAria')}
            >
              ×
            </button>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
