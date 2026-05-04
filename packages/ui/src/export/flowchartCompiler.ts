import type { ModelEdge, ModelNode, ModelVariable, SimulationModel } from '@simulador/shared';
import { parseSubroutineEntry, parseSubroutineLabel } from '../state/diagramAnalysis';

// === Compiled IR =====================================================
// One CompiledFlow per "callable" — the main flow plus one per declared
// subroutine. Each flow is a graph of CompiledNode entries indexed by id;
// emitters walk it via the explicit successor / yes/no successor / goto
// fields rather than re-deriving from edges.

export interface CompiledNode {
  id: string;
  node: ModelNode;
  // For sequential nodes (init / assignment / routine / connector / comment).
  // null when the node is a leaf inside a subroutine — the caller emits a
  // `return` for those.
  successor: string | null;
  // Only set for decisions.
  yesSuccessor?: string | null;
  noSuccessor?: string | null;
  // Set when a connector with no outgoing edge resolves a GOTO (jumps to
  // another connector with the same label that does have outgoing edges).
  gotoTarget?: string;
}

export interface CompiledFlow {
  startId: string;
  nodes: Map<string, CompiledNode>;
}

export interface CompiledModel {
  variables: ModelVariable[];
  eventTables: Set<string>;
  resultVariables: ModelVariable[];
  mainFlow: CompiledFlow;
  procedures: Map<string, CompiledFlow>;
  modelName: string;
  seed: number;
  timeLimit: number;
  // Raw label text of every salida node, in walk order. Used by the emitters
  // to decide what to print at end-of-simulation.
  salidaLabels: string[];
}

// === Helpers =========================================================
function findOutgoing(
  edges: ModelEdge[],
  nodeId: string,
  handle?: 'yes' | 'no',
): ModelEdge | undefined {
  return edges.find(
    (e) =>
      e.source === nodeId &&
      // Self-loop guard: data files occasionally have corrupted edges where
      // a node points to itself (typically a connector created by mistake
      // during a hovering drag). Without this filter the emitted code would
      // read `pc = N` from inside `case N`, locking the program in an
      // infinite no-op loop. The runtime simulator already tolerates this
      // because it falls back to the connector goto-by-label resolution,
      // but the emitter has no such fallback at runtime.
      e.target !== nodeId &&
      (handle === undefined || (e.sourceHandle ?? null) === handle),
  );
}

function findGotoTarget(
  connectorLabel: string,
  currentId: string,
  nodes: ModelNode[],
  edges: ModelEdge[],
): string | null {
  const target = connectorLabel.trim();
  if (!target) return null;
  for (const n of nodes) {
    if (n.id === currentId) continue;
    if (n.type !== 'connector') continue;
    if ((n.label ?? '').trim() !== target) continue;
    if (findOutgoing(edges, n.id)) return n.id;
  }
  return null;
}

interface RoutineData {
  callKind?: 'routine' | 'function' | 'subroutine';
  formula?: string;
  assignTo?: string;
}

function findProcedureEntry(name: string, nodes: ModelNode[]): ModelNode | null {
  const target = name.trim();
  if (!target) return null;
  for (const n of nodes) {
    if (n.type !== 'routine') continue;
    const data = (n.data ?? {}) as RoutineData;
    // Entry blocks have neither callKind === 'subroutine' (call site) nor
    // 'function' (data generator). They're "plain" routines, possibly with
    // parameters declared in their label (e.g. "Arrepentimiento TE, I").
    if (data.callKind === 'subroutine' || data.callKind === 'function') continue;
    const entryName = parseSubroutineEntry(n.label ?? '').procName;
    if (entryName !== target) continue;
    return n;
  }
  return null;
}

function compileFlow(
  startId: string,
  allNodes: ModelNode[],
  allEdges: ModelEdge[],
  procedures: Map<string, CompiledFlow>,
  visitedProcs: Set<string>,
  salidaLabels: string[],
): CompiledFlow {
  const nodes = new Map<string, CompiledNode>();
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (nodes.has(id)) continue;

    const node = allNodes.find((n) => n.id === id);
    if (!node) continue;

    let successor: string | null = null;
    let yesSuccessor: string | null | undefined;
    let noSuccessor: string | null | undefined;
    let gotoTarget: string | undefined;

    if (node.type === 'decision') {
      const yesEdge = findOutgoing(allEdges, id, 'yes');
      const noEdge = findOutgoing(allEdges, id, 'no');
      yesSuccessor = yesEdge?.target ?? null;
      noSuccessor = noEdge?.target ?? null;
      if (yesSuccessor) queue.push(yesSuccessor);
      if (noSuccessor) queue.push(noSuccessor);
    } else if (node.type === 'salida') {
      salidaLabels.push(node.label ?? '');
      successor = null;
    } else if (node.type === 'connector') {
      const out = findOutgoing(allEdges, id);
      if (out) {
        successor = out.target;
      } else {
        const target = findGotoTarget(node.label ?? '', id, allNodes, allEdges);
        if (target) {
          gotoTarget = target;
          successor = target;
        }
      }
      if (successor) queue.push(successor);
    } else {
      const data = (node.data ?? {}) as RoutineData;
      if (node.type === 'routine' && data.callKind === 'subroutine') {
        // The call-site label is `[Y = ]NAME[ arg1, arg2, ...]`. Pull the
        // procedure name out cleanly so a call like "A = Arrepentimiento"
        // resolves to the entry "Arrepentimiento" instead of being looked
        // up by the full string.
        const procName = parseSubroutineLabel(node.label ?? '').procName.trim();
        if (procName && !visitedProcs.has(procName)) {
          visitedProcs.add(procName);
          const entry = findProcedureEntry(procName, allNodes);
          if (entry) {
            const procFlow = compileFlow(
              entry.id,
              allNodes,
              allEdges,
              procedures,
              visitedProcs,
              salidaLabels,
            );
            procedures.set(procName, procFlow);
          }
        }
      }
      const out = findOutgoing(allEdges, id);
      successor = out?.target ?? null;
      if (successor) queue.push(successor);
    }

    nodes.set(id, {
      id,
      node,
      successor,
      ...(yesSuccessor !== undefined ? { yesSuccessor } : {}),
      ...(noSuccessor !== undefined ? { noSuccessor } : {}),
      ...(gotoTarget !== undefined ? { gotoTarget } : {}),
    });
  }

  return { startId, nodes };
}

