// checker.js
// Static checks that run before any execution (and before any model cost).
// Resolves names (types, tools, agents, flows), validates references, and
// enforces the CONTRACT FENCE (docs/DESIGN.md section 6.5):
//
//   require / ensure expressions may contain ONLY:
//     - literals, in-scope bindings, member access
//     - comparison operators and boolean operators
//     - calls to a closed registry: built-in lints, or declared tools
//       whose return type is bool
//   No lambdas, no closures, no arithmetic, no arbitrary calls. Ever.
//
// This fence is what keeps contracts from quietly becoming a second
// embedded language inside Weave.

import { BUILTINS, isBuiltin } from './builtins.js';

const CONTRACT_OPS = new Set(['==', '!=', '<=', '>=', '<', '>', '&&', '||']);

export function check(program) {
  const errors = [];
  const types = new Map(), tools = new Map(), agents = new Map(), flows = new Map();

  for (const d of program.decls) {
    if (d.kind === 'TypeDecl') { if (types.has(d.name)) errors.push(`duplicate type '${d.name}'`); types.set(d.name, d.type); }
    else if (d.kind === 'ToolDecl') { if (tools.has(d.name)) errors.push(`duplicate tool '${d.name}'`); tools.set(d.name, d); }
    else if (d.kind === 'AgentDecl') { if (agents.has(d.name)) errors.push(`duplicate agent '${d.name}'`); agents.set(d.name, d); }
    else if (d.kind === 'FlowDecl') { if (flows.has(d.name)) errors.push(`duplicate flow '${d.name}'`); flows.set(d.name, d); }
  }

  function checkTypeRefs(t, where) {
    if (!t) return;
    if (t.t === 'named') { if (!types.has(t.name)) errors.push(`${where}: unknown type '${t.name}'`); }
    else if (t.t === 'list') checkTypeRefs(t.elem, where);
    else if (t.t === 'record') t.fields.forEach(f => checkTypeRefs(f.type, where));
    else if (t.t === 'union') t.options.forEach(o => checkTypeRefs(o, where));
  }

  function returnsBool(name) {
    if (isBuiltin(name)) return BUILTINS[name].ret === 'bool';
    if (tools.has(name)) { const r = tools.get(name).ret; return !!r && r.t === 'prim' && r.name === 'bool'; }
    return false;
  }

  for (const d of program.decls) {
    if (d.kind === 'TypeDecl') checkTypeRefs(d.type, `type ${d.name}`);
    else if (d.kind === 'ToolDecl') { d.params.forEach(p => checkTypeRefs(p.type, `tool ${d.name}`)); checkTypeRefs(d.ret, `tool ${d.name}`); }
    else if (d.kind === 'AgentDecl') { if (Array.isArray(d.fields.tools)) for (const t of d.fields.tools) if (!tools.has(t)) errors.push(`agent ${d.name}: unknown tool '${t}'`); }
    else if (d.kind === 'FlowDecl') checkFlow(d);
  }

  function checkFlow(d) {
    d.params.forEach(p => checkTypeRefs(p.type, `flow ${d.name} param`));
    checkTypeRefs(d.ret, `flow ${d.name} return`);
    let hasReturn = false;
    const where = `flow ${d.name}`;

    const walk = (stmts, scope) => {
      for (const s of stmts) {
        if (s.kind === 'Require' || s.kind === 'Ensure') {
          checkContract(s.expr, scope, where);
        } else if (s.kind === 'Bind') {
          checkExpr(s.call, scope, where, true);
          if (s.type) checkTypeRefs(s.type, `${where} bind ${s.name}`);
          scope.add(s.name);
        } else if (s.kind === 'For') {
          // Flat scoping (matches the interpreter): loop var and body binds
          // join the flow scope so they stay visible after the block.
          checkExpr(s.iter, scope, where);
          scope.add(s.name);
          walk(s.body, scope);
        } else if (s.kind === 'If') {
          checkExpr(s.cond, scope, where);
          walk(s.then, scope);
          if (s.alt) walk(s.alt, scope);
        } else if (s.kind === 'Return') {
          hasReturn = true;
          checkExpr(s.expr, scope, where);
        } else if (s.kind === 'ExprStmt') {
          checkExpr(s.expr, scope, where);
        }
      }
    };

    walk(d.body, new Set(d.params.map(p => p.name)));
    if (!hasReturn) errors.push(`${where}: missing 'return'`);
  }

  // General expression resolution.
  function checkExpr(node, scope, where, allowSoft = false) {
    switch (node.kind) {
      case 'Str': case 'Num': case 'Bool': return;
      case 'Ident':
        if (!scope.has(node.name)) errors.push(`${where}: unknown binding '${node.name}'`);
        return;
      case 'Member': checkExpr(node.obj, scope, where); return;
      case 'Unary': checkExpr(node.expr, scope, where); return;
      case 'Binary': checkExpr(node.left, scope, where); checkExpr(node.right, scope, where); return;
      case 'Call': {
        const c = node.callee;
        if (c.kind !== 'Ident') { errors.push(`${where}: only named calls are allowed`); return; }
        const n = c.name;
        if (n === 'judge') {
          const a0 = node.args[0];
          if (!a0 || a0.kind !== 'Ident' || !agents.has(a0.name)) errors.push(`${where}: judge(...) first argument must be a declared agent`);
          for (let i = 1; i < node.args.length; i++) checkExpr(node.args[i], scope, where);
          return;
        }
        const known = isBuiltin(n) || tools.has(n) || flows.has(n) || agents.has(n);
        if (!known) errors.push(`${where}: unknown function '${n}'`);
        if (agents.has(n) && !allowSoft) errors.push(`${where}: agent '${n}' can only be called as a bind step (use '${n}(...) -> name')`);
        node.args.forEach(a => checkExpr(a, scope, where));
        return;
      }
    }
  }

  // The contract fence: a restricted grammar for require / ensure.
  function checkContract(node, scope, where) {
    switch (node.kind) {
      case 'Str': case 'Num': case 'Bool': return;
      case 'Ident':
        if (!scope.has(node.name)) errors.push(`${where}: unknown binding '${node.name}' in contract`);
        return;
      case 'Member': checkContract(node.obj, scope, where); return;
      case 'Unary': checkContract(node.expr, scope, where); return;
      case 'Binary':
        if (!CONTRACT_OPS.has(node.op)) errors.push(`${where}: operator '${node.op}' is not allowed in a contract (contract fence)`);
        checkContract(node.left, scope, where);
        checkContract(node.right, scope, where);
        return;
      case 'Call': {
        const c = node.callee;
        if (c.kind !== 'Ident') { errors.push(`${where}: only named predicate calls allowed in contracts`); return; }
        const n = c.name;
        if (n === 'judge') {
          const a0 = node.args[0];
          if (!a0 || a0.kind !== 'Ident' || !agents.has(a0.name)) errors.push(`${where}: judge(...) first argument must be a declared agent`);
          for (let i = 1; i < node.args.length; i++) checkContract(node.args[i], scope, where);
          return;
        }
        if (!(isBuiltin(n) || tools.has(n))) errors.push(`${where}: a contract may only call built-in lints or tools, not '${n}' (contract fence)`);
        else if (!returnsBool(n)) errors.push(`${where}: contract call '${n}' must return bool (contract fence)`);
        node.args.forEach(a => checkContract(a, scope, where));
        return;
      }
      default:
        errors.push(`${where}: '${node.kind}' is not allowed inside a contract (contract fence)`);
    }
  }

  return { ok: errors.length === 0, errors };
}
