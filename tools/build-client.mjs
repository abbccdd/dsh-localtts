import { readFileSync, writeFileSync } from 'node:fs';
const file = new URL('../lib/client.js', import.meta.url);
const source = readFileSync(new URL('../src/local-client.js', import.meta.url), 'utf8');
const before = readFileSync(file, 'utf8');
const coexistence = readFileSync(new URL('../src/coexistence-client.js', import.meta.url), 'utf8');
const host = readFileSync(new URL('../src/host-client.js', import.meta.url), 'utf8');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const updater = readFileSync(new URL('../src/update-client.js', import.meta.url), 'utf8').replace('__LOCAL_PLUGIN_VERSION__', version);
const after = before.replace(/\/\/ BEGIN LOCAL RUNTIME CLIENT[\s\S]*?\/\/ END LOCAL RUNTIME CLIENT/, '// BEGIN LOCAL RUNTIME CLIENT\n' + source + '\n// END LOCAL RUNTIME CLIENT')
  .replace(/\/\/ BEGIN COEXISTENCE CLIENT[\s\S]*?\/\/ END COEXISTENCE CLIENT/, '// BEGIN COEXISTENCE CLIENT\n' + coexistence + '\n// END COEXISTENCE CLIENT')
  .replace(/\/\/ BEGIN HOST CLIENT[\s\S]*?\/\/ END HOST CLIENT/, '// BEGIN HOST CLIENT\n' + host + '\n// END HOST CLIENT')
  .replace(/\/\/ BEGIN UPDATE CLIENT[\s\S]*?\/\/ END UPDATE CLIENT/, '// BEGIN UPDATE CLIENT\n' + updater + '\n// END UPDATE CLIENT');
if (process.argv.includes('--check')) {
  if (after !== before) { console.error('Run node tools/build-client.mjs'); process.exitCode = 1; }
} else writeFileSync(file, after);
