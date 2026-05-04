import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type MenuAction, type SimuladorBridge } from '@simulador/shared';

const bridge: SimuladorBridge = {
  openModel: (knownPath) => ipcRenderer.invoke(IPC.ModelOpen, knownPath),
  saveModel: (model, knownPath) => ipcRenderer.invoke(IPC.ModelSave, model, knownPath),
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
};

contextBridge.exposeInMainWorld('simulador', bridge);
