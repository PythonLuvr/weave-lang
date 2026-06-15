// models-gemini.js
// Real model backend that shells out to the Gemini CLI (subscription OAuth,
// no API key). Same shape as the mock: complete({ prompt, returnType }) -> value.
//
// The full prompt is piped via stdin (no spacey CLI args, so no Windows shell
// quoting issues). API-key env vars are stripped before spawn, mirroring the
// router policy (subscription-only). If a future Gemini CLI version needs an
// explicit -p flag for non-interactive stdin, that is the one knob to revisit.

import { spawn } from 'child_process';
import { buildPayload, coerce } from './model-util.js';

const STRIP_KEYS = ['GEMINI_API_KEY', 'EJ_GEMINI_API_KEY', 'SHARED_GEMINI_API_KEY', 'GOOGLE_API_KEY'];

export function createGeminiCliModel(opts = {}) {
  const model = opts.model || 'gemini-2.5-flash';
  return {
    async complete({ prompt, returnType, agent }) {
      const { wantsJson, stdin } = buildPayload(prompt, returnType, agent && agent.persona);
      const out = await runGemini(stdin, model);
      return coerce(out, returnType, wantsJson, 'Gemini');
    },
  };
}

function runGemini(stdinText, model, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const k of STRIP_KEYS) delete env[k];
    // Command as one string (no args array) avoids Node's DEP0190 shell-args
    // warning. model is a controlled token; the prompt goes via stdin only.
    const ps = spawn(`gemini -m ${model} -o text --skip-trust`, { env, shell: true });
    let out = '', err = '';
    const timer = setTimeout(() => { ps.kill(); reject(new Error('gemini CLI timed out')); }, timeoutMs);
    ps.stdout.on('data', d => { out += d; });
    ps.stderr.on('data', d => { err += d; });
    ps.on('error', e => { clearTimeout(timer); reject(e); });
    ps.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`gemini exited ${code}: ${err.slice(0, 300)}`));
    });
    ps.stdin.write(stdinText);
    ps.stdin.end();
  });
}
