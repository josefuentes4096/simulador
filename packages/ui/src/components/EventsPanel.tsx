import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DeltaTRow,
  EventTableMode,
  ModelVariable,
  SimulationType,
  TeiRow,
} from '@simulador/shared';
import { DeltaTGroupsGrid } from './DeltaTGroupsGrid';
import { TeiGrid } from './TeiGrid';

interface Props {
  simulationType: SimulationType;
  eventTableMode: EventTableMode;
  setEventTableMode: (m: EventTableMode) => void;
  variables: ModelVariable[];
  tei: TeiRow[];
  setTei: Dispatch<SetStateAction<TeiRow[]>>;
  deltaT: DeltaTRow[];
  setDeltaT: Dispatch<SetStateAction<DeltaTRow[]>>;
}

export function EventsPanel({
  simulationType,
  eventTableMode,
  setEventTableMode,
  variables,
  tei,
  setTei,
  deltaT,
  setDeltaT,
}: Props) {
  const { t } = useTranslation();
  const showEaeCombo = simulationType === 'event-to-event';

  const onAddTeiRow = useCallback(() => {
    setTei((rows) => [...rows, { event: `Evt${rows.length + 1}` }]);
  }, [setTei]);

  const onAddDeltaTRow = useCallback(() => {
    setDeltaT((rows) => [...rows, {}]);
  }, [setDeltaT]);

  // `+` button adds a row to whichever grid is currently visible. Both grids
  // are conceptually "Tabla de Eventos" — the EaE one shows event definitions
  // (with TEF, condición, etc.), the Δt one shows TEFs with their bucket of
  // events per Δt window.
  const onAdd = showEaeCombo ? onAddTeiRow : onAddDeltaTRow;
  const addAriaKey = showEaeCombo ? 'events.tei.addAria' : 'events.deltaT.addAria';

  return (
    <section className="panel">
      <header className="panel__header">
        <h3>{t('events.header')}</h3>
        <button className="panel__add" onClick={onAdd} aria-label={t(addAriaKey)}>
          +
        </button>
      </header>
      {showEaeCombo ? (
        <>
          <select
            className="simulation-type__select"
            value={eventTableMode}
            onChange={(e) => setEventTableMode(e.target.value as EventTableMode)}
          >
            <option value="unified">{t('events.unified')}</option>
            <option value="independent">{t('events.independent')}</option>
          </select>
          <TeiGrid variables={variables} tei={tei} setTei={setTei} mode={eventTableMode} />
        </>
      ) : (
        <DeltaTGroupsGrid variables={variables} deltaT={deltaT} setDeltaT={setDeltaT} />
      )}
    </section>
  );
}
