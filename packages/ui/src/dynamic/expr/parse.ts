// Recursive-descent parser for the expression grammar in §6.1 of the spec.
//
// Precedence (low → high):
//   OR
//   AND
//   NOT (unary)
//   = <> < <= > >=
//   + -
//   * / MOD
//   unary + -
//   ^ (right-assoc)
//   atom: number | identifier | (expr) | builtin(args) | IF/THEN/ELSE

import type { Expr } from './ast';
import { tokenize, type Token } from './tokenize';

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
  ) {
    super(message);
  }
}

class Parser {
  i = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(): Token {
    return this.toks[this.i]!;
  }
  private eat(): Token {
    return this.toks[this.i++]!;
  }
  private match(kind: Token['kind'], value?: string): boolean {
    const t = this.peek();
    if (t.kind !== kind) return false;
    if (value !== undefined && t.value !== value) return false;
    this.i++;
    return true;
  }
  private expect(kind: Token['kind'], value?: string): Token {
    const t = this.peek();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new ParseError(
        `Expected ${value ?? kind} but found '${t.value}' (${t.kind})`,
        t.pos,
      );
    }
    return this.eat();
  }

  parse(): Expr {
    const e = this.or();
    const t = this.peek();
    if (t.kind !== 'eof') {
      throw new ParseError(`Unexpected '${t.value}' at end of expression`, t.pos);
    }
    return e;
  }

  private or(): Expr {
    let left = this.and();
    while (this.match('keyword', 'OR')) {
      const right = this.and();
      left = { kind: 'binary', op: 'OR', left, right };
    }
    return left;
  }
  private and(): Expr {
    let left = this.not();
    while (this.match('keyword', 'AND')) {
      const right = this.not();
      left = { kind: 'binary', op: 'AND', left, right };
    }
    return left;
  }
  private not(): Expr {
    if (this.match('keyword', 'NOT')) {
      return { kind: 'unary', op: 'NOT', operand: this.not() };
    }
    return this.cmp();
  }
  private cmp(): Expr {
    const left = this.sum();
    const t = this.peek();
    if (
      t.kind === 'op' &&
      (t.value === '=' ||
        t.value === '<>' ||
        t.value === '<' ||
        t.value === '<=' ||
        t.value === '>' ||
        t.value === '>=')
    ) {
      this.eat();
      const right = this.sum();
      return { kind: 'binary', op: t.value as '=' | '<>' | '<' | '<=' | '>' | '>=', left, right };
    }
    return left;
  }
  private sum(): Expr {
    let left = this.product();
    while (true) {
      const t = this.peek();
      if (t.kind === 'op' && (t.value === '+' || t.value === '-')) {
        this.eat();
        const right = this.product();
        left = { kind: 'binary', op: t.value as '+' | '-', left, right };
      } else break;
    }
    return left;
  }
  private product(): Expr {
    let left = this.unary();
    while (true) {
      const t = this.peek();
      if (t.kind === 'op' && (t.value === '*' || t.value === '/')) {
        this.eat();
        const right = this.unary();
        left = { kind: 'binary', op: t.value as '*' | '/', left, right };
      } else if (t.kind === 'keyword' && t.value === 'MOD') {
        this.eat();
        const right = this.unary();
        left = { kind: 'binary', op: 'MOD', left, right };
      } else break;
    }
    return left;
  }
  private unary(): Expr {
    const t = this.peek();
    if (t.kind === 'op' && (t.value === '+' || t.value === '-')) {
      this.eat();
      return { kind: 'unary', op: t.value as '+' | '-', operand: this.unary() };
    }
    return this.power();
  }
  private power(): Expr {
    const left = this.atom();
    if (this.peek().kind === 'op' && this.peek().value === '^') {
      this.eat();
      const right = this.unary(); // right-assoc
      return { kind: 'binary', op: '^', left, right };
    }
    return left;
  }
  private atom(): Expr {
    const t = this.peek();
    if (t.kind === 'number') {
      this.eat();
      return { kind: 'number', value: Number(t.value) };
    }
    if (t.kind === 'op' && t.value === '(') {
      this.eat();
      const e = this.or();
      this.expect('op', ')');
      return e;
    }
    if (t.kind === 'keyword' && t.value === 'IF') {
      this.eat();
      const cond = this.or();
      this.expect('keyword', 'THEN');
      const then = this.or();
      this.expect('keyword', 'ELSE');
      const els = this.or();
      return { kind: 'if', cond, then, else: els };
    }
    if (t.kind === 'identifier') {
      this.eat();
      // Function call?
      if (this.peek().kind === 'op' && this.peek().value === '(') {
        this.eat();
        const args: Expr[] = [];
        if (!(this.peek().kind === 'op' && this.peek().value === ')')) {
          args.push(this.or());
          while (this.match('op', ',')) {
            args.push(this.or());
          }
        }
        this.expect('op', ')');
        return { kind: 'call', name: t.value, args };
      }
      return { kind: 'ref', name: t.value };
    }
    throw new ParseError(`Unexpected '${t.value}'`, t.pos);
  }
}

export function parse(source: string): Expr {
  const toks = tokenize(source);
  return new Parser(toks).parse();
}
