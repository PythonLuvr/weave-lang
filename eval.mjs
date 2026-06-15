// eval.mjs
// The honest test of the "an AI can author this language" thesis: give a model
// the teach pack and a task, then measure how often the program it writes
// actually parses and type-checks (including the contract fence).
//
//   node eval.mjs [--backend claude|gemini] [--samples N]
//
// Reports parse% and check-clean% over tasks x samples, plus a per-task breakdown.
// Note on what this does NOT measure: a Weave-vs-raw-TS comparison would require
// safely executing arbitrary model-written code, which is out of scope here. This
// measures authorship validity, not downstream task success.

import { parse } from './src/parser.js';
import { check } from './src/checker.js';
import { teachPack } from './src/teach.js';
import { createClaudeCliModel } from './src/models-claude.js';
import { createGeminiCliModel } from './src/models-gemini.js';

const rest = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1]; i++; }

const backend = flags.backend || 'claude';
const samples = Math.max(1, Number(flags.samples || 1));
const model = backend === 'gemini' ? createGeminiCliModel() : createClaudeCliModel();

const TASKS = [
  'A flow that takes a topic and writes a social post (headline, body under 200 chars, cta), no em dashes, no hashtags.',
  'A flow that classifies a customer review as one of "positive", "negative", or "neutral".',
  'A flow that researches a topic with a web_search tool, fact-checks each point, and returns a one-sentence summary.',
  'A flow that turns a product name and three features into a short ad with a clear call to action.',
  'A flow that takes a long article and returns a three-bullet summary as a list of text.',
  'A flow that drafts a reply to a support ticket, then has a reviewer agent judge it is polite and on-topic.',
  'A flow that generates a blog title and outline, with a human review gate before it returns.',
  'A flow that, given a question, searches with a tool and returns an answer under 280 chars that a judge approves.',
];

function strip(s) {
  const m = String(s).match(/```(?:weave)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : String(s)).trim();
}

console.log(`weave eval  backend=${backend}  tasks=${TASKS.length}  samples=${samples}\n`);
let runs = 0, parsed = 0, checked = 0;
const per = TASKS.map((t) => ({ t, p: 0, c: 0 }));

for (let s = 0; s < samples; s++) {
  for (let i = 0; i < TASKS.length; i++) {
    runs++;
    const out = String(await model.complete({ agentName: 'author', agent: {}, prompt: `${teachPack}\n\nTASK: ${TASKS[i]}`, returnType: { t: 'prim', name: 'text' } }));
    let prog;
    try { prog = parse(strip(out)); parsed++; per[i].p++; }
    catch (e) { console.log(`  parse-fail  [t${i}]: ${e.message}`); continue; }
    const res = check(prog);
    if (res.ok) { checked++; per[i].c++; }
    else console.log(`  check-fail  [t${i}]: ${res.errors[0]}`);
  }
}

const pct = (n) => `${Math.round((n / runs) * 100)}%`;
console.log(`\nPARSE:        ${parsed}/${runs}  (${pct(parsed)})`);
console.log(`CHECK-CLEAN:  ${checked}/${runs}  (${pct(checked)})`);
console.log(`\nper task (parse/check over ${samples} sample(s)):`);
per.forEach((x, i) => console.log(`  t${i}  ${x.p}/${x.c}   ${x.t.slice(0, 62)}`));
