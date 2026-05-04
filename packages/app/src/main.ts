import { app, BrowserWindow, Menu, dialog, ipcMain, shell, type MenuItemConstructorOptions } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  IPC,
  type ExportKind,
  type MenuAction,
  type OpenedFile,
  type ResolutionFile,
  type ResolutionsState,
  type SaveResult,
  type SimulationModel,
} from '@simulador/shared';
import { getResolutionsState, refreshResolutions } from './exercises';
import {
  addRecentFile,
  clearRecentFiles,
  getRecentFiles,
  getRepoUrl,
  setRepoUrl,
  getLocale as getSavedLocale,
  setLocale as setSavedLocale,
} from './settings';
import { setMainLocale, strings, tFormat, type MainLocale } from './i18n';

const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;
let lastOpenDir: string | undefined;
// In-memory cache of the MRU list. Synced with settings.json via the recent
// helpers; rebuilds the application menu whenever it changes.
let recentFiles: string[] = [];

async function rememberRecent(filePath: string): Promise<void> {
  recentFiles = await addRecentFile(filePath);
  Menu.setApplicationMenu(buildAppMenu());
}

// Where the bundled example .json files live. Used as the initial folder for
// the Open dialog so first-time users find them without manual navigation.
const BUNDLED_EXAMPLES_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'examples')
  : path.join(__dirname, '../../../example-resolutions');

