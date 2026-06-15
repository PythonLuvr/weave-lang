import { parse } from '../src/parser.js';
import { test, eq, ok } from './harness.mjs';

const SRC = `
type Post = { body: text  cta: text }
tool fc(c: text) -> bool
agent w { model: claude  retry: 2 }
flow f(t: text) -> Post {
  require t != ""
  w("hi {t}") -> d: Post
  ensure d.body.length <= 10
  for x in items { ensure fc(x) }
  if t == "a" { w("x") -> r } else { w("y") -> r }
  return d
}`;

test('parser: top-level decl kinds', () => {
  const p = parse(SRC);
  eq(p.decls.map(d => d.kind), ['TypeDecl', 'ToolDecl', 'AgentDecl', 'FlowDecl']);
});

test('parser: record type fields', () => {
  const t = parse(SRC).decls[0];
  eq(t.type.t, 'record');
  eq(t.type.fields.map(f => f.name), ['body', 'cta']);
});

test('parser: enum (string union) type', () => {
  const p = parse('type Mood = "good" | "bad" | "ok"');
  eq(p.decls[0].type.t, 'enum');
  eq(p.decls[0].type.members, ['good', 'bad', 'ok']);
});

test('parser: list type', () => {
  const p = parse('tool s(q: text) -> list<text>');
  eq(p.decls[0].ret.t, 'list');
  eq(p.decls[0].ret.elem.t, 'prim');
});

test('parser: flow body statement kinds', () => {
  const flow = parse(SRC).decls.find(d => d.kind === 'FlowDecl');
  eq(flow.body.map(s => s.kind), ['Require', 'Bind', 'Ensure', 'For', 'If', 'Return']);
});

test('parser: bind captures name and type', () => {
  const flow = parse(SRC).decls.find(d => d.kind === 'FlowDecl');
  const bind = flow.body.find(s => s.kind === 'Bind');
  eq(bind.name, 'd');
  eq(bind.type.t, 'named');
});

test('parser: member + call expression shape', () => {
  const flow = parse(SRC).decls.find(d => d.kind === 'FlowDecl');
  const ens = flow.body.find(s => s.kind === 'Ensure');
  eq(ens.expr.kind, 'Binary');
  eq(ens.expr.op, '<=');
  ok(ens.expr.left.kind === 'Member', 'left should be member access');
});
