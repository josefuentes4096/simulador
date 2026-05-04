// Extract the set of variable identifiers referenced by an expression,
// excluding builtins and special vars (TIME / DT / STARTTIME / STOPTIME /
// PI). Used by the inspector to validate Required Inputs (§6.4 of the spec).

import type { Expr } from './ast';
import { ALL_BUILTIN_NAMES } from './builtins';

export function extractReferences(expr: Expr): Set<string> {
  const out = new Set<string>();
  function walk(e: Expr) {
    switch (e.kind) {
      case 'number':
        return;
      case 'ref': {
        const upper = e.name.toUpperCase();
        if (!ALL_BUILTIN_NAMES.has(upper)) out.add(e.name);
        return;
      }
      case 'unary':
        walk(e.operand);
        return;
      case 'binary':
        walk(e.left);
        walk(e.right);
        return;
      case 'if':
        walk(e.cond);
        walk(e.then);
        walk(e.else);
        return;
      case 'call':
        // Function name ≠ variable; arguments are walked normally. Builtins
        // get filtered above; user-defined functions don't exist in v1.
        for (const a of e.args) walk(a);
        return;
    }
  }
  walk(expr);
  return out;
}
