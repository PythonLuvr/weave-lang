// test.mjs
// Runs the Weave test suite. Usage: node test.mjs
import './tests/lexer.test.mjs';
import './tests/parser.test.mjs';
import './tests/checker.test.mjs';
import './tests/interpreter.test.mjs';
import './tests/examples.test.mjs';
import { run } from './tests/harness.mjs';

await run();
