import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LocalRuntimeService } from '../lib/local-runtime/service.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const selector = vm.runInNewContext(`${readFileSync(new URL('../src/host-client.js', import.meta.url), 'utf8')}; useHostMessages`);
const messages = [{ kind: 'assistant', messageId: 'm1', seq: 1, blocks: [{ kind: 'text', text: '你好。' }] }];

test('message controls select legacy snapshots and the public 0.2 Chat projection', () => {
  assert.equal(selector({ session: { nodes: messages } }), messages);
  assert.equal(selector({ useSession: fn => fn({ nodes: messages }) }), messages);
  assert.equal(selector({ useChat: fn => fn({ legacy: { nodes: messages } }),
    useSession() { throw new Error('0.2 Session state has no message nodes'); } }), messages);
});

test('client declares the slots service and does not silently apply without it', () => {
  let registration;
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value; } } },
  });
  const exports = registration.factory(name => { assert.equal(name, 'react'); return {}; });
  assert.deepEqual(Array.from(exports.inject), ['slots']);
  assert.throws(() => exports.apply({ get() {}, effect() {} }));
});

test('a missing Chat legacy projection uses a public nodes snapshot or reports an unsupported capability', () => {
  assert.equal(selector({ useChat: fn => fn({ nodes: messages }) }), messages);
  assert.equal(selector({ useChat: fn => fn({ newerMessageStore: {} }) }).length, 0);
});

function runtime(t) {
  const requests = [];
  const service = new LocalRuntimeService({ providerFactory: () => ({
    async synthesize({ text }) { requests.push(text); return { data: Buffer.from('test audio'), mime: 'audio/wav' }; },
    cancel() {},
  }) });
  t.after(() => service.dispose());
  service.configure({ clientId: 'compat_client_123456', config: { endpoint: 'http://localhost:9999', engine: 'indextts' }, sessionId: 's1', autoRead: true });
  const agent = { session: { id: 's1' } };
  const c = service.client('compat_client_123456');
  const frame = data => service.ingestStream({ agent, frame: { attemptId: 's1:1', ...data } });
  const durable = (seq, type, data) => service.ingest(agent.session, { seq, type, data });
  const settle = async count => {
    for (let i = 0; i < 100 && requests.length < count; i++) await delay(5);
    assert.equal(requests.length, count);
  };
  return { service, c, agent, frame, durable, requests, settle };
}

test('durable final messages remain readable when transient streaming is unavailable', async t => {
  const h = runtime(t);
  h.durable(1, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '第一句。第二句。' }] } });
  h.durable(2, 'turn/end', { turn: 1 });
  await h.settle(2);
  assert.deepEqual(h.requests, ['第一句。', '第二句。']);
});

test('0.2 streaming starts before settlement, ignores repeated frames and never replays final text', async t => {
  const h = runtime(t);
  h.frame({ type: 'start', revision: 100, turn: 1, step: 1 });
  h.frame({ type: 'chunk', revision: 101, index: 0, chunk: { type: 'text-delta', text: '第一句。' } });
  h.frame({ type: 'chunk', revision: 101, index: 0, chunk: { type: 'text-delta', text: '第一句。' } });
  await h.settle(1);
  assert.equal(h.c.maxSeq, -1, 'transient revision cannot consume durable seq');
  h.frame({ type: 'chunk', revision: 102, index: 1, chunk: { type: 'text-delta', text: '第二句。第三句。' } });
  h.durable(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '第一句。第二句。第三句。' }] } });
  h.frame({ type: 'end', revision: 103, index: 2, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 2 } });
  h.frame({ type: 'chunk', revision: 104, index: 2, chunk: { type: 'text-delta', text: '结束后不朗读。' } });
  h.durable(3, 'turn/end', { turn: 1 });
  await h.settle(3);
  assert.deepEqual(h.requests, ['第一句。', '第二句。', '第三句。']);
  assert.equal(h.c.maxSeq, 3);
  assert.equal(h.c.jobs[0].done, true);
});

test('0.2 failed attempt discards residual, retry gets a fresh frame sequence, other sessions stay isolated', async t => {
  const h = runtime(t);
  h.frame({ type: 'start', revision: 1, turn: 1, step: 1 });
  h.frame({ type: 'chunk', revision: 2, index: 0, chunk: { type: 'text-delta', text: '失败的残句' } });
  h.durable(1, 'assistant/attempt', { turn: 1, step: 1, stream: [] });
  h.frame({ type: 'end', revision: 3, index: 1, outcome: { kind: 'committed', eventType: 'assistant/attempt', seq: 1 } });
  h.frame({ type: 'start', attemptId: 's1:2', revision: 4, turn: 1, step: 1 });
  h.service.ingestStream({ agent: { session: { id: 'other' } }, frame: { type: 'start', attemptId: 'other:1', revision: 999, turn: 1, step: 1 } });
  h.frame({ type: 'chunk', attemptId: 's1:2', revision: 5, index: 0, chunk: { type: 'text-delta', text: '成功的尾句' } });
  h.durable(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '成功的尾句' }] } });
  h.durable(3, 'turn/end', { turn: 1 });
  await h.settle(1);
  assert.deepEqual(h.requests, ['成功的尾句']);
});

test('0.2 frames respect manual reads, stop and disabled Auto Read', async t => {
  const h = runtime(t);
  h.service.read(h.c, '手动朗读。');
  h.frame({ type: 'start', revision: 1, turn: 1, step: 1 });
  h.frame({ type: 'chunk', revision: 2, index: 0, chunk: { type: 'text-delta', text: '自动朗读。' } });
  await h.settle(1);
  assert.equal(h.c.suppressedTurn, 1);
  h.service.stop(h.c);
  h.c.autoRead = false;
  h.frame({ type: 'start', attemptId: 's1:2', revision: 3, turn: 2, step: 1 });
  h.frame({ type: 'chunk', attemptId: 's1:2', revision: 4, index: 0, chunk: { type: 'text-delta', text: '关闭后不朗读。' } });
  await delay(10);
  assert.deepEqual(h.requests, ['手动朗读。']);
});

test('replacement Agent can restart revision at one without old-Agent frames crossing into it', async t => {
  const h = runtime(t);
  h.frame({ type: 'start', revision: 100, turn: 1, step: 1 });
  h.frame({ type: 'end', revision: 101, index: 0, outcome: { kind: 'abandoned' } });
  const replacement = { session: { id: 's1' } };
  h.service.ingestStream({ agent: replacement, frame: { type: 'start', attemptId: 's1:1', revision: 1, turn: 2, step: 1 } });
  h.frame({ type: 'chunk', revision: 102, index: 0, chunk: { type: 'text-delta', text: '旧Agent。' } });
  h.service.ingestStream({ agent: replacement, frame: { type: 'chunk', attemptId: 's1:1', revision: 2, index: 0, chunk: { type: 'text-delta', text: '新Agent。' } } });
  await h.settle(1);
  assert.deepEqual(h.requests, ['新Agent。']);
});
