// AST node types for the expression language.
// Intentionally small: the gramatical hierarchy of the spec collapses down to
// a handful of node kinds at runtime.

export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; name: string } // identifier — variable or 0-arg builtin
  | { kind: 'unary'; op: '+' | '-' | 'NOT'; operand: Expr }
  | {
      kind: 'binary';
      op:
        | '+'
        | '-'
        | '*'
        | '/'
        | '^'
        | 'MOD'
        | 'AND'
        | 'OR'
        | '='
        | '<>'
        | '<'
        | '<='
        | '>'
        | '>=';
      left: Expr;
      right: Expr;
    }
  | { kind: 'if'; cond: Expr; then: Expr; else: Expr }
  | { kind: 'call'; name: string; args: Expr[] };
