// interpreter.js
// A tree-walking interpreter for Weave v0.
// Executes a flow: runs steps, resolves soft calls against a model backend,
// enforces contracts, and runs the REPAIR LOOP (a failed ensure on a soft
// step feeds the violated contract back to the agent and retries).

import { BUILTIN_IMPL, isBuiltin } from './builtins.js';

class Halt extends Error {}

class Scope {
  constructor(parent) { this.vars = new Map(); this.parent = parent || null; }
  has(n) { return this.vars.has(n) || (this.parent ? this.parent.has(n) : false); }
  get(n) { if (this.vars.has(n)) return this.vars.get(n); return this.parent ? this.parent.get(n) : undefined; }
  set(n, v) { this.vars.set(n, v); }
}

export async function run(program, entryName, args, opts = {}) {
  const types = new Map(), tools = new Map(), agents = new Map(), flows = new Map();
  for (const d of program.decls) {
    if (d.kind === 'TypeDecl') types.set(d.name, d.type);
    else if (d.kind === 'ToolDecl') tools.set(d.name, d);
    else if (d.kind === 'AgentDecl') agents.set(d.name, d);
    else if (d.kind === 'FlowDecl') flows.set(d.name, d);
  }

  const model = opts.model;
  const toolImpl = opts.tools || {};
  const onEvent = opts.onEvent || (() => {});
  const cache = new Map();
  let lastJudgeReason = null;
  const sessionMem = {};                       // agentName -> [exchanges] (memory: session)
  const memStore = opts.memory || new Map();   // persistent key-value (recall / remember)
  const callsByAgent = {};
  let totalCalls = 0;

  // Budgets: each real model call is charged. An agent's `budget:` caps its own
  // calls; opts.budget caps the whole flow. Exceeding either halts.
  function chargeCall(name) {
    callsByAgent[name] = (callsByAgent[name] || 0) + 1;
    totalCalls++;
    const agent = agents.get(name);
    const b = agent && Number(agent.fields.budget);
    if (b && callsByAgent[name] > b) throw new Halt(`agent '${name}' exceeded its budget of ${b} model call(s)`);
    if (opts.budget && totalCalls > Number(opts.budget)) throw new Halt(`flow exceeded its budget of ${opts.budget} model call(s)`);
  }

  // Human approval gate. opts.onReview decides; with none wired, auto-approve.
  async function reviewGate(value, name) {
    if (typeof opts.onReview === 'function') {
      const verdict = await opts.onReview({ value, name });
      if (verdict && verdict.approved === false) throw new Halt(`rejected at review '${name}'`);
      return (verdict && 'value' in verdict) ? verdict.value : value;
    }
    return value;
  }

  function resolveType(t) {
    if (!t) return { t: 'prim', name: 'text' };
    if (t.t === 'named') { const def = types.get(t.name); return def ? resolveType(def) : t; }
    if (t.t === 'list') return { t: 'list', elem: resolveType(t.elem) };
    if (t.t === 'record') return { t: 'record', fields: t.fields.map(f => ({ name: f.name, type: resolveType(f.type) })) };
    return t;
  }

  async function execFlow(flow, scope) {
    const r = await execStmts(flow.body, scope);
    return r ? r.value : undefined;
  }

  async function execStmts(stmts, scope) {
    let i = 0;
    while (i < stmts.length) {
      const s = stmts[i];
      if (s.kind === 'Return') {
        return { value: await evalExpr(s.expr, scope) };
      } else if (s.kind === 'Require') {
        const ok = truthy(await evalExpr(s.expr, scope));
        onEvent(`  require ${printExpr(s.expr)}  ${ok ? 'PASS' : 'FAIL'}`);
        if (!ok) throw new Halt(`require failed: ${printExpr(s.expr)}`);
      } else if (s.kind === 'Ensure') {
        const ok = truthy(await evalExpr(s.expr, scope));
        onEvent(`  ensure ${printExpr(s.expr)}  ${ok ? 'PASS' : 'FAIL'}`);
        if (!ok) throw new Halt(`ensure failed: ${printExpr(s.expr)}`);
      } else if (s.kind === 'For') {
        // Flat scoping: the loop var and any binds in the body live in the flow
        // scope, so results stay visible by name (linear-pipeline model).
        const arr = await evalExpr(s.iter, scope);
        const list = Array.isArray(arr) ? arr : [];
        onEvent(`  for ${s.name} in ${printExpr(s.iter)}  (${list.length} item(s))`);
        for (const item of list) {
          scope.set(s.name, item);
          const r = await execStmts(s.body, scope);
          if (r) return r;
        }
      } else if (s.kind === 'If') {
        const c = truthy(await evalExpr(s.cond, scope));
        const r = await execStmts(c ? s.then : (s.alt || []), scope);
        if (r) return r;
      } else if (s.kind === 'Review') {
        const v = await evalExpr(s.value, scope);
        onEvent(`  review ${printExpr(s.value)} -> ${s.name}`);
        scope.set(s.name, await reviewGate(v, s.name));
      } else if (s.kind === 'Parallel') {
        onEvent(`  parallel { ${s.binds.length} step(s) }`);
        await Promise.all(s.binds.map(async (b) => {
          const callee = b.call.callee;
          const isSoft = callee.kind === 'Ident' && agents.has(callee.name);
          const value = isSoft
            ? await evalSoftCall(b.call, scope, resolveType(b.type || { t: 'prim', name: 'text' }), null)
            : await evalExpr(b.call, scope);
          scope.set(b.name, value);
          onEvent(`    parallel ${callee.name || ''} -> ${b.name}`);
        }));
      } else if (s.kind === 'ExprStmt') {
        await evalExpr(s.expr, scope);
      } else if (s.kind === 'Bind') {
        i = await execBind(s, stmts, i, scope);
        continue;
      }
      i++;
    }
    return undefined;
  }

  // Executes a bind, then consumes the contiguous `ensure` statements that
  // reference the bound name. For soft (agent) binds those ensures drive the
  // repair loop. Returns the index to continue from.
  async function execBind(stmt, stmts, i, scope) {
    const callee = stmt.call.callee;
    const isSoft = callee.kind === 'Ident' && agents.has(callee.name);

    let j = i + 1;
    const post = [];
    while (j < stmts.length && stmts[j].kind === 'Ensure' && refersTo(stmts[j].expr, stmt.name)) {
      post.push(stmts[j]); j++;
    }

    const expectedType = resolveType(stmt.type || { t: 'prim', name: 'text' });

    if (isSoft) {
      const agent = agents.get(callee.name);
      const retry = Number(agent.fields.retry ?? 0);
      let attempt = 0, feedback = null;
      while (true) {
        const value = await evalSoftCall(stmt.call, scope, expectedType, feedback);
        scope.set(stmt.name, value);
        onEvent(`  soft  ${callee.name}(...) -> ${stmt.name}   [attempt ${attempt + 1}]`);
        let failed = null;
        for (const p of post) {
          lastJudgeReason = null;
          const ok = truthy(await evalExpr(p.expr, scope));
          onEvent(`    ensure ${printExpr(p.expr)}  ${ok ? 'PASS' : 'FAIL'}`);
          if (!ok) { failed = p; break; }
        }
        if (!failed) break;
        if (attempt >= retry) throw new Halt(`ensure failed after ${attempt + 1} attempt(s): ${printExpr(failed.expr)}`);
        feedback = `${printExpr(failed.expr)} (was ${preview(scope.get(stmt.name))})`;
        if (lastJudgeReason) feedback += ` | reviewer: ${lastJudgeReason}`;
        onEvent(`    repair -> feeding "${printExpr(failed.expr)}" back to ${callee.name}, retrying`);
        attempt++;
      }
    } else {
      const value = await evalExpr(stmt.call, scope);
      scope.set(stmt.name, value);
      onEvent(`  call  ${printExpr(stmt.call)} -> ${stmt.name}`);
      for (const p of post) {
        const ok = truthy(await evalExpr(p.expr, scope));
        onEvent(`    ensure ${printExpr(p.expr)}  ${ok ? 'PASS' : 'FAIL'}`);
        if (!ok) throw new Halt(`ensure failed: ${printExpr(p.expr)}`);
      }
    }
    return j;
  }

  async function evalSoftCall(callNode, scope, expectedType, feedback) {
    const args = [];
    for (const a of callNode.args) args.push(await evalExpr(a, scope));
    let prompt = String(args[0] ?? '');
    if (feedback) prompt += `\n\n[repair] previous output violated ${feedback}. Fix it.`;
    const name = callNode.callee.name;
    const agent = agents.get(name);

    // If the agent declares tools, let it gather via a ReAct loop before answering.
    const agentTools = Array.isArray(agent.fields.tools) ? agent.fields.tools : [];
    if (agentTools.length) prompt = await runToolLoop(name, agent, agentTools, prompt);

    // memory: session -> prepend this agent's earlier exchanges from this run.
    let sent = prompt;
    const useSession = agent.fields.memory === 'session';
    if (useSession && sessionMem[name] && sessionMem[name].length) {
      sent = `Earlier in this session:\n${sessionMem[name].join('\n\n')}\n\n----\n\n${prompt}`;
    }

    const key = `${name}|${sent}|${JSON.stringify(expectedType)}`;
    if (cache.has(key)) { onEvent(`    cache hit (${name})`); return clone(cache.get(key)); }
    chargeCall(name);
    const value = await model.complete({ agentName: name, agent: agent.fields, prompt: sent, returnType: expectedType });
    cache.set(key, value);
    if (useSession) {
      const v = typeof value === 'object' ? JSON.stringify(value) : String(value);
      (sessionMem[name] = sessionMem[name] || []).push(`Q: ${prompt.slice(0, 200)}\nA: ${v.slice(0, 300)}`);
    }
    return clone(value);
  }

  // ReAct loop: the model may emit `CALL <tool> <json-args>` lines; we run the
  // real tool and feed the result back, looping until it stops. Returns the
  // prompt augmented with everything gathered, for the final typed completion.
  async function runToolLoop(name, agent, toolNames, userPrompt) {
    const defs = toolNames.map(toolSignature).join('\n');
    let transcript =
      `${userPrompt}\n\nYou can call these tools to gather information first:\n${defs}\n\n` +
      'To call one, reply with EXACTLY one line:\nCALL <tool> <json-array-of-args>\n' +
      `for example: CALL ${toolNames[0]} ["..."]\n` +
      'Call as many as you need, one per reply. When you have enough, reply with: DONE';
    const gathered = [];
    for (let i = 0; i < 6; i++) {
      chargeCall(name);
      const reply = String(await model.complete({ agentName: name, agent: agent.fields, prompt: transcript, returnType: { t: 'prim', name: 'text' } }));
      const call = parseToolCall(reply, toolNames);
      if (!call) break;
      let result;
      try { result = await invokeTool(call.name, call.args); }
      catch (e) { result = { error: String(e.message || e) }; }
      onEvent(`    tool  ${call.name}(${call.args.map(preview).join(', ')})`);
      gathered.push(`${call.name}(${call.args.map(a => JSON.stringify(a)).join(', ')}) -> ${JSON.stringify(result)}`);
      transcript += `\n\n${reply}\nResult: ${JSON.stringify(result)}\n\nCall another tool, or reply DONE.`;
    }
    return gathered.length ? `${userPrompt}\n\nInformation gathered from tools:\n${gathered.join('\n')}` : userPrompt;
  }

  async function invokeTool(name, args) {
    if (tools.has(name)) {
      if (typeof toolImpl[name] !== 'function') throw new Error(`tool '${name}' has no implementation`);
      return await toolImpl[name](...args);
    }
    if (isBuiltin(name)) return BUILTIN_IMPL[name](...args);
    throw new Error(`unknown tool '${name}'`);
  }

  function toolSignature(n) {
    const d = tools.get(n);
    if (!d) return n;
    const ps = (d.params || []).map(p => `${p.name}: ${typeStr(p.type)}`).join(', ');
    return `${n}(${ps}) -> ${typeStr(d.ret)}`;
  }

  async function evalExpr(node, scope) {
    switch (node.kind) {
      case 'Str': return interpolate(node.value, scope);
      case 'Num': return node.value;
      case 'Bool': return node.value;
      case 'Ident':
        if (!scope.has(node.name)) throw new Halt(`unknown binding '${node.name}'`);
        return scope.get(node.name);
      case 'Member': {
        const obj = await evalExpr(node.obj, scope);
        if (node.prop === 'length') {
          if (typeof obj === 'string' || Array.isArray(obj)) return obj.length;
          return 0;
        }
        return obj == null ? undefined : obj[node.prop];
      }
      case 'Unary': return !truthy(await evalExpr(node.expr, scope));
      case 'Binary': return await evalBinary(node, scope);
      case 'Call': return await evalCall(node, scope);
      default: throw new Halt(`cannot evaluate ${node.kind}`);
    }
  }

  async function evalBinary(node, scope) {
    if (node.op === '&&') return truthy(await evalExpr(node.left, scope)) && truthy(await evalExpr(node.right, scope));
    if (node.op === '||') return truthy(await evalExpr(node.left, scope)) || truthy(await evalExpr(node.right, scope));
    const l = await evalExpr(node.left, scope);
    const r = await evalExpr(node.right, scope);
    switch (node.op) {
      case '==': return l === r;
      case '!=': return l !== r;
      case '<': return l < r;
      case '>': return l > r;
      case '<=': return l <= r;
      case '>=': return l >= r;
    }
    throw new Halt(`bad operator ${node.op}`);
  }

  // judge(agentRef, rubric, value): a reviewer model decides if value meets the
  // rubric. Returns bool (fence-safe). The reason is stashed for repair feedback.
  async function evalJudge(node, scope) {
    const a0 = node.args[0];
    const agentName = a0 && a0.kind === 'Ident' ? a0.name : null;
    if (!agentName || !agents.has(agentName)) throw new Halt('judge(...) first argument must be a declared agent');
    const rubric = String(await evalExpr(node.args[1], scope));
    const value = await evalExpr(node.args[2], scope);
    const valueStr = (value && typeof value === 'object') ? JSON.stringify(value) : String(value);
    const agent = agents.get(agentName);
    const prompt =
      'You are a strict reviewer. Decide whether the CONTENT satisfies the RUBRIC.\n\n' +
      `RUBRIC: ${rubric}\n\nCONTENT:\n${valueStr}\n\n` +
      'Reply with PASS or FAIL on the first line, then one short sentence saying why.';
    const key = `judge|${agentName}|${rubric}|${valueStr}`;
    let resp;
    if (cache.has(key)) resp = cache.get(key);
    else {
      chargeCall(agentName);
      resp = String(await model.complete({ agentName, agent: agent.fields, prompt, returnType: { t: 'prim', name: 'text' } }));
      cache.set(key, resp);
    }
    const pass = /\bpass\b/i.test(resp) && !/\bfail\b/i.test(resp);
    lastJudgeReason = resp.replace(/\s+/g, ' ').trim().slice(0, 240);
    onEvent(`    judge ${agentName}: "${rubric.slice(0, 48)}${rubric.length > 48 ? '...' : ''}"  ${pass ? 'PASS' : 'FAIL'}`);
    return pass;
  }

  async function evalCall(node, scope) {
    const c = node.callee;
    if (c.kind !== 'Ident') throw new Halt('only named calls are supported');
    const n = c.name;
    if (n === 'judge') return await evalJudge(node, scope);
    const args = [];
    for (const a of node.args) args.push(await evalExpr(a, scope));
    if (n === 'recall') { const k = String(args[0]); return memStore.has(k) ? memStore.get(k) : ''; }
    if (n === 'remember') { memStore.set(String(args[0]), args[1]); onEvent(`    remember ${JSON.stringify(String(args[0]))}`); return true; }
    if (isBuiltin(n)) return BUILTIN_IMPL[n](...args);
    if (tools.has(n)) {
      onEvent(`    tool  ${n}(${args.map(preview).join(', ')})`);
      if (typeof toolImpl[n] !== 'function') throw new Halt(`tool '${n}' has no implementation registered`);
      return await toolImpl[n](...args);
    }
    if (flows.has(n)) {
      const f = flows.get(n);
      const sc = new Scope(null);
      f.params.forEach((p, idx) => sc.set(p.name, args[idx]));
      return await execFlow(f, sc);
    }
    if (agents.has(n)) throw new Halt(`agent '${n}' can only be called as a bind step`);
    throw new Halt(`unknown function '${n}'`);
  }

  function interpolate(s, scope) {
    return String(s).replace(/\{([A-Za-z_][A-Za-z0-9_.]*)\}/g, (m, path) => {
      const parts = path.split('.');
      let v = scope.has(parts[0]) ? scope.get(parts[0]) : undefined;
      for (let k = 1; k < parts.length && v != null; k++) {
        v = parts[k] === 'length'
          ? ((typeof v === 'string' || Array.isArray(v)) ? v.length : undefined)
          : v[parts[k]];
      }
      if (v == null) return m;
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }

  const entry = flows.get(entryName);
  if (!entry) throw new Error(`no flow named '${entryName}'`);
  const scope = new Scope(null);
  entry.params.forEach((p, idx) => scope.set(p.name, args[idx]));
  return await execFlow(entry, scope);
}

// ---- pure helpers ----

function truthy(v) { return v === true; }

function typeStr(t) {
  if (!t) return 'any';
  if (t.t === 'prim') return t.name;
  if (t.t === 'named') return t.name;
  if (t.t === 'list') return `list<${typeStr(t.elem)}>`;
  if (t.t === 'record') return '{ ... }';
  if (t.t === 'enum') return t.members.map(m => JSON.stringify(m)).join(' | ');
  return 'any';
}

// Parse a `CALL <tool> <json-array>` line from a model reply. Returns null if
// there is no valid call or the tool is not one the agent declared.
function parseToolCall(reply, toolNames) {
  const m = String(reply).match(/CALL\s+([A-Za-z_]\w*)\s+(\[[\s\S]*?\])/);
  if (!m) return null;
  if (toolNames && !toolNames.includes(m[1])) return null;
  let args;
  try { args = JSON.parse(m[2]); } catch { args = []; }
  if (!Array.isArray(args)) args = [args];
  return { name: m[1], args };
}

function clone(v) {
  if (v == null || typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v));
}

function refersTo(node, name) {
  if (!node || typeof node !== 'object') return false;
  if (node.kind === 'Ident') return node.name === name;
  for (const k of Object.keys(node)) {
    const val = node[k];
    if (Array.isArray(val)) { if (val.some(x => refersTo(x, name))) return true; }
    else if (val && typeof val === 'object') { if (refersTo(val, name)) return true; }
  }
  return false;
}

function preview(v) {
  if (typeof v === 'string') return `'${v.slice(0, 40)}${v.length > 40 ? '...' : ''}' (len ${v.length})`;
  if (v && typeof v === 'object') { const s = JSON.stringify(v); return s.length > 60 ? s.slice(0, 60) + '...' : s; }
  return String(v);
}

function printExpr(node) {
  switch (node.kind) {
    case 'Str': return JSON.stringify(node.value);
    case 'Num': return String(node.value);
    case 'Bool': return String(node.value);
    case 'Ident': return node.name;
    case 'Member': return `${printExpr(node.obj)}.${node.prop}`;
    case 'Unary': return `not ${printExpr(node.expr)}`;
    case 'Binary': return `${printExpr(node.left)} ${node.op} ${printExpr(node.right)}`;
    case 'Call': return `${printExpr(node.callee)}(${node.args.map(printExpr).join(', ')})`;
    default: return '<expr>';
  }
}
