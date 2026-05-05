import type { UpdaterStatus } from '@simulador/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Floating banner shown at the bottom-right corner when an auto-update is
// available, downloading, or ready to install. Subscribes to the main
// process via `window.simulador.onUpdaterStatus`. Idle / not-available /
// checking states render nothing — the banner only appears when there's
// something the user can act on (or when the download is in progress).

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateBanner() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdaterStatus>({ phase: 'idle' });
  // Suppresses the not-available toast unless the user explicitly asked for
  // it (e.g. via Help → Check for updates). The startup check shouldn't
  // surface "you're up to date" — it's just noise.
  const [showNotAvailable, setShowNotAvailable] = useState(false);

  useEffect(() => {
    void window.simulador.getUpdaterStatus().then((s) => setStatus(s));
    const unsubscribe = window.simulador.onUpdaterStatus((s) => {
      setStatus(s);
      // The "not-available" phase is shown briefly when the user invoked
      // the check manually; the menu handler sets a flag in the window
      // and we read+clear it here.
      if (s.phase === 'not-available' && (window as unknown as { __manualUpdateCheck?: boolean }).__manualUpdateCheck) {
        setShowNotAvailable(true);
        (window as unknown as { __manualUpdateCheck?: boolean }).__manualUpdateCheck = false;
        // Auto-hide after 4 seconds.
        setTimeout(() => setShowNotAvailable(false), 4000);
      }
    });
    return unsubscribe;
  }, []);

  // Decide what to render based on phase.
  const visible =
    status.phase === 'available' ||
    status.phase === 'downloading' ||
    status.phase === 'downloaded' ||
    (status.phase === 'not-available' && showNotAvailable) ||
    status.phase === 'error';

  if (!visible) return null;

  return (
    <div className="update-banner" role="status">
      {status.phase === 'available' && (
        <>
          <div className="update-banner__title">
            {t('update.available', { version: status.info.version })}
          </div>
          <div className="update-banner__actions">
            <button
              type="button"
              className="update-banner__btn update-banner__btn--primary"
              onClick={() => void window.simulador.downloadUpdate()}
            >
              {t('update.download')}
            </button>
            <button
              type="button"
              className="update-banner__btn"
              onClick={() => setStatus({ phase: 'idle' })}
            >
              {t('update.later')}
            </button>
          </div>
        </>
      )}

      {status.phase === 'downloading' && (
        <>
          <div className="update-banner__title">
            {t('update.downloading', {
              percent: Math.round(status.progress.percent),
              transferred: formatBytes(status.progress.transferred),
              total: formatBytes(status.progress.total),
            })}
          </div>
          <div className="update-banner__progress">
            <div
              className="update-banner__progress-bar"
              style={{ width: `${Math.max(0, Math.min(100, status.progress.percent))}%` }}
            />
          </div>
        </>
      )}

      {status.phase === 'downloaded' && (
        <>
          <div className="update-banner__title">
            {t('update.downloaded', { version: status.info.version })}
          </div>
          <div className="update-banner__actions">
            <button
              type="button"
              className="update-banner__btn update-banner__btn--primary"
              onClick={() => void window.simulador.installUpdate()}
            >
              {t('update.restart')}
            </button>
            <button
              type="button"
              className="update-banner__btn"
              onClick={() => setStatus({ phase: 'idle' })}
            >
              {t('update.later')}
            </button>
          </div>
        </>
      )}

      {status.phase === 'not-available' && showNotAvailable && (
        <div className="update-banner__title">{t('update.notAvailable')}</div>
      )}

      {status.phase === 'error' && (
        <>
          <div className="update-banner__title">{t('update.error')}</div>
          <div className="update-banner__detail">{status.message}</div>
          <div className="update-banner__actions">
            <button
              type="button"
              className="update-banner__btn"
              onClick={() => setStatus({ phase: 'idle' })}
            >
              {t('update.dismiss')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
