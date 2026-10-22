// 常驻子进程宿主（2.4）：一行请求 → 一行 JSON 响应。
// 借鉴 Screenpipe #4841：引擎只建一次、单并发信号量、超时与自动重启；空闲自动退出，避免常驻占用。
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
class PsHost {
  constructor({ name, script, timeoutMs = 8000, firstTimeoutMs, idleExitMs = 5 * 60000, spawnImpl, maxRestarts = 5 } = {}) {
    // 2.4.8：首个请求含 powershell 启动 + Add-Type 编译（慢机器 3–10s），用单独的宽限超时，避免"超时→杀进程→重启→再超时"死循环直至永久停用
    Object.assign(this, { name, script, timeoutMs, firstTimeoutMs: firstTimeoutMs || (spawnImpl ? timeoutMs : Math.max(timeoutMs, 15000)), idleExitMs, spawnImpl, maxRestarts });
    this.warm = false;
    this.proc = null; this.buf = ''; this.queue = []; this.cur = null; this.restarts = 0; this.idleTimer = null;
    this.stats = { requests: 0, ok: 0, fail: 0, timeouts: 0, spawns: 0, totalMs: 0 };
    this.lastError = null;
  }
  _spawn() {
    if (this.spawnImpl) { this.proc = this.spawnImpl(); }
    else {
      const f = path.join(os.tmpdir(), `mindtrace-${this.name}.ps1`);
      fs.writeFileSync(f, '\ufeff' + this.script, 'utf8');
      this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    }
    this.stats.spawns++; this.buf = ''; this.warm = false;
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => { if (this.proc === me) this._onData(d); });
    const me = this.proc;
    const dead = () => { if (this.proc !== me) return; this.proc = null; if (this.cur) this._finish(null, new Error(`${this.name} 进程退出`)); };
    this.proc.on('exit', dead); this.proc.on('error', dead);
  }
  _onData(d) {
    this.buf += d; let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      if (!line || !this.cur) continue;
      let j; try { j = JSON.parse(line); } catch (_) { continue; }
      this._finish(j, null);
    }
  }
  _finish(res, err) {
    const c = this.cur; if (!c) return; this.cur = null; clearTimeout(c.tm);
    const ms = Date.now() - c.t0; this.stats.totalMs += ms; if (!err) { this.warm = true; this.restarts = 0; }
    err ? this.stats.fail++ : this.stats.ok++; if (err) this.lastError = err.message;
    err ? c.reject(err) : c.resolve(res);
    this._pump();
  }
  _pump() {
    if (this.cur || !this.queue.length) { if (!this.cur && !this.queue.length) this._armIdle(); return; }
    clearTimeout(this.idleTimer);
    if (!this.proc) { if (this.restarts++ > this.maxRestarts) { const q = this.queue.splice(0); q.forEach(x => x.reject(new Error(`${this.name} 多次崩溃，已停用`))); return; } this._spawn(); }
    const c = this.cur = this.queue.shift(); c.t0 = Date.now();
    c.tm = setTimeout(() => { this.stats.timeouts++; const p = this.proc; this.proc = null; try { p && p.kill(); } catch (_) {} this._finish(null, new Error(`${this.name} 超时`)); }, this.warm ? this.timeoutMs : this.firstTimeoutMs);
    try { this.proc.stdin.write(String(c.line).replace(/[\r\n]+/g, ' ') + '\n'); } catch (e) { this._finish(null, e); }
  }
  _armIdle() { clearTimeout(this.idleTimer); if (this.idleExitMs > 0) { this.idleTimer = setTimeout(() => this.stop(), this.idleExitMs); this.idleTimer.unref?.(); } }
  request(line) { this.stats.requests++; return new Promise((resolve, reject) => { this.queue.push({ line, resolve, reject }); this._pump(); }); }
  get pending() { return this.queue.length + (this.cur ? 1 : 0); }
  stop() { clearTimeout(this.idleTimer); const p = this.proc; this.proc = null; if (p) { try { p.stdin.end(); } catch (_) {} try { p.kill(); } catch (_) {} } }
  info() { const s = this.stats; return { ...s, lastError: this.lastError, alive: !!this.proc, avgMs: s.ok + s.fail ? Math.round(s.totalMs / (s.ok + s.fail)) : 0 }; }
}
module.exports = { PsHost };
