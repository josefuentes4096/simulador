import { createContext } from 'react';

// Bridge between the model state (held in useModelState in App) and the
// TitleBlockNode (rendered inside React Flow's node tree). The node reads
// its values from this context and calls the setters on every keystroke;
// saves pick the values up from model.metadata.
//
// `fecha` is the OS file mtime (ISO 8601), surfaced read-only — re-read
// on open and on save.
export interface TitleBlockBinding {
  label: string;
  setLabel: (v: string) => void;
  creator: string;
  setCreator: (v: string) => void;
  version: string;
  setVersion: (v: string) => void;
  fecha: string;
}

export const TitleBlockContext = createContext<TitleBlockBinding | null>(null);
