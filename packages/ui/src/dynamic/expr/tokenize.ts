// Tokenizer for the Stella-style expression language.
//
// Token kinds:
//   - number       e.g. 1, 1.5, 1e3, 1.5e-2
//   - identifier   variable / function names (case-sensitive at lookup time)
//   - keyword      IF/THEN/ELSE/AND/OR/NOT/MOD (case-insensitive)
//   - op           + - * / ^ = <> < <= > >= , ( )
//
// Whitespace and newlines separate tokens but carry no other meaning.

export type TokenKind = 'number' | 'identifier' | 'keyword' | 'op' | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  // 0-based offset into the source text — used to render error markers in
  // the inspector down the road.
  pos: number;
}

const KEYWORDS = new Set([
  'IF',
  'THEN',
  'ELSE',
  'AND',
  'OR',
  'NOT',
  'MOD',
]);

const TWO_CHAR_OPS = new Set(['<=', '>=', '<>']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '^', '=', '<', '>', ',', '(', ')']);

export class TokenizeError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
  ) {
    super(message);
  }
}

export function tokenize(source: string): Token[] {
  const out: Token[] = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i]!;
    // Whitespace.
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    // Number: digits, optional fractional part, optional exponent. Doesn't
    // start with a sign — unary minus is handled by the parser.
    if (c >= '0' && c <= '9') {
      const start = i;
      while (i < n && source[i]! >= '0' && source[i]! <= '9') i++;
      if (source[i] === '.') {
        i++;
        while (i < n && source[i]! >= '0' && source[i]! <= '9') i++;
      }
      if (source[i] === 'e' || source[i] === 'E') {
        i++;
        if (source[i] === '+' || source[i] === '-') i++;
        while (i < n && source[i]! >= '0' && source[i]! <= '9') i++;
      }
      out.push({ kind: 'number', value: source.slice(start, i), pos: start });
      continue;
    }
    // Identifier or keyword: starts with letter/underscore.
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      const start = i;
      while (i < n) {
        const cc = source[i]!;
        if (
          (cc >= 'a' && cc <= 'z') ||
          (cc >= 'A' && cc <= 'Z') ||
          (cc >= '0' && cc <= '9') ||
          cc === '_'
        ) {
          i++;
        } else {
          break;
        }
      }
      const text = source.slice(start, i);
      if (KEYWORDS.has(text.toUpperCase())) {
        out.push({ kind: 'keyword', value: text.toUpperCase(), pos: start });
      } else {
        out.push({ kind: 'identifier', value: text, pos: start });
      }
      continue;
    }
    // Two-char op?
    if (i + 1 < n) {
      const two = source.slice(i, i + 2);
      if (TWO_CHAR_OPS.has(two)) {
        out.push({ kind: 'op', value: two, pos: i });
        i += 2;
        continue;
      }
    }
    if (ONE_CHAR_OPS.has(c)) {
      out.push({ kind: 'op', value: c, pos: i });
      i++;
      continue;
    }
    throw new TokenizeError(`Unexpected character '${c}' at position ${i}`, i);
  }
  out.push({ kind: 'eof', value: '', pos: n });
  return out;
}
