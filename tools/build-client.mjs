import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../lib/client.js', import.meta.url);
const source = readFileSync(new URL('../src/local-client.js', import.meta.url), 'utf8');
const before = readFileSync(file, 'utf8');
const coexistence = readFileSync(new URL('../src/coexistence-client.js', import.meta.url), 'utf8');
const after = before.replace(/\/\/ BEGIN LOCAL RUNTIME CLIENT[\s\S]*?\/\/ END LOCAL RUNTIME CLIENT/, '// BEGIN LOCAL RUNTIME CLIENT\n' + source + '\n// END LOCAL RUNTIME CLIENT')
  .replace(/\/\/ BEGIN COEXISTENCE CLIENT[\s\S]*?\/\/ END COEXISTENCE CLIENT/, '// BEGIN COEXISTENCE CLIENT\n' + coexistence + '\n// END COEXISTENCE CLIENT');
if (process.argv.includes('--check')) {
  if (after !== before) { console.error('Run node tools/build-client.mjs'); process.exitCode = 1; }
} else writeFileSync(file, after);
