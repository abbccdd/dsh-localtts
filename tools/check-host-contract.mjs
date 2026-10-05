// Run against a complete, independently installed official DSH package.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const anchor = path.resolve(process.argv[2]);
const hostRequire = createRequire(anchor);
const host = JSON.parse(readFileSync(anchor, 'utf8'));
const plugin = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const bootManifest = hostRequire.resolve('@deepseek-ai/dsh-app-boot/package.json');
const bootRequire = createRequire(bootManifest);
const boot = await import(pathToFileURL(bootRequire.resolve('@deepseek-ai/dsh-app-boot')));
if (typeof boot.evaluatePluginCompatibility === 'function')
  assert.equal(boot.evaluatePluginCompatibility(plugin, {}, host.version), undefined, `Host ${host.version} rejects the plugin`);
else assert.ok(host.version.startsWith('0.1.'), 'A future host removed the public compatibility evaluator');
for (const name of ['@deepseek-ai/dsh-host-webserver', ...plugin.dsh.client.inject]) {
  const manifest = JSON.parse(readFileSync(hostRequire.resolve(`${name}/package.json`), 'utf8'));
  assert.equal(manifest.version, host.version, `${name}: mixed host package generation`);
  if (name !== '@deepseek-ai/dsh-host-webserver') {
    assert.equal(manifest.dsh.client.platform, 'web');
    assert.ok(existsSync(hostRequire.resolve(`${name}/client`)), `${name}: client entry is missing`);
  }
}
// Modern hosts must keep the typed public stream boundary this adapter uses.
if (host.version.startsWith('0.2.')) {
  const agentDir = path.dirname(hostRequire.resolve('@deepseek-ai/dsh-agent/package.json'));
  const files = (await import('node:fs')).readdirSync(path.join(agentDir, 'lib/types'), { recursive: true }).filter(file => file.endsWith('.d.ts'));
  const types = files.map(file => readFileSync(path.join(agentDir, 'lib/types', file), 'utf8')).join('\n');
  for (const field of ['agent/assistant-stream', 'attemptId', 'revision', 'outcome']) assert.ok(types.includes(field), `Host ${host.version}: stream contract missing ${field}`);
}
console.log(`Official Harness ${host.version}: compatibility gate, web service, client entries and event declarations passed.`);
