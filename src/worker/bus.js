const { Budget } = require('./budget');

class EventBus {
  constructor({ flush, intervalMs = 3000, maxBatch = 50 } = {}) {
    this.flush = flush;
    this.intervalMs = intervalMs;
    this.maxBatch = maxBatch;
    this.buf = [];
    this.budget = new Budget();
    this.timer = null;
    this.seen = new Map(); // hash -> ts
  }
  start() {
    this.stop();
    this.timer = setInterval(() => this.flushNow(), this.intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flushNow();
  }
  _hash(ev) {
    return ev.content_hash || `${ev.type}|${ev.app || ''}|${ev.title || ''}|${ev.url || ''}|${ev.path || ''}|${(ev.content || '').slice(0, 80)}`;
  }
  push(ev) {
    if (!ev || !ev.type) return false;
    const h = this._hash(ev);
    const now = Date.now();
    const prev = this.seen.get(h);
    if (prev && now - prev < 15000 && ev.type !== 'note') return false;
    this.seen.set(h, now);
    if (this.seen.size > 5000) {
      const cut = now - 3600000;
      for (const [k, t] of this.seen) if (t < cut) this.seen.delete(k);
    }
    this.buf.push({ ...ev, content_hash: h, ts_start: ev.ts_start || now });
    this.budget.onEnqueue(1);
    if (this.buf.length >= this.maxBatch) this.flushNow();
    return true;
  }
  flushNow() {
    if (!this.buf.length) return;
    const batch = this.buf.splice(0, this.buf.length);
    this.budget.onFlush(batch.length);
    try { this.flush(batch); } catch (e) { console.error('bus flush', e.message); }
  }
}
module.exports = { EventBus };
