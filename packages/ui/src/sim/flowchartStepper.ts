import type { Edge, Node } from '@xyflow/react';
import type { ModelVariable, ScalarValue } from '@simulador/shared';
import { MAX_CALL_DEPTH, MAX_OUTPUT } from '../limits';
import { i18n } from '../locales';
import { parseSubroutineEntry, parseSubroutineLabel } from '../state/diagramAnalysis';

// Helper so the engine can translate without each site doing the cast.
const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(key, params) as unknown as string;

// Event-tables hold an ascending-sorted list of event times (a multiset).
// Regular vars hold scalars. Both share storage in vars.
export type RuntimeValue = ScalarValue | number[] | number[][];

// Sentinel: peek on an empty event-table returns HV, so user code can write
// `if (TPLL == HV)` to test "is the table empty?". Assigning HV to a table
// (`TPLL = HV`) is a special operation that clears the list.
export const HV = Number.POSITIVE_INFINITY;

// Mulberry32 — small, deterministic PRNG. State is a 32-bit unsigned int that
// the caller threads through each call so stepping stays reproducible.
function mulberry32(seedRef: { s: number }): number {
  seedRef.s = (seedRef.s + 0x6d2b79f5) | 0;
  let t = seedRef.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface OutputEntry {
  step: number;
  nodeId: string;
  label: string;
  vars: Record<string, RuntimeValue>;
}

export interface ReturnFrame {
  // PC to resume at after the subroutine returns.
  returnTo: string;
  // Procedure name (the caller's label). Used to find the "return value" var
  // by convention (the procedure leaves its result in a var with the same name).
  procedureName: string;
  // Optional: variable on the *caller* side that receives the procedure's
  // result. When set, on return: vars[assignTo] = vars[procedureName].
  assignTo?: string;
  // Caller-side values of the parameter names, captured before the call
  // overwrote them with the arg values. Restored on return so a parameter
  // doesn't leak out of the procedure scope. (Mutations *through* an array
  // parameter's elements still propagate — JS array refs.)
  savedVars?: Record<string, RuntimeValue | undefined>;
}

export interface RuntimeState {
  pc: string | null;
  vars: Record<string, RuntimeValue>;
  rngSeed: number;
  step: number;
  halted: boolean;
  // Pre-translated string for display. May be null when the runtime is
  // healthy. Don't compare against literals — use `haltCategory` to decide
  // whether the halt was a normal exit or an error to surface to the user.
  haltReason: string | null;
  // 'normal' = expected end (exit reached, no successor, user stop).
  // 'error'  = something the user wants to know about.
  haltCategory: 'normal' | 'error' | null;
  output: OutputEntry[];
  lastExecutedId: string | null;
  lastExecutedLabel: string | null;
  returnStack: ReturnFrame[];
}

// Names of variables declared as event-tables. Computed once per call to
// initialRuntime/step and threaded through compilation + execution.
type TableSet = ReadonlySet<string>;

export function initialRuntime(
  variables: ModelVariable[],
  startNodeId: string,
  seed: number | undefined,
): RuntimeState {
  const vars: Record<string, RuntimeValue> = {};
  // Built-in variables — provided by the runtime regardless of declaration.
  // T = simulation clock, TF = simulation horizon. Users can still declare
  // them in the panel to override the default initialValue (the user's
  // declaration runs after these and wins).
  vars.T = 0;
  vars.TF = 10000;
  for (const v of variables) {
    if (v.kind === 'event-table') {
      // Event-tables start empty. Any seed values come from C.I. via
      // explicit `TPLL = ...` statements.
      vars[v.name] = [];
    } else if (v.kind === 'array') {
      // Array kind: initialValue is either a number (length — array of N
      // zeros) or an explicit number[] (the seed contents).
      const init = v.initialValue;
      if (Array.isArray(init)) {
        vars[v.name] = [...init];
      } else if (typeof init === 'number') {
        vars[v.name] = new Array(Math.max(0, Math.floor(init))).fill(0) as number[];
      } else {
        vars[v.name] = [] as number[];
      }
    } else if (v.kind === 'event-table-array') {
      // Vector of TEFs: each slot is its own priority queue (number[]).
      // `initialValue` is a number — the length of the outer array.
      const init = v.initialValue;
      const len = typeof init === 'number' ? Math.max(0, Math.floor(init)) : 0;
      vars[v.name] = Array.from({ length: len }, () => [] as number[]) as number[][];
    } else if (v.initialValue !== undefined && !Array.isArray(v.initialValue)) {
      vars[v.name] = v.initialValue;
    } else {
      vars[v.name] = 0;
    }
  }
  return {
    pc: startNodeId,
    vars,
    rngSeed: ((seed ?? 1) >>> 0) || 1,
    step: 0,
    halted: false,
    haltReason: null,
    haltCategory: null,
    output: [],
    lastExecutedId: null,
    lastExecutedLabel: null,
    returnStack: [],
  };
}

function getLabel(node: Node): string {
  const data = node.data as { label?: unknown } | undefined;
  return typeof data?.label === 'string' ? data.label : '';
}

interface RoutineData {
  callKind?: 'routine' | 'function' | 'subroutine';
  formula?: string;
  // Legacy: for subroutine calls, variable that receives the procedure's
  // return value. Kept for backwards compatibility on JSON load (migrated to
  // `Y = X` in the label there). New code reads the label instead.
  // "return value" (= the var with the same name as the procedure).
  assignTo?: string;
}

// === Event-table helpers ============================================
// Tables are sorted (ascending) lists of event times.
//   pop  → remove and return the minimum; halt if empty
//   peek → return the minimum, or HV if empty (no halt)
//   push(v)  → insert v in sorted position
//   push(HV) → special: clear the list
class EmptyTableError extends Error {
  constructor(table: string) {
    super(t('errors.emptyTable', { name: table }));
    this.name = 'EmptyTableError';
  }
}

function asArray(vars: Record<string, RuntimeValue>, name: string): number[] {
  const arr = vars[name];
  if (!Array.isArray(arr)) {
    // First write to a not-yet-initialized table — initialize on the fly.
    const fresh: number[] = [];
    vars[name] = fresh;
    return fresh;
  }
  return arr as number[];
}

function etPop(vars: Record<string, RuntimeValue>, name: string): number {
  const arr = vars[name] as number[] | undefined;
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new EmptyTableError(name);
  }
  return arr.shift() as number;
}

