import type { SimulationModel } from './model';

export interface ResolutionModification {
  by: string;
  at: string; // ISO 8601
  note?: string;
}

export interface ResolutionFile {
  label: string;
  creator: string;
  modifications: ResolutionModification[];
  version: number;
  source: string;
  verified: boolean;
  model: SimulationModel;
}

export type ResolutionMeta = Omit<ResolutionFile, 'model'>;

export interface OpenedFile {
  model: SimulationModel;
  meta?: ResolutionMeta;
  // ISO 8601 timestamp of the file's mtime on disk. Surfaced read-only on
  // the title block. Undefined for sources without a real file backing.
  lastModifiedAt?: string;
  // Absolute path of the file the user opened. Lets the renderer drive
  // File → Save (overwrite same path) without prompting again.
  path?: string;
}

export interface ResolutionEntry {
  id: string;
  label: string;
  source: string;
  verified: boolean;
  version: number;
  creator: string;
  lastModifiedAt: string;
}

export interface ResolutionsState {
  repoUrl: string;
  lastSync: string | null;
  entries: ResolutionEntry[];
  errorMessage: string | null;
}
