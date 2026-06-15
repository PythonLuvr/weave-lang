// models.js
// Model backends. v0 ships a deterministic MOCK so a .weave file runs end to
// end for free (zero credits, zero quota). The mock also demonstrates the
// repair loop: a body-producing soft call returns an over-long draft on the
// first attempt and a corrected one once it sees repair feedback.
//
// A real backend (Claude / Gemini) implements the same `complete(...)` shape
// and is wired behind an explicit cost gate, not by default.

const LONG_BODY =
  'Granite countertops resist heat and scratches, and every single slab is a one of a kind ' +
  'natural pattern that can last for decades when it is sealed correctly, which is exactly the ' +
  'reason so many homeowners keep choosing real natural stone over engineered look alike surfaces ' +
  'year after year, season after season, kitchen after kitchen.';

const SHORT_BODY =
  'Granite resists heat and scratches, and every slab is one of a kind. Sealed right, it lasts decades.';

const FACTS = [
  'Granite is highly heat and scratch resistant.',
  'Each granite slab has a unique natural pattern.',
  'Sealed granite can last for decades.',
];

export function createMockModel() {
  return {
    async complete({ prompt, returnType }) {
      // Judge prompts: the mock reviewer always approves so demos run clean.
      if (String(prompt).includes('Reply with PASS or FAIL')) return 'PASS. Meets the rubric.';
      const repairing = String(prompt).includes('previous output violated');
      return synth(returnType, { repairing });
    },
  };
}

function synth(type, ctx) {
  if (!type) return 'sample text';
  if (type.t === 'prim') {
    if (type.name === 'bool') return true;
    if (type.name === 'int' || type.name === 'num') return 0;
    return 'sample text';
  }
  if (type.t === 'enum') return type.members[0];
  if (type.t === 'list') return [0, 1, 2].map(i => synthItem(type.elem, i, ctx));
  if (type.t === 'record') {
    const o = {};
    for (const f of type.fields) o[f.name] = fieldValue(f.name, f.type, ctx);
    return o;
  }
  return 'sample text';
}

function synthItem(elem, i, ctx) {
  if (elem && elem.t === 'prim' && elem.name === 'text') return FACTS[i % FACTS.length];
  return synth(elem, ctx);
}

function fieldValue(name, type, ctx) {
  if (type && type.t === 'prim' && type.name === 'text') {
    if (name === 'body') return ctx.repairing ? SHORT_BODY : LONG_BODY;
    if (name === 'cta') return 'Visit our showroom this week.';
    return 'sample text';
  }
  return synth(type, ctx);
}
