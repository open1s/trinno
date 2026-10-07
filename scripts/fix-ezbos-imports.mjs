#!/usr/bin/env node
/**
 * Patch upstream ESM packaging bugs after `npm install`.
 *
 * @open1s/ezbos 2.0.1 ships `"type": "module"` but dist/tool.js line 3 has an
 * extensionless relative import (`from './errors'`), which Node's ESM loader
 * rejects with ERR_MODULE_NOT_FOUND — breaking every runtime import of the
 * package even though TypeScript compiles fine. Idempotent: rewrites only
 * extensionless relative specifiers, no-op when already fixed upstream.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../node_modules/@open1s/ezbos/dist/tool.js', import.meta.url);

let src;
try {
  src = readFileSync(target, 'utf8');
} catch (e) {
  // Not installed yet (or already fixed by a future release removing tool.js).
  process.exit(0);
}

const fixed = src.replace(
  /(from\s+')((?:\.{1,2}\/)[^']+?)(')/g,
  (_m, head, spec, tail) =>
    head + (spec.endsWith('.js') ? spec : spec + '.js') + tail,
);

if (fixed !== src) {
  writeFileSync(target, fixed);
  console.log('fix-ezbos-imports: patched @open1s/ezbos/dist/tool.js relative import');
}
