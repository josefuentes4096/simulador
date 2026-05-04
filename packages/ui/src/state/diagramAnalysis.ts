// Cross-references between the diagram (node labels / formulas) and the
// Variables panel:
// - `undefinedRefs`: identifiers used in the diagram but absent from the
//   variables list. Drives the red highlighting inside node labels.
// - `unusedVars`:    variables in the panel never referenced in the diagram.
//   Drives the red highlighting on the variable's name input.

// JS reserved words plus simulator built-ins. These are NOT treated as
// variable references — even if they happen to appear in a label, they
// shouldn't be flagged as undefined.
const KEYWORDS = new Set([
  'if', 'else', 'true', 'false', 'null', 'undefined',
  'while', 'for', 'do', 'return', 'var', 'let', 'const',
  'function', 'in', 'of', 'typeof', 'instanceof', 'new', 'delete', 'void',
  'try', 'catch', 'finally', 'throw', 'switch', 'case', 'break', 'continue',
  'this', 'super',
  // JS globals seen in formulas
  'Math', 'Number', 'Boolean', 'String', 'Array', 'Object',
  'Infinity', 'NaN', 'JSON',
  // Simulator built-ins / sentinels
  'RND', 'HV',
  // Decision-edge labels
  'sí', 'si', 'no', 'yes',
]);

// Identifier head (incl. accented Unicode letters) preceded by anything that
// isn't `.` or another identifier char — so member accesses like `Math.sqrt`
// don't pull `sqrt` into the "used" set.
const IDENT_RE = /(?<![.\p{L}\p{N}_])[\p{L}_][\p{L}\p{N}_]*/gu;

export function extractIdents(text: string): string[] {
  const out: string[] = [];
  IDENT_RE.lastIndex = 0;
  let m;
  while ((m = IDENT_RE.exec(text)) !== null) {
    if (!KEYWORDS.has(m[0])) out.push(m[0]);
  }
  return out;
}

// Comma-split that respects (), [] and {} nesting so arg expressions
// containing commas (like `f(a, b)` or `[1,2]`) stay intact.
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      const piece = s.slice(start, i).trim();
      if (piece) out.push(piece);
      start = i + 1;
    }
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// Subroutine CALL labels:
//   - `X`                       → call X, no args, no return assign
//   - `Y = X`                   → call X, on return copy X → Y
//   - `X ARG1, ARG2`            → call X with args
//   - `Y = X ARG1, ARG2`        → call X with args, on return copy X → Y
// Args are arbitrary JS expressions evaluated in the caller's scope at call
// time. They get bound to the entry's declared parameter names inside the
// procedure body.
export function parseSubroutineLabel(label: string): {
  procName: string;
  assignTo: string | null;
  args: string[];
} {
  const trimmed = label.trim();
  const m = /^(?:([\p{L}_][\p{L}\p{N}_]*)\s*=\s*)?([\p{L}_][\p{L}\p{N}_]*)(?:\s+(.+))?$/u.exec(
    trimmed,
  );
  if (!m) return { procName: trimmed, assignTo: null, args: [] };
  const args = m[3] ? splitArgs(m[3]) : [];
  return { procName: m[2]!, assignTo: m[1] ?? null, args };
}

// Subroutine ENTRY labels:
//   - `X`                  → procedure X, no parameters
//   - `X PARAM1, PARAM2`   → procedure X declaring two parameters
// Params must be plain identifiers — anything that isn't a valid JS
// identifier is silently dropped (the entry stays addressable by name).
export function parseSubroutineEntry(label: string): { procName: string; params: string[] } {
  const trimmed = label.trim();
  const m = /^([\p{L}_][\p{L}\p{N}_]*)(?:\s+(.+))?$/u.exec(trimmed);
  if (!m) return { procName: trimmed, params: [] };
  const raw = m[2] ? splitArgs(m[2]) : [];
  const params = raw.filter((p) => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(p));
  return { procName: m[1]!, params };
}

