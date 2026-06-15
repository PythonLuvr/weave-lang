// models-claude.js
// Real model backend that shells out to the Claude CLI in headless print mode
// (uses your Claude subscription, no API key). Same shape as the mock:
// complete({ prompt, returnType }) -> value.
//
// `-p` is a boolean print flag; the prompt is piped via stdin, so no shell
// quoting issues. --output-format text gives clean stdout.

import { spawn } from 'child_process';
import { buildPayload, coerce } from './model-util.js';

export function createClaudeCliModel(opts = {}) {
  const model = opts.model || 'sonnet';
  return {
    async complete({ prompt, returnType, agent }) {
      const { wantsJson, stdin } = buildPayload(prompt, returnType, agent && agent.persona);
      const out = await runClaude(stdin, model);
      return coerce(out, returnType, wantsJson, 'Claude');
    },
  };
}

function runClaude(stdinText, model, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    // Command as one string (no args array) avoids Node's DEP0190 shell-args
    // warning. model is a controlled token; the prompt goes via stdin only.
    const ps = spawn(`claude -p --output-format text --model ${model}`, { shell: true });
    let out = '', err = '';
    const timer = setTimeout(() => { ps.kill(); reject(new Error('claude CLI timed out')); }, timeoutMs);
    ps.stdout.on('data', d => { out += d; });
    ps.stderr.on('data', d => { err += d; });
    ps.on('error', e => { clearTimeout(timer); reject(e); });
    ps.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
    });
    ps.stdin.write(stdinText);
    ps.stdin.end();
  });
}
