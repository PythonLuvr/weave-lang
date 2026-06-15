#!/usr/bin/env node
// cli.js
// The `weave` command. Two subcommands for v0:
//   weave check <file>            static checks only, no execution, no cost
//   weave run   <file> [--p v]    type-check then execute a flow
//
// Flags map to flow parameters by name, e.g. --topic "granite countertops".
// Use --entry to pick a flow when a file declares more than one.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { parse } from './parser.js';
import { check } from './checker.js';
import { run } from './interpreter.js';
import { createMockModel } from './models.js';
import { createGeminiCliModel } from './models-gemini.js';
import { createClaudeCliModel } from './models-claude.js';
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import { teachPack } from './teach.js';

const [, , cmd, file, ...rest] = process.argv;

if (cmd === 'teach') { console.log(teachPack); process.exit(0); }

const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1]; i++; }
}

if (!cmd || !file || (cmd !== 'run' && cmd !== 'check')) {
  console.log('usage:');
  console.log('  weave teach');
  console.log('  weave check <file.weave>');
  console.log('  weave run   <file.weave> [--backend mock|gemini|claude] [--tools module.mjs] [--budget N] [--entry flowName] [--param value ...]');
  process.exit(1);
}

let src;
try { src = readFileSync(file, 'utf8'); }
catch { console.error(`cannot read file: ${file}`); process.exit(1); }

let program;
try { program = parse(src); }
catch (e) { console.error(String(e.message || e)); process.exit(1); }

const result = check(program);
if (!result.ok) {
  console.error('Check failed:');
  for (const e of result.errors) console.error('  - ' + e);
  process.exit(1);
}

if (cmd === 'check') {
  console.log(`OK: ${file} checks clean (${program.decls.length} declarations).`);
  process.exit(0);
}

// run
const flows = program.decls.filter(d => d.kind === 'FlowDecl');
const entryName = flags.entry || (flows[0] && flows[0].name);
const entry = flows.find(f => f.name === entryName);
if (!entry) { console.error('no flow to run'); process.exit(1); }

const args = entry.params.map(p => flags[p.name] ?? '');

console.log(`weave run ${file}   flow=${entryName}`);
console.log(`args: ${entry.params.map(p => `${p.name}=${JSON.stringify(flags[p.name] ?? '')}`).join(', ') || '(none)'}`);
console.log('-'.repeat(60));

const backend = flags.backend || 'mock';
let model;
if (backend === 'gemini') {
  console.log('backend: Gemini CLI (gemini-2.5-flash). NOTE: this spends your Google AI Pro quota.');
  model = createGeminiCliModel();
} else if (backend === 'claude') {
  console.log('backend: Claude CLI (sonnet, via your Claude subscription).');
  model = createClaudeCliModel();
} else {
  model = createMockModel();
}

const toolsMod = flags.tools
  ? await import(pathToFileURL(resolve(flags.tools)).href)
  : await import('./tools.js');
const tools = toolsMod.createTools();

// persistent memory store, file-backed across runs (recall / remember)
const memFile = 'weave-memory.json';
const memStore = new Map(existsSync(memFile) ? Object.entries(JSON.parse(readFileSync(memFile, 'utf8'))) : []);

// human review gate: prompt on a TTY, auto-approve when non-interactive
async function onReview({ value, name }) {
  const view = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  console.log(`\n[review: ${name}]\n${view}`);
  if (!process.stdin.isTTY) { console.log('(non-interactive: auto-approved)'); return { approved: true }; }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((res) => rl.question('approve? [y/n] ', (a) => { rl.close(); res(a); }));
  return { approved: /^y/i.test(String(ans).trim()) };
}

try {
  const out = await run(program, entryName, args, {
    model,
    tools,
    budget: flags.budget,
    memory: memStore,
    onReview,
    onEvent: (s) => console.log(s),
  });
  console.log('-'.repeat(60));
  console.log('RESULT:');
  console.log(JSON.stringify(out, null, 2));
  if (memStore.size) writeFileSync(memFile, JSON.stringify(Object.fromEntries(memStore), null, 2));
} catch (e) {
  console.log('-'.repeat(60));
  console.error('HALTED: ' + String(e.message || e));
  process.exit(1);
}