function createWindow(): void {
  // Window/taskbar icon. In dev, dist/ sits at packages/app/dist and the icon
  // lives at packages/app/build/icon.png. In packaged builds electron-builder
  // copies the icon into <resources>/build/icon.png (we include it via
  // extraResources). For Windows binaries we'd need a proper .ico for the
  // installer; the PNG here drives the runtime BrowserWindow icon.
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon.png')
    : path.join(__dirname, '..', 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // electron-builder.yml copies packages/ui/dist/* to <resources>/ui/* (the
    // `to: ui` mapping in extraResources strips the `dist` segment), so in
    // packaged builds index.html is at <resources>/ui/index.html.
    // __dirname here is <resources>/app.asar/dist, hence the two `..` levels.
    void mainWindow.loadFile(path.join(__dirname, '../../ui/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle(
    IPC.ModelOpen,
    async (_evt, knownPath?: string): Promise<OpenedFile | null> => {
      if (!mainWindow) return null;
      let filePath = knownPath;
      if (!filePath) {
        const result = await dialog.showOpenDialog(mainWindow, {
          defaultPath: lastOpenDir ?? BUNDLED_EXAMPLES_DIR,
          filters: [{ name: 'Simulation Model', extensions: ['json'] }],
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        filePath = result.filePaths[0]!;
      }
      lastOpenDir = path.dirname(filePath);
      let raw: string;
      let lastModifiedAt: string | undefined;
      try {
        raw = await fs.readFile(filePath, 'utf8');
        const st = await fs.stat(filePath);
        lastModifiedAt = st.mtime.toISOString();
      } catch (err) {
        // Stale entry in the MRU (file moved/deleted) → clean up so it stops
        // appearing in Open Recent.
        if (knownPath) {
          recentFiles = recentFiles.filter((p) => p !== knownPath);
          Menu.setApplicationMenu(buildAppMenu());
        }
        throw err;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(tFormat(strings().errors.invalidJson, { detail }));
      }

      // Two valid file shapes:
      //   1. Bare SimulationModel:    { schemaVersion, metadata, behavior, diagram }
      //   2. Resolution envelope:     { label, creator, ..., model: SimulationModel }
      // Unwrap (2) and surface the envelope metadata so the UI can show it.
      let opened: OpenedFile;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'model' in parsed &&
        typeof (parsed as { model: unknown }).model === 'object' &&
        (parsed as { model: unknown }).model !== null &&
        'schemaVersion' in (parsed as { model: object }).model
      ) {
        const env = parsed as ResolutionFile;
        const { model: simModel, ...meta } = env;
        validateModel(simModel, filePath);
        opened = { model: simModel, meta, path: filePath, lastModifiedAt };
      } else {
        const simModel = parsed as SimulationModel;
        validateModel(simModel, filePath);
        opened = { model: simModel, path: filePath, lastModifiedAt };
      }
      void rememberRecent(filePath);
      return opened;
    },
  );

  ipcMain.handle(
    IPC.ModelSave,
    async (_evt, model: SimulationModel, knownPath?: string): Promise<SaveResult> => {
      if (!mainWindow) return { path: null };
      let target: string | null = knownPath ?? null;
      if (!target) {
        const result = await dialog.showSaveDialog(mainWindow, {
          filters: [{ name: 'Simulation Model', extensions: ['json'] }],
          defaultPath: `${model.metadata.name}.json`,
        });
        if (result.canceled || !result.filePath) return { path: null };
        target = result.filePath;
      }
      await fs.writeFile(target, JSON.stringify(model, null, 2), 'utf8');
      const st = await fs.stat(target);
      void rememberRecent(target);
      return { path: target, lastModifiedAt: st.mtime.toISOString() };
    },
  );

  registerExport(IPC.ExportPng, 'PNG image', 'png', true);
  registerExport(IPC.ExportPdf, 'PDF document', 'pdf', true);
  registerExport(IPC.ExportSvg, 'SVG image', 'svg', false);
  registerExport(IPC.ExportCsv, 'CSV', 'csv', false);
  registerExport(IPC.ExportJson, 'JSON', 'json', false);
  registerExport(IPC.ExportDrawio, 'draw.io diagram', 'drawio', false);
  registerExport(IPC.ExportCpp, 'C++ source', 'cpp', false);
  registerExport(IPC.ExportJava, 'Java source', 'java', false);
  registerExport(IPC.ExportGo, 'Go source', 'go', false);

  ipcMain.handle(IPC.SettingsGetRepoUrl, (): Promise<string> => getRepoUrl());
  ipcMain.handle(IPC.SettingsSetRepoUrl, (_evt, url: string): Promise<void> => setRepoUrl(url));
  ipcMain.handle(IPC.SettingsGetLocale, (): Promise<string> => getSavedLocale());
  ipcMain.handle(IPC.SettingsSetLocale, async (_evt, locale: string): Promise<void> => {
    setMainLocale(locale as MainLocale);
    await setSavedLocale(locale);
    Menu.setApplicationMenu(buildAppMenu());
  });
  ipcMain.handle(IPC.ResolutionsGet, (): Promise<ResolutionsState> => getResolutionsState());
  ipcMain.handle(IPC.ResolutionsRefresh, (): Promise<ResolutionsState> => refreshResolutions());
}

// Cheap structural validation at the IPC boundary. Catches obvious schema
// drift (wrong version, missing top-level sections) so a malformed file
// fails with a clear message instead of bombing later in the renderer.
const SUPPORTED_SCHEMA_VERSION = 2;
function validateModel(m: unknown, filePath: string): asserts m is SimulationModel {
  const file = path.basename(filePath);
  const E = strings().errors;
  if (typeof m !== 'object' || m === null) {
    throw new Error(tFormat(E.invalidStructure, { file }));
  }
  const obj = m as Record<string, unknown>;
  if (obj.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      tFormat(E.unsupportedSchema, {
        file,
        version: String(obj.schemaVersion),
        expected: SUPPORTED_SCHEMA_VERSION,
      }),
    );
  }
  if (typeof obj.metadata !== 'object' || obj.metadata === null) {
    throw new Error(tFormat(E.missingMetadata, { file }));
  }
  if (typeof obj.behavior !== 'object' || obj.behavior === null) {
    throw new Error(tFormat(E.missingBehavior, { file }));
  }
  if (typeof obj.diagram !== 'object' || obj.diagram === null) {
    throw new Error(tFormat(E.missingDiagram, { file }));
  }
}

function registerExport(
  channel: string,
  filterName: string,
  ext: string,
  binary: boolean,
): void {
  ipcMain.handle(
    channel,
    async (_evt, content: string | Uint8Array, defaultName: string) => {
      if (!mainWindow) return;
      const result = await dialog.showSaveDialog(mainWindow, {
        filters: [{ name: filterName, extensions: [ext] }],
        defaultPath: defaultName,
      });
      if (result.canceled || !result.filePath) return;
      if (binary) {
        await fs.writeFile(result.filePath, Buffer.from(content as Uint8Array));
      } else {
        await fs.writeFile(result.filePath, content as string, 'utf8');
      }
    },
  );
}

function sendMenuAction(action: MenuAction): void {
  mainWindow?.webContents.send(IPC.MenuAction, action);
}

function buildAppMenu(): Menu {
  const M = strings().menu;
  const exportMenuItem = (label: string, kind: ExportKind): MenuItemConstructorOptions => ({
    label,
    click: () => sendMenuAction({ type: 'export', kind }),
  });

  const recentSubmenu: MenuItemConstructorOptions[] = recentFiles.length
    ? [
        ...recentFiles.map(
          (filePath, i): MenuItemConstructorOptions => ({
            label: `${i + 1} ${path.basename(filePath)}`,
            toolTip: filePath,
            click: () => sendMenuAction({ type: 'open-recent', path: filePath }),
          }),
        ),
        { type: 'separator' },
        {
          label: M.clearRecent,
          click: () => {
            void clearRecentFiles().then(() => {
              recentFiles = [];
              Menu.setApplicationMenu(buildAppMenu());
            });
          },
        },
      ]
    : [{ label: M.empty, enabled: false }];

  const template: MenuItemConstructorOptions[] = [
    {
      label: M.file,
      submenu: [
        { label: M.new_, accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction({ type: 'new' }) },
        { label: M.open, accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction({ type: 'open' }) },
        { label: M.openRecent, submenu: recentSubmenu },
        { label: M.save, accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction({ type: 'save' }) },
        { label: M.saveAs, accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction({ type: 'save-as' }) },
        {
          label: M.exportAs,
          submenu: [
            exportMenuItem(M.exportPng, 'png'),
            exportMenuItem(M.exportPdf, 'pdf'),
            exportMenuItem(M.exportSvg, 'svg'),
            exportMenuItem(M.exportCsv, 'csv'),
            exportMenuItem(M.exportJson, 'json'),
            exportMenuItem(M.exportDrawio, 'drawio'),
            { type: 'separator' },
            exportMenuItem(M.exportCpp, 'cpp'),
            exportMenuItem(M.exportJava, 'java'),
            exportMenuItem(M.exportGo, 'go'),
          ],
        },
        { type: 'separator' },
        { label: M.print, accelerator: 'CmdOrCtrl+P', click: () => sendMenuAction({ type: 'print' }) },
        { type: 'separator' },
        { label: M.close, click: () => sendMenuAction({ type: 'close' }) },
        { type: 'separator' },
        { role: 'quit', label: M.exit },
      ],
    },
    {
      label: M.edit,
      submenu: [
        { label: M.undo, accelerator: 'CmdOrCtrl+Z', click: () => sendMenuAction({ type: 'undo' }) },
        { label: M.redo, accelerator: 'CmdOrCtrl+Y', click: () => sendMenuAction({ type: 'redo' }) },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: M.delete, accelerator: 'Delete', click: () => sendMenuAction({ type: 'delete' }) },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: M.preferences, accelerator: 'CmdOrCtrl+,', click: () => sendMenuAction({ type: 'preferences' }) },
      ],
    },
    {
      label: M.view,
      submenu: [
        { label: M.toggleSidebar, click: () => sendMenuAction({ type: 'toggle-sidebar' }) },
        { label: M.toggleChart, click: () => sendMenuAction({ type: 'toggle-chart' }) },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    { label: 'Window', role: 'windowMenu' },
    {
      label: M.help,
      submenu: [
        { label: M.about, click: () => sendMenuAction({ type: 'about' }) },
        {
          label: M.documentation,
          click: () => {
            void shell.openExternal('https://github.com/josefuentes4096/simulador');
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

app.whenReady().then(async () => {
  registerIpc();
  // Restore the persisted locale (or fall back to OS locale, then 'es') so
  // the menu and validation errors come up in the user's preferred language
  // even before the renderer has had a chance to push its own choice.
  const persisted = (await getSavedLocale()) || (app.getLocale() ?? '').slice(0, 2);
  if (persisted === 'es' || persisted === 'en' || persisted === 'pt') {
    setMainLocale(persisted);
  }
  recentFiles = await getRecentFiles();
  Menu.setApplicationMenu(buildAppMenu());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Hard block: refuse navigation to anything other than the dev server / file:// in production.
app.on('web-contents-created', (_evt, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith(DEV_URL)) return;
    if (!isDev && url.startsWith('file://')) return;
    event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
