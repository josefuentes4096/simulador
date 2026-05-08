import { useTranslation } from 'react-i18next';

interface Props {
  printTitle: string;
  setPrintTitle: (v: string) => void;
}

// Single-input panel that drives the `<h1>` of the printed first page (and
// the suggested filename for exports). Lives at the top of the sidebar so
// it's the first thing the user sees when preparing a model for print.
export function PrintTitlePanel({ printTitle, setPrintTitle }: Props) {
  const { t } = useTranslation();
  return (
    <section className="panel">
      <header className="panel__header">
        <h3>{t('printTitle.header')}</h3>
      </header>
      <input
        className="print-title__input"
        type="text"
        value={printTitle}
        onChange={(e) => setPrintTitle(e.target.value)}
        placeholder={t('printTitle.placeholder')}
        spellCheck={false}
      />
    </section>
  );
}
