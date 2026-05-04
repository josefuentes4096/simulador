import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ScheduledEvent,
  SimulationModel,
  SimulationSnapshot,
  TraceSample,
} from '@simulador/shared';
import { analyzeDiagram, parseSubroutineEntry, parseSubroutineLabel } from './state/diagramAnalysis';
import { DiagramAnalysisContext } from './state/diagramAnalysisContext';
import { TitleBlockContext } from './state/titleBlockContext';
import { printableArea } from './printPages';
import { BlockPalette } from './components/BlockPalette';
import { Canvas } from './components/Canvas';
import { EquationView } from './components/EquationView';
import { runDynamic, type DynamicRunResult } from './sim/dynamicStepper';
import { ChartPane } from './components/ChartPane';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { SidebarSplitter } from './components/SidebarSplitter';
import { Toolbar } from './components/Toolbar';
import {
  eventTableArraysOf,
  eventTablesOf,
  initialRuntime,
  step as stepFlowchart,
  type RuntimeState,
} from './sim/flowchartStepper';
import { useOnExport } from './state/useExports';
import { useHistory } from './state/useHistory';
import { useModelState } from './state/useModelState';
import { useOnPrint } from './state/usePrint';
import { hasErrors, validate } from './validation/validate';
import { LOG_CAP, STEP_SAFETY, TRACE_CAP } from './limits';

