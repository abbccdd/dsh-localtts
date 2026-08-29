import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root }).toString().split('\0').filter(Boolean))];
const problems = [];
const forbidden = /(?:^|\/)(?:node_modules|\.venv|venv|runtime|checkpoints|weights|voice_cache|runtime_voices|voices|reference_audio|outputs|artifacts|logs)\/|\.(?:ckpt|pth|pt|safetensors|onnx|bin|wav|mp3|flac|ogg|pcm|m4a|npz|npy|pkl|zip|7z|tgz|pyc|log)$/i;
for (const file of files) {
  const full = path.join(root, file);
  if (!existsSync(full)) continue; // deleted upstream file
  if (forbidden.test(file) || /(?:^|\/)(?:\.env(?:\.|$)|cookies|credentials|tokens)/i.test(file)) problems.push(`${file}: private/binary artifact`);
  if (statSync(full).size > 2 * 1024 * 1024) problems.push(`${file}: larger than 2 MiB`);
  if (!/\.(?:js|mjs|py|json|md|ya?ml)$/.test(file)) continue;
  const content = readFileSync(full, 'utf8');
  const userPath = /(?:[A-Z]:[\\/](?:Users|IndexTTS|GPT-SoVITS)|\/(?:Users|home)\/[^\s/]+)/i;
  const credential = /(?:sk-[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)/;
  if (userPath.test(content)) problems.push(`${file}: machine-specific path`);
  if (credential.test(content)) problems.push(`${file}: possible credential`);
}
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')));
if (pkg.version !== '0.1.6' || pkg.name !== '@dsh-external/dsh-plugin-local-ai-tts') problems.push('package.json: inconsistent release identity');
if (pkg.dependencies && Object.keys(pkg.dependencies).length) problems.push('package.json: review newly introduced runtime dependencies');
for (const name of ['README.md', 'README.zh-CN.md', 'LICENSE', 'NOTICE.md', 'CHANGELOG.md', 'docs/LOCAL-RUNTIME-PROTOCOL.md', 'docs/VALIDATION.md'])
  if (!existsSync(path.join(root, name))) problems.push(`missing ${name}`);
// Pinned normalized SHA-256 works in shallow CI clones and independent forks.
const licenseHash = createHash('sha256').update(readFileSync(path.join(root, 'LICENSE'), 'utf8').replace(/\r/g, '')).digest('hex');
if (licenseHash !== '7fb776c6153c2c5cb11acf22d997455ad32b1121a07ede25007e24bf304c7a6b') problems.push('upstream LICENSE changed');
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log(`Release file scan passed (${files.length} tracked/unignored paths; upstream LICENSE unchanged). Review manually before publishing.`);
