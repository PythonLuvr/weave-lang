// harness.mjs
// Tiny zero-dependency test harness. Tests register with test(name, fn),
// then run() executes them (async-aware) and reports.

const tests = [];

export function test(name, fn) { tests.push([name, fn]); }

export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || 'eq'}: expected ${b}, got ${a}`);
}

export function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'expected truthy');
}

export async function throws(fn, msg) {
  let threw = false;
  try { await fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg || 'expected an error to be thrown');
}

export async function run() {
  let passed = 0;
  const fails = [];
  for (const [name, fn] of tests) {
    try { await fn(); passed++; process.stdout.write('.'); }
    catch (e) { fails.push([name, e]); process.stdout.write('x'); }
  }
  console.log(`\n\n${passed}/${tests.length} passed`);
  for (const [n, e] of fails) console.log(`\nFAIL  ${n}\n  ${e.message}`);
  if (fails.length) process.exit(1);
  console.log('all green');
}
