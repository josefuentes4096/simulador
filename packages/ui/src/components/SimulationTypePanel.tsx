import { useTranslation } from 'react-i18next';
import type { SimulationType } from '@simulador/shared';

interface Props {
  simulationType: SimulationType;
  setSimulationType: (t: SimulationType) => void;
}

export function SimulationTypePanel({ simulationType, setSimulationType }: Props) {
  const { t } = useTranslation();
  return (
    <section className="panel">
      <header className="panel__header">
        <h3>{t('simulationType.header')}</h3>
      </header>
      <select
        className="simulation-type__select"
        value={simulationType}
        onChange={(e) => setSimulationType(e.target.value as SimulationType)}
      >
        <option value="event-to-event">{t('simulationType.eventToEvent')}</option>
        <option value="delta-t-constant">{t('simulationType.deltaTConstant')}</option>
        <option value="dynamic">{t('simulationType.dynamic')}</option>
      </select>
    </section>
  );
}
