import { app } from 'electron';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ResolutionEntry, ResolutionFile, ResolutionsState } from '@simulador/shared';
import { getRepoUrl } from './settings';

interface ParsedRepo {
  owner: string;
  repo: string;
  branch?: string;
  path: string;
}

interface ContentsItem {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  sha: string;
  download_url: string | null;
}

interface CacheMeta {
  repoUrl: string;
  lastSync: string;
  files: Record<string, { sha: string; entry: ResolutionEntry }>;
}

function urlHash(url: string): string {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
}

function cacheDir(repoUrl: string): string {
  return path.join(app.getPath('userData'), 'exercises-cache', urlHash(repoUrl));
}

function metaPath(repoUrl: string): string {
  return path.join(cacheDir(repoUrl), 'meta.json');
}

function filePath(repoUrl: string, id: string): string {
  return path.join(cacheDir(repoUrl), `${id}.json`);
}

function parseRepoUrl(url: string): ParsedRepo | null {
  const trimmed = url.replace(/\/+$/, '').trim();
  // accepts:
  //   https://github.com/<owner>/<repo>
  //   https://github.com/<owner>/<repo>/<path...>
  //   https://github.com/<owner>/<repo>/tree/<branch>
  //   https://github.com/<owner>/<repo>/tree/<branch>/<path...>
  const m = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+))?(?:\/(.*))?$/,
  );
  if (!m) return null;
  const [, owner, repo, branch, p] = m;
  return { owner: owner!, repo: repo!, branch, path: p ?? '' };
}

async function readMeta(repoUrl: string): Promise<CacheMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(repoUrl), 'utf8');
    return JSON.parse(raw) as CacheMeta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: CacheMeta): Promise<void> {
  await fs.mkdir(cacheDir(meta.repoUrl), { recursive: true });
  await fs.writeFile(metaPath(meta.repoUrl), JSON.stringify(meta, null, 2), 'utf8');
}

function entryFromFile(id: string, file: ResolutionFile): ResolutionEntry {
  const lastMod = file.modifications.at(-1);
  return {
    id,
    label: file.label,
    source: file.source,
    verified: file.verified,
    version: file.version,
    creator: file.creator,
    lastModifiedAt: lastMod?.at ?? '',
  };
}

function basenameId(name: string): string {
  return name.replace(/\.json$/i, '');
}

async function listRepoFiles(parsed: ParsedRepo): Promise<ContentsItem[]> {
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.path}${
    parsed.branch ? `?ref=${parsed.branch}` : ''
  }`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub Contents API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as ContentsItem[];
  if (!Array.isArray(data)) {
    throw new Error('Repo URL does not point to a directory');
  }
  return data.filter((item) => item.type === 'file' && /\.json$/i.test(item.name));
}

async function fetchResolutionFile(downloadUrl: string): Promise<ResolutionFile> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Failed to download ${downloadUrl} (${res.status})`);
  const data = (await res.json()) as unknown;
  if (typeof data !== 'object' || data === null || !('model' in data)) {
    throw new Error(`Malformed resolution file: ${downloadUrl}`);
  }
  return data as ResolutionFile;
}

export async function getResolutionsState(): Promise<ResolutionsState> {
  const repoUrl = await getRepoUrl();
  const meta = await readMeta(repoUrl);
  if (!meta) {
    return { repoUrl, lastSync: null, entries: [], errorMessage: null };
  }
  return {
    repoUrl,
    lastSync: meta.lastSync,
    entries: Object.values(meta.files).map((f) => f.entry),
    errorMessage: null,
  };
}

export async function refreshResolutions(): Promise<ResolutionsState> {
  const repoUrl = await getRepoUrl();
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return {
      repoUrl,
      lastSync: null,
      entries: [],
      errorMessage: `Invalid repo URL: "${repoUrl}". Expected https://github.com/<owner>/<repo>/...`,
    };
  }

  let items: ContentsItem[];
  try {
    items = await listRepoFiles(parsed);
  } catch (err) {
    const previous = await readMeta(repoUrl);
    return {
      repoUrl,
      lastSync: previous?.lastSync ?? null,
      entries: previous ? Object.values(previous.files).map((f) => f.entry) : [],
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  const previous = await readMeta(repoUrl);
  const previousFiles = previous?.files ?? {};
  const nextFiles: CacheMeta['files'] = {};
  await fs.mkdir(cacheDir(repoUrl), { recursive: true });

  // Fetch in parallel; reuse cache when sha matches.
  await Promise.all(
    items.map(async (item) => {
      const id = basenameId(item.name);
      const cached = previousFiles[id];
      if (cached && cached.sha === item.sha) {
        nextFiles[id] = cached;
        return;
      }
      if (!item.download_url) return;
      try {
        const file = await fetchResolutionFile(item.download_url);
        await fs.writeFile(filePath(repoUrl, id), JSON.stringify(file, null, 2), 'utf8');
        nextFiles[id] = { sha: item.sha, entry: entryFromFile(id, file) };
      } catch {
        // Skip malformed files; they won't appear in the dropdown.
      }
    }),
  );

  // Drop deleted files from cache.
  for (const id of Object.keys(previousFiles)) {
    if (!(id in nextFiles)) {
      try {
        await fs.unlink(filePath(repoUrl, id));
      } catch {
        // ignore
      }
    }
  }

  const meta: CacheMeta = {
    repoUrl,
    lastSync: new Date().toISOString(),
    files: nextFiles,
  };
  await writeMeta(meta);

  return {
    repoUrl,
    lastSync: meta.lastSync,
    entries: Object.values(nextFiles).map((f) => f.entry),
    errorMessage: null,
  };
}

export async function loadResolution(id: string): Promise<ResolutionFile> {
  const repoUrl = await getRepoUrl();
  const raw = await fs.readFile(filePath(repoUrl, id), 'utf8');
  return JSON.parse(raw) as ResolutionFile;
}
