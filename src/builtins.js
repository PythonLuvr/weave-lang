// builtins.js
// The closed registry of built-in lints usable inside contracts.
// Per the contract fence (docs/DESIGN.md section 6.5), `require` / `ensure`
// may only call functions from THIS registry or declared tools that return
// bool. Nothing else. No lambdas, no closures, no arbitrary computation.

// The em dash glyph, constructed at runtime so this source file never
// embeds the literal character (supports a no-em-dashes house style).
const EM_DASH = String.fromCharCode(0x2014);

// Signature metadata used by the checker to validate contract calls.
export const BUILTINS = {
  contains:     { params: ['text', 'text'], ret: 'bool' },
  starts_with:  { params: ['text', 'text'], ret: 'bool' },
  ends_with:    { params: ['text', 'text'], ret: 'bool' },
  no_em_dashes: { params: ['text'],         ret: 'bool' },
  no_hashtags:  { params: ['text'],         ret: 'bool' },
  // judge(agentRef, rubric, value) -> bool. Special-cased in the interpreter
  // and checker (first arg is an agent, not a value). It calls a reviewer model;
  // it is the one predicate that costs a model call and is non-deterministic.
  judge:        { params: ['agent', 'text', 'any'], ret: 'bool' },
};

// Runtime implementations, keyed by name.
export const BUILTIN_IMPL = {
  contains:     (s, sub) => String(s).includes(String(sub)),
  starts_with:  (s, sub) => String(s).startsWith(String(sub)),
  ends_with:    (s, sub) => String(s).endsWith(String(sub)),
  no_em_dashes: (s) => !String(s).includes(EM_DASH),
  no_hashtags:  (s) => !String(s).includes('#'),
};

export function isBuiltin(name) {
  return Object.prototype.hasOwnProperty.call(BUILTINS, name);
}
