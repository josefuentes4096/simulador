import type { SimulationModel } from '@simulador/shared';
import { useCallback, useState } from 'react';
import { MAX_HISTORY } from '../limits';

interface State {
  stack: SimulationModel[];
  cursor: number;
}

export interface History {
  push: (snapshot: SimulationModel) => void;
  undo: () => SimulationModel | null;
  redo: () => SimulationModel | null;
  reset: (snapshot: SimulationModel) => void;
}

function snapshotsEqual(a: SimulationModel | undefined, b: SimulationModel): boolean {
  if (!a) return false;
  // Both are canonicalized so JSON identity = semantic equality.
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useHistory(): History {
  const [state, setState] = useState<State>({ stack: [], cursor: -1 });

  const push = useCallback((snapshot: SimulationModel) => {
    setState((s) => {
      const current = s.stack[s.cursor];
      if (snapshotsEqual(current, snapshot)) return s;
      const truncated = s.stack.slice(0, s.cursor + 1);
      const next = [...truncated, snapshot];
      const capped = next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      return { stack: capped, cursor: capped.length - 1 };
    });
  }, []);

  const undo = useCallback((): SimulationModel | null => {
    if (state.cursor <= 0) return null;
    const target = state.stack[state.cursor - 1] ?? null;
    setState((s) => ({ ...s, cursor: s.cursor - 1 }));
    return target;
  }, [state.cursor, state.stack]);

  const redo = useCallback((): SimulationModel | null => {
    if (state.cursor >= state.stack.length - 1) return null;
    const target = state.stack[state.cursor + 1] ?? null;
    setState((s) => ({ ...s, cursor: s.cursor + 1 }));
    return target;
  }, [state.cursor, state.stack]);

  // Used after explicit loads (file open, template, resolution): drops history.
  const reset = useCallback((snapshot: SimulationModel) => {
    setState({ stack: [snapshot], cursor: 0 });
  }, []);

  return { push, undo, redo, reset };
}
