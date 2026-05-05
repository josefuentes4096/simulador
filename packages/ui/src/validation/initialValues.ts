// Cross-checks the Initial Conditions block(s) against the Variables
// table. The user can set a variable's seed value in two places:
//
//   - Variables panel → `initialValue` field on the ModelVariable.
//   - Initial Conditions node label → free-text lines like `TPLL = 0`.
//
// Both paths feed the runtime (initialRuntime applies `initialValue` first,
// then the diagram walks through the CI block's assignments which can
// override). They drift easily — a user changes one and forgets the other.
//
// This module parses the CI block's lines and exposes a comparison helper
// so the validator and field-level rules can flag divergences in red.

import type { ModelNode, ModelVariable, ScalarValue } from '@simulador/shared';

export type ParsedCiValueMap = Map<string, ParsedCiValue>;

export type ParsedCiValue =
  // Recognized JS literal — comparable against the Variables panel's
  // `initialValue` (also a literal). Booleans and strings are supported in
  // case the user types `Arrepentimiento = false` etc.
  | { kind: 'literal'; value: ScalarValue }
  // Anything else: arithmetic, function calls, identifier references, …
  // We can't statically compare to a literal so we just record the source
  // and skip the divergence check.
  | { kind: 'expr'; source: string };

// Parse one CI line of the form `IDENT = <rhs>`. Whitespace is forgiving;
// returns null when the line doesn't look like an assignment (e.g., a
// freeform comment or a declaration the user is in the middle of typing).
export function parseCiLine(line: string): { name: string; value: ParsedCiValue } | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  // Skip comment-style lines.
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) return null;
  const m = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+)$/u.exec(trimmed);
  if (!m) return null;
  const name = m[1]!;
  const rhs = m[2]!.trim();
  return { name, value: parseRhs(rhs) };
}

function parseRhs(rhs: string): ParsedCiValue {
  // Boolean / null literal first — JSON.parse can handle these too but
  // matching by-string is faster and avoids accepting things like `0`
  // as a number while losing intent.
  if (rhs === 'true') return { kind: 'literal', value: true };
  if (rhs === 'false') return { kind: 'literal', value: false };
  // Numeric: integer / float / scientific. Negative numbers are part of
  // the regex so the rhs of `STO = -1` parses as a literal.
  if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(rhs)) {
    const n = Number(rhs);
    if (Number.isFinite(n)) return { kind: 'literal', value: n };
  }
  // Quoted string literal: support both single and double quotes since
  // users mix them.
  const sm = /^(["'])(.*)\1$/.exec(rhs);
  if (sm) return { kind: 'literal', value: sm[2] ?? '' };
  return { kind: 'expr', source: rhs };
}

// Walks every initialConditions node and merges their assignments into a
// single Map<name → parsed>. When the same variable is set in multiple CI
// blocks, the last one wins (matches the runtime, which executes them in
// graph order).
export function extractAllCiValues(nodes: ModelNode[]): Map<string, ParsedCiValue> {
  const out = new Map<string, ParsedCiValue>();
  for (const n of nodes) {
    if (n.type !== 'initialConditions') continue;
    const label = typeof n.label === 'string' ? n.label : '';
    for (const line of label.split('\n')) {
      const parsed = parseCiLine(line);
      if (!parsed) continue;
      out.set(parsed.name, parsed.value);
    }
  }
  return out;
}

// Compare a Variables-panel literal against a parsed CI literal. Returns
// false when either side is missing / non-literal — only literal-vs-literal
// disagreement counts as a divergence the user can act on.
function literalsDiffer(panel: ScalarValue, ciVal: ParsedCiValue): boolean {
  if (ciVal.kind !== 'literal') return false;
  return panel !== ciVal.value;
}

// Predicate consumed by fieldRules / VariablesPanel / the LabelInput
// mirror in CI nodes. True ⇔ the variable is declared in the panel AND
// the C.I. block declares a literal that doesn't match the panel's
// `initialValue`.
//
// The strict rule is: if a variable is in the table AND the C.I. assigns
// it a literal, the two must agree. An undefined `initialValue` (panel
// row exists but no seed entered) counts as a divergence — the user has
// to either fill in the panel or remove the C.I. line.
//
// Exception: `kind === 'data'` is exempt because the panel disables its
// `initialValue` input by convention (data is generated each step), so
// flagging it would be unfixable from the panel.
export function variableInitialDiverges(
  variable: ModelVariable,
  ciValues: Map<string, ParsedCiValue>,
): boolean {
  const ci = ciValues.get(variable.name);
  if (!ci || ci.kind !== 'literal') return false;
  if (Array.isArray(variable.initialValue)) return false;
  if (variable.kind === 'data') return false;
  if (variable.initialValue === undefined) return true;
  return literalsDiffer(variable.initialValue, ci);
}

// Same predicate but answering "for THIS CI line, is there a panel value
// that disagrees?". Used by the InitialConditions node label mirror to
// paint just the offending line red.
export function ciLineDiverges(
  name: string,
  ci: ParsedCiValue,
  variables: ModelVariable[],
): boolean {
  if (ci.kind !== 'literal') return false;
  const v = variables.find((x) => x.name === name);
  if (!v || v.initialValue === undefined) return false;
  if (Array.isArray(v.initialValue)) return false;
  return literalsDiffer(v.initialValue, ci);
}
