import { parse } from '../src/parser.js';
import { run } from '../src/interpreter.js';
import { buildPayload } from '../src/model-util.js';
import { teachPack } from '../src/teach.js';
import { gbnf } from '../src/grammar.js';
import { test, eq, ok, throws } from './harness.mjs';

// A model backend driven by a scripted function.
const scriptModel = (fn) => ({ async complete(args) { return fn(args); } });

const exec = (src, entry, args, opts) => run(parse(src), entry, args, opts);

test('interp: require + return text', async () => {
  const out = await exec(
    `flow f(t: text) -> text { require t != ""  return t }`,
    'f', ['hi'], { model: scriptModel(() => 'x') });
  eq(out, 'hi');
});

test('interp: failed require halts', async () => {
  await throws(() => exec(
    `flow f(t: text) -> text { require t != ""  return t }`,
    'f', [''], { model: scriptModel(() => 'x') }));
});

test('interp: soft call result + prompt interpolation', async () => {
  let seen = '';
  const m = scriptModel(({ prompt }) => { seen = prompt; return 'OUT'; });
  const out = await exec(
    `agent w { model: x }
flow f(t: text) -> text { w("hi {t}") -> d: text  return d }`,
    'f', ['Ada'], { model: m });
  eq(out, 'OUT');
  ok(seen.includes('hi Ada'), 'interpolated prompt was: ' + seen);
});

test('interp: REPAIR LOOP fixes a failing ensure', async () => {
  let calls = 0;
  const m = scriptModel(({ prompt }) => {
    calls++;
    return prompt.includes('previous output violated')
      ? { body: 'short' }
      : { body: 'this body is far too long to pass' };
  });
  const out = await exec(
    `type P = { body: text }
agent w { model: x  retry: 3 }
flow f() -> P { w("go") -> d: P  ensure d.body.length <= 10  return d }`,
    'f', [], { model: m });
  eq(out, { body: 'short' });
  eq(calls, 2);
});

test('interp: ensure fails after retries -> halt', async () => {
  const m = scriptModel(() => ({ body: 'always too long' }));
  await throws(() => exec(
    `type P = { body: text }
agent w { model: x  retry: 1 }
flow f() -> P { w("go") -> d: P  ensure d.body.length <= 3  return d }`,
    'f', [], { model: m }));
});

test('interp: for loop runs body once per item', async () => {
  let count = 0;
  const m = scriptModel(({ returnType }) =>
    returnType && returnType.t === 'list' ? ['a', 'b', 'c'] : true);
  const tools = { tick: async () => { count++; return true; } };
  const out = await exec(
    `agent w { model: x }
tool tick(s: text) -> bool
flow f() -> text { w("x") -> items: list<text>  for it in items { ensure tick(it) }  return "done" }`,
    'f', [], { model: m, tools });
  eq(out, 'done');
  eq(count, 3);
});

test('interp: builtins no_em_dashes + contains', async () => {
  const m = scriptModel(() => 'clean text');
  const out = await exec(
    `agent w { model: x }
flow f() -> text { w("x") -> d: text  ensure no_em_dashes(d)  ensure contains(d, "clean")  return d }`,
    'f', [], { model: m });
  eq(out, 'clean text');
});

test('interp: identical soft calls are cached', async () => {
  let calls = 0;
  const m = scriptModel(() => { calls++; return 'v'; });
  await exec(
    `agent w { model: x }
flow f() -> text { w("same") -> a: text  w("same") -> b: text  return b }`,
    'f', [], { model: m });
  eq(calls, 1);
});

test('interp: if/else branches', async () => {
  const m = scriptModel(({ prompt }) => prompt);
  const out = await exec(
    `agent w { model: x }
flow f(t: text) -> text { if t == "a" { w("AY") -> r: text } else { w("BEE") -> r: text }  return r }`,
    'f', ['b'], { model: m });
  eq(out, 'BEE');
});

test('interp: agent persona is passed to the model', async () => {
  let seen = '';
  const m = { async complete({ agent }) { seen = agent && agent.persona; return 'x'; } };
  await exec(
    `agent w { model: x  persona: "be terse" }
flow f() -> text { w("hi") -> d: text  return d }`,
    'f', [], { model: m });
  eq(seen, 'be terse');
});

test('model-util: persona is included in the payload', () => {
  const { stdin } = buildPayload('do the thing', { t: 'prim', name: 'text' }, 'be terse');
  ok(stdin.includes('be terse'), 'payload should carry the persona: ' + stdin);
});

test('interp: judge contract passes when the reviewer says PASS', async () => {
  const m = { async complete({ prompt }) {
    if (String(prompt).includes('Reply with PASS or FAIL')) return 'PASS. on-brand';
    return { body: 'short' };
  } };
  const out = await exec(
    `type P = { body: text }
agent w { model: x }
agent critic { model: x }
flow f() -> P { w("go") -> d: P  ensure judge(critic, "on-brand?", d.body)  return d }`,
    'f', [], { model: m });
  eq(out, { body: 'short' });
});