function etPeek(vars: Record<string, RuntimeValue>, name: string): number {
  // Peek does NOT halt on empty. Returning HV (Infinity) lets user code do
  // `if (TPLL == HV) ...` or `if (T < TPLL) ...` cleanly.
  const arr = vars[name] as number[] | undefined;
  if (!Array.isArray(arr) || arr.length === 0) return HV;
  return arr[0]!;
}

function etPush(vars: Record<string, RuntimeValue>, name: string, value: unknown): void {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) {
    throw new Error(`No se puede asignar "${String(value)}" a tabla "${name}" (no es número)`);
  }
  // Special case: assigning HV (Infinity) is the cátedra convention for
  // "clear the table" — not "insert Infinity into the list".
  if (num === HV) {
    vars[name] = [];
    return;
  }
  const arr = asArray(vars, name);
  let i = 0;
  while (i < arr.length && arr[i] <= num) i++;
  arr.splice(i, 0, num);
}

// Indexed event-table-array helpers: NAME[idx] is itself a priority queue.
// `outerOf` returns the inner table at idx, growing the outer array if needed.
function outerOf(vars: Record<string, RuntimeValue>, name: string, idx: number): number[] {
  let outer = vars[name];
  if (!Array.isArray(outer)) {
    outer = [];
    vars[name] = outer;
  }
  const i = Math.floor(idx);
  let inner = (outer as unknown[])[i] as number[] | undefined;
  if (!Array.isArray(inner)) {
    inner = [];
    (outer as unknown[])[i] = inner;
  }
  return inner;
}

