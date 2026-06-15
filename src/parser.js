// parser.js
// Recursive-descent parser. Tokens in, AST out.
// Implements the v0 subset of the grammar in docs/DESIGN.md Appendix A:
// type / tool / agent / flow declarations, and the flow statement set
// (require, ensure, for, if, return, review, parallel, bind, expr).

import { tokenize } from './lexer.js';

const PRIMITIVES = new Set(['text', 'int', 'num', 'bool']);
const STMT_KEYWORDS = new Set(['require', 'ensure', 'for', 'if', 'return', 'review', 'parallel']);

export function parse(src) {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = (o = 0) => tokens[pos + o];
  const next = () => tokens[pos++];
  const atEof = () => peek().type === 'eof';

  function err(msg, tok = peek()) {
    return new Error(`Parse error at ${tok.line}:${tok.col}: ${msg} (got ${tok.type} ${JSON.stringify(tok.value)})`);
  }
  function isOp(v, o = 0) { const t = peek(o); return t.type === 'op' && t.value === v; }
  function isKw(v, o = 0) { const t = peek(o); return t.type === 'ident' && t.value === v; }
  function eatOp(v) { if (!isOp(v)) throw err(`expected '${v}'`); return next(); }
  function eatIdent() { if (peek().type !== 'ident') throw err('expected identifier'); return next().value; }

  // ---- declarations ----

  function parseProgram() {
    const decls = [];
    while (!atEof()) decls.push(parseDecl());
    return { kind: 'Program', decls };
  }

  function parseDecl() {
    if (isKw('type')) return parseTypeDecl();
    if (isKw('tool')) return parseToolDecl();
    if (isKw('agent')) return parseAgentDecl();
    if (isKw('flow')) return parseFlowDecl();
    throw err('expected a declaration (type, tool, agent, flow)');
  }

  function parseTypeDecl() {
    next(); // 'type'
    const name = eatIdent();
    eatOp('=');
    const type = parseType();
    return { kind: 'TypeDecl', name, type };
  }

  function parseToolDecl() {
    next(); // 'tool'
    const name = eatIdent();
    eatOp('(');
    const params = parseParams();
    eatOp(')');
    eatOp('->');
    const ret = parseType();
    return { kind: 'ToolDecl', name, params, ret };
  }

  function parseAgentDecl() {
    next(); // 'agent'
    const name = eatIdent();
    eatOp('{');
    const fields = {};
    while (!isOp('}')) {
      const key = eatIdent();
      eatOp(':');
      fields[key] = parseAgentValue();
      if (isOp(',')) next();
    }
    eatOp('}');
    return { kind: 'AgentDecl', name, fields };
  }

  function parseAgentValue() {
    const t = peek();
    if (t.type === 'string') { next(); return t.value; }
    if (t.type === 'number') { next(); return Number(t.value); }
    if (isOp('[')) {
      next();
      const items = [];
      while (!isOp(']')) {
        items.push(eatIdent());
        if (isOp(',')) next();
      }
      eatOp(']');
      return items;
    }
    if (t.type === 'ident') { next(); return t.value; }
    throw err('expected an agent field value');
  }

  function parseFlowDecl() {
    next(); // 'flow'
    const name = eatIdent();
    eatOp('(');
    const params = parseParams();
    eatOp(')');
    eatOp('->');
    const ret = parseType();
    eatOp('{');
    const body = [];
    while (!isOp('}')) body.push(parseStmt());
    eatOp('}');
    return { kind: 'FlowDecl', name, params, ret, body };
  }

  function parseParams() {
    const params = [];
    while (!isOp(')')) {
      const name = eatIdent();
      eatOp(':');
      const type = parseType();
      params.push({ name, type });
      if (isOp(',')) next();
    }
    return params;
  }

  // ---- types ----

  function parseType() {
    const first = parsePrimaryType();
    if (!isOp('|')) return first;
    const members = [first];
    while (isOp('|')) { next(); members.push(parsePrimaryType()); }
    if (members.every(m => m.t === 'lit')) {
      return { t: 'enum', members: members.map(m => m.value) };
    }
    return { t: 'union', options: members };
  }

  function parsePrimaryType() {
    const t = peek();
    if (t.type === 'string') { next(); return { t: 'lit', value: t.value }; }
    if (isOp('{')) return parseRecordType();
    if (isKw('list')) {
      next();
      eatOp('<');
      const elem = parseType();
      eatOp('>');
      return { t: 'list', elem };
    }
    if (t.type === 'ident') {
      next();
      if (PRIMITIVES.has(t.value)) return { t: 'prim', name: t.value };
      return { t: 'named', name: t.value };
    }
    throw err('expected a type');
  }

  function parseRecordType() {
    eatOp('{');
    const fields = [];
    while (!isOp('}')) {
      const name = eatIdent();
      eatOp(':');
      const type = parseType();
      fields.push({ name, type });
      if (isOp(',')) next();
    }
    eatOp('}');
    return { t: 'record', fields };
  }

  // ---- statements ----

  function parseStmt() {
    if (peek().type === 'ident' && STMT_KEYWORDS.has(peek().value)) {
      const kw = peek().value;
      if (kw === 'require') { next(); return { kind: 'Require', expr: parseExpr() }; }
      if (kw === 'ensure') { next(); return { kind: 'Ensure', expr: parseExpr() }; }
      if (kw === 'return') { next(); return { kind: 'Return', expr: parseExpr() }; }
      if (kw === 'for') return parseFor();
      if (kw === 'if') return parseIf();
      if (kw === 'review') return parseReview();
      if (kw === 'parallel') return parseParallel();
    }
    // otherwise: an expression, possibly a bind ( call -> name )
    const expr = parseExpr();
    if (isOp('->')) {
      next();
      const name = eatIdent();
      let type = null;
      if (isOp(':')) { next(); type = parseType(); }
      return { kind: 'Bind', call: expr, name, type };
    }
    return { kind: 'ExprStmt', expr };
  }

  function parseBlock() {
    eatOp('{');
    const stmts = [];
    while (!isOp('}')) stmts.push(parseStmt());
    eatOp('}');
    return stmts;
  }

  function parseReview() {
    next(); // 'review'
    const value = parseExpr();
    eatOp('->');
    const name = eatIdent();
    let type = null;
    if (isOp(':')) { next(); type = parseType(); }
    return { kind: 'Review', value, name, type };
  }

  function parseParallel() {
    next(); // 'parallel'
    eatOp('{');
    const binds = [];
    while (!isOp('}')) {
      const call = parseExpr();
      eatOp('->');
      const name = eatIdent();
      let type = null;
      if (isOp(':')) { next(); type = parseType(); }
      binds.push({ kind: 'Bind', call, name, type });
    }
    eatOp('}');
    return { kind: 'Parallel', binds };
  }

  function parseFor() {
    next(); // 'for'
    const name = eatIdent();
    if (!isKw('in')) throw err("expected 'in'");
    next();
    const iter = parseExpr();
    const body = parseBlock();
    return { kind: 'For', name, iter, body };
  }

  function parseIf() {
    next(); // 'if'
    const cond = parseExpr();
    const then = parseBlock();
    let alt = null;
    if (isKw('else')) { next(); alt = parseBlock(); }
    return { kind: 'If', cond, then, alt };
  }

  // ---- expressions (precedence climbing) ----

  function parseExpr() { return parseOr(); }

  function parseOr() {
    let left = parseAnd();
    while (isOp('||')) { next(); left = { kind: 'Binary', op: '||', left, right: parseAnd() }; }
    return left;
  }
  function parseAnd() {
    let left = parseEquality();
    while (isOp('&&')) { next(); left = { kind: 'Binary', op: '&&', left, right: parseEquality() }; }
    return left;
  }
  function parseEquality() {
    let left = parseComparison();
    while (isOp('==') || isOp('!=')) {
      const op = next().value;
      left = { kind: 'Binary', op, left, right: parseComparison() };
    }
    return left;
  }
  function parseComparison() {
    let left = parseUnary();
    while (isOp('<=') || isOp('>=') || isOp('<') || isOp('>')) {
      const op = next().value;
      left = { kind: 'Binary', op, left, right: parseUnary() };
    }
    return left;
  }
  function parseUnary() {
    if (isKw('not') || isOp('!')) {
      next();
      return { kind: 'Unary', op: 'not', expr: parseUnary() };
    }
    return parsePostfix();
  }
  function parsePostfix() {
    let node = parsePrimary();
    while (true) {
      if (isOp('.')) {
        next();
        const prop = eatIdent();
        node = { kind: 'Member', obj: node, prop };
      } else if (isOp('(')) {
        next();
        const args = [];
        while (!isOp(')')) {
          args.push(parseExpr());
          if (isOp(',')) next();
        }
        eatOp(')');
        node = { kind: 'Call', callee: node, args };
      } else {
        break;
      }
    }
    return node;
  }
  function parsePrimary() {
    const t = peek();
    if (t.type === 'string') { next(); return { kind: 'Str', value: t.value }; }
    if (t.type === 'number') { next(); return { kind: 'Num', value: Number(t.value) }; }
    if (t.type === 'ident') {
      if (t.value === 'true') { next(); return { kind: 'Bool', value: true }; }
      if (t.value === 'false') { next(); return { kind: 'Bool', value: false }; }
      next();
      return { kind: 'Ident', name: t.value };
    }
    if (isOp('(')) { next(); const e = parseExpr(); eatOp(')'); return e; }
    throw err('expected an expression');
  }

  return parseProgram();
}
