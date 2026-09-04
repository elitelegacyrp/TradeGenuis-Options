// GBrain Options 桌面客户端 — 主进程
// 架构：渲染层 --IPC--> 主进程 --stdio MCP--> 常驻 `gbrain serve`（一个进程持 PGLite 锁，内部并发）。
// trade-off：PGLite 数据目录是进程独占锁，多个 CLI 进程并发会等锁 30s 后失败（已实测）。
// 因此所有 op 走常驻 serve；只有没有 MCP 等价物的命令（import 目录 / embed / doctor / init / config set）
// 走"CLI 通道"：暂停 serve → 执行 → 恢复。CLI 通道串行、有超时。
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { McpClient } = require('./mcp-client');

// ---------- 配置 ----------
const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  gbrainRepo: path.join(os.homedir(), 'Desktop', 'gbrain'),
  bunPath: path.join(os.homedir(), '.bun', 'bin', 'bun'),
  gbrainHome: '',
  env: { VOYAGE_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '' },
  chatModel: '',
};
// 产品改名后 userData 目录变了：首次启动把旧目录（GBrain）的设置迁过来，用户填过的 key 不丢
function migrateSettings() {
  try {
    const cur = SETTINGS_PATH(); if (fs.existsSync(cur)) return;
    for (const name of ['TradeGenius Options', 'TradingGenius Options', 'GBrain']) { const old = path.join(path.dirname(app.getPath('userData')), name, 'settings.json'); if (fs.existsSync(old)) { fs.mkdirSync(path.dirname(cur), { recursive: true }); fs.copyFileSync(old, cur); return; } }
  } catch {}
}
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8')) }; } catch { return { ...DEFAULTS }; } }
function saveSettings(s) { fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive: true }); fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(s, null, 2)); }
function buildEnv() {
  const s = loadSettings();
  // GBRAIN_STDIO_TAKES_HOLDERS：本地补丁（gbrain/src/mcp/server.ts），让常驻 serve 允许以 people/me 记录 takes
  const env = { ...process.env, GBRAIN_NO_ONBOARD_NUDGE: '1', GBRAIN_STDIO_TAKES_HOLDERS: 'world,people/me,brain', PATH: `${path.dirname(s.bunPath)}:${process.env.PATH || ''}` };
  for (const [k, v] of Object.entries(s.env || {})) if (v) env[k] = v;
  if (s.gbrainHome) env.GBRAIN_HOME = s.gbrainHome;
  return env;
}
const cliPath = () => path.join(loadSettings().gbrainRepo, 'src', 'cli.ts');

