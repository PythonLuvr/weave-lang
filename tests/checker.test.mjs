import { parse } from '../src/parser.js';
import { check } from '../src/checker.js';
import { test, ok } from './harness.mjs';

const errs = (src) => check(parse(src)).errors;

test('checker: clean program has no errors', () => {
  const e = errs(`tool fc(c: text) -> bool
agent w { model: claude }
flow f(t: text) -> text {
  require t != ""
  w("{t}") -> d: text
  ensure no_em_dashes(d)
  return d
}`);
  ok(e.length === 0, 'expected none, got ' + JSON.stringify(e));
});

test('checker: unknown type is an error', () => {
  const e = errs(`flow f(t: Nope) -> text { return t }`);
  ok(e.some(x => x.includes("unknown type 'Nope'")), JSON.stringify(e));
});

test('checker: unknown binding is an error', () => {
  const e = errs(`flow f() -> text { return zzz }`);
  ok(e.some(x => x.includes("unknown binding 'zzz'")), JSON.stringify(e));
});

test('checker: missing return is an error', () => {
  const e = errs(`flow f(t: text) -> text { require t != "" }`);
  ok(e.some(x => x.includes('missing')), JSON.stringify(e));
});

test('FENCE: non-bool tool in a contract is rejected', () => {
  const e = errs(`tool t(c: text) -> text
agent w { model: claude }
flow f(x: text) -> text { w("{x}") -> d: text  ensure t(d)  return d }`);
  ok(e.some(x => /bool/i.test(x) && /fence/i.test(x)), JSON.stringify(e));
});

test('FENCE: unknown call in a contract is rejected', () => {
  const e = errs(`flow f(x: text) -> text { ensure mystery(x)  return x }`);
  ok(e.some(x => /fence/i.test(x) || /built-in lints/i.test(x)), JSON.stringify(e));
});

test('FENCE: bool tool and builtin are allowed in a contract', () => {
  const e = errs(`tool fc(c: text) -> bool
agent w { model: claude }
flow f(x: text) -> text { w("{x}") -> d: text  ensure fc(d)  ensure no_em_dashes(d)  return d }`);
  ok(e.length === 0, JSON.stringify(e));
});

test('checker: agent call as a bind is fine', () => {
  const e = errs(`agent w { model: claude }
flow f(x: text) -> text { w(x) -> d: text  ensure no_em_dashes(d)  return d }`);
  ok(e.length === 0, 'bind call should be ok: ' + JSON.stringify(e));
});

test('checker: agent called outside a bind is rejected', () => {
  const e = errs(`agent w { model: claude }
flow f(x: text) -> text { w(x)  return x }`);
  ok(e.some(x => /can only be called as a bind step/i.test(x)), JSON.stringify(e));
});

test('FENCE: judge in a contract is allowed with a declared agent', () => {
  const e = errs(`agent w { model: x }
agent critic { model: x }
flow f(t: text) -> text { w("{t}") -> d: text  ensure judge(critic, "good?", d)  return d }`);
  ok(e.length === 0, JSON.stringify(e));
});

test('FENCE: judge with a non-agent first arg is rejected', () => {
  const e = errs(`agent w { model: x }
flow f(t: text) -> text { w("{t}") -> d: text  ensure judge(d, "good?", d)  return d }`);
  ok(e.some(x => /judge/i.test(x) && /agent/i.test(x)), JSON.stringify(e));
});
