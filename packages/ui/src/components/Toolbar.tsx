import { useTranslation } from 'react-i18next';
import { PAPER_SIZES, type PaperOrientation, type PaperSizeKey } from '../printPages';

interface Props {
  onReset: () => void;
  chartOpen: boolean;
  onToggleChart: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  paperSize: PaperSizeKey;
  onPaperSizeChange: (s: PaperSizeKey) => void;
  paperOrientation: PaperOrientation;
  onPaperOrientationChange: (o: PaperOrientation) => void;
}

const PAPER_KEYS = Object.keys(PAPER_SIZES) as PaperSizeKey[];

export function Toolbar({
  onReset,
  chartOpen,
  onToggleChart,
  sidebarOpen,
  onToggleSidebar,
  paperSize,
  onPaperSizeChange,
  paperOrientation,
  onPaperOrientationChange,
}: Props) {
  const { t } = useTranslation();
  return (
    <header className="toolbar">
      <div className="toolbar__group toolbar__group--right">
        <label className="toolbar__select" title={t('toolbar.paperTitle')}>
          <span>{t('toolbar.paperLabel')}</span>
          <select
            value={paperSize}
            onChange={(e) => onPaperSizeChange(e.target.value as PaperSizeKey)}
          >
            {PAPER_KEYS.map((k) => (
              <option key={k} value={k}>
                {PAPER_SIZES[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__select" title={t('toolbar.orientationTitle')}>
          <select
            value={paperOrientation}
            onChange={(e) =>
              onPaperOrientationChange(e.target.value as PaperOrientation)
            }
          >
            <option value="portrait">{t('toolbar.orientationPortrait')}</option>
            <option value="landscape">{t('toolbar.orientationLandscape')}</option>
          </select>
        </label>
        <button
          onClick={onToggleSidebar}
          aria-pressed={sidebarOpen}
          className={sidebarOpen ? 'toolbar__chart-active' : ''}
          title={t('toolbar.togglePanelTitle')}
        >
          {t('toolbar.panel')} {sidebarOpen ? '▸' : '◂'}
        </button>
        <button
          onClick={onToggleChart}
          aria-pressed={chartOpen}
          className={chartOpen ? 'toolbar__chart-active' : ''}
          title={t('toolbar.toggleChartTitle')}
        >
          {t('toolbar.chart')} {chartOpen ? '▾' : '▸'}
        </button>
        <button onClick={onReset}>{t('toolbar.reset')}</button>
      </div>
    </header>
  );
}
