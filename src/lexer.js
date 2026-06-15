// lexer.js
// Turns Loom source text into a flat list of tokens.
// Token shape: { type, value, line, col }
// Types: 'ident' | 'number' | 'string' | 'op' | 'eof'
// Keywords are emitted as 'ident'; the parser decides meaning by value.

const TWO_CHAR_OPS = new Set(['->', '==', '!=', '<=', '>=', '&&', '||']);
const ONE_CHAR_OPS = new Set(['(', ')', '{', '}', '[', ']', '<', '>', ':', ',', '.', '=', '!', '|']);

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const peek = (o = 0) => src[i + o];
  const advance = () => {
    const ch = src[i++];
    if (ch === '\n') { line++; col = 1; } else { col++; }
    return ch;
  };

  while (i < src.length) {
    const ch = peek();

    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { advance(); continue; }

    // line comments
    if (ch === '/' && peek(1) === '/') {
      while (i < src.length && peek() !== '\n') advance();
      continue;
    }

    const startLine = line;
    const startCol = col;

    // string literal
    if (ch === '"') {
      advance(); // opening quote
      let value = '';
      while (i < src.length && peek() !== '"') {
        const c = advance();
        if (c === '\\') {
          const next = advance();
          if (next === 'n') value += '\n';
          else if (next === 't') value += '\t';
          else if (next === '"') value += '"';
          else if (next === '\\') value += '\\';
          else value += next;
        } else {
          value += c;
        }
      }
      if (peek() !== '"') throw lexError('unterminated string', startLine, startCol);
      advance(); // closing quote
      tokens.push({ type: 'string', value, line: startLine, col: startCol });
      continue;
    }

    // number literal
    if (isDigit(ch)) {
      let value = '';
      while (i < src.length && (isDigit(peek()) || peek() === '.')) value += advance();
      tokens.push({ type: 'number', value, line: startLine, col: startCol });
      continue;
    }

    // identifier or keyword
    if (isIdentStart(ch)) {
      let value = '';
      while (i < src.length && isIdentPart(peek())) value += advance();
      tokens.push({ type: 'ident', value, line: startLine, col: startCol });
      continue;
    }

    // two-char operators
    const two = ch + (peek(1) || '');
    if (TWO_CHAR_OPS.has(two)) {
      advance(); advance();
      tokens.push({ type: 'op', value: two, line: startLine, col: startCol });
      continue;
    }

    // one-char operators
    if (ONE_CHAR_OPS.has(ch)) {
      advance();
      tokens.push({ type: 'op', value: ch, line: startLine, col: startCol });
      continue;
    }

    throw lexError(`unexpected character ${JSON.stringify(ch)}`, startLine, startCol);
  }

  tokens.push({ type: 'eof', value: '', line, col });
  return tokens;
}

function isDigit(c) { return c >= '0' && c <= '9'; }
function isIdentStart(c) { return /[A-Za-z_]/.test(c); }
function isIdentPart(c) { return /[A-Za-z0-9_]/.test(c); }

function lexError(msg, line, col) {
  return new Error(`Lex error at ${line}:${col}: ${msg}`);
}