function etPopAt(vars: Record<string, RuntimeValue>, name: string, idx: number): number {
  const inner = outerOf(vars, name, idx);
  if (inner.length === 0) throw new EmptyTableError(`${name}[${idx}]`);
  return inner.shift() as number;
}

function etPeekAt(vars: Record<string, RuntimeValue>, name: string, idx: number): number {
  const inner = outerOf(vars, name, idx);
  return inner.length === 0 ? HV : inner[0]!;
}

function etPushAt(vars: Record<string, RuntimeValue>, name: string, idx: number, value: unknown): void {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) {
    throw new Error(
      `No se puede asignar "${String(value)}" a tabla "${name}[${idx}]" (no es número)`,
    );
  }
  if (num === HV) {
    // Clear the slot. Outer array preserved so other slots stay intact.
    const outer = vars[name];
    if (Array.isArray(outer)) (outer as unknown[])[Math.floor(idx)] = [] as number[];
    return;
  }
  const inner = outerOf(vars, name, idx);
  let i = 0;
  while (i < inner.length && inner[i]! <= num) i++;
  inner.splice(i, 0, num);
}

// === Code transformation =============================================
// User pseudo-JS uses event-table names as if they were scalars:
//   - `T = TPLL`    means pop  (consumes the next event)
//   - `TPLL = X`    means push (schedules a new event)
//   - any other reference is a peek (read without removing)
// We rewrite the code before compiling so the helper calls do the work.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Simpler than a real JS parser: regex-based passes. Order matters and the
// helper names are deliberately suffixed so they survive the peek pass: `__pop_T`
// has a `_` before `T`, which is a word char, so `\bT\b` won't match inside it.
function transformCode(
  code: string,
  tables: TableSet,
  tableArrays: TableSet,
  isExpression: boolean,
): string {
  if (tables.size === 0 && tableArrays.size === 0) return code;
  let out = code;
  // Pass 1: vector-of-TEFs `NAME[idx]` → push/pop/peek with index. We do this
  // BEFORE the scalar TEF pass so a name that's both registered (illegal but
  // possible) gets indexed transformations first.
  for (const a of tableArrays) {
    const aEsc = escapeRe(a);
    if (!isExpression) {
      // Push: `A[idx] = EXPR` → `__push_A_at(idx, EXPR)`.
      out = out.replace(
        new RegExp(`\\b${aEsc}\\[([^\\]]+)\\][ \\t]*=(?!=)[ \\t]*([^;\\n]+)`, 'g'),
        `__push_${a}_at($1, $2)`,
      );
      // Pop: `<lhs> = A[idx]` at statement end.
      out = out.replace(
        new RegExp(`(?<![=<>!])(=[ \\t]*)\\b${aEsc}\\[([^\\]]+)\\](?=[ \\t]*(?:;|$))`, 'gm'),
        `$1__pop_${a}_at($2)`,
      );
    }
    // Peek: any remaining `A[idx]` → `__peek_A_at(idx)`.
    out = out.replace(
      new RegExp(`\\b${aEsc}\\[([^\\]]+)\\]`, 'g'),
      `__peek_${a}_at($1)`,
    );
  }
  for (const t of tables) {
    const tEsc = escapeRe(t);
    if (!isExpression) {
      // Push: `T = EXPR` → `__push_T(EXPR)`.
      // - `[ \t]*` (no \n) keeps the match on a single statement.
      // - `(?!=)` after the = avoids matching `==` / `===` (peek/equality).
      out = out.replace(
        new RegExp(`\\b${tEsc}[ \\t]*=(?!=)[ \\t]*([^;\\n]+)`, 'g'),
        `__push_${t}($1)`,
      );
      // Pop: `<lhs> = T` (bare T at end of statement).
      // - Lookbehind `(?<![=<>!])` avoids matching `==`, `<=`, `>=`, `!=`.
      // - Lookahead requires `;` or end-of-line so `var = T + 1` falls to peek.
      out = out.replace(
        new RegExp(`(?<![=<>!])(=[ \\t]*)\\b${tEsc}\\b(?=[ \\t]*(?:;|$))`, 'gm'),
        `$1__pop_${t}()`,
      );
    }
    // Peek: any remaining bare T → __peek_T(). Helper names like `__push_T`
    // are protected because the underscore preceding T is a \w (so no \b).
    out = out.replace(
      new RegExp(`\\b${tEsc}\\b`, 'g'),
      `__peek_${t}()`,
    );
  }
  return out;
}

