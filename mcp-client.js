// 常驻 `gbrain serve`（stdio MCP）客户端。
// 为什么：PGLite 数据目录是进程独占锁，多个 gbrain CLI 进程并发必然一个成功其余等锁 30s 后失败；
// 一个常驻 serve 进程持锁、内部并发处理请求，才能让 think（几十秒）和 get_stats（百毫秒）同时进行。
// 协议：JSON-RPC 2.0，换行分隔；initialize → notifications/initialized → tools/call。
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class McpClient extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts; // { bunPath, cli, env, cwd, log }
    this.proc = null; this.ready = false; this.pending = new Map(); this.nextId = 1; this.buf = '';
    this.restarts = 0; this.stopped = false; this.stderrTail = [];
    this.metrics = { requests: 0, errors: 0, restarts: 0 };
  }
  log(o) { try { this.opts.log && this.opts.log(o); } catch {} }
  start() {
    if (this.proc) return;
    this.stopped = false;
    const p = spawn(this.opts.bunPath, ['run', this.opts.cli, 'serve'], { env: this.opts.env(), cwd: this.opts.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = p; this.ready = false; this.buf = '';
    p.stdout.on('data', d => this.onData(d));
    p.stderr.on('data', d => { const s = String(d); this.stderrTail.push(s); if (this.stderrTail.length > 40) this.stderrTail.shift(); });
    p.on('error', e => { this.log({ serve_error: e.message }); this.failAll('serve 启动失败: ' + e.message); });
    p.on('close', code => {
      this.log({ serve_exit: code, stderr: this.stderrTail.slice(-3).join('') });
      this.proc = null; this.ready = false; this.failAll(`serve 退出（${code}）`);
      this.emit('down');
      if (!this.stopped) { // 有界重启：最多 5 次，指数退避
        if (this.restarts < 5) { this.restarts++; this.metrics.restarts++; setTimeout(() => this.start(), Math.min(30000, 1000 * 2 ** this.restarts)); }
        else this.log({ serve_giveup: true });
      }
    });
    this.readyPromise = this.handshake();
    return this.readyPromise;
  }
  async handshake() {
    try {
      const r = await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gbrain-desktop', version: '0.2' } }, 60000);
      this.notify('notifications/initialized', {});
      this.ready = true; this.restarts = 0; this.serverInfo = r.serverInfo; this.emit('ready');
      this.log({ serve_ready: r.serverInfo });
    } catch (e) { this.log({ serve_handshake_failed: e.message }); }
  }
  stop() { this.stopped = true; if (this.proc) { try { this.proc.stdin.end(); } catch {} setTimeout(() => { try { this.proc && this.proc.kill('SIGKILL'); } catch {} }, 3000); } }
  async restart() { this.stop(); await new Promise(r => setTimeout(r, 500)); this.proc = null; this.restarts = 0; return this.start(); }
  onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id); this.pending.delete(msg.id); clearTimeout(timer);
        msg.error ? reject(new Error(msg.error.message || JSON.stringify(msg.error))) : resolve(msg.result);
      }
    }
    if (this.buf.length > 50e6) this.buf = ''; // 资源有界
  }
  send(obj) { if (!this.proc) throw new Error('serve 未运行'); this.proc.stdin.write(JSON.stringify(obj) + '\n'); }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  request(method, params, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`超时（${timeoutMs / 1000}s）`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  failAll(msg) { for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(msg)); } this.pending.clear(); }
  /** 调用一个 gbrain op，返回 { ok, data | error, ms } */
  async call(tool, args, timeoutMs = 120000) {
    const t0 = Date.now(); this.metrics.requests++;
    if (!this.ready) { if (this.readyPromise) await this.readyPromise; if (!this.ready) { this.metrics.errors++; return { ok: false, error: 'serve 未就绪', ms: Date.now() - t0 }; } }
    try {
      const r = await this.request('tools/call', { name: tool, arguments: args || {} }, timeoutMs);
      const text = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      let data; try { data = JSON.parse(text); } catch { data = text; }
      if (r.isError) { this.metrics.errors++; return { ok: false, error: typeof data === 'string' ? data : (data.error || JSON.stringify(data)), ms: Date.now() - t0 }; }
      return { ok: true, data, ms: Date.now() - t0 };
    } catch (e) { this.metrics.errors++; return { ok: false, error: e.message, ms: Date.now() - t0 }; }
  }
}
module.exports = { McpClient };
