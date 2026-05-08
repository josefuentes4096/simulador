import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type MenuAction,
  type SimuladorBridge,
  type UpdaterStatus,
} from '@simulador/shared';

const bridge: SimuladorBridge = {
  openModel: (knownPath) => ipcRenderer.invoke(IPC.ModelOpen, knownPath),
  saveModel: (model, knownPath, dialogHintPath) =>
    ipcRenderer.invoke(IPC.ModelSave, model, knownPath, dialogHintPath),
  exportPng: (data, name) => ipcRenderer.invoke(IPC.ExportPng, data, name),
  exportPdf: (data, name) => ipcRenderer.invoke(IPC.ExportPdf, data, name),
  exportSvg: (content, name) => ipcRenderer.invoke(IPC.ExportSvg, content, name),
  exportCsv: (content, name) => ipcRenderer.invoke(IPC.ExportCsv, content, name),
  exportJson: (content, name) => ipcRenderer.invoke(IPC.ExportJson, content, name),
  exportDrawio: (content, name) => ipcRenderer.invoke(IPC.ExportDrawio, content, name),
  exportCpp: (content, name) => ipcRenderer.invoke(IPC.ExportCpp, content, name),
  exportJava: (content, name) => ipcRenderer.invoke(IPC.ExportJava, content, name),
  exportGo: (content, name) => ipcRenderer.invoke(IPC.ExportGo, content, name),
  getRepoUrl: () => ipcRenderer.invoke(IPC.SettingsGetRepoUrl),
  setRepoUrl: (url) => ipcRenderer.invoke(IPC.SettingsSetRepoUrl, url),
  getLocale: () => ipcRenderer.invoke(IPC.SettingsGetLocale),
  setLocale: (locale) => ipcRenderer.invoke(IPC.SettingsSetLocale, locale),
  getResolutions: () => ipcRenderer.invoke(IPC.ResolutionsGet),
  refreshResolutions: () => ipcRenderer.invoke(IPC.ResolutionsRefresh),
  onMenuAction: (cb) => {
    const handler = (_evt: IpcRendererEvent, action: MenuAction) => cb(action);
    ipcRenderer.on(IPC.MenuAction, handler);
    return () => {
      ipcRenderer.removeListener(IPC.MenuAction, handler);
    };
  },
  checkForUpdates: () => ipcRenderer.invoke(IPC.UpdaterCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC.UpdaterDownload),
  installUpdate: () => ipcRenderer.invoke(IPC.UpdaterInstall),
  getUpdaterStatus: () => ipcRenderer.invoke(IPC.UpdaterGetStatus),
  onUpdaterStatus: (cb) => {
    const handler = (_evt: IpcRendererEvent, status: UpdaterStatus) => cb(status);
    ipcRenderer.on(IPC.UpdaterStatus, handler);
    return () => {
      ipcRenderer.removeListener(IPC.UpdaterStatus, handler);
    };
  },
  getAutoCheckUpdates: () => ipcRenderer.invoke(IPC.SettingsGetAutoCheckUpdates),
  setAutoCheckUpdates: (value) => ipcRenderer.invoke(IPC.SettingsSetAutoCheckUpdates, value),
};

contextBridge.exposeInMainWorld('simulador', bridge);
