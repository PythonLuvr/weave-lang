// lsp.js
// A minimal Language Server for Weave, speaking LSP over stdio (JSON-RPC), with
// no external dependencies. It reuses the lexer/parser/checker for live
// diagnostics, and offers completion and hover. Start it with `node src/lsp.js`
// (or `weave lsp`); point any LSP client at that command for the `weave` language.
//
// The diagnostics/completion logic is exported as pure functions so it can be
// unit-tested without the protocol.

import { parse } from './parser.js';
import { check } from './checker.js';
import { BUILTINS, isBuiltin } from './builtins.js';
import { pathToFileURL } from 'url';

const KEYWORDS = ['type', 'tool', 'agent', 'flow', 'require', 'ensure', 'for', 'in', 'if', 'else', 'return', 'review', 'parallel', 'not'];

// Parse errors carry a precise "at L:C" position; checker errors do not, so they
// are reported at the top of the file (still surfaced in the Problems panel).
export function lspDiagnostics(text) {
  let program;
  try { program = parse(text); }
  catch (e) {
    const m = String(e.message).match(/at (\d+):(\d+)/);
    const line = m ? Math.max(0, +m[1] - 1) : 0;
    const ch = m ? Math.max(0, +m[2] - 1) : 0;
    return [{ line, character: ch, endLine: line, endCharacter: ch + 1, message: String(e.message), severity: 1 }];
  }
  return check(program).errors.map((message) => ({ line: 0, character: 0, endLine: 0, endCharacter: 1, message, severity: 1 }));
}

export function lspCompletions(text) {
  const items = KEYWORDS.map((label) => ({ label, kind: 14 }));               // 14 = Keyword
  for (const b of Object.keys(BUILTINS)) items.push({ label: b, kind: 3 });   // 3 = Function
  try {
    for (const d of parse(text).decls) {
      if (d.name) items.push({ label: d.name, kind: d.kind === 'TypeDecl' ? 7 : d.kind === 'AgentDecl' ? 6 : 3 });
    }
  } catch { /* partial doc, skip declared-name completions */ }
  return items;
}

export function wordAt(text, pos) {
  const line = String(text).split('\n')[pos.line] || '';
  let s = pos.character, e = pos.character;
  while (s > 0 && /\w/.test(line[s - 1])) s--;
  while (e < line.length && /\w/.test(line[e])) e++;
  return line.slice(s, e);
}

export function describeWord(word, text) {
  if (!word) return null;
  if (KEYWORDS.includes(word)) return `**${word}** (Weave keyword)`;
  if (isBuiltin(word)) { const b = BUILTINS[word]; return `**${word}(${(b.params || []).join(', ')})** -> ${b.ret} (built-in)`; }
  try {
    const d = parse(text).decls.find((x) => x.name === word);
    if (d) return `**${word}** (${d.kind.replace('Decl', '').toLowerCase()})`;
  } catch { /* ignore */ }
  return null;
}

export function startServer() {
  const docs = new Map();
  let buffer = Buffer.alloc(0);

  const send = (obj) => {
    const s = JSON.stringify(obj);
    process.stdout.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
  };
  const publish = (uri) => {
    const diagnostics = lspDiagnostics(docs.get(uri) || '').map((d) => ({
      range: { start: { line: d.line, character: d.character }, end: { line: d.endLine, character: d.endCharacter } },
      message: d.message, severity: d.severity, source: 'weave',
    }));
    send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
  };

  const handle = (msg) => {
    const { id, method, params } = msg;
    switch (method) {
      case 'initialize':
        send({ jsonrpc: '2.0', id, result: { capabilities: { textDocumentSync: 1, completionProvider: { triggerCharacters: ['.'] }, hoverProvider: true } } });
        break;
      case 'textDocument/didOpen': {
        const td = params.textDocument; docs.set(td.uri, td.text); publish(td.uri); break;
      }
      case 'textDocument/didChange': {
        const uri = params.textDocument.uri; const last = params.contentChanges[params.contentChanges.length - 1];
        docs.set(uri, last.text); publish(uri); break;
      }
      case 'textDocument/completion':
        send({ jsonrpc: '2.0', id, result: lspCompletions(docs.get(params.textDocument.uri) || '') });
        break;
      case 'textDocument/hover': {
        const text = docs.get(params.textDocument.uri) || '';
        const info = describeWord(wordAt(text, params.position), text);
        send({ jsonrpc: '2.0', id, result: info ? { contents: { kind: 'markdown', value: info } } : null });
        break;
      }
      case 'shutdown': send({ jsonrpc: '2.0', id, result: null }); break;
      case 'exit': process.exit(0); break;
      default: if (id !== undefined) send({ jsonrpc: '2.0', id, result: null });
    }
  };

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const m = buffer.slice(0, headerEnd).toString().match(/Content-Length: (\d+)/i);
      if (!m) { buffer = buffer.slice(headerEnd + 4); continue; }
      const len = +m[1];
      const start = headerEnd + 4;
      if (buffer.length < start + len) break;
      const body = buffer.slice(start, start + len).toString();
      buffer = buffer.slice(start + len);
      let msg; try { msg = JSON.parse(body); } catch { continue; }
      handle(msg);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
