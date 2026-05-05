import { app, BrowserWindow } from 'electron';
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import { autoUpdater } from 'electron-updater';

// Auto-update wrapper around electron-updater. Talks to GitHub Releases via
// the `publish` block in electron-builder.yml — no extra config needed
// here. The flow is:
//
//   1) On startup we kick a single check (silent — no native dialogs).
//   2) Each transition is forwarded to the renderer over IPC so the React
//      banner can render the current state. We do NOT fall back to
//      electron-updater's default native dialogs.
//   3) When an update is downloaded, we wait for the user to click
//      "Restart and install" before calling quitAndInstall(). Otherwise we
//      keep the downloaded artifact and offer it again next launch.
//
// Disabled in dev (`!app.isPackaged`) — there's no real binary to replace
// during `npm run dev`, and the GitHub probe would just spam errors.

export type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; info: { version: string; releaseDate?: string; releaseNotes?: string | null } }
  | { phase: 'not-available'; info: { version: string } }
  | { phase: 'downloading'; progress: { percent: number; bytesPerSecond: number; transferred: number; total: number } }
  | { phase: 'downloaded'; info: { version: string; releaseDate?: string } }
  | { phase: 'error'; message: string };

let lastStatus: UpdateStatus = { phase: 'idle' };
let initialized = false;

function broadcast(status: UpdateStatus): void {
  lastStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status', status);
  }
}

export function getLastUpdateStatus(): UpdateStatus {
  return lastStatus;
}

// Wire all autoUpdater events to broadcast(). Safe to call multiple times —
// the `initialized` guard avoids duplicating listeners.
function wireListeners(): void {
  if (initialized) return;
  initialized = true;

  // We do NOT auto-download — only check, then notify. The user explicitly
  // decides when to start the download via the banner button.
  autoUpdater.autoDownload = false;
  // Do not silently relaunch; the renderer banner controls that too.
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    broadcast({ phase: 'checking' });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    broadcast({
      phase: 'available',
      info: {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes:
          typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
      },
    });
  });
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    broadcast({ phase: 'not-available', info: { version: info.version } });
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    broadcast({
      phase: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });
  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    broadcast({
      phase: 'downloaded',
      info: { version: info.version, releaseDate: info.releaseDate },
    });
  });
  autoUpdater.on('error', (err: Error) => {
    // Network errors during the periodic check are common and benign —
    // log them but don't pop a dialog.
    console.warn('[updater] error:', err.message);
    broadcast({ phase: 'error', message: err.message });
  });
}

// Single check. Returns false when running in dev or when we silently bail.
// Throws are caught and reported via broadcast('error').
export async function checkForUpdates(): Promise<boolean> {
  if (!app.isPackaged) {
    broadcast({ phase: 'idle' });
    return false;
  }
  wireListeners();
  try {
    await autoUpdater.checkForUpdates();
    return true;
  } catch (err) {
    broadcast({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

// Trigger the actual download once the user has accepted the banner.
export async function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) return;
  wireListeners();
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    broadcast({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

// Apply the downloaded update by quitting and relaunching with the new
// binary. Safe no-op when nothing has been downloaded yet.
export function quitAndInstall(): void {
  if (!app.isPackaged) return;
  if (lastStatus.phase !== 'downloaded') return;
  // `isSilent: false` lets the OS show its standard installer prompt;
  // `isForceRunAfter: true` keeps the app running after install.
  autoUpdater.quitAndInstall(false, true);
}

// Called from main.ts after app.whenReady() to schedule the first silent
// check. We delay slightly so it doesn't compete with window creation /
// catalog refresh / first paint.
export function scheduleStartupCheck(delayMs = 5000): void {
  if (!app.isPackaged) return;
  wireListeners();
  setTimeout(() => {
    void checkForUpdates();
  }, delayMs);
}