export function compileModel(model: SimulationModel): CompiledModel {
  const allNodes = model.diagram.nodes;
  const allEdges = model.diagram.edges;

  const eventTables = new Set(
    model.behavior.variables.filter((v) => v.kind === 'event-table').map((v) => v.name),
  );

  const resultVariables = model.behavior.variables.filter((v) => v.kind === 'result');

  // Prefer a Condiciones-Iniciales block as the start; fall back to the first
  // node in canonical order if the diagram doesn't have one.
  const start = allNodes.find((n) => n.type === 'initialConditions') ?? allNodes[0];

  const procedures = new Map<string, CompiledFlow>();
  const visitedProcs = new Set<string>();
  const salidaLabels: string[] = [];

  const mainFlow: CompiledFlow = start
    ? compileFlow(start.id, allNodes, allEdges, procedures, visitedProcs, salidaLabels)
    : { startId: '', nodes: new Map() };

  return {
    variables: model.behavior.variables,
    eventTables,
    resultVariables,
    mainFlow,
    procedures,
    modelName: model.metadata.name,
    // Seed and timeLimit are baked into the generated source as edit-here
    // constants — the editor no longer exposes a knob for them.
    seed: 1,
    timeLimit: 100,
    salidaLabels,
  };
}

// === Identifier sanitizer ============================================
// Used by the emitters to turn user-typed labels into language identifiers
// (procedure names, salida-listed variables, etc.). Strips non-ASCII letters,
// digits, and underscore; ensures the result is a valid identifier head.
export function sanitizeIdent(s: string): string {
  const cleaned = s.trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (cleaned === '') return '_';
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

// === Code translation helpers ========================================
// Apply the same event-table rewrite the runtime stepper uses (push/peek/pop)
// but using a syntax compatible with the target language: emit `<TABLE>.push(x)`,
// `<TABLE>.pop()`, `<TABLE>.peek()`. Each language defines an EventTable type
// that exposes those three methods.

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rewriteEventTables(code: string, tables: ReadonlySet<string>): string {
  if (tables.size === 0) return code;
  let out = code;
  // Two-pass: first rewrite to underscore-prefixed placeholder forms (so the
  // peek pass's `\bTABLE\b` doesn't accidentally match inside the previously
  // rewritten push/pop calls — `_TABLE` has no word boundary between `_` and
  // `T`). Then in a final sweep, swap placeholders for method calls.
  for (const t of tables) {
    const tEsc = escapeRe(t);
    // 1. Push: TABLE = expr  →  __push_TABLE(expr)
    out = out.replace(
      new RegExp(`\\b${tEsc}[ \\t]*=(?!=)[ \\t]*([^;\\n]+)`, 'g'),
      `__push_${t}($1)`,
    );
    // 2. Pop: lhs = TABLE (bare at end of statement)  →  lhs = __pop_TABLE()
    out = out.replace(
      new RegExp(`(?<![=<>!])(=[ \\t]*)\\b${tEsc}\\b(?=[ \\t]*(?:;|$))`, 'gm'),
      `$1__pop_${t}()`,
    );
    // 3. Peek: any remaining bare reference  →  __peek_TABLE()
    out = out.replace(new RegExp(`\\b${tEsc}\\b`, 'g'), `__peek_${t}()`);
  }
  // Final sweep: turn placeholders into target-language method calls. Doing
  // this after all tables have been rewritten avoids interleaving issues when
  // the same line touches multiple tables.
  for (const t of tables) {
    const tEsc = escapeRe(t);
    out = out
      .replace(new RegExp(`__push_${tEsc}\\(`, 'g'), `${t}.push(`)
      .replace(new RegExp(`__pop_${tEsc}\\(\\)`, 'g'), `${t}.pop()`)
      .replace(new RegExp(`__peek_${tEsc}\\(\\)`, 'g'), `${t}.peek()`);
  }
  return out;
}