// === Compile + execute ==============================================
// Cache: the transformed code uniquely identifies the compiled function, so a
// single Map keyed by the post-transform string is enough.
type ScopeFn = (scope: Record<string, unknown>) => unknown;
const fnCache = new Map<string, ScopeFn>();

function compile(transformed: string, isExpression: boolean): ScopeFn {
  const key = (isExpression ? 'E:' : 'S:') + transformed;
  let fn = fnCache.get(key);
  if (!fn) {
    const body = isExpression
      ? `with (scope) { return (${transformed}); }`
      : `with (scope) { ${transformed} };`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    fn = new Function('scope', body) as ScopeFn;
    fnCache.set(key, fn);
  }
  return fn;
}

// Build a Proxy scope. Reads check helpers (RND, Math, __pop_*, __push_*,
// __peek_*) first, then user vars. Writes always go to user vars. The `has`
// trap returns true so `with (scope)` routes every bare-name access through us
// and nothing leaks to globalThis.
//
// Returns the proxy together with the seedRef closed over by RND so the
// caller can persist the rng seed back to state.rngSeed without needing a
// hidden `__seedRef` side-channel on the proxy.
function makeScope(
  state: RuntimeState,
  tables: TableSet,
  tableArrays: TableSet,
): { scope: Record<string, unknown>; seedRef: { s: number } } {
  const seedRef = { s: state.rngSeed };
  const helpers: Record<string, unknown> = {
    RND: () => mulberry32(seedRef),
    Math,
    HV,
  };
  for (const t of tables) {
    helpers[`__pop_${t}`] = () => etPop(state.vars, t);
    helpers[`__push_${t}`] = (v: unknown) => etPush(state.vars, t, v);
    helpers[`__peek_${t}`] = () => etPeek(state.vars, t);
  }
  for (const a of tableArrays) {
    helpers[`__pop_${a}_at`] = (i: number) => etPopAt(state.vars, a, i);
    helpers[`__push_${a}_at`] = (i: number, v: unknown) => etPushAt(state.vars, a, i, v);
    helpers[`__peek_${a}_at`] = (i: number) => etPeekAt(state.vars, a, i);
  }
  const scope = new Proxy(
    {},
    {
      has() {
        return true;
      },
      get(_, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop in helpers) return helpers[prop];
        return state.vars[prop];
      },
      set(_, prop, value) {
        if (typeof prop === 'string') state.vars[prop] = value as RuntimeValue;
        return true;
      },
    },
  ) as Record<string, unknown>;
  return { scope, seedRef };
}

function execStatements(
  code: string,
  state: RuntimeState,
  tables: TableSet,
  tableArrays: TableSet,
): void {
  if (code.trim() === '') return;
  const transformed = transformCode(code, tables, tableArrays, false);
  const fn = compile(transformed, false);
  const { scope, seedRef } = makeScope(state, tables, tableArrays);
  fn(scope);
  state.rngSeed = seedRef.s;
}

