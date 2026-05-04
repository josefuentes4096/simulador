import { createContext } from 'react';
import type { DiagramAnalysis } from './diagramAnalysis';

const EMPTY_ANALYSIS: DiagramAnalysis = {
  undefinedRefs: new Set(),
  unusedVars: new Set(),
  dataVarNames: new Set(),
};

export const DiagramAnalysisContext = createContext<DiagramAnalysis>(EMPTY_ANALYSIS);
