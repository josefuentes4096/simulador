import type { SimulationModel } from './model';
import type { OpenedFile, ResolutionsState } from './resolution';

export const IPC = {
  ModelOpen: 'model:open',
  ModelSave: 'model:save',
  ExportPng: 'export:png',
  ExportPdf: 'export:pdf',
  ExportSvg: 'export:svg',
  ExportCsv: 'export:csv',
  ExportJson: 'export:json',
  ExportDrawio: 'export:drawio',
  ExportCpp: 'export:cpp',
  ExportJava: 'export:java',
  ExportGo: 'export:go',
  SettingsGetRepoUrl: 'settings:get-repo-url',
  SettingsSetRepoUrl: 'settings:set-repo-url',
  SettingsGetLocale: 'settings:get-locale',
  SettingsSetLocale: 'settings:set-locale',
  ResolutionsGet: 'resolutions:get',
  ResolutionsRefresh: 'resolutions:refresh',
  // Main → renderer: a menu item was selected. Single channel, payload
  // discriminated by `type`.
  MenuAction: 'menu:action',
  // Auto-update channels. The renderer fires `UpdaterCheck` /
  // `UpdaterDownload` / `UpdaterInstall` and listens to `UpdaterStatus`
  // for state transitions (idle / checking / available / downloading /
  // downloaded / error).
  UpdaterCheck: 'updater:check',
  UpdaterDownload: 'updater:download',
  UpdaterInstall: 'updater:install',
  UpdaterStatus: 'updater:status',
  UpdaterGetStatus: 'updater:get-status',
  SettingsGetAutoCheckUpdates: 'settings:get-auto-check-updates',
  SettingsSetAutoCheckUpdates: 'settings:set-auto-check-updates',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export type ExportKind = 'png' | 'pdf' | 'svg' | 'csv' | 'json' | 'drawio' | 'cpp' | 'java' | 'go';

export type MenuAction =
  | { type: 'new' }
  | { type: 'open' }
  | { type: 'open-recent'; path: string }
  | { type: 'save' }
  | { type: 'save-as' }
  | { type: 'export'; kind: ExportKind }
  | { type: 'print' }
  | { type: 'close' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'delete' }
  | { type: 'preferences' }
  | { type: 'toggle-sidebar' }
  | { type: 'toggle-chart' }
  | { type: 'about' }
  | { type: 'docs' }
  | { type: 'check-for-updates' };

// Mirrors UpdateStatus in packages/app/src/updater.ts. Lives here so the
// renderer can type-check its IPC subscriptions without importing from the
// main-process source.
export type UpdaterStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | {
      phase: 'available';
      info: { version: string; releaseDate?: string; releaseNotes?: string | null };
    }
  | { phase: 'not-available'; info: { version: string } }
  | {
      phase: 'downloading';
      progress: { percent: number; bytesPerSecond: number; transferred: number; total: number };
    }
  | { phase: 'downloaded'; info: { version: string; releaseDate?: string } }
  | { phase: 'error'; message: string };

export interface SaveResult {
  // Absolute path the file was written to, or null if the user cancelled.
  path: string | null;
  // ISO 8601 mtime of the file after the write. Used by the title block to
  // refresh its read-only fecha field without re-opening the document.
  lastModifiedAt?: string;
}

export interface SimuladorBridge {
  // When `knownPath` is provided the file is read directly (used by Open
  // Recent items). Otherwise the OS Open dialog is shown.
  openModel: (knownPath?: string) => Promise<OpenedFile | null>;
  // When `knownPath` is provided the file is overwritten silently. Otherwise
  // a Save dialog is shown. `dialogHintPath` (used only when `knownPath` is
  // omitted, e.g. Save As) seeds the dialog's starting folder and filename
  // — typically the path of the file currently open. Returns the path
  // actually written (or null when the user cancels).
  saveModel: (
    model: SimulationModel,
    knownPath?: string,
    dialogHintPath?: string,
  ) => Promise<SaveResult>;
  exportPng: (data: Uint8Array, defaultName: string) => Promise<void>;
  exportPdf: (data: Uint8Array, defaultName: string) => Promise<void>;
  exportSvg: (content: string, defaultName: string) => Promise<void>;
  exportCsv: (content: string, defaultName: string) => Promise<void>;
  exportJson: (content: string, defaultName: string) => Promise<void>;
  exportDrawio: (content: string, defaultName: string) => Promise<void>;
  exportCpp: (content: string, defaultName: string) => Promise<void>;
  exportJava: (content: string, defaultName: string) => Promise<void>;
  exportGo: (content: string, defaultName: string) => Promise<void>;
  getRepoUrl: () => Promise<string>;
  setRepoUrl: (url: string) => Promise<void>;
  getLocale: () => Promise<string>;
  setLocale: (locale: string) => Promise<void>;
  getResolutions: () => Promise<ResolutionsState>;
  refreshResolutions: () => Promise<ResolutionsState>;
  // Subscribe to native-menu actions. Returns an unsubscribe function.
  onMenuAction: (cb: (action: MenuAction) => void) => () => void;
  // Auto-update.
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  getUpdaterStatus: () => Promise<UpdaterStatus>;
  onUpdaterStatus: (cb: (status: UpdaterStatus) => void) => () => void;
  getAutoCheckUpdates: () => Promise<boolean>;
  setAutoCheckUpdates: (value: boolean) => Promise<void>;
}
