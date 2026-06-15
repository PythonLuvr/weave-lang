import { tokenize } from '../src/lexer.js';
import { test, eq, ok } from './harness.mjs';

test('lexer: keywords and idents', () => {
  const vals = tokenize('flow x ( a : text )').map(t => t.value);
  ok(vals.includes('flow') && vals.includes('x') && vals.includes('text'), vals.join(','));
});

test('lexer: multi-char ops', () => {
  const ops = tokenize('a -> b == c != d <= e >= f && g || h').filter(t => t.type === 'op').map(t => t.value);
  eq(ops, ['->', '==', '!=', '<=', '>=', '&&', '||']);
});

test('lexer: string keeps interpolation braces literal', () => {
  const t = tokenize('"hi {x}"');
  eq(t[0].type, 'string');
  eq(t[0].value, 'hi {x}');
});

test('lexer: line comments ignored', () => {
  const t = tokenize('// a comment\nflow');
  eq(t[0].value, 'flow');
});

test('lexer: string escapes', () => {
  const t = tokenize('"a\\"b\\nc"');
  eq(t[0].value, 'a"b\nc');
});

test('lexer: ends with eof', () => {
  const t = tokenize('flow');
  eq(t[t.length - 1].type, 'eof');
});
