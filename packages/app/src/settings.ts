import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_REPO_URL = 'https://github.com/josefuentes4096/simulador/example-resolutions';

interface SettingsFile {
  repoUrl?: string;
  // Most-recently-used file paths, newest first. Capped at MRU_CAP.
  recentFiles?: string[];
  // UI language: 'es' | 'en' | 'pt'. Persisted across launches.
  locale?: string;
}

const MRU_CAP = 10;

let cache: SettingsFile | null = null;

async function read(): Promise<SettingsFile> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    cache = JSON.parse(raw) as SettingsFile;
  } catch {
    cache = {};
  }
  return cache;
}

async function write(settings: SettingsFile): Promise<void> {
  cache = settings;
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

export async function getRepoUrl(): Promise<string> {
  const s = await read();
  return s.repoUrl ?? DEFAULT_REPO_URL;
}

export async function setRepoUrl(url: string): Promise<void> {
  const s = await read();
  s.repoUrl = url.trim() || DEFAULT_REPO_URL;
  await write(s);
}

export async function getRecentFiles(): Promise<string[]> {
  const s = await read();
  return s.recentFiles ?? [];
}

export async function addRecentFile(filePath: string): Promise<string[]> {
  const s = await read();
  const existing = s.recentFiles ?? [];
  // Newest first; dedupe by exact path; cap at MRU_CAP.
  const next = [filePath, ...existing.filter((p) => p !== filePath)].slice(0, MRU_CAP);
  s.recentFiles = next;
  await write(s);
  return next;
}

export async function clearRecentFiles(): Promise<string[]> {
  const s = await read();
  s.recentFiles = [];
  await write(s);
  return [];
}

export async function getLocale(): Promise<string> {
  const s = await read();
  return s.locale ?? '';
}

export async function setLocale(locale: string): Promise<void> {
  const s = await read();
  s.locale = locale;
  await write(s);
}
