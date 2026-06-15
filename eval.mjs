// eval.mjs
// The honest test of the "an AI can author this language" thesis: give a model
// the teach pack and a task, then measure how often the program it writes
// actually parses and type-checks. The number can come back low; we report it
// either way. Usage: node eval.mjs [--backend claude|gemini]

import { parse } from './src/parser.js';
import { check } from './src/checker.js';
import { teachPack } from './src/teach.js';
import { createClaudeCliModel } from './src/models-claude.js';
import { createGeminiCliModel } from './src/models-gemini.js';

const rest = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1]; i++; }

const backend = flags.backend || 'claude';
const model = backend === 'gemini' ? createGeminiCliModel() : createClaudeCliModel();

const TASKS = [
  'A flow that takes a topic and writes a social post (headline, body under 200 chars, cta), with no em dashes and no hashtags.',
  'A flow that classifies a customer review as one of "positive", "negative", or "neutral".',
  'A flow that researches a topic with a web_search tool, fact-checks each point, and returns a one-sentence summary.',
];

function strip(s) {
  const m = String(s).match(/```(?:weave)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : String(s)).trim();
}

console.log(`weave eval  backend=${backend}  tasks=${TASKS.length}\n`);
let parsed = 0;
let checked = 0;
for (const task of TASKS) {
  const prompt = `${teachPack}\n\nTASK: ${task}`;
  const out = String(await model.complete({ agentName: 'author', agent: {}, prompt, returnType: { t: 'prim', name: 'text' } }));
  const code = strip(out);
  let prog;
  try { prog = parse(code); parsed++; }
  catch (e) { console.log(`PARSE FAIL: ${task}\n  ${e.message}\n`); continue; }
  const res = check(prog);
  if (res.ok) { checked++; console.log(`OK:    ${task}`); }
  else console.log(`CHECK FAIL: ${task}\n  ${res.errors.join('; ')}\n`);
}
console.log(`\nparse: ${parsed}/${TASKS.length}   check-clean: ${checked}/${TASKS.length}`);
