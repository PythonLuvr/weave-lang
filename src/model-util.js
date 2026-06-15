// model-util.js
// Shared helpers for real model backends (Gemini CLI, Claude CLI).

// Describe a resolved Weave type as a compact JSON shape hint for the model.
export function describeShape(t) {
  if (!t) return '"...text..."';
  if (t.t === 'prim') {
    if (t.name === 'bool') return 'true or false';
    if (t.name === 'int' || t.name === 'num') return 'a number';
    return '"...text..."';
  }
  if (t.t === 'enum') return t.members.map(m => JSON.stringify(m)).join(' | ');
  if (t.t === 'list') return `[ ${describeShape(t.elem)}, ... ]`;
  if (t.t === 'record') return `{ ${t.fields.map(f => `"${f.name}": ${describeShape(f.type)}`).join(', ')} }`;
  return '"..."';
}

// Parse model JSON output, tolerating markdown code fences and stray prose
// around the JSON (real models sometimes add a sentence before the object).
export function parseJsonLoose(text) {
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through to extraction */ }
  const start = s.search(/[{[]/);
  const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (start !== -1 && end > start) return JSON.parse(s.slice(start, end + 1));
  throw new SyntaxError('no JSON found in model output');
}

// Build the stdin payload sent to a CLI model.
export function buildPayload(prompt, returnType, persona) {
  const wantsJson = returnType && (returnType.t === 'record' || returnType.t === 'list' || returnType.t === 'enum');
  const instruction = wantsJson
    ? 'Return ONLY valid JSON for the requested shape. No prose, no markdown fences.'
    : 'Return only the answer text. No preamble, no markdown.';
  const role = persona ? `ROLE: ${persona}\n\n` : '';
  const stdin = wantsJson
    ? `${role}${instruction}\n\nTASK:\n${prompt}\n\nReturn ONLY JSON matching this shape:\n${describeShape(returnType)}`
    : `${role}${instruction}\n\nTASK:\n${prompt}`;
  return { wantsJson, stdin };
}

// Coerce raw CLI text into the declared return type.
export function coerce(out, returnType, wantsJson, label) {
  if (returnType && returnType.t === 'prim' && returnType.name === 'bool') {
    return /\btrue\b/i.test(out) && !/\bfalse\b/i.test(out);
  }
  if (!wantsJson) return out.trim();
  try { return parseJsonLoose(out); }
  catch { throw new Error(`${label} returned unparseable JSON for a ${returnType.t}. Got: ${out.slice(0, 200)}`); }
}
