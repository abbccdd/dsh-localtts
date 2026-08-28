import readline from 'node:readline';
import { Buffer } from 'node:buffer';

function wav() {
  const pcm = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]);
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]).toString('base64');
}
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  let r; try { r = JSON.parse(line); } catch { return; }
  if (r.action === 'health') setTimeout(() => console.log(JSON.stringify({ id: r.id, ok: true, ready: !process.argv.includes('--not-ready'), status: 'ready' })), process.argv.includes('--slow-ready') ? 100 : 0);
  else if (r.action === 'voices') console.log(JSON.stringify({ id: r.id, ok: true, voices: [{ id: 'mock', name: 'Mock' }] }));
  else if (r.action === 'synthesize') console.log(JSON.stringify({ id: r.id, ok: true, mime: 'audio/wav', audioBase64: wav() }));
  else console.log(JSON.stringify({ id: r.id, ok: false, code: 'ACTION', error: 'unknown' }));
});
