import path from 'node:path';
import { RuntimeError } from './provider.mjs';

// A lease belongs to a browser, not a sentence/turn. Identical configurations
// share one worker and one serial queue, including connection checks.
export class RuntimePool {
  constructor(factory) { this.factory = factory; this.entries = new Map(); }
  acquire(config) {
    const key = JSON.stringify(config);
    let entry = this.entries.get(key);
    if (entry?.closing) throw new RuntimeError('RUNTIME_CLOSING', 'Previous worker is shutting down. Retry shortly.');
    if (!entry) {
      if (this.entries.size >= 8) throw new RuntimeError('LIMIT', 'Too many local runtimes. Close unused sessions.');
      const resources = [];
      if (config.mode === 'process' && config.launchPreset !== 'custom') {
        if (config.projectPath) {
          const project = path.resolve(config.projectPath);
          resources.push('project:' + (process.platform === 'win32' ? project.toLowerCase() : project));
        }
        if (config.launchPreset === 'webui' && config.webuiEndpoint) resources.push('endpoint:' + config.webuiEndpoint);
        else if (config.engine === 'gpt-sovits') resources.push('port:' + config.port);
      }
      if ([...this.entries.values()].some(e => e.resources.some(r => resources.includes(r))))
        throw new RuntimeError('RUNTIME_IN_USE', 'This project or endpoint is already in use with different settings. Stop the other session first.');
      entry = { provider: this.factory(config), config, resources, refs: 0, tail: Promise.resolve(), active: null, closing: false };
      this.entries.set(key, entry);
    }
    entry.refs++;
    let revision = 0, released = false;
    const lease = {};
    const cancelled = () => new RuntimeError('CANCELLED', 'Reading cancelled.');
    const call = (method, args) => {
      const ticket = revision;
      const result = entry.tail.then(async () => {
        if (released || entry.closing || ticket !== revision) throw cancelled();
        entry.active = lease;
        try {
          const value = await entry.provider[method](...args);
          if (released || ticket !== revision) throw cancelled();
          return value;
        } finally { entry.active = null; }
      });
      entry.tail = result.catch(() => {});
      return result;
    };
    for (const method of ['synthesize', 'healthCheck', 'listVoices']) lease[method] = (...args) => call(method, args);
    lease.cancel = () => {
      revision++;
      // Owned JSONL workers finish the current computation before another
      // request enters the queue. Stop discards audio, not the whole model.
      if (entry.active === lease && entry.config.mode !== 'process') entry.provider.cancel?.();
    };
    lease.dispose = () => {
      if (released) return;
      lease.cancel(); released = true;
      if (--entry.refs) return;
      entry.closing = true;
      let result;
      try { result = entry.provider.dispose?.(); entry.provider.cancel?.(); }
      finally {
        const remove = () => { if (this.entries.get(key) === entry) this.entries.delete(key); };
        if (result?.then) return Promise.resolve(result).catch(() => {}).finally(remove);
        remove();
      }
    };
    return lease;
  }
  dispose() {
    for (const entry of this.entries.values()) { entry.closing = true; entry.provider.cancel?.(); entry.provider.dispose?.(); }
    this.entries.clear();
  }
}