function evalExpr(
  code: string,
  state: RuntimeState,
  tables: TableSet,
  tableArrays: TableSet,
): unknown {
  const transformed = transformCode(code, tables, tableArrays, true);
  const fn = compile(transformed, true);
  const { scope, seedRef } = makeScope(state, tables, tableArrays);
  const value = fn(scope);
  state.rngSeed = seedRef.s;
  return value;
}

// === Stepper ========================================================
function findOutgoing(edges: Edge[], nodeId: string, handle?: string): Edge | undefined {
  return edges.find(
    (e) =>
      e.source === nodeId &&
      (handle === undefined || (e.sourceHandle ?? null) === handle),
  );
}

// Find the entry point of a procedure: a routine block with the matching label
// that is NOT itself a call (callKind !== 'subroutine' / 'function'). The
// caller block is excluded so a procedure can't accidentally call itself by
// label-matching.
function findProcedureEntry(name: string, nodes: Node[], callerId: string): Node | null {
  const target = name.trim();
  if (target === '') return null;
  for (const n of nodes) {
    if (n.id === callerId) continue;
    if (n.type !== 'routine') continue;
    const data = (n.data ?? {}) as RoutineData;
    if (data.callKind === 'subroutine' || data.callKind === 'function') continue;
    // Entry labels can include parameter declarations (`NAME P1, P2`) so we
    // match by the procedure name, not the full label.
    const entryName = parseSubroutineEntry(getLabel(n)).procName;
    if (entryName !== target) continue;
    return n;
  }
  return null;
}

function findGotoTarget(connectorLabel: string, current: Node, nodes: Node[], edges: Edge[]): Node | null {
  if (connectorLabel.trim() === '') return null;
  for (const n of nodes) {
    if (n.id === current.id) continue;
    if (n.type !== 'connector') continue;
    if (getLabel(n).trim() !== connectorLabel.trim()) continue;
    if (findOutgoing(edges, n.id)) return n;
  }
  return null;
}

export interface StepInput {
  nodes: Node[];
  edges: Edge[];
  eventTables: TableSet;
  eventTableArrays: TableSet;
}

