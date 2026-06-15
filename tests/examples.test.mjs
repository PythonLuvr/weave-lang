import { parse } from '../src/parser.js';
import { check } from '../src/checker.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { test, ok } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// The examples that ship in the public build must always parse and type-check.
const PUBLIC = ['demo', 'social_post', 'judged-post', 'research', 'variants'];

for (const name of PUBLIC) {
  test(`example ${name}.weave parses and checks clean`, () => {
    const src = readFileSync(join(here, '..', 'examples', `${name}.weave`), 'utf8');
    const res = check(parse(src));
    ok(res.ok, `${name}: ${res.errors.join('; ')}`);
  });
}