test('interp: failing judge triggers repair and self-corrects', async () => {
  const m = { async complete({ prompt }) {
    const p = String(prompt);
    if (p.includes('Reply with PASS or FAIL')) return p.includes('good copy') ? 'PASS. solid' : 'FAIL. too generic';
    return { body: p.includes('previous output violated') ? 'good copy' : 'generic' };
  } };
  const out = await exec(
    `type P = { body: text }
agent w { model: x  retry: 3 }
agent critic { model: x }
flow f() -> P { w("go") -> d: P  ensure judge(critic, "specific?", d.body)  return d }`,
    'f', [], { model: m });
  eq(out, { body: 'good copy' });
});

test('interp: agent with tools runs a ReAct loop and calls the tool', async () => {
  let searched = null;
  const tools = { web_search: async (q) => { searched = q; return ['fact A', 'fact B']; } };
  const m = { async complete({ prompt }) {
    const p = String(prompt);
    if (p.includes('CALL <tool>')) return p.includes('Result:') ? 'DONE' : 'CALL web_search ["quartz"]';
    return p.includes('fact A') ? 'used the gathered facts' : 'no facts';
  } };
  const out = await exec(
    `tool web_search(q: text) -> list<text>
agent r { model: x  tools: [web_search] }
flow f() -> text { r("research quartz") -> d: text  return d }`,
    'f', [], { model: m, tools });
  eq(searched, 'quartz');
  eq(out, 'used the gathered facts');
});

test('interp: review auto-approves with no reviewer wired', async () => {
  const m = { async complete() { return 'x'; } };
  const out = await exec(
    `agent w { model: x }
flow f() -> text { w("hi") -> d: text  review d -> ok: text  return ok }`,
    'f', [], { model: m });
  eq(out, 'x');
});

test('interp: review can reject and halt', async () => {
  const m = { async complete() { return 'x'; } };
  await throws(() => exec(
    `agent w { model: x }
flow f() -> text { w("hi") -> d: text  review d -> ok: text  return ok }`,
    'f', [], { model: m, onReview: () => ({ approved: false }) }));
});

test('interp: parallel runs binds and captures all results', async () => {
  const m = { async complete({ prompt }) { return String(prompt).includes('A') ? 'aa' : 'bb'; } };
  const out = await exec(
    `agent w { model: x }
flow f() -> text { parallel { w("A") -> a: text  w("B") -> b: text }  return a }`,
    'f', [], { model: m });
  eq(out, 'aa');
});

test('interp: agent budget halts after its call limit', async () => {
  const m = { async complete() { return { body: 'x' }; } };
  await throws(() => exec(
    `type P = { body: text }
agent w { model: x  budget: 1 }
flow f() -> P { w("1") -> a: P  w("2") -> b: P  return b }`,
    'f', [], { model: m }));
});

test('interp: session memory feeds earlier exchanges back', async () => {
  let secondSent = '';
  let n = 0;
  const m = { async complete({ prompt }) { n++; if (n === 2) secondSent = String(prompt); return 'r' + n; } };
  await exec(
    `agent w { model: x  memory: session }
flow f() -> text { w("first question") -> a: text  w("second question") -> b: text  return b }`,
    'f', [], { model: m });
  ok(secondSent.includes('Earlier in this session') && secondSent.includes('first question'), secondSent);
});

test('interp: remember then recall round-trips via the store', async () => {
  const store = new Map();
  const m = { async complete() { return 'ok'; } };
  const out = await exec(
    `flow f() -> text { remember("k", "saved value") -> w: bool  recall("k") -> v: text  return v }`,
    'f', [], { model: m, memory: store });
  eq(out, 'saved value');
});

test('teach: the language pack covers the core constructs', () => {
  for (const kw of ['flow', 'agent', 'tool', 'ensure', 'judge', 'parallel', 'review', 'recall']) {
    ok(teachPack.includes(kw), 'teach pack is missing: ' + kw);
  }
});

test('grammar: GBNF is self-consistent (every referenced rule is defined)', () => {
  const defined = new Set();
  for (const line of gbnf.split('\n')) {
    const m = line.match(/^([a-zA-Z_]\w*)\s*::=/);
    if (m) defined.add(m[1]);
  }
  ok(defined.has('root'), 'no root rule');
  const refs = new Set();
  for (const line of gbnf.split('\n')) {
    const idx = line.indexOf('::=');
    const body = (idx >= 0 ? line.slice(idx + 3) : line)
      .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ');
    for (const t of body.match(/[a-zA-Z_]\w*/g) || []) refs.add(t);
  }
  const undef = [...refs].filter(r => !defined.has(r));
  ok(undef.length === 0, 'undefined GBNF rules: ' + undef.join(', '));
});
