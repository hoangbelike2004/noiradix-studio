import { createHash } from 'node:crypto';
import { providerError } from './ai-providers.mjs';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

/** Content-addressed assets stay local. IDs are not advertised as provider file IDs. */
export class AssetManager {
  constructor(maxBytes = 32 * 1024 * 1024) { this.assets = new Map(); this.bytes = 0; this.maxBytes = maxBytes; }
  put(value) {
    const serialized = JSON.stringify(value), id = 'asset_' + digest(serialized);
    if (!this.assets.has(id)) {
      const bytes = Buffer.byteLength(serialized);
      if (bytes > this.maxBytes) throw providerError('Asset vượt giới hạn bộ nhớ.');
      while (this.bytes + bytes > this.maxBytes && this.assets.size) {
        const key = this.assets.keys().next().value; this.bytes -= this.assets.get(key).bytes; this.assets.delete(key);
      }
      this.assets.set(id, { value: structuredClone(value), bytes }); this.bytes += bytes;
    }
    return id;
  }
  get(id) { return structuredClone(this.assets.get(id)?.value); }
  clear() { this.assets.clear(); this.bytes = 0; }
}

export class SharedContextManager {
  constructor(context, assets) {
    this.assets = assets;
    const { referenceImage, ...technical } = context;
    this.context = structuredClone(technical);
    this.sourceId = assets.put(technical);
    this.currentId = this.sourceId;
    this.decisions = [];
    this.brief = { characterDesign: '', style: '', decisions: [] };
  }
  update(output) {
    if (output.canvas) {
      // Do not truncate palette, dimensions, coordinates, IDs, timing or locks.
      const { referenceImage, ...canvas } = output.canvas;
      this.context = { ...this.context, ...structuredClone(canvas) };
    }
    if (output.studio) this.context.studio = structuredClone(output.studio);
    this.currentId = this.assets.put(this.context);
  }
  data() { return { sourceAssetId: this.sourceId, currentAssetId: this.currentId, constraints: this.context,
    projectBrief: this.brief, decisions: this.decisions.slice(-8) }; }
  decide(task) { this.decisions.push({ taskId: task.id, goal: task.goal, result: task.result }); }
}

// Keep two recent exchanges verbatim; older conversation is not silently promoted
// to authoritative project constraints. The current editor snapshot is authoritative.
export function recentHistory(history) {
  return history.filter(item => ['user', 'assistant'].includes(item?.role) && typeof item.content === 'string').slice(-4)
    .map(item => ({ ...item, content: item.content.slice(-4000) }));
}

/** Superseded snapshots are replaced, preserving call/output and reasoning order. */
export function compactToolHistory(input, assets) {
  const latest = new Map();
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i];
    if (item.type !== 'function_call_output') continue;
    const output = JSON.parse(item.output);
    for (const field of ['canvas', 'studio']) {
      const value = output[field];
      if (!value || value.assetRef) continue;
      if (latest.has(field)) output[field] = { assetRef: assets.put(value), supersededByLatestToolResult: true };
      else latest.set(field, i);
    }
    input[i] = { ...item, output: JSON.stringify(output) };
  }
}

export class ResultCache {
  constructor() { this.entries = new Map(); this.inflight = new Map(); this.hits = 0; this.misses = 0; }
  async get(key, producer) {
    const cached = this.entries.get(key);
    if (cached && cached.expires > Date.now()) { this.hits++; return { value: structuredClone(cached.value), hit: true }; }
    if (this.inflight.has(key)) { this.hits++; return { value: structuredClone(await this.inflight.get(key)), hit: true }; }
    this.misses++;
    const pending = producer(); this.inflight.set(key, pending);
    try {
      const value = await pending;
      if (this.entries.size >= 64) this.entries.delete(this.entries.keys().next().value);
      this.entries.set(key, { value: structuredClone(value), expires: Date.now() + 300000 });
      return { value, hit: false };
    } finally { this.inflight.delete(key); }
  }
}
