// 最小 localStorage polyfill，供 Node 下驱动真实 store 使用
class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
}

(globalThis as unknown as { localStorage: MemoryStorage; window: { addEventListener: () => void; removeEventListener: () => void } }).localStorage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = globalThis;
