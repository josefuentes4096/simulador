import type { ResolutionsState } from '@simulador/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setLocale, SUPPORTED_LOCALES, type Locale } from '../locales';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onResolutionsChanged?: (state: ResolutionsState) => void;
}

function formatTimestamp(iso: string | null, neverLabel: string): string {
  if (!iso) return neverLabel;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function SettingsModal({ open, onClose, onResolutionsChanged }: Props) {
  const { t, i18n } = useTranslation();
  const [url, setUrl] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [state, setState] = useState<ResolutionsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLocaleChange = async (next: Locale) => {
    await setLocale(next);
    // Push to main so the native menu gets rebuilt in the chosen language.
    try {
      await window.simulador.setLocale(next);
    } catch {
      // Non-fatal — UI side already updated.
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const stored = await window.simulador.getRepoUrl();
      const cached = await window.simulador.getResolutions();
      if (cancelled) return;
      setUrl(stored);
      setOriginalUrl(stored);
      setState(cached);
      setError(cached.errorMessage);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const onSaveUrl = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.simulador.setRepoUrl(url);
      setOriginalUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRefresh = async () => {
    setBusy(true);
    setError(null);
    try {
      // Save the URL first if it changed.
      if (url !== originalUrl) {
        await window.simulador.setRepoUrl(url);
        setOriginalUrl(url);
      }
      const next = await window.simulador.refreshResolutions();
      setState(next);
      setError(next.errorMessage);
      onResolutionsChanged?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('settings.title')}>
      <section className="settings-section">
        <h3>{t('settings.language')}</h3>
        <p className="settings-hint">{t('settings.languageHint')}</p>
        <div className="settings-row">
          <select
            className="settings-input"
            value={i18n.language as Locale}
            onChange={(e) => void onLocaleChange(e.target.value as Locale)}
          >
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h3>{t('settingsRepo.header')}</h3>
        <p className="settings-hint">{t('settingsRepo.hint')}</p>
        <div className="settings-row">
          <input
            className="settings-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('settingsRepo.urlPlaceholder')}
            spellCheck={false}
            disabled={busy}
          />
        </div>
        <div className="settings-row">
          <button onClick={onSaveUrl} disabled={busy || url === originalUrl}>
            {t('settingsRepo.saveUrl')}
          </button>
          <button onClick={onRefresh} disabled={busy} className="settings-primary">
            {busy ? t('settingsRepo.refreshing') : t('settingsRepo.refresh')}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>{t('settingsRepo.cacheHeader')}</h3>
        <dl className="settings-meta">
          <dt>{t('settingsRepo.lastSync')}</dt>
          <dd>{formatTimestamp(state?.lastSync ?? null, t('settingsRepo.neverSynced'))}</dd>
          <dt>{t('settingsRepo.cachedCount')}</dt>
          <dd>{state?.entries.length ?? 0}</dd>
        </dl>
        {error && <pre className="settings-error">{error}</pre>}
      </section>
    </Modal>
  );
}