// Best-effort node id factory. crypto.randomUUID is available everywhere this
// app runs (Electron 32 + modern browsers); fall back to a counter+timestamp
// only as a paranoia net.
const newId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `n_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
};

export function App() {
  const { t } = useTranslation();
  const model = useModelState();
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [log, setLog] = useState<ScheduledEvent[]>([]);
  // Breakpoints live in `useModelState` so they persist via `node.data.breakpoint`.
  const breakpoints = model.breakpoints;
  const setBreakpoints = model.setBreakpoints;
  const [trace, setTrace] = useState<TraceSample[]>([]);
  const [chartOpen, setChartOpen] = useState(false);
  const [chartSeries, setChartSeries] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  // ISO mtime of the open file. Refreshed by openByPath and by save handlers
  // and surfaced read-only on the title block's Fecha row.
  const [lastModifiedAt, setLastModifiedAt] = useState('');
  const history = useHistory();
  const [connectMode, setConnectMode] = useState(false);
  // Dynamic-mode edge tool. null = arrow/select (default — click selects,
  // drag pans/moves). 'flow' or 'connector' = drawing mode: click source
  // node, then click target node (or empty pane → auto-cloud for flow) to
  // create the edge. Mirrors the existing connectMode pattern of the
  // discrete editor instead of relying on handle drags.
  const [dynamicEdgeMode, setDynamicEdgeMode] = useState<'flow' | 'connector' | null>(null);
  // Pending source for the click-click edge pattern. Lifted from Canvas so
  // the orphan-cloud sweep below can skip a cloud that's currently the
  // pending endpoint (otherwise the auto-cloud created by clicking on
  // empty pane gets pruned before the user can finish the inflow drag).
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  // Active tab in dynamic mode: 'model' = canvas with stocks/flows;
  // 'equation' = read-only Equation view derived from the model.
  const [dynamicTab, setDynamicTab] = useState<'model' | 'equation'>('model');
  // Last dynamic-run result. Shown in the sidebar (final sample + ev order).
  const [dynamicResult, setDynamicResult] = useState<DynamicRunResult | null>(null);

  // Stella invariant: a cloud only exists as a flow endpoint. Any cloud that
  // ends up not referenced by any flow gets pruned on the next render. This
  // catches the case where the user deletes a flow or a Stock that was the
  // cloud's "other end". The pending source is allowed through so a freshly
  // auto-created cloud (waiting for the user's second click) survives.
  useEffect(() => {
    if (model.simulationType !== 'dynamic') return;
    const referenced = new Set<string>();
    for (const e of model.dynamicEdges) {
      if (e.type !== 'flow') continue;
      referenced.add(e.source);
      referenced.add(e.target);
    }
    let needsPrune = false;
    for (const n of model.dynamicNodes) {
      if (n.type !== 'cloud') continue;
      if (referenced.has(n.id)) continue;
      if (n.id === pendingSource) continue;
      needsPrune = true;
      break;
    }
    if (needsPrune) {
      model.setDynamicNodes((ns) =>
        ns.filter(
          (n) =>
            n.type !== 'cloud' || referenced.has(n.id) || n.id === pendingSource,
        ),
      );
    }
  }, [model.simulationType, model.dynamicNodes, model.dynamicEdges, model, pendingSource]);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const [runtime, setRuntime] = useState<RuntimeState | null>(null);
  // Path of the file the user last opened or saved-as. Drives File → Save:
  // when set, save overwrites silently; when null, save prompts.
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  // Canvas writes to .current on every render so this returns the next "good
  // place" to drop a new node (last click in flow coords, with a tiny jitter,
  // or the visible-canvas center when there's no click yet).
  const newNodePosRef = useRef<() => { x: number; y: number }>(() => ({ x: 100, y: 100 }));

  const onResizeSidebar = useCallback((deltaPx: number) => {
    // Splitter sits to the left of the sidebar — dragging right shrinks it.
    setSidebarWidth((w) => Math.min(900, Math.max(240, w - deltaPx)));
  }, []);

  // Snapshot the model into the history stack ~700ms after the last change.
  // This coalesces typing in label/handler inputs into one history entry.
  const serializedSnapshot = useMemo(
    () => model.serialize(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      model.name,
      model.description,
      model.variables,
      model.events,
      model.initialEvents,
      model.nodes,
      model.edges,
      model.viewport,
    ],
  );
  useEffect(() => {
    const id = setTimeout(() => history.push(serializedSnapshot), 700);
    return () => clearTimeout(id);
  }, [serializedSnapshot, history]);

  // Window title reflects the file currently being edited. Electron mirrors
  // document.title to BrowserWindow.setTitle automatically — no IPC needed.
  useEffect(() => {
    const filename = currentFilePath
      ? currentFilePath.split(/[\\/]/).pop()
      : `${model.name || 'untitled'}.json`;
    document.title = `Simulador - ${filename}`;
  }, [currentFilePath, model.name]);

  // Sync the Variables panel with routine-block labels:
  //   - For each function-routine (callKind='function') label, ensure a
  //     `data` variable exists with that name (the label is the assignment
  //     target of `<label> = (<formula>)` at runtime).
  //   - Subroutine blocks (call or legacy entry) are NOT variables — their
  //     label is a procedure name. Any `data` variable whose name matches a
  //     subroutine-only block label gets dropped here, since the user just
  //     converted a function-routine into a subroutine (or split the diagram
  //     so the data label is now only a procedure name).
  // When a label exists as BOTH a function-routine and a subroutine block,
  // the function-routine wins (the data variable stays).
  useEffect(() => {
    const fnLabels = new Set<string>();
    const subLabels = new Set<string>();
    for (const n of model.nodes) {
      if (n.type !== 'routine') continue;
      const data = (n.data ?? {}) as { callKind?: string; label?: string };
      const label = typeof data.label === 'string' ? data.label : '';
      if (data.callKind === 'function') {
        const trimmed = label.trim();
        if (trimmed) fnLabels.add(trimmed);
      } else if (data.callKind === 'subroutine') {
        // Subroutine call labels are `X` or `Y = X` — extract the procedure
        // name X for the cleanup decision.
        const { procName } = parseSubroutineLabel(label);
        if (procName) subLabels.add(procName);
      } else {
        // Procedure entry — label is `NAME` or `NAME PARAM1, PARAM2`. Take
        // just the procedure name for the cleanup matching.
        const { procName } = parseSubroutineEntry(label);
        if (procName) subLabels.add(procName);
      }
    }
    // Function routines take precedence over subroutine-or-entry labels.
    for (const l of fnLabels) subLabels.delete(l);

    model.setVariables((vars) => {
      const existing = new Set(vars.map((v) => v.name));
      // Drop data variables that now correspond only to subroutine blocks.
      const filtered =
        subLabels.size === 0
          ? vars
          : vars.filter((v) => !(v.kind === 'data' && subLabels.has(v.name)));
      // Add data variables for function-routine labels we don't have yet.
      const additions =
        fnLabels.size === 0
          ? []
          : [...fnLabels]
              .filter((name) => !existing.has(name))
              .map((name) => ({ name, kind: 'data' as const }));
      if (filtered.length === vars.length && additions.length === 0) return vars;
      return [...filtered, ...additions];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.nodes, model.setVariables]);

  // Cross-validation between diagram and Variables panel:
  //   - identifiers used in node labels but not in `model.variables` →
  //     painted red in the on-canvas labels.
  //   - variables in the panel never referenced in any node → their name
  //     input shows in red.
  // Recomputed only when nodes or variables change.
  const diagramAnalysis = useMemo(
    () => analyzeDiagram(model.nodes, model.variables),
    [model.nodes, model.variables],
  );

  const onUndo = useCallback(() => {
    const snap = history.undo();
    if (snap) model.load(snap);
  }, [history, model]);

  const onRedo = useCallback(() => {
    const snap = history.redo();
    if (snap) model.load(snap);
  }, [history, model]);

  const validation = useMemo(
    () => validate(model.serialize()),
    // Re-validate whenever any model-shape input changes.
    // model.serialize() identity changes per render, so we depend on its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      model.variables,
      model.events,
      model.initialEvents,
      model.nodes,
      model.edges,
      model.name,
      model.description,
    ],
  );
  const blocking = hasErrors(validation);
  const runBlockedReason = blocking
    ? 'Fix validation errors before running'
    : null;

  // Dynamic-mode counterpart of onAddNode. Produces React Flow nodes whose
  // `type` is the Stella key (stock/stellaConverter/...) and seeds a sensible
  // default name (Stock_1, Converter_2, ...) by counting existing siblings.
  const onAddDynamicNode = useCallback(
    (rfType: string, kind: string) => {
      const existingOfKind = model.dynamicNodes.filter((n) => n.type === rfType).length;
      const baseLabel =
        kind === 'stock'
          ? 'Stock'
          : kind === 'converter'
            ? 'Converter'
            : kind === 'cloud'
              ? 'Cloud'
              : kind === 'comment'
                ? 'Comment'
                : 'Label';
      const name = `${baseLabel}_${existingOfKind + 1}`;
      const pos = newNodePosRef.current();
      const initial: Record<string, unknown> = { name };
      if (kind === 'stock') {
        initial['initialExpression'] = '0';
        initial['nonNegative'] = true;
      } else if (kind === 'converter') {
        initial['expression'] = '0';
      } else if (kind === 'comment' || kind === 'label') {
        initial['text'] = '';
      }
      model.setDynamicNodes((ns) => [
        ...ns,
        { id: newId(), type: rfType, data: initial, position: pos },
      ]);
    },
    [model],
  );

  const onAddNode = useCallback(
    (kind: string) => {
      let label = '';
      if (kind === 'connector') {
        const used = new Set(
          model.nodes
            .filter((n) => n.type === 'connector')
            .map((n) => (typeof n.data?.['label'] === 'string' ? (n.data['label'] as string) : '')),
        );
        // A..Z, then AA..AZ, etc.
        const next = (i: number): string => {
          let s = '';
          let n = i;
          do {
            s = String.fromCharCode(65 + (n % 26)) + s;
            n = Math.floor(n / 26) - 1;
          } while (n >= 0);
          return s;
        };
        for (let i = 0; i < 1000; i++) {
          const candidate = next(i);
          if (!used.has(candidate)) {
            label = candidate;
            break;
          }
        }
      }
      const pos = newNodePosRef.current();
      // Title block fields live in model.metadata. Fecha is OS-derived, so
      // we only seed `version` here if it was empty so a fresh diagram has a
      // sensible default to show.
      if (kind === 'titleBlock' && !model.version) {
        model.setVersion('1.0');
      }
      model.setNodes((ns) => [
        ...ns,
        {
          id: newId(),
          type: kind,
          data: { label },
          position: pos,
        },
      ]);
    },
    [model],
  );

  const openByPath = useCallback(
    async (knownPath?: string) => {
      setError(null);
      try {
        const opened = await window.simulador.openModel(knownPath);
        if (opened) {
          model.load(opened.model);
          // Reset undo/redo so Ctrl+Z after Open doesn't unwind the loaded
          // file back to whatever was on screen before.
          history.reset(opened.model);
          setCurrentFilePath(opened.path ?? null);
          setLastModifiedAt(opened.lastModifiedAt ?? '');
          setSnapshot(null);
          setLog([]);
          setTrace([]);
          setRuntime(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [history, model],
  );

  const onOpen = useCallback(() => void openByPath(), [openByPath]);
  const onOpenRecent = useCallback(
    (filePath: string) => void openByPath(filePath),
    [openByPath],
  );

  // Compute the next "vX.Y.Z.B" stamp. If the previous stamp matches the
  // current app version, bump its build counter; otherwise restart at 1 so
  // the stamp realigns when the app version changes.
  const nextBuiltWith = useCallback((prev: string): string => {
    const m = /^(\d+(?:\.\d+){0,2})\.(\d+)$/.exec(prev);
    if (m && m[1] === __APP_VERSION__) {
      return `${__APP_VERSION__}.${parseInt(m[2]!, 10) + 1}`;
    }
    return `${__APP_VERSION__}.1`;
  }, []);

  const onSave = useCallback(async () => {
    setError(null);
    try {
      const built = nextBuiltWith(model.builtWith);
      const serialized = model.serialize();
      serialized.metadata.builtWith = built;
      const result = await window.simulador.saveModel(
        serialized,
        currentFilePath ?? undefined,
      );
      if (result.path) {
        setCurrentFilePath(result.path);
        model.setBuiltWith(built);
        if (result.lastModifiedAt) setLastModifiedAt(result.lastModifiedAt);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [currentFilePath, model, nextBuiltWith]);

  const onSaveAs = useCallback(async () => {
    setError(null);
    try {
      const built = nextBuiltWith(model.builtWith);
      const serialized = model.serialize();
      serialized.metadata.builtWith = built;
      const result = await window.simulador.saveModel(serialized);
      if (result.path) {
        setCurrentFilePath(result.path);
        model.setBuiltWith(built);
        if (result.lastModifiedAt) setLastModifiedAt(result.lastModifiedAt);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [model, nextBuiltWith]);

  // Wipe to a brand-new empty model. Used by both File → New and File → Close
  // (Close is just "go back to a blank workspace" in this single-document app).
  const blankAndReset = useCallback(
    (confirmLabel: string) => {
      const hasContent =
        model.nodes.length > 0 ||
        model.events.length > 0 ||
        model.variables.length > 0;
      if (
        hasContent &&
        !confirm(t('actions.confirmDiscard', { action: confirmLabel }))
      )
        return;
      const blank: SimulationModel = {
        schemaVersion: 2,
        metadata: { name: 'untitled' },
        behavior: {
          variables: [],
          events: [],
        },
        diagram: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      };
      model.load(blank);
      history.reset(blank);
      setCurrentFilePath(null);
      setLastModifiedAt('');
      setSnapshot(null);
      setError(null);
      setLog([]);
      setTrace([]);
      setRuntime(null);
    },
    [history, model, t],
  );

  const onNew = useCallback(
    () => blankAndReset(t('actions.newModel')),
    [blankAndReset, t],
  );
  const onCloseDoc = useCallback(
    () => blankAndReset(t('actions.closeModel')),
    [blankAndReset, t],
  );

  // Highlight the current PC node by setting `selected: true` on it (and only
  // it). React Flow renders a blue outline around selected nodes — we reuse
  // that as the "execution cursor".
  const highlightPc = useCallback(
    (pcId: string | null) => {
      model.setNodes((ns) =>
        ns.map((n) => (n.selected !== (n.id === pcId) ? { ...n, selected: n.id === pcId } : n)),
      );
    },
    [model],
  );

  // Build the snapshot payload for the current runtime state. Pure helper so
  // both the per-step path and the post-loop flush call into the same shape.
  const snapshotFromRuntime = (rt: RuntimeState): SimulationSnapshot => {
    const stateForSnapshot: Record<string, unknown> = { ...rt.vars };
    if (rt.lastExecutedId !== null) stateForSnapshot.__pc = rt.pc ?? '(halt)';
    return {
      time: rt.step,
      state: stateForSnapshot,
      pendingEvents: rt.halted ? 0 : 1,
    };
  };

  const startRuntime = useCallback((): RuntimeState | null => {
    const selected = model.nodes.filter((n) => n.selected);
    if (selected.length === 0) {
      setError(t('errors.selectStartBlock'));
      return null;
    }
    if (selected.length > 1) {
      setError(t('errors.tooManySelected'));
      return null;
    }
    // Seed RND() with the wall clock so each run produces a different stream.
    return initialRuntime(model.variables, selected[0].id, Date.now());
  }, [model.nodes, model.variables, t]);

  // === Run loop ======================================================
  // Single helper used by Step (F11), Run (F5), Run-without-debug (Ctrl+F5),
  // Step-Over (F10) and Step-Out (Shift+F11). The variation between commands
  // is captured by `shouldContinue`, which decides after each step whether to
  // keep iterating. Receives the post-step state, the iteration count
  // (1-based), and the *initial* state so it can compare returnStack depths.
  const runLoop = useCallback(
    (
      shouldContinue: (next: RuntimeState, iter: number, initial: RuntimeState) => boolean,
      busyFlag: (b: boolean) => void = setRunning,
    ) => {
      setError(null);
      let current = runtime;
      // Restart-on-halt UX: a halted runtime + a freshly selected (different)
      // node means "start over from here". Otherwise message + bail.
      if (current !== null && current.halted) {
        const sel = model.nodes.filter((n) => n.selected);
        if (sel.length === 1 && sel[0].id !== current.pc) {
          current = null;
        } else {
          setError(
            current.haltReason
              ? t('errors.runtimeStoppedReason', { reason: current.haltReason })
              : t('errors.runtimeStoppedReset'),
          );
          return;
        }
      }
      if (current === null) {
        current = startRuntime();
        if (current === null) return;
        setLog([]);
        setTrace([]);
      }
      const initial = current;
      busyFlag(true);
      try {
        const input = {
          nodes: model.nodes,
          edges: model.edges,
          eventTables: eventTablesOf(model.variables),
          eventTableArrays: eventTableArraysOf(model.variables),
        };
        const startStep = current.step;
        // Aggregate appended log entries / trace samples locally during the
        // loop, then flush via a single setLog/setTrace at the end. Avoids
        // O(n²) array slicing on cap-trim that the previous implementation
        // did per-step (one setter call × N steps × cap).
        const newEvents: ScheduledEvent[] = [];
        const newSamples: TraceSample[] = [];
        for (let i = 0; i < STEP_SAFETY && !current.halted; i++) {
          const next = stepFlowchart(input, current);
          if (next.lastExecutedId !== null && next.step > current.step) {
            newEvents.push({
              time: next.step,
              name: next.lastExecutedLabel || next.lastExecutedId,
              seq: next.step,
              payload: { nodeId: next.lastExecutedId },
            });
            newSamples.push({ time: next.step, state: { ...next.vars } });
          }
          current = next;
          if (!shouldContinue(current, i + 1, initial)) break;
        }
        if (!current.halted && current.step - startStep >= STEP_SAFETY) {
          setError(t('errors.stepLimit', { count: STEP_SAFETY }));
        }
        if (
          current.halted &&
          current.haltCategory === 'error' &&
          current.haltReason
        ) {
          setError(current.haltReason);
        }
        setSnapshot(snapshotFromRuntime(current));
        if (newEvents.length > 0) {
          setLog((l) => {
            const merged = l.concat(newEvents);
            return merged.length > LOG_CAP ? merged.slice(merged.length - LOG_CAP) : merged;
          });
          setTrace((t) => {
            const merged = t.concat(newSamples);
            return merged.length > TRACE_CAP ? merged.slice(merged.length - TRACE_CAP) : merged;
          });
        }
        setRuntime(current);
        highlightPc(current.pc);
      } finally {
        busyFlag(false);
      }
    },
    [
      highlightPc,
      model.edges,
      model.nodes,
      model.variables,
      runtime,
      startRuntime,
    ],
  );

  // F11 — single step, follows into subroutines.
  const onStep = useCallback(() => {
    runLoop((_n, i) => i < 1, setStepping);
  }, [runLoop]);

  // F5 — run; pause on the next breakpoint (after at least one step so you
  // can resume past one you're paused on) or halt.
  const onRun = useCallback(() => {
    runLoop((next, i) => i < 1 || next.pc === null || !breakpoints.has(next.pc));
  }, [breakpoints, runLoop]);

  // Ctrl+F5 — run, ignore breakpoints, until halt.
  const onRunNoDebug = useCallback(() => {
    runLoop(() => true);
  }, [runLoop]);

  // Continuous-time run for dynamic mode. One-shot (no step debugger): the
  // engine integrates from STARTTIME to STOPTIME and we keep the result in
  // state for the sidebar to display.
  const onRunDynamic = useCallback(() => {
    const result = runDynamic(model.dynamicNodes, model.dynamicEdges, model.dynamicRunSpecs);
    setDynamicResult(result);
  }, [model.dynamicNodes, model.dynamicEdges, model.dynamicRunSpecs]);

  // F10 — step over: if the step entered a deeper call, keep running until
  // we return to the caller's depth. For non-subroutine steps it's a single
  // step (predicate immediately false).
  const onStepOver = useCallback(() => {
    runLoop(
      (next, _i, initial) => next.returnStack.length > initial.returnStack.length,
      setStepping,
    );
  }, [runLoop]);

  // Shift+F11 — step out: keep stepping until returnStack drops below the
  // initial depth (we returned from the current procedure). When the initial
  // depth is 0, this runs to halt.
  const onStepOut = useCallback(() => {
    runLoop(
      (next, _i, initial) => next.returnStack.length >= initial.returnStack.length,
      setStepping,
    );
  }, [runLoop]);

  // F9 — toggle breakpoint on the currently selected node (single selection).
  const onToggleBreakpoint = useCallback(() => {
    const sel = model.nodes.filter((n) => n.selected);
    if (sel.length !== 1) return;
    const id = sel[0].id;
    setBreakpoints((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [model.nodes, setBreakpoints]);

  // Ctrl+Shift+F9 — drop every breakpoint.
  const onClearBreakpoints = useCallback(() => {
    setBreakpoints(new Set());
  }, [setBreakpoints]);

  const onReset = useCallback(() => {
    setRuntime(null);
    setSnapshot(null);
    setError(null);
    setLog([]);
    setTrace([]);
    // Drop selection too so the next step prompts the user to pick a start block.
    model.setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
  }, [model]);

  // Shift+F5 / toolbar Stop button. Different from Reset:
  //   Stop  = freeze the current runtime (mark halted, keep PC + variables
  //           so the user can still inspect them).
  //   Reset = wipe everything back to a clean slate.
  // No-op when there's no runtime or it's already halted.
  const onStop = useCallback(() => {
    const reason = t('halt.stoppedByUser');
    setRuntime((rt) => {
      if (!rt || rt.halted) return rt;
      return { ...rt, halted: true, haltReason: reason, haltCategory: 'normal' };
    });
    setError(reason);
  }, [t]);

  const onClearLog = useCallback(() => setLog([]), []);

  const onPrint = useOnPrint(model, setError);
  const onExport = useOnExport(model, snapshot, trace, log, setError);

  // Native-menu actions are dispatched here. We keep the latest handlers in a
  // ref so the subscription itself can stay stable (subscribe once on mount).
  const menuHandlers = {
    onNew,
    onOpen,
    onOpenRecent,
    onSave,
    onSaveAs,
    onExport,
    onPrint,
    onCloseDoc,
    onUndo,
    onRedo,
    onOpenSettings: () => setSettingsOpen(true),
    onToggleSidebar: () => setSidebarOpen((v) => !v),
    onToggleChart: () => setChartOpen((v) => !v),
    onDelete: () => {
      model.setNodes((ns) => ns.filter((n) => !n.selected));
      model.setEdges((es) => es.filter((e) => !e.selected));
    },
  };
  const menuHandlersRef = useRef(menuHandlers);
  menuHandlersRef.current = menuHandlers;

  useEffect(() => {
    const unsubscribe = window.simulador.onMenuAction((action) => {
      const h = menuHandlersRef.current;
      switch (action.type) {
        case 'new': h.onNew(); break;
        case 'open': h.onOpen(); break;
        case 'open-recent': h.onOpenRecent(action.path); break;
        case 'save': h.onSave(); break;
        case 'save-as': h.onSaveAs(); break;
        case 'export': h.onExport(action.kind); break;
        case 'print': h.onPrint(); break;
        case 'close': h.onCloseDoc(); break;
        case 'undo': h.onUndo(); break;
        case 'redo': h.onRedo(); break;
        case 'delete': h.onDelete(); break;
        case 'preferences': h.onOpenSettings(); break;
        case 'toggle-sidebar': h.onToggleSidebar(); break;
        case 'toggle-chart': h.onToggleChart(); break;
        case 'about':
          alert(`Simulador v${model.builtWith || __APP_VERSION__} · @josefuentes4096`);
          break;
        case 'docs':
          // Handled in main process via shell.openExternal — nothing to do here.
          break;
      }
    });
    return unsubscribe;
  }, []);

  // Visual Studio-style debugging shortcuts. F-keys ignore input focus (they
  // act globally like in any IDE) so we listen on document, not on a
  // particular element. Handlers are read through a ref to keep the listener
  // stable.
  const debugShortcutsRef = useRef({
    onRun,
    onRunNoDebug,
    onStop,
    onStep,
    onStepOver,
    onStepOut,
    onToggleBreakpoint,
    onClearBreakpoints,
  });
  debugShortcutsRef.current = {
    onRun,
    onRunNoDebug,
    onStop,
    onStep,
    onStepOver,
    onStepOut,
    onToggleBreakpoint,
    onClearBreakpoints,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = debugShortcutsRef.current;
      const ctrl = e.ctrlKey || e.metaKey;
      switch (e.key) {
        case 'F5':
          e.preventDefault();
          if (e.shiftKey) h.onStop();
          else if (ctrl) h.onRunNoDebug();
          else h.onRun();
          return;
        case 'F9':
          e.preventDefault();
          if (ctrl && e.shiftKey) h.onClearBreakpoints();
          else h.onToggleBreakpoint();
          return;
        case 'F10':
          e.preventDefault();
          h.onStepOver();
          return;
        case 'F11':
          e.preventDefault();
          if (e.shiftKey) h.onStepOut();
          else h.onStep();
          return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Printable area derived from the current paper choice (state lives in
  // the model so it persists in metadata.paperSize / metadata.paperOrientation).
  const printArea = useMemo(
    () => printableArea(model.paperSize, model.paperOrientation),
    [model.paperSize, model.paperOrientation],
  );

  const titleBlockBinding = useMemo(
    () => ({
      label: model.label,
      setLabel: model.setLabel,
      creator: model.creator,
      setCreator: model.setCreator,
      version: model.version,
      setVersion: model.setVersion,
      fecha: lastModifiedAt,
    }),
    [
      model.label,
      model.setLabel,
      model.creator,
      model.setCreator,
      model.version,
      model.setVersion,
      lastModifiedAt,
    ],
  );

  return (
    <DiagramAnalysisContext.Provider value={diagramAnalysis}>
    <TitleBlockContext.Provider value={titleBlockBinding}>
    <ReactFlowProvider>
      <div className={`app ${chartOpen ? 'app--chart-open' : ''}`}>
        <Toolbar
          onReset={onReset}
          chartOpen={chartOpen}
          onToggleChart={() => setChartOpen((v) => !v)}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          paperSize={model.paperSize}
          onPaperSizeChange={model.setPaperSize}
          paperOrientation={model.paperOrientation}
          onPaperOrientationChange={model.setPaperOrientation}
        />
        <main
          className="app__main"
          style={{
            gridTemplateColumns: sidebarOpen
              ? `auto 1fr 6px ${sidebarWidth}px`
              : 'auto 1fr',
          }}
        >
          <BlockPalette
            onAddNode={onAddNode}
            onAddDynamicNode={onAddDynamicNode}
            connectMode={connectMode}
            onToggleConnectMode={() => setConnectMode((v) => !v)}
            dynamicEdgeMode={dynamicEdgeMode}
            setDynamicEdgeMode={setDynamicEdgeMode}
            snapToGrid={snapToGrid}
            onToggleSnapToGrid={() => setSnapToGrid((v) => !v)}
            nodes={model.simulationType === 'dynamic' ? model.dynamicNodes : model.nodes}
            setNodes={
              model.simulationType === 'dynamic' ? model.setDynamicNodes : model.setNodes
            }
            simulationType={model.simulationType}
          />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
            {model.simulationType === 'dynamic' && (
              <div className="dynamic-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={dynamicTab === 'model'}
                  onClick={() => setDynamicTab('model')}
                  className={`dynamic-tab ${
                    dynamicTab === 'model' ? 'dynamic-tab--active' : ''
                  }`}
                >
                  {t('dynamic.tabModel')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={dynamicTab === 'equation'}
                  onClick={() => setDynamicTab('equation')}
                  className={`dynamic-tab ${
                    dynamicTab === 'equation' ? 'dynamic-tab--active' : ''
                  }`}
                >
                  {t('dynamic.tabEquation')}
                </button>
              </div>
            )}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display:
                  model.simulationType === 'dynamic' && dynamicTab === 'equation' ? 'none' : 'flex',
                flexDirection: 'column',
              }}
            >
          <Canvas
            nodes={model.simulationType === 'dynamic' ? model.dynamicNodes : model.nodes}
            edges={model.simulationType === 'dynamic' ? model.dynamicEdges : model.edges}
            onNodesChange={
              model.simulationType === 'dynamic'
                ? model.onDynamicNodesChange
                : model.onNodesChange
            }
            onEdgesChange={
              model.simulationType === 'dynamic'
                ? model.onDynamicEdgesChange
                : model.onEdgesChange
            }
            setNodes={
              model.simulationType === 'dynamic' ? model.setDynamicNodes : model.setNodes
            }
            setEdges={
              model.simulationType === 'dynamic' ? model.setDynamicEdges : model.setEdges
            }
            viewport={model.simulationType === 'dynamic' ? model.dynamicViewport : model.viewport}
            setViewport={
              model.simulationType === 'dynamic'
                ? model.setDynamicViewport
                : model.setViewport
            }
            onSave={onSave}
            onOpen={onOpen}
            onUndo={onUndo}
            onRedo={onRedo}
            connectMode={connectMode}
            setConnectMode={setConnectMode}
            dynamicEdgeMode={dynamicEdgeMode}
            pendingSource={pendingSource}
            setPendingSource={setPendingSource}
            snapToGrid={snapToGrid}
            pageWidth={printArea.w}
            pageHeight={printArea.h}
            pc={runtime?.pc ?? null}
            newNodePosRef={newNodePosRef}
          />
            </div>
            {model.simulationType === 'dynamic' && dynamicTab === 'equation' && (
              <EquationView nodes={model.dynamicNodes} edges={model.dynamicEdges} />
            )}
          </div>
          {sidebarOpen && (
            <>
              <SidebarSplitter onResize={onResizeSidebar} />
              <Sidebar
                model={model}
                snapshot={snapshot}
                error={error}
                log={log}
                breakpoints={breakpoints}
                setBreakpoints={setBreakpoints}
                onRun={onRun}
                onStop={onStop}
                onStep={onStep}
                onStepOver={onStepOver}
                onStepOut={onStepOut}
                onRunNoDebug={onRunNoDebug}
                onClearBreakpoints={onClearBreakpoints}
                onClearLog={onClearLog}
                isBusy={stepping || running}
                runBlockedReason={runBlockedReason}
                validation={validation}
                onRunDynamic={onRunDynamic}
                dynamicResult={dynamicResult}
              />
            </>
          )}
        </main>
        {chartOpen && (
          <ChartPane
            trace={trace}
            variables={model.variables}
            selected={chartSeries}
            setSelected={setChartSeries}
          />
        )}
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </ReactFlowProvider>
    </TitleBlockContext.Provider>
    </DiagramAnalysisContext.Provider>
  );
}