// ---------- 可观测性 ----------
const LOG_PATH = () => path.join(app.getPath('userData'), 'calls.log');
const metrics = { calls: 0, errors: 0, timeouts: 0, totalMs: 0, cliRuns: 0, cliErrors: 0 };
function logLine(obj) { try { fs.appendFileSync(LOG_PATH(), JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'); } catch {} }

// ---------- 常驻 serve ----------
let mcp = null;
function ensureMcp() {
  if (mcp) return mcp;
  mcp = new McpClient({ bunPath: loadSettings().bunPath, cli: cliPath(), env: buildEnv, cwd: () => loadSettings().gbrainRepo, log: logLine });
  mcp.start();
  return mcp;
}
async function callOp(op, params, { timeoutMs = 120000 } = {}) {
  metrics.calls++;
  // CLI 通道占用期间 serve 已暂停：排队等它恢复，而不是失败
  if (cliBusy) await cliBusy.catch(() => {});
  const r = await ensureMcp().call(op, params, timeoutMs);
  metrics.totalMs += r.ms; if (!r.ok) { metrics.errors++; if (/超时/.test(r.error)) metrics.timeouts++; }
  logLine({ op, ms: r.ms, ok: r.ok, error: r.error });
  return r;
}

// ---------- CLI 通道（暂停 serve） ----------
let cliBusy = null;
function runGbrain(args, { timeoutMs = 120000, cwd } = {}) {
  const job = (async () => {
    const s = loadSettings();
    if (mcp) { mcp.stop(); await waitForExit(mcp, 5000); }
    metrics.cliRuns++;
    const r = await new Promise(resolve => {
      const t0 = Date.now(); let out = '', err = '', done = false;
      const child = spawn(s.bunPath, ['run', cliPath(), ...args], { env: buildEnv(), cwd: cwd || s.gbrainRepo });
      const timer = setTimeout(() => { if (!done) child.kill('SIGKILL'); }, timeoutMs);
      child.stdout.on('data', d => { out += d; if (out.length > 20e6) child.kill('SIGKILL'); });
      child.stderr.on('data', d => { err += d; if (err.length > 2e6) err = err.slice(-1e6); });
      const finish = (code, spawnErr) => {
        if (done) return; done = true; clearTimeout(timer); const ms = Date.now() - t0;
        if (spawnErr) return resolve({ ok: false, error: `无法启动 bun：${spawnErr}`, stderr: err, ms });
        if (ms >= timeoutMs) return resolve({ ok: false, error: `超时（${timeoutMs / 1000}s）`, stderr: err, ms });
        if (code !== 0) return resolve({ ok: false, error: `gbrain 退出码 ${code}`, stderr: err.trim() || out.trim(), ms });
        resolve({ ok: true, stdout: out, stderr: err, ms });
      };
      child.on('error', e => finish(null, e.message)); child.on('close', code => finish(code, null));
    });
    if (!r.ok) metrics.cliErrors++;
    logLine({ cli: args.slice(0, 2), ms: r.ms, ok: r.ok, error: r.error });
    if (mcp) { mcp.proc = null; mcp.restarts = 0; mcp.start(); }
    return r;
  })();
  cliBusy = job.finally(() => { cliBusy = null; });
  return job;
}
function waitForExit(client, ms) { return new Promise(res => { if (!client.proc) return res(); const t = setTimeout(res, ms); client.once('down', () => { clearTimeout(t); res(); }); }); }

// ---------- IPC ----------
ipcMain.handle('gbrain:call', (_e, op, params, opts) => callOp(op, params, opts || {}));
ipcMain.handle('gbrain:raw', (_e, args, opts) => runGbrain(args, opts));
ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', async (_e, s) => { saveSettings(s); if (mcp) await mcp.restart(); return loadSettings(); });
ipcMain.handle('metrics:get', () => ({ ...metrics, avgMs: metrics.calls ? Math.round(metrics.totalMs / metrics.calls) : 0, logPath: LOG_PATH(), serve: mcp ? { ready: mcp.ready, restarts: mcp.metrics.restarts, requests: mcp.metrics.requests } : null }));
ipcMain.handle('dialog:pickDir', async () => { const r = await dialog.showOpenDialog({ properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('dialog:pickFiles', async () => { const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: '文档', extensions: ['md', 'markdown', 'txt', 'pdf'] }] }); return r.canceled ? [] : r.filePaths; });
ipcMain.handle('fs:readText', (_e, p) => { try { return fs.readFileSync(p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p, 'utf8').slice(0, 5e6); } catch { return null; } });
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
ipcMain.handle('env:check', async () => {
  const s = loadSettings(); const home = s.gbrainHome || path.join(os.homedir(), '.gbrain');
  const script = path.join(SCRIPT_DIR, 'scripts', 'market_sync.py');
  const pythonOk = await new Promise(res => execFile('python3', ['-c', 'import pypdf'], err => res(!err)));
  return { bunOk: fs.existsSync(s.bunPath), repoOk: fs.existsSync(cliPath()), brainOk: fs.existsSync(home), home, serveReady: !!(mcp && mcp.ready), scriptOk: fs.existsSync(script), script, pythonOk };
});
ipcMain.handle('gbrain:init', () => runGbrain(['init', '--pglite'], { timeoutMs: 300000 }));

// PDF → 文本（python3 + pypdf）。扫描件无文字层时明确报错。
const PDF_PY = `
import sys, json
try:
    from pypdf import PdfReader
except ImportError:
    print(json.dumps({"error": "缺少 pypdf，运行: python3 -m pip install pypdf"})); sys.exit(0)
r = PdfReader(sys.argv[1]); pages = []
for i, p in enumerate(r.pages[:int(sys.argv[2])]):
    try: t = p.extract_text() or ''
    except Exception: t = ''
    pages.append(t.strip())
text = "\\n\\n".join(f"<!-- 第 {i+1} 页 -->\\n{t}" for i, t in enumerate(pages) if t)
meta = r.metadata or {}
print(json.dumps({"pages": len(r.pages), "chars": len(text), "title": (meta.get('/Title') or ''), "text": text[:4_000_000]}))
`;
ipcMain.handle('pdf:extract', (_e, p, maxPages = 500) => new Promise(resolve => {
  execFile('python3', ['-c', PDF_PY, p, String(maxPages)], { maxBuffer: 50e6, timeout: 120000 }, (err, stdout, stderr) => {
    if (err) return resolve({ error: `PDF 解析失败：${(stderr || err.message).slice(-500)}` });
    try { const d = JSON.parse(stdout); if (d.error) return resolve(d); if (!d.chars) return resolve({ error: `PDF 没有文字层（可能是扫描件），共 ${d.pages} 页。需要先 OCR。` }); resolve(d); }
    catch { resolve({ error: '解析输出异常' }); }
  });
}));

// ---------- 行情 ----------
const OPT_DIR = () => path.join(os.homedir(), '.gbrain', 'options');
const BRAIN_OPT_DIR = () => path.join(os.homedir(), 'brain-options');
let syncing = null;
ipcMain.handle('market:latest', () => { try { return JSON.parse(fs.readFileSync(path.join(OPT_DIR(), 'latest.json'), 'utf8')); } catch { return null; } });
ipcMain.handle('watchlist:get', () => { try { return JSON.parse(fs.readFileSync(path.join(OPT_DIR(), 'watchlist.json'), 'utf8')); } catch { return null; } });
ipcMain.handle('watchlist:set', (_e, list) => {
  fs.mkdirSync(OPT_DIR(), { recursive: true });
  const clean = [...new Set((list || []).map(s => String(s).trim().toUpperCase()).filter(s => /^[A-Z.]{1,6}$/.test(s)))].slice(0, 40);
  fs.writeFileSync(path.join(OPT_DIR(), 'watchlist.json'), JSON.stringify(clean, null, 2)); return clean;
});
// 行情只进 latest.json，不进大脑（行情是数据，大脑存知识）。
// 打包后 __dirname 在 app.asar 里，python3 读不到虚拟归档 → electron-builder asarUnpack 把 scripts/ 解到 app.asar.unpacked
const SCRIPT_DIR = __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
function runPython(args, { timeoutMs = 600000, onLine } = {}) {
  return new Promise(resolve => {
    let out = '', errTail = '';
    const script = path.join(SCRIPT_DIR, 'scripts', 'market_sync.py');
    if (!fs.existsSync(script)) return resolve({ ok: false, error: `脚本不存在：${script}` });
    const child = spawn('python3', [script, ...args], { env: process.env });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', d => { const s = String(d); out += s; if (onLine) s.split('\n').filter(Boolean).forEach(onLine); if (out.length > 30e6) child.kill('SIGKILL'); });
    child.stderr.on('data', d => { const s = String(d); errTail = (errTail + s).slice(-2000); if (onLine) s.split('\n').filter(Boolean).slice(-3).forEach(l => onLine('! ' + l)); });
    child.on('error', err => { clearTimeout(timer); resolve({ ok: false, error: '无法运行 python3: ' + err.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, code, out, error: code === 0 ? undefined : `脚本退出码 ${code}${errTail ? '：' + errTail.trim().split('\n').pop().slice(0, 200) : ''}` }); });
  });
}
ipcMain.handle('market:sync', async (e) => {
  if (syncing) return { ok: false, error: '已有同步在进行' };
  const send = line => { try { e.sender.send('market:sync:log', line); } catch {} };
  const t0 = Date.now();
  syncing = runPython([], { onLine: send });
  const r = await syncing; syncing = null;
  logLine({ market_sync: r.ok, ms: Date.now() - t0 });
  return r.ok ? { ok: true, ms: Date.now() - t0 } : { ok: false, error: r.error || `同步脚本退出码 ${r.code}` };
});
// 启动自检：脚本路径与 python3 可用性写入日志（打包路径问题在这里第一时间暴露）
app.whenReady().then(() => {
  const script = path.join(SCRIPT_DIR, 'scripts', 'market_sync.py');
  execFile('python3', ['--version'], (err, so, se) => logLine({ selfcheck: { script_exists: fs.existsSync(script), script, python: err ? err.message : String(so || se).trim() } }));
});
// 单标的实时刷新：脚本 --symbol 只拉该标的，~3s
const fetching = new Map(); // 同一标的的并发刷新合并
ipcMain.handle('market:fetch', async (_e, sym) => {
  sym = String(sym || '').toUpperCase(); if (!/^[A-Z.]{1,6}$/.test(sym)) return { ok: false, error: '无效代码' };
  if (fetching.has(sym)) return fetching.get(sym);
  const p = runPython(['--symbol', sym], { timeoutMs: 90000 }).then(r => {
    if (!r.ok) return { ok: false, error: r.error || `刷新失败（${r.code}）` };
    if (!r.out.trim().split('\n').some(l => l.startsWith('{'))) return { ok: false, error: '脚本没有返回数据' };
    const line = r.out.trim().split('\n').filter(l => l.startsWith('{')).pop();
    try { return { ok: true, data: JSON.parse(line) }; } catch { return { ok: false, error: '刷新输出异常' }; }
  }).finally(() => fetching.delete(sym));
  fetching.set(sym, p); return p;
});
// 按类型批量删除（软删除，gbrain restore_page 可恢复）。有界：一次最多 300 页。
ipcMain.handle('brain:purge', async (_e, type) => {
  let deleted = 0, failed = 0;
  for (let i = 0; i < 3; i++) {
    const r = await callOp('list_pages', { type, limit: 100, offset: 0 }, { timeoutMs: 60000 });
    const rows = r.ok ? (Array.isArray(r.data) ? r.data : r.data.pages || []) : [];
    if (!rows.length) break;
    for (const p of rows) { const d = await callOp('delete_page', { slug: p.slug }, { timeoutMs: 60000 }); d.ok ? deleted++ : failed++; }
  }
  return { ok: failed === 0, deleted, failed };
});

// ---------- AI：直连 DeepSeek（OpenAI 兼容） ----------
// 为什么不用 gbrain think：它的合成提示词不受控（英文、格式散）。大脑负责检索（search/get_page/takes），
// 合成由客户端用固定系统提示完成，输出格式才能规范。timeout 150s，失败重试 1 次，输出上限 4k tokens。
// 流式：每个增量通过 'ai:chunk' 事件推给渲染层（带请求 id），用户能看到逐字输出而不是空等。
// 首字节超时 40s，总超时 180s；5xx 重试一次；输出上限 maxTokens。
// DeepSeek V4 默认开"思考模式"：先流式输出 reasoning_content，再输出 content，且思考计入 max_tokens。
// 我们的任务都是结构化短答，默认关闭思考（thinking.disabled）；若服务端不认这个参数（400）就退回默认并把上限 ×3。
// 思考内容不进正文，只推进度（字数）；若最终 content 为空而 reasoning 非空，按 gbrain 的做法把 reasoning 当答案并标记。
ipcMain.handle('ai:chat', async (e, { id, messages, model, maxTokens = 3000, temperature = 0.3, thinking = false }) => {
  const s = loadSettings(); const key = s.env.DEEPSEEK_API_KEY;
  if (!key) return { ok: false, error: '未配置 DEEPSEEK_API_KEY', code: 'no_key' };
  const m = (model || s.chatModel || 'deepseek:deepseek-v4-pro').replace(/^deepseek:/, '');
  const t0 = Date.now(); const push = (payload) => { try { e.sender.send('ai:chunk', { id, ...payload }); } catch {} };
  let sendThinkingParam = true;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController(); let timer = setTimeout(() => ctrl.abort(), 40000);
    const body = { model: m, messages, max_tokens: sendThinkingParam ? maxTokens : maxTokens * 3, temperature, stream: true, stream_options: { include_usage: true } };
    if (sendThinkingParam) body.thinking = { type: thinking ? 'enabled' : 'disabled' };
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
      if (!res.ok) {
        clearTimeout(timer); const j = await res.json().catch(() => ({})); const msg = j.error?.message || `HTTP ${res.status}`;
        if (res.status === 400 && sendThinkingParam && /thinking|unknown|invalid|unrecognized/i.test(msg)) { sendThinkingParam = false; logLine({ ai: m, note: 'thinking param rejected, retry without', msg }); continue; }
        if (res.status >= 500 && attempt < 2) continue;
        logLine({ ai: m, ms: Date.now() - t0, ok: false, error: msg }); return { ok: false, error: msg };
      }
      clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), 240000);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '', text = '', reasoning = '', usage = null, firstAt = null, finish = null;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue; const data = line.slice(5).trim(); if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data); const ch = j.choices?.[0]; const d = ch?.delta?.content; const rc = ch?.delta?.reasoning_content;
            if (rc) { reasoning += rc; push({ reasoning: reasoning.length }); }
            if (d) { if (!firstAt) firstAt = Date.now(); text += d; push({ delta: d, text }); }
            if (ch?.finish_reason) finish = ch.finish_reason; if (j.usage) usage = j.usage;
          } catch {}
        }
      }
      clearTimeout(timer);
      let promoted = false;
      if (!text.trim() && reasoning.trim()) { text = reasoning; promoted = true; }
      logLine({ ai: m, ms: Date.now() - t0, ttfb: firstAt ? firstAt - t0 : null, ok: !!text.trim(), tokens: usage?.total_tokens, reasoning_chars: reasoning.length, finish, promoted, thinking_param: sendThinkingParam });
      if (!text.trim()) return { ok: false, error: `DeepSeek 返回为空（finish=${finish || '?'}，思考 ${reasoning.length} 字）。请重试或换 deepseek-v4-flash。` };
      return { ok: true, text, usage, model: m, ms: Date.now() - t0, promoted, finish };
    } catch (err) { clearTimeout(timer); if (attempt < 2 && err.name !== 'AbortError') continue; logLine({ ai: m, ok: false, error: err.message }); return { ok: false, error: err.name === 'AbortError' ? '超时（DeepSeek 无响应）' : err.message }; }
  }
  return { ok: false, error: '请求失败' };
});

// ---------- 窗口 ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1000, minHeight: 640, title: 'TradeGenuis Options', titleBarStyle: 'hiddenInset', backgroundColor: '#0b0d12',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) logLine({ renderer_console: msg }); });
  if (process.env.GB_SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 4000));
      const view = process.env.GB_SMOKE;
      if (view !== 'cockpit') await win.webContents.executeJavaScript(`showView(${JSON.stringify(view)})`);
      if (process.env.GB_SMOKE_JS) await win.webContents.executeJavaScript(process.env.GB_SMOKE_JS);
      await new Promise(r => setTimeout(r, Number(process.env.GB_SMOKE_WAIT || 3000)));
      win.show(); win.focus(); win.webContents.invalidate();
      await new Promise(r => setTimeout(r, 600));
      const active = await win.webContents.executeJavaScript('document.querySelector(".view.active") && document.querySelector(".view.active").id');
      logLine({ smoke: view, active, focused: win.isFocused(), visible: win.isVisible() });
      fs.writeFileSync(`/tmp/gb-${view}.png`, (await win.webContents.capturePage()).toPNG());
      app.quit();
    });
  }
}
app.whenReady().then(() => { migrateSettings(); ensureMcp(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (mcp) mcp.stop(); });