// Tokenize a label line into runs of identifiers and runs of non-identifier
// chars. Used by the mirror to wrap each identifier in its own <span> so
// undefined-reference styling can target the exact characters.
export interface Token {
  value: string;
  isIdent: boolean;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Plain identifier match (no `.` exclusion here — that's only for the
  // *use* tracking. The mirror still needs to wrap every identifier so
  // styling can apply to it.)
  const re = /[\p{L}_][\p{L}\p{N}_]*/gu;
  let lastEnd = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastEnd) {
      tokens.push({ value: text.slice(lastEnd, m.index), isIdent: false });
    }
    tokens.push({ value: m[0], isIdent: true });
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) {
    tokens.push({ value: text.slice(lastEnd), isIdent: false });
  }
  return tokens;
}

export interface DiagramAnalysis {
  undefinedRefs: Set<string>;
  unusedVars: Set<string>;
  /** Names of variables declared with `kind === 'data'`. Used by the
   *  routine-function-block rule (label must reference a Dato variable). */
  dataVarNames: Set<string>;
}

interface NodeShape {
  type?: string;
  data?: Record<string, unknown> | undefined;
}

interface VariableShape {
  name: string;
  kind: string;
}

export function analyzeDiagram(
  nodes: ReadonlyArray<NodeShape>,
  variables: ReadonlyArray<VariableShape>,
): DiagramAnalysis {
  const defined = new Set(variables.map((v) => v.name));
  const dataVarNames = new Set(
    variables.filter((v) => v.kind === 'data').map((v) => v.name),
  );
  // Subroutine procedure names — labels of routine blocks that are subroutine
  // calls or legacy procedure entries. These names live in the diagram only;
  // they aren't variables in the panel. The same name may also be used as
  // the implicit local return variable inside the subroutine body, so we
  // accept references to these names without flagging them as undefined.
  const subroutineNames = new Set<string>();
  const used = new Set<string>();

  const collect = (text: unknown) => {
    if (typeof text !== 'string') return;
    extractIdents(text).forEach((id) => used.add(id));
  };

  for (const n of nodes) {
    const data = n.data ?? {};
    const label = typeof data.label === 'string' ? data.label : '';
    switch (n.type) {
      case 'assignment':
      case 'initialConditions':
      case 'decision':
      case 'salida':
        collect(label);
        break;
      case 'loop':
        // Iterador block — the counter is assigned, init/final are
        // expressions evaluated each iteration.
        collect(data.counter);
        collect(data.init);
        collect(data.final);
        break;
      case 'routine': {
        const ck = data.callKind;
        if (ck === 'function') {
          // Label is the variable that receives the function's result.
          collect(label);
          collect(data.formula);
        } else if (ck === 'subroutine') {
          // Subroutine call — label may include args.
          const { procName, assignTo, args } = parseSubroutineLabel(label);
          if (procName) subroutineNames.add(procName);
          if (assignTo) used.add(assignTo);
          // Each arg is a JS expression evaluated in caller's scope.
          for (const a of args) collect(a);
        } else {
          // Procedure entry — label is `NAME` or `NAME PARAM1, PARAM2`. Track
          // the procedure name and the parameter names (as known identifiers
          // bound at call time, so refs inside the sub body don't flag).
          const { procName, params } = parseSubroutineEntry(label);
          if (procName) subroutineNames.add(procName);
          for (const p of params) subroutineNames.add(p);
        }
        break;
      }
      // comment, connector, titleBlock — no analysis.
      default:
        break;
    }
  }

  // Runtime built-ins — always defined, never need a panel declaration. T is
  // the simulation clock, TF the horizon.
  const BUILTINS = new Set(['T', 'TF']);

  const undefinedRefs = new Set<string>();
  for (const id of used) {
    if (!defined.has(id) && !subroutineNames.has(id) && !BUILTINS.has(id)) {
      undefinedRefs.add(id);
    }
  }

  const unusedVars = new Set<string>();
  for (const name of defined) {
    if (!used.has(name)) unusedVars.add(name);
  }

  return { undefinedRefs, unusedVars, dataVarNames };
}