export function stepRuntime(input: StepInput, state: RuntimeState): RuntimeState {
  if (state.halted || state.pc === null) {
    state.halted = true;
    return state;
  }

  const node = input.nodes.find((n) => n.id === state.pc);
  if (!node) {
    state.halted = true;
    state.haltReason = t('errors.blockNotFound', { id: state.pc ?? '?' });
    state.haltCategory = 'error';
    state.pc = null;
    return state;
  }

  const label = getLabel(node);
  const data = (node.data ?? {}) as RoutineData;
  let nextHandle: 'yes' | 'no' | undefined;
  let halt = false;

  try {
    switch (node.type) {
      case 'initialConditions':
      case 'assignment': {
        execStatements(label, state, input.eventTables, input.eventTableArrays);
        break;
      }
      case 'decision': {
        const result = Boolean(evalExpr(label, state, input.eventTables, input.eventTableArrays));
        nextHandle = result ? 'yes' : 'no';
        break;
      }
      case 'loop': {
        // Iterador (for-loop terminator). Sits at the END of the loop body.
        // On every entry: counter += 1, test counter <= final. If yes →
        // continue (out of either side), if no → exit (out of the bottom).
        // The user must initialize the counter manually with an assignment
        // block BEFORE the body — the `init` field on the Iterador is
        // documentary only.
        const ld = data as { counter?: unknown; final?: unknown };
        const counter = typeof ld.counter === 'string' ? ld.counter.trim() : '';
        const finalExpr = typeof ld.final === 'string' ? ld.final.trim() : '';
        if (counter === '' || finalExpr === '') {
          throw new Error(
            'Iterador incompleto: completa contador y valor final',
          );
        }
        execStatements(
          `${counter} = ${counter} + 1`,
          state,
          input.eventTables,
          input.eventTableArrays,
        );
        const cond = Boolean(
          evalExpr(
            `${counter} <= (${finalExpr})`,
            state,
            input.eventTables,
            input.eventTableArrays,
          ),
        );
        if (cond) {
          // Continue — accept the user's loop-back edge from either side.
          const out =
            findOutgoing(input.edges, node.id, 'yes') ??
            findOutgoing(input.edges, node.id, 'yes-left');
          if (!out) {
            throw new Error('Iterador sin flecha de continuación (lado izquierdo o derecho)');
          }
          state.lastExecutedId = node.id;
          state.lastExecutedLabel = label;
          state.step += 1;
          state.pc = out.target;
          return state;
        }
        nextHandle = 'no';
        break;
      }
      case 'routine': {
        if (data.callKind === 'function' && data.formula && data.formula.trim() !== '') {
          const target = label.trim();
          if (target === '') {
            throw new Error('Función sin variable destino: indica un nombre de variable como etiqueta');
          }
          execStatements(`${target} = (${data.formula})`, state, input.eventTables, input.eventTableArrays);
        } else if (data.callKind === 'subroutine') {
          // Label can be `X`, `Y = X`, `X A1, A2`, or `Y = X A1, A2`.
          const parsed = parseSubroutineLabel(label);
          const procName = parsed.procName;
          if (procName === '') {
            throw new Error('Subrutina sin nombre: el label es el nombre del procedimiento');
          }
          const entry = findProcedureEntry(procName, input.nodes, node.id);
          if (!entry) {
            throw new Error(`Procedimiento "${procName}" no encontrado (se busca un bloque rutina con ese label)`);
          }
          if (state.returnStack.length >= MAX_CALL_DEPTH) {
            throw new Error(t('errors.callStackTooDeep', { max: MAX_CALL_DEPTH }));
          }
          // Compute the return target from the caller's outgoing edge BEFORE
          // jumping into the procedure. If the caller has no outgoing, the
          // sub return would have nowhere to go — error out early.
          const ret = findOutgoing(input.edges, node.id);
          if (!ret) {
            throw new Error('Llamada a subrutina sin sucesor: no hay flecha de salida del caller');
          }
          // Resolve the entry's declared parameters and bind args to them.
          // Args are evaluated in the caller's scope BEFORE we mutate vars,
          // so they see the caller's view of every name (including any param
          // about to be shadowed).
          const entryParams = parseSubroutineEntry(getLabel(entry)).params;
          const argExprs = parsed.args;
          const argValues: RuntimeValue[] = argExprs.map(
            (a) => evalExpr(a, state, input.eventTables, input.eventTableArrays) as RuntimeValue,
          );
          const savedVars: Record<string, RuntimeValue | undefined> = {};
          const bindCount = Math.min(entryParams.length, argValues.length);
          for (let i = 0; i < entryParams.length; i++) {
            savedVars[entryParams[i]!] = state.vars[entryParams[i]!];
          }
          for (let i = 0; i < bindCount; i++) {
            state.vars[entryParams[i]!] = argValues[i]!;
          }
          state.returnStack.push({
            returnTo: ret.target,
            procedureName: procName,
            assignTo: parsed.assignTo ?? undefined,
            savedVars,
          });
          // Jump into the procedure entry. We bypass the normal "find outgoing
          // edge" path below by pre-setting pc and returning early.
          state.lastExecutedId = node.id;
          state.lastExecutedLabel = label;
          state.step += 1;
          state.pc = entry.id;
          return state;
        }
        break;
      }
      case 'salida': {
        state.output.push({
          step: state.step + 1,
          nodeId: node.id,
          label,
          vars: { ...state.vars },
        });
        if (state.output.length > MAX_OUTPUT) state.output.shift();
        halt = true;
        state.haltReason = t('halt.exitReached');
        state.haltCategory = 'normal';
        break;
      }
      case 'connector':
      case 'comment':
        break;
      default:
        break;
    }
  } catch (err) {
    state.halted = true;
    state.haltCategory = 'error';
    if (err instanceof EmptyTableError) {
      state.haltReason = err.message;
    } else {
      state.haltReason = t('errors.blockError', {
        label: label || node.id,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    state.lastExecutedId = node.id;
    state.lastExecutedLabel = label;
    state.step += 1;
    // Keep pc on the failing node so the highlight shows where execution
    // broke. The caller checks `halted` to know not to advance further.
    return state;
  }

  state.lastExecutedId = node.id;
  state.lastExecutedLabel = label;
  state.step += 1;

  if (halt) {
    state.halted = true;
    state.pc = null;
    return state;
  }

  let nextEdge: Edge | undefined;
  if (node.type === 'decision') {
    nextEdge = findOutgoing(input.edges, node.id, nextHandle);
  } else {
    nextEdge = findOutgoing(input.edges, node.id);
  }

  if (nextEdge) {
    state.pc = nextEdge.target;
    return state;
  }

  if (node.type === 'connector') {
    const target = findGotoTarget(label, node, input.nodes, input.edges);
    if (target) {
      state.pc = target.id;
      return state;
    }
  }

  // No outgoing edge AND we're inside a subroutine call → return to caller.
  // The convention: the procedure's "return value" lives in the var with the
  // same name as the procedure. Copy it to assignTo if the caller asked.
  if (state.returnStack.length > 0) {
    const frame = state.returnStack.pop()!;
    if (frame.assignTo) {
      const value = state.vars[frame.procedureName];
      // Don't copy arrays (event-tables) — assigning an event-table by
      // reference would alias the procedure's table to the caller's slot.
      if (value !== undefined && !Array.isArray(value)) {
        state.vars[frame.assignTo] = value;
      }
    }
    // Restore caller-side values of any parameter names, so a parameter
    // doesn't leak out of the procedure scope. Mutations through an array
    // parameter's elements (`SA[I] = ...`) still propagated because the
    // array reference is shared with the caller.
    if (frame.savedVars) {
      for (const [name, value] of Object.entries(frame.savedVars)) {
        if (value === undefined) {
          delete state.vars[name];
        } else {
          state.vars[name] = value;
        }
      }
    }
    state.pc = frame.returnTo;
    return state;
  }

  state.halted = true;
  if (!state.haltReason) {
    state.haltReason = t('halt.noSuccessor');
    state.haltCategory = 'normal';
  }
  state.pc = null;
  return state;
}

export function step(input: StepInput, state: RuntimeState): RuntimeState {
  // Deep-clone the table arrays so the previous step's state is untouched if
  // the caller keeps a reference (e.g. for undo).
  const clonedVars: Record<string, RuntimeValue> = {};
  for (const [k, v] of Object.entries(state.vars)) {
    if (Array.isArray(v)) {
      // Deep clone one level — for event-table-arrays each inner queue is its
      // own number[] and must be cloned so a step doesn't mutate the prior
      // state's inner array reference.
      clonedVars[k] = (v as unknown[]).map((el) =>
        Array.isArray(el) ? [...(el as number[])] : (el as number),
      ) as RuntimeValue;
    } else {
      clonedVars[k] = v;
    }
  }
  const next: RuntimeState = {
    ...state,
    vars: clonedVars,
    output: [...state.output],
    returnStack: [...state.returnStack],
  };
  return stepRuntime(input, next);
}

export function eventTablesOf(variables: ModelVariable[]): TableSet {
  const out = new Set<string>();
  for (const v of variables) {
    if (v.kind === 'event-table') out.add(v.name);
  }
  return out;
}

export function eventTableArraysOf(variables: ModelVariable[]): TableSet {
  const out = new Set<string>();
  for (const v of variables) {
    if (v.kind === 'event-table-array') out.add(v.name);
  }
  return out;
}
