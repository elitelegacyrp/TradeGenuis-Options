/* TradeGenuis Options — 渲染层。机会 → 投研 → 交易（含复盘） → 知识库。 */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => (v == null || Number.isNaN(+v)) ? '—' : (+v).toFixed(d);
const fpx = v => v == null ? '—' : (+v >= 1000 ? (+v).toFixed(0) : (+v).toFixed(2));
const pct = (v, d = 1) => v == null ? '—' : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}%`;
const cls = v => v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '';
const today = () => new Date().toISOString().slice(0, 10);
const HOLDER = 'people/me';
const TYPE_LABEL = { framework: '框架', setup: '策略模板', research: '投研报告', trade: '交易', lesson: '教训', 'daily-review': '复盘', skill: '工作流', person: '画像', note: '笔记', article: '资料', concept: '概念' };
const SYSTEM = `你是一位美股与币安加密期权的投研助理，服务一位以 0–14 DTE 短期期权为主的交易者。
规则：
1. 只用中文。先给结论，再给依据。不解释基础概念，不加免责声明，不复述数据表，不用"可能/或许"堆叠不确定。
2. 所有数字必须来自「实时数据」或「大脑页面」；没有的写"无数据"，不要编造。
3. 建议必须对照「交易者画像」里的纪律逐条核对，违反的明确指出。
4. 输出 Markdown，标题用 ##，段落短，一句话一个意思。`;

// ---------- 通用 ----------
let toastTimer;
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), err ? 7000 : 2500); }
const fmtErr = r => (r.error || '未知错误') + (r.stderr ? '\n' + r.stderr.slice(-500) : '');
async function busy(btn, fn) { if (!btn) return fn(); btn.disabled = true; btn.classList.add('spin'); try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('spin'); } }
function md(src) {
  const lines = String(src || '').split('\n'); let out = '', inCode = false, inList = null, inTable = false;
  const closeAll = () => { if (inList) { out += `</${inList}>`; inList = null; } if (inTable) { out += '</tbody></table>'; inTable = false; } };
  const inline = s => esc(s).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, slug, label) => `<a class="wiki" href="#" data-slug="${slug}">${label || slug}</a>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*([^*]+)\*/g, '$1<i>$2</i>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  for (const raw of lines) {
    if (raw.startsWith('```')) { closeAll(); inCode = !inCode; out += inCode ? '<pre>' : '</pre>'; continue; }
    if (inCode) { out += esc(raw) + '\n'; continue; }
    if (/^\|.*\|\s*$/.test(raw)) { if (/^\|[\s\-:|]+\|\s*$/.test(raw)) continue; const cells = raw.trim().slice(1, -1).split('|').map(c => inline(c.trim())); if (!inTable) { if (inList) { out += `</${inList}>`; inList = null; } out += '<table><thead><tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'; inTable = true; continue; } out += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>'; continue; }
    else if (inTable) { out += '</tbody></table>'; inTable = false; }
    const h = raw.match(/^(#{1,3})\s+(.*)/); if (h) { closeAll(); out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    if (/^---+$/.test(raw)) { closeAll(); out += '<hr>'; continue; }
    const li = raw.match(/^\s*([-*]|\d+\.)\s+(.*)/); if (li) { const tag = /\d/.test(li[1]) ? 'ol' : 'ul'; if (inList !== tag) { if (inList) out += `</${inList}>`; out += `<${tag}>`; inList = tag; } out += `<li>${inline(li[2])}</li>`; continue; }
    if (raw.startsWith('>')) { closeAll(); out += `<blockquote>${inline(raw.slice(1))}</blockquote>`; continue; }
    closeAll(); if (raw.trim()) out += `<p>${inline(raw)}</p>`;
  }
  closeAll(); return out;
}
function bindWiki(el) { el.querySelectorAll('a.wiki').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openPage(a.dataset.slug); })); }
function splitFm(text) { const m = String(text || '').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/); if (!m) return { fm: {}, body: text || '' }; const fm = {}; for (const l of m[1].split('\n')) { const k = l.match(/^([\w-]+):\s*(.*)$/); if (k) fm[k[1]] = k[2].replace(/^["']|["']$/g, ''); } return { fm, body: m[2] }; }
// 日期一律加引号：YAML 会把裸 2026-09-18 解析成时间戳；读取时再做一次归一化兜底
const fmVal = v => { const s = String(v).replace(/\n/g, ' '); return /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s) ? `"${s.slice(0, 10)}"` : s; };
const normFm = fm => Object.fromEntries(Object.entries(fm || {}).map(([k, v]) => [k, typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? v.slice(0, 10) : v]));
function joinFm(fm, body) { const keys = Object.entries(fm).filter(([, v]) => v !== '' && v != null); return (keys.length ? '---\n' + keys.map(([k, v]) => `${k}: ${fmVal(v)}`).join('\n') + '\n---\n\n' : '') + body; }
function spark(canvas, vals) {
  if (!vals || vals.length < 2) return; const dpr = window.devicePixelRatio || 1; const w = canvas.clientWidth || 60, h = 18; canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  ctx.beginPath(); vals.forEach((v, i) => { const x = i / (vals.length - 1) * (w - 2) + 1, y = h - 2 - (v - min) / rng * (h - 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = vals[vals.length - 1] >= vals[0] ? '#4ADE80' : '#F87171'; ctx.lineWidth = 1.2; ctx.stroke();
}
async function listAll(params) { const out = []; for (let i = 0; i < 10; i++) { const r = await gb.call('list_pages', { ...params, limit: 100, offset: i * 100 }); if (!r.ok) return { ok: false, error: r.error, rows: out }; const rows = Array.isArray(r.data) ? r.data : (r.data.pages || []); out.push(...rows); if (rows.length < 100) break; } return { ok: true, rows: out }; }
const pageCache = new Map();
async function getPage(slug, fresh = false) { if (!fresh && pageCache.has(slug)) return pageCache.get(slug); const r = await gb.call('get_page', { slug }); const v = r.ok ? r.data : null; if (v) { v.frontmatter = normFm(v.frontmatter); pageCache.set(slug, v); } return v; }
// takes 以 ~/brain-options/<slug>.md 里的 Markdown 表格为准（gbrain 的 markdown-canonical 设计），
// put_page 会用新内容覆盖该文件。所以任何重写都要先把现有 takes 表格取出来带上，否则 bet 行会丢。
const FENCE_RE = /\n*## Takes\s*\n<!--- gbrain:takes:begin -->[\s\S]*?<!--- gbrain:takes:end -->\s*/g;
async function takesFence(slug) { const t = await gb.readText(`~/brain-options/${slug}.md`); const m = t && t.match(/## Takes\s*\n<!--- gbrain:takes:begin -->[\s\S]*?<!--- gbrain:takes:end -->/); return m ? m[0] : ''; }
async function putWithFence(slug, fm, body, opts) { const f = await takesFence(slug); const clean = String(body || '').replace(FENCE_RE, '\n').trimEnd(); const r = await gb.call('put_page', { slug, content: joinFm(fm, clean + (f ? '\n\n' + f + '\n' : '\n')) }, opts); pageCache.delete(slug); return r; }
function modal(title, html) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });

// ---------- 导航 ----------
const TITLES = { opps: '机会', research: '投研', strategy: '交易', knowledge: '知识库', ask: '问答', settings: '设置' };
$$('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
function showView(v) {
  $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  $('#top-title').textContent = TITLES[v] || v;
  ({ opps: renderOpps, research: renderResearch, strategy: () => { renderStrategy(); renderReview(); }, knowledge: renderKnowledge, settings: loadSettings })[v]?.();
}

// ---------- 大脑状态 ----------
let stats = null;
async function refreshStats() {
  const r = await gb.call('get_stats', {}, { timeoutMs: 30000 });
  if (!r.ok) { $('#brain-dot').className = 'dot bad'; $('#brain-stat').textContent = '大脑未连接'; return; }
  stats = r.data; $('#brain-dot').className = 'dot ok'; $('#brain-stat').textContent = `${stats.page_count} 页 · 向量 ${stats.chunk_count ? Math.round(100 * stats.embedded_count / stats.chunk_count) : 0}%`;
}

// ---------- 行情 ----------
let market = null;
async function loadMarket() {
  market = await gb.marketLatest(); const el = $('#fresh');
  if (!market) { el.textContent = '无行情'; el.className = 'fresh stale'; return; }
  const age = (Date.now() - new Date(market.fetched_at).getTime()) / 60000;
  el.textContent = `${market.fetched_at.slice(5, 16).replace('T', ' ')} · ${age < 60 ? Math.round(age) + ' 分钟前' : Math.round(age / 60) + ' 小时前'}`; el.className = 'fresh' + (age > 90 ? ' stale' : '');
  $('#sym-list').innerHTML = market.watchlist.map(s => `<option value="${s}">`).join('');
}
gb.onSyncLog(line => { const l = $('#sync-log'); l.textContent += line + '\n'; l.scrollTop = l.scrollHeight; });
$('#sync-close').addEventListener('click', () => $('#sync-panel').classList.add('hidden'));
async function doSync() {
  $('#sync-panel').classList.remove('hidden'); $('#sync-log').textContent = '';
  await busy($('#btn-sync'), async () => { const r = await gb.marketSync(); if (!r.ok) return toast(r.error, true); toast(`行情已同步 · ${Math.round(r.ms / 1000)} s`); await loadMarket(); renderOpps(); $('#sync-panel').classList.add('hidden'); });
}
$('#btn-sync').addEventListener('click', doSync);
const T = sym => market?.tickers[sym];
function tickerDigest(t) {
  if (!t) return '无数据';
  const head = `${t.symbol}（${t.venue}）现价 ${fpx(t.price)} 日 ${pct(t.change_pct)} 5日 ${pct(t.ret_5d)} 20日 ${pct(t.ret_20d)} 20日高/低 ${fpx(t.hi_20d)}/${fpx(t.lo_20d)}；IV30 ${fmt(t.iv30, 1)} RV20 ${fmt(t.rv20, 1)} IV/RV ${fmt(t.iv_rv)} IV Rank ${t.iv_rank ?? '无数据（历史 ' + t.iv_days + ' 天）'} ATR14 ${fmt(t.atr_pct)}% 近月溢价 ${fmt(t.front_premium)}${t.next_event ? '；下一事件 ' + t.next_event.date + ' ' + (t.next_event.kind === 'fomc' ? 'FOMC' : '财报') : '；30 天内无已知事件'}`;
  const rows = t.expiries.map(e => `到期 ${e.expiry}（${e.dte}d）ATM ${e.atm_strike} IV ${e.atm_iv}% 直跨 ${e.straddle} 预期 ±${e.expected_move_pct}% P/C OI ${e.pc_oi} P/C 量 ${e.pc_vol} 25Δ偏斜 ${e.skew_25d}；最大 OI ${e.top_oi.slice(0, 4).map(o => o.strike + o.cp + ' ' + o.oi).join('，')}`);
  const opps = (t.opportunities || []).map(o => `扫描信号「${o.kind}」${o.title}：${o.rationale} 结构 ${structText(o.structure)} 胜率 ${Math.round(o.structure.pop * 100)}% 盈亏比 ${o.structure.rr} 期望/最大亏损 ${pct(o.structure.edge * 100, 0)} 最大亏损 ${o.structure.max_loss}`);
  return [head, ...rows, ...opps].join('\n');
}
const structText = s => `${s.name}：${s.legs.map(l => `${l.side}${fpx(l.strike)}${l.cp}${l.delta != null ? '(' + Math.abs(l.delta).toFixed(2) + 'Δ)' : ''}`).join(' ')}，${s.is_credit ? '收' : '付'} ${s.price}`;
function marketDigest(limit = 24) {
  if (!market) return '无行情数据';
  const rows = Object.values(market.tickers).slice(0, limit).map(t => { const fe = t.expiries[0] || {}; return `${t.symbol}: ${fpx(t.price)} ${pct(t.change_pct)} IV30 ${fmt(t.iv30, 1)} RV20 ${fmt(t.rv20, 1)} IV/RV ${fmt(t.iv_rv)} 近月${fe.dte ?? '?'}d ±${fmt(fe.expected_move_pct)}% 偏斜 ${fmt(fe.skew_25d, 1)}${t.next_event ? ' 事件 ' + t.next_event.date : ''}`; });
  const evs = (market.earnings || []).filter(e => e.date >= today()).slice(0, 20).map(e => `${e.date} ${e.symbol} ${e.kind === 'fomc' ? 'FOMC' : '财报'}`);
  return `【行情 ${market.fetched_at}】\n${rows.join('\n')}\n【事件】\n${evs.join('；')}`;
}

// ---------- AI 管线：大脑检索 + 实时数据 → DeepSeek ----------
async function brainContext({ symbol, query, includeTemplate = false, limitFrameworks = 3 }) {
  const me = await getPage('people/me');
  const tpl = includeTemplate ? await getPage('frameworks/research-report-template') : null;
  const sr = await gb.call('search', { query, limit: 12 });
  const hits = sr.ok && Array.isArray(sr.data) ? sr.data : [];
  const fwSlugs = [...new Set(hits.filter(h => /^(frameworks|setups)\//.test(h.slug)).map(h => h.slug))].slice(0, limitFrameworks);
  const frameworks = (await Promise.all(fwSlugs.map(s => getPage(s)))).filter(Boolean);
  let history = [];
  if (symbol) { const hr = await gb.call('search', { query: `${symbol} 交易 复盘 教训 投研`, limit: 10 }); history = (hr.ok && Array.isArray(hr.data) ? hr.data : []).filter(h => /^(trades|research|reviews|lessons)\//.test(h.slug) && new RegExp(symbol, 'i').test(h.slug + h.title + h.chunk_text)).slice(0, 5); }
  const tk = await gb.call('takes_list', { holder: HOLDER, kind: 'take', limit: 12 });
  const lessons = tk.ok ? (Array.isArray(tk.data) ? tk.data : tk.data.takes || tk.data.rows || []) : [];
  const parts = [];
  if (me) parts.push(`【交易者画像 people/me】\n${me.compiled_truth.slice(0, 3000)}`);
  if (tpl) parts.push(`【报告规范 frameworks/research-report-template】\n${tpl.compiled_truth.slice(0, 1500)}`);
  for (const f of frameworks) parts.push(`【大脑页面 ${f.slug}】${f.title}\n${f.compiled_truth.slice(0, 2800)}`);
  if (history.length) parts.push(`【历史记录】\n${history.map(h => `- ${h.slug}: ${h.chunk_text.slice(0, 400)}`).join('\n')}`);
  if (lessons.length) parts.push(`【我的教训（takes）】\n${lessons.slice(0, 10).map(l => `- ${l.claim || l.text || JSON.stringify(l).slice(0, 120)}`).join('\n')}`);
  return { text: parts.join('\n\n'), frameworks: fwSlugs, history: history.map(h => h.slug), lessons: lessons.length, hits };
}
// 流式调用：onText(fullText) 在每个增量后触发（节流 80ms）；返回最终结果。
let aiSeq = 0; const aiListeners = new Map();
gb.onAiChunk(p => aiListeners.get(p.id)?.(p));
async function aiStream(messages, { model, maxTokens, onText, thinking = false } = {}) {
  const id = ++aiSeq; let last = 0, pending = null;
  aiListeners.set(id, p => {
    if (!onText) return;
    if (p.reasoning != null && p.text == null) { onText(`> DeepSeek 思考中 · ${p.reasoning} 字`); return; }
    const now = Date.now(); if (now - last > 80) { last = now; onText(p.text); } else { clearTimeout(pending); pending = setTimeout(() => { last = Date.now(); onText(p.text); }, 90); }
  });
  try { const r = await gb.ai({ id, messages, model, maxTokens, thinking }); clearTimeout(pending); if (r.ok && onText) onText(r.promoted ? `> 模型只返回了思考过程，以下为其原文\n\n${r.text}` : r.text); if (r.ok && r.promoted) r.text = `（模型只返回了思考过程）\n\n${r.text}`; return r; } finally { aiListeners.delete(id); }
}
async function ask(system, user, opts = {}) { return aiStream([{ role: 'system', content: system }, { role: 'user', content: user }], opts); }
// 步骤进度：让用户知道任务执行到哪一步、每步花了多久
function steps(el, labels) {
  const t0 = Date.now(); const times = {};
  el.innerHTML = `<div class="steps">${labels.map((l, i) => `<div class="step" data-i="${i}"><i></i><span>${esc(l)}</span><span class="n"></span></div>`).join('')}</div>`;
  const row = i => el.querySelector(`.step[data-i="${i}"]`);
  const api = {
    start(i, note) { const r = row(i); r.className = 'step run'; times[i] = Date.now(); if (note) r.querySelector('.n').textContent = note; return api; },
    done(i, note) { const r = row(i); r.className = 'step ok'; r.querySelector('.n').textContent = `${note ? note + ' · ' : ''}${((Date.now() - (times[i] || t0)) / 1000).toFixed(1)} s`; return api; },
    fail(i, msg) { const r = row(i); r.className = 'step bad'; r.querySelector('.n').textContent = msg || '失败'; return api; },
    total() { return ((Date.now() - t0) / 1000).toFixed(1); },
  };
  return api;
}
function aiErrorHtml(r) {
  if (r.code === 'no_key') return `<div class="nokey"><span><b>未配置 DeepSeek key。</b>扫描、实时结构、交易记录不受影响；投研报告、问答、复盘需要它。</span><span class="spacer"></span><button class="btn sm" onclick="showView('settings')">去设置</button></div>`;
  return `<div class="nokey"><span><b>DeepSeek 调用失败：</b>${esc(r.error)}</span></div>`;
}
const REPORT_EMPTY = `<div class="empty-state"><b>尚未生成投研报告</b><span>点右上「生成投研报告」。流程：实时链 → 交易者画像 → 检索框架 → 历史交易与教训 → DeepSeek 合成 → 存入知识库，约 20–60 秒，全程可见。</span></div>`;

// ---------- 机会 ----------
function ring(score) { const r = 28, c = 2 * Math.PI * r; return `<div class="ring"><svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="${r}"/><circle class="fg" cx="32" cy="32" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - score / 100)}"/></svg><b>${score}</b></div>`; }
function renderOpps() {
  const box = $('#opps-list');
  if (!market) { box.innerHTML = '<div class="card"><div class="dim center">无行情数据。点右上角「同步行情」。</div></div>'; $('#ev-list').innerHTML = ''; $('#iv-list').innerHTML = ''; return; }
  const opps = market.opportunities || [];
  box.innerHTML = opps.length ? opps.map((o, i) => { const s = o.structure, t = T(o.symbol); return `<div class="card opp" style="--i:${i}">
      ${ring(o.score)}
      <div><span class="eyebrow">${esc(o.kind)}</span>${o.market === 'crypto' ? '<span class="eyebrow mkt">币安</span>' : ''}
        <h3><span class="sym" data-sym="${o.symbol}">${esc(o.title)}</span><span class="px">${fpx(t?.price)} <span class="${cls(t?.change_pct)}">${pct(t?.change_pct)}</span></span></h3>
        <p class="why">${esc(o.rationale)}</p>
        <div class="struct"><span>${esc(s.name)}</span><span class="legs">${s.legs.map(l => `${l.side} ${fpx(l.strike)}${l.cp}`).join(' · ')}</span><span>${o.expiry.slice(5)} · ${o.dte}d</span><span>${s.is_credit ? '收' : '付'} ${s.price}</span></div>
        <div class="metrics"><span><span class="k">胜率</span><b>${Math.round(s.pop * 100)}%</b></span><span><span class="k">盈亏比</span><b>${s.rr}</b></span><span><span class="k">期望 / 最大亏损</span><b class="${cls(s.edge)}">${pct(s.edge * 100, 0)}</b></span><span><span class="k">最大亏损</span><b>${o.market === 'crypto' ? s.max_loss + ' U' : '$' + s.max_loss}</b></span><span><span class="k">最大盈利</span><b>${o.market === 'crypto' ? s.max_gain + ' U' : '$' + s.max_gain}</b></span></div>
      </div>
      <div class="act"><button class="btn sm" data-research="${o.symbol}">投研<span class="ic">↗</span></button><span class="dte">${esc(o.setup.replace(/^(setups|frameworks)\//, ''))}</span><span class="prov">${esc(o.provenance || '')}</span></div>
    </div>`; }).join('') : '<div class="card"><div class="dim center">当前观察列表没有期望为正的机会。规则见知识库「机会扫描规则」。</div></div>';
  box.querySelectorAll('[data-research]').forEach(b => b.addEventListener('click', () => goResearch(b.dataset.research)));
  box.querySelectorAll('.sym').forEach(b => b.addEventListener('click', () => goResearch(b.dataset.sym)));
  const wl = new Set(market.watchlist); const evs = (market.earnings || []).filter(e => e.date >= today()).slice(0, 18);
  $('#ev-list').innerHTML = evs.map(e => `<div class="ev ${e.kind === 'fomc' ? 'fomc' : ''}"><span class="d ${e.date === today() ? 'today' : ''}">${e.date.slice(5)}</span><span class="s ${wl.has(e.symbol) ? 'wl' : ''}" data-sym="${esc(e.symbol)}">${esc(e.symbol)}</span><span class="n">${esc(e.name || '')}${e.kind !== 'fomc' && e.time ? ' · ' + e.time.replace('time-', '').replace('-', ' ') : ''}</span></div>`).join('') || '<div class="dim">未来 14 天无事件</div>';
  $('#ev-list').querySelectorAll('.s').forEach(s => { if (s.dataset.sym !== 'FOMC') s.addEventListener('click', () => goResearch(s.dataset.sym)); });
  const rows = Object.values(market.tickers).sort((a, b) => (b.iv_rv ?? -1) - (a.iv_rv ?? -1));
  $('#iv-list').innerHTML = rows.map(t => { const fe = t.expiries[0] || {}; return `<div class="ivr"><span class="s" data-sym="${t.symbol}">${t.symbol}</span><canvas data-sym="${t.symbol}"></canvas><span class="r ${cls(t.change_pct)}">${pct(t.change_pct)}</span><span class="r"><span class="pill ${t.iv_rv > 1.5 ? 'hi' : t.iv_rv < 0.8 ? 'lo' : ''}">${fmt(t.iv_rv)}</span></span><span class="r dim">±${fmt(fe.expected_move_pct, 1)}%</span></div>`; }).join('');
  $$('#iv-list canvas').forEach(c => spark(c, T(c.dataset.sym)?.closes)); $$('#iv-list .s').forEach(s => s.addEventListener('click', () => goResearch(s.dataset.sym)));
}

// ---------- 投研 ----------
let rsSym = null, rsReport = null, rsCtx = null, rsThread = [];
const rsState = {}; // 按标的保存已生成的报告，切页/切标的不丢
function goResearch(sym) { showView('research'); selectResearch(sym); }
function renderResearch() { if (rsSym && !rsState[rsSym]) selectResearch(rsSym); }
function renderReport(sym) {
  const st = rsState[sym]; const out = $('#rs-report'); if (!st) { out.innerHTML = REPORT_EMPTY; $('#rs-adopt').classList.add('hidden'); $('#rs-follow').classList.add('hidden'); return; }
  rsReport = st.text; rsThread = st.thread; rsCtx = st.ctx;
  out.innerHTML = (st.stepsHtml || '') + `<div id="rs-stream" class="md">${md(st.text)}<div class="meta">${esc(st.meta || '')}</div></div>` + (st.followHtml || '');
  bindWiki(out); $('#rs-adopt').classList.remove('hidden'); $('#rs-follow').classList.remove('hidden');
}
$('#rs-sym').addEventListener('change', () => selectResearch($('#rs-sym').value.trim().toUpperCase()));
$('#rs-refresh').addEventListener('click', () => busy($('#rs-refresh'), async () => { const sym = $('#rs-sym').value.trim().toUpperCase(); if (!sym) return; const r = await gb.marketFetch(sym); if (!r.ok) return toast(r.error, true); await loadMarket(); selectResearch(sym); toast(`${sym} 已刷新`); }));
async function selectResearch(sym) {
  if (!sym) return; const same = sym === rsSym; rsSym = sym; $('#rs-sym').value = sym;
  if (!rsState[sym]) { rsReport = null; rsThread = []; $('#rs-adopt').classList.add('hidden'); $('#rs-follow').classList.add('hidden'); }
  let t = T(sym);
  if (!t) { $('#rs-quote').innerHTML = '<span class="dim">不在观察列表，实时拉取中…</span>'; const r = await gb.marketFetch(sym); if (!r.ok) { $('#rs-quote').innerHTML = `<span class="dn">${esc(r.error)}</span>`; return; } await loadMarket(); t = T(sym); }
  $('#rs-quote').innerHTML = `<span class="px">${fpx(t.price)}</span><span class="${cls(t.change_pct)}">${pct(t.change_pct)}</span><span class="nm">${esc(t.name || '')} · ${esc(t.provenance || t.venue)}</span>`;
  const fe = t.expiries[0] || {};
  $('#rs-live').innerHTML = `<div class="tiles">${[[fmt(t.iv30, 1), 'IV30'], [fmt(t.rv20, 1), 'RV20'], [`<span class="${t.iv_rv > 1.5 ? 'dn' : t.iv_rv < 0.8 ? 'up' : ''}">${fmt(t.iv_rv)}</span>`, 'IV / RV'], [t.iv_rank ?? '—', `IV Rank · ${t.iv_days}d`], [fmt(t.atr_pct) + '%', 'ATR14'], [`±${fmt(fe.expected_move_pct)}%`, `近月预期 ${fe.dte ?? ''}d`], [fmt(t.front_premium), '近月溢价'], [t.next_event ? t.next_event.date.slice(5) : '—', t.next_event ? (t.next_event.kind === 'fomc' ? 'FOMC' : '财报') : '30 天无事件']].map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
    <div class="tw" style="margin-top:12px"><table class="tbl"><thead><tr><th class="l">到期</th><th>DTE</th><th>ATM</th><th>ATM IV</th><th>直跨</th><th>预期</th><th>P/C OI</th><th>P/C 量</th><th>25Δ 偏斜</th><th class="l">最大持仓</th></tr></thead><tbody>
      ${t.expiries.map(e => `<tr><td class="l mono">${e.expiry.slice(5)}</td><td>${e.dte}</td><td>${fpx(e.atm_strike)}</td><td>${fmt(e.atm_iv, 1)}%</td><td>${fmt(e.straddle)}</td><td>±${fmt(e.expected_move_pct)}%</td><td>${fmt(e.pc_oi)}</td><td>${fmt(e.pc_vol)}</td><td class="${e.skew_25d >= 8 ? 'dn' : e.skew_25d <= -3 ? 'up' : ''}">${fmt(e.skew_25d, 1)}</td><td class="l mono dim">${e.top_oi.slice(0, 3).map(o => fpx(o.strike) + o.cp).join(' ')}</td></tr>`).join('')}</tbody></table></div>`;
  if (rsState[sym]) renderReport(sym);
  else {
    // 知识库里今天已生成过 → 直接回显
    const saved = await getPage(`research/${today()}-${sym.toLowerCase()}`, true);
    if (saved && saved.compiled_truth) { const text = saved.compiled_truth.replace(/^# .*\n+/, '').replace(/^关联 .*\n+/, '').split('\n## 输入快照')[0].replace(FENCE_RE, '\n').trim(); rsState[sym] = { text, thread: [{ role: 'assistant', content: text }], ctx: null, meta: `来自知识库 research/${today()}-${sym.toLowerCase()} · 今日已生成，点「生成投研报告」可重做`, stepsHtml: '' }; renderReport(sym); }
    else $('#rs-report').innerHTML = REPORT_EMPTY + ((t.opportunities || []).length ? `<div class="dim small">扫描信号将作为输入：${t.opportunities.map(o => `${o.kind} · ${esc(o.structure.name)} 胜率 ${Math.round(o.structure.pop * 100)}% 盈亏比 ${o.structure.rr}`).join('；')}</div>` : '');
  }
  // 大脑上下文（不等 AI）
  $('#rs-brain').innerHTML = '<div class="dim">检索中…</div>';
  const kinds = (t.opportunities || []).map(o => o.kind).join(' ');
  rsCtx = await brainContext({ symbol: sym, query: `${sym} ${kinds} IV/RV ${t.iv_rv} 偏斜 期限结构 事件 ${t.next_event ? t.next_event.kind : ''} 仓位`, includeTemplate: true });
  const grp = (title, items) => items.length ? `<div class="grp"><div class="gt">${title}</div>${items.map(s => `<div class="it" data-slug="${esc(s)}">${esc(s.split('/').pop())}<span class="sl">${esc(s.split('/')[0])}</span></div>`).join('')}</div>` : '';
  $('#rs-brain').innerHTML = grp('相关框架', rsCtx.frameworks) + grp('历史记录', rsCtx.history) + `<div class="grp"><div class="gt">教训</div><div class="dim small">${rsCtx.lessons} 条 take 将纳入报告</div></div>` + (rsCtx.frameworks.length ? '' : '<div class="dim small">知识库里没有相关框架。</div>');
  $('#rs-brain').querySelectorAll('.it').forEach(i => i.addEventListener('click', () => openPage(i.dataset.slug)));
}
$('#rs-run').addEventListener('click', () => busy($('#rs-run'), async () => {
  if (!rsSym) return toast('先选择标的', true);
  const out = $('#rs-report'); out.innerHTML = '<div id="rs-steps"></div><div id="rs-stream" class="md"></div>';
  const st = steps($('#rs-steps'), ['实时期权链', '交易者画像与报告规范', '检索相关框架', '历史交易与教训', 'DeepSeek 合成', '存入知识库']);
  const stream = $('#rs-stream');
  // 1 实时数据（超过 10 分钟就刷新）
  st.start(0); let t = T(rsSym);
  if (!t || (Date.now() - new Date(t.fetched_at || market.fetched_at).getTime()) > 10 * 60000) { const rf = await gb.marketFetch(rsSym); if (rf.ok) { await loadMarket(); t = T(rsSym); } }
  if (!t) { st.fail(0, '无行情'); return; } st.done(0, `${fpx(t.price)} · ${t.expiries.length} 个到期`);
  // 2–4 大脑上下文
  st.start(1); const me = await getPage('people/me'); const tpl = await getPage('frameworks/research-report-template'); st.done(1, me ? 'people/me' : '缺画像');
  st.start(2); const kinds = (t.opportunities || []).map(o => o.kind).join(' ');
  rsCtx = await brainContext({ symbol: rsSym, query: `${rsSym} ${kinds} IV/RV ${t.iv_rv} 偏斜 期限结构 事件 ${t.next_event ? t.next_event.kind : ''} 仓位`, includeTemplate: true });
  st.done(2, rsCtx.frameworks.map(s => s.split('/').pop()).join('，') || '无命中');
  st.start(3).done(3, `${rsCtx.history.length} 条记录 · ${rsCtx.lessons} 条教训`);
  // 5 合成（流式）
  st.start(4, t.market === 'crypto' ? 'Binance 数据' : 'CBOE / Nasdaq 数据');
  const user = `请为 ${rsSym} 写一份投研报告，严格按「报告规范」的五段结构（结论 / 依据 / 策略 / 风险 / 置信度），中文，不超过 400 字。策略段用表格：结构 | 腿 | 到期 | 张数 | 最大亏损 | 目标 | 失效条件。张数按账户 2% 规则算，账户规模未知时写"按 2% 规则"。置信度段格式：「0.xx — <bet 表述>」。\n\n【实时数据】\n${tickerDigest(t)}\n\n${rsCtx.text}`;
  stream.classList.add('stream');
  const r = await ask(SYSTEM, user, { maxTokens: 2200, onText: txt => { stream.innerHTML = md(txt); } });
  stream.classList.remove('stream');
  if (!r.ok) { st.fail(4, r.error); stream.innerHTML = aiErrorHtml(r); return; }
  st.done(4, `${r.model} · ${r.usage?.total_tokens ?? '?'} tokens`);
  const sym = rsSym; rsState[sym] = { text: r.text, thread: [{ role: 'user', content: user }, { role: 'assistant', content: r.text }], ctx: rsCtx, stepsHtml: $('#rs-steps') ? $('#rs-steps').outerHTML : '', meta: `${r.model} · ${r.usage?.total_tokens ?? '?'} tokens · ${st.total()} s · 依据 ${rsCtx.frameworks.join('，') || '无框架'}${rsCtx.history.length ? ' · 历史 ' + rsCtx.history.join('，') : ''}` };
  if (rsSym === sym) renderReport(sym); // 生成期间没切标的才渲染；切了也已存入 rsState，切回即复原
  // 6 保存
  st.start(5);
  const conf = (r.text.match(/置信度[\s\S]*?(0\.\d{2})/) || [])[1]; const conclusion = ((r.text.split(/##\s*结论/)[1] || '').split('##')[0] || '').trim().split('\n').filter(Boolean)[0] || '';
  const slug = `research/${today()}-${rsSym.toLowerCase()}`;
  const fm = { title: `${rsSym} 投研 ${today()}`, type: 'research', symbol: rsSym, date: today(), confidence: conf || '', conclusion: conclusion.slice(0, 120), price: t.price, iv30: t.iv30, iv_rv: t.iv_rv, frameworks: rsCtx.frameworks.join(' ') };
  const body = `# ${rsSym} 投研 ${today()}\n\n关联 ${rsCtx.frameworks.map(s => `[[${s}]]`).join(' ')}\n\n${r.text}\n\n## 输入快照\n\n${tickerDigest(t).split('\n').slice(0, 4).join('\n')}\n`;
  const p = await putWithFence(slug, fm, body); if (p.ok) st.done(5, slug); else st.fail(5, p.error);
  if (rsState[sym] && $('#rs-steps')) rsState[sym].stepsHtml = $('#rs-steps').outerHTML;
  toast(`投研完成 · ${st.total()} s`);
}));
$('#rs-follow').addEventListener('submit', e => { e.preventDefault(); const q = $('#rs-q').value.trim(); if (!q || !rsThread.length) return; busy(e.target.querySelector('button'), async () => {
  const out = $('#rs-report'); out.insertAdjacentHTML('beforeend', `<div class="thread" style="margin-top:12px"><div class="q">${esc(q)}</div><div class="a card md stream"></div></div>`); const a = out.lastElementChild.lastElementChild; $('#rs-q').value = '';
  const r = await aiStream([{ role: 'system', content: SYSTEM }, ...rsThread, { role: 'user', content: q + '\n（简短回答，中文，先结论。）' }], { maxTokens: 1200, onText: txt => { a.innerHTML = md(txt); } });
  a.classList.remove('stream'); if (!r.ok) { a.innerHTML = aiErrorHtml(r); return; }
  rsThread.push({ role: 'user', content: q }, { role: 'assistant', content: r.text }); bindWiki(a);
  if (rsState[rsSym]) { rsState[rsSym].thread = rsThread; rsState[rsSym].followHtml = (rsState[rsSym].followHtml || '') + `<div class="thread" style="margin-top:12px"><div class="q">${esc(q)}</div><div class="a card md">${md(r.text)}</div></div>`; }
}); });
$('#rs-adopt').addEventListener('click', () => {
  const t = T(rsSym); const o = (t?.opportunities || [])[0]; const f = $('#trade-form');
  f.symbol.value = rsSym; f.research.value = `research/${today()}-${rsSym.toLowerCase()}`;
  if (o) { const s = o.structure; f.expiry.value = o.expiry; f.strikes.value = s.legs.map(l => `${l.side}${fpx(l.strike)}${l.cp}`).join(' '); f.entry_price.value = s.price; if ([...f.structure.options].some(x => x.value === s.name)) f.structure.value = s.name; f.direction.value = s.name.includes('Call') && !s.is_credit ? 'long' : s.name.includes('Put') && !s.is_credit ? 'short' : 'neutral'; if (o.setup.startsWith('setups/')) f.setup.value = o.setup; }
  const conf = (rsReport?.match(/置信度[\s\S]*?(0\.\d{2})/) || [])[1]; if (conf) { f.confidence.value = conf; $('#conf-val').textContent = conf; }
  const bet = (rsReport?.match(/0\.\d{2}\s*[—–-]+\s*(.+)/) || [])[1]; if (bet) f.thesis.value = bet.trim().slice(0, 140);
  showView('strategy'); disciplineCheck(); toast('已带入开仓表单，核对后保存');
});

// ---------- 策略 ----------
let tradesCache = null;
async function fetchTrades(force = false) {
  if (tradesCache && !force) return tradesCache;
  const r = await listAll({ type: 'trade' }); const out = [];
  for (const p of (r.rows || []).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 80)) { const g = await getPage(p.slug, force); if (g) out.push({ slug: p.slug, title: g.title, fm: g.frontmatter || {}, body: g.compiled_truth || '', updated_at: p.updated_at }); }
  tradesCache = out; return out;
}
async function renderStrategy() {
  if ($('#setup-select').options.length <= 1) { const r = await listAll({ type: 'setup' }); $('#setup-select').innerHTML = '<option value="">无</option>' + (r.rows || []).map(p => `<option value="${esc(p.slug)}">${esc(p.title || p.slug)}</option>`).join(''); }
  const trades = await fetchTrades(true); const open = trades.filter(t => t.fm.status !== 'closed'), closed = trades.filter(t => t.fm.status === 'closed');
  $('#st-open').innerHTML = open.map(t => { const mk = T(t.fm.symbol); const dte = t.fm.expiry ? Math.round((new Date(t.fm.expiry) - new Date(today())) / 864e5) : null; return `<div class="pos"><div><div class="t"><span class="sym">${esc(t.fm.symbol)}</span> ${esc(t.fm.structure || '')}</div><div class="l">${esc(t.fm.strikes || '')} · 到期 ${esc(t.fm.expiry || '')}${dte != null ? ` (${dte}d)` : ''} · 入场 ${fmt(t.fm.entry_price)} × ${t.fm.qty || 1}${mk ? ` · 标的 ${fpx(t.fm.entry_underlying)} → ${fpx(mk.price)} · IV30 ${fmt(t.fm.entry_iv30, 1)} → ${fmt(mk.iv30, 1)}` : ''}</div></div><div class="acts"><button class="btn sm" data-open="${esc(t.slug)}">页面</button><button class="btn sm" data-close="${esc(t.slug)}">平仓</button></div><div class="th">${esc(t.fm.thesis || '')}${t.fm.invalidation ? ` · 失效：${esc(t.fm.invalidation)}` : ''}</div></div>`; }).join('') || '<div class="dim">无持仓。从投研报告「采纳为策略」或右侧直接记录。</div>';
  $('#st-open').querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openPage(b.dataset.open))); $('#st-open').querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => beginClose(b.dataset.close)));
  $('#st-closed tbody').innerHTML = closed.map(t => { const p = t.fm.pnl != null ? +t.fm.pnl : null; return `<tr class="click" data-slug="${esc(t.slug)}"><td class="l mono">${esc(t.fm.entry_date || '')}</td><td class="l"><b>${esc(t.fm.symbol)}</b></td><td class="l">${esc(t.fm.structure || '')} ${esc(t.fm.strikes || '')}</td><td>${fmt(t.fm.entry_price)}</td><td>${fmt(t.fm.exit_price)}</td><td class="${cls(p)}">${p == null ? '—' : (p > 0 ? '+' : '') + fmt(p, 0)}</td><td>${t.fm.confidence || '—'}</td><td class="l">${({ correct: '成立', incorrect: '不成立', partial: '部分', unresolvable: '无法判断' })[t.fm.result] || '—'}</td></tr>`; }).join('') || '<tr><td colspan="8" class="l dim">暂无</td></tr>';
  $$('#st-closed tr.click').forEach(tr => tr.addEventListener('click', () => openPage(tr.dataset.slug)));
}
const tf = $('#trade-form');
tf.confidence.addEventListener('input', () => $('#conf-val').textContent = (+tf.confidence.value).toFixed(2));
const isHist = () => $('#hist-mode').checked || (tf.entry_date.value && tf.entry_date.value < today());
function disciplineCheck() {
  if (isHist()) { $('#trade-check').innerHTML = '<div class="dim">历史录入：不做纪律核对，不取当前行情。</div>'; return; }
  const sym = tf.symbol.value.toUpperCase(); const exp = tf.expiry.value; const t = T(sym); const dte = exp ? Math.round((new Date(exp) - new Date(today())) / 864e5) : null; const items = [];
  if (dte != null) items.push([dte >= 0, `DTE ${dte}`]);
  if (dte === 0) items.push([['SPY', 'QQQ', 'NVDA', 'TSLA', 'BTC', 'ETH'].includes(sym), '0DTE 仅限 SPY / QQQ / NVDA / TSLA / BTC / ETH']);
  if (market?.fomc_today && dte === 0) items.push([false, '今天 FOMC，不开 0DTE 新仓']);
  if (t) { const single = /单腿/.test(tf.structure.value); const evSoon = t.next_event && (new Date(t.next_event.date) - Date.now()) < 7 * 864e5; items.push([!(t.iv_rv > 1.5 && single && evSoon), `IV/RV ${fmt(t.iv_rv)}${t.iv_rv > 1.5 && single ? '，事件前不裸买' : ''}`]); if (t.next_event && exp) items.push([true, `${t.next_event.kind === 'fomc' ? 'FOMC' : '财报'} ${t.next_event.date} ${new Date(t.next_event.date) <= new Date(exp) ? '在到期前（持有过事件，仓位减半）' : '在到期后'}`]); if (t.market === 'crypto') items.push([![0, 6].includes(new Date().getDay()), '币安：周末不开新仓']); }
  else if (sym) items.push([false, `${sym} 无行情核对`]);
  items.push([!!tf.invalidation.value, '失效条件已写'], [!!tf.stop.value, '止损已写']);
  $('#trade-check').innerHTML = items.map(([ok, s]) => `<div class="${ok ? 'ok' : 'bad'}">${esc(s)}</div>`).join('');
}
['symbol', 'expiry', 'structure', 'invalidation', 'stop', 'entry_date'].forEach(n => tf[n].addEventListener('input', disciplineCheck));
tf.entry_date.value = today();
$('#hist-mode').addEventListener('change', () => { const h = $('#hist-mode').checked; $('#hist-fields').classList.toggle('hidden', !h); tf.querySelector('button[type=submit]').textContent = h ? '录入历史交易' : '记录开仓'; ['exit_date', 'exit_price', 'lesson'].forEach(n => tf[n].required = h); disciplineCheck(); });
// 交易检查：录入前把计划交给 AI，对照纪律 / 框架 / 历史 / 实时链给结论
let lastPlanCheck = null;
function planText(f) { return `标的 ${f.symbol}｜方向 ${({ long: '看多', short: '看空', neutral: '中性/波动率' })[f.direction]}｜结构 ${f.structure}｜到期 ${f.expiry || '未填'}｜腿 ${f.strikes || '未填'}｜权利金/张 ${f.entry_price || '未填'}｜张数 ${f.qty || 1}｜setup ${f.setup || '无'}｜置信度 ${f.confidence}\n论点：${f.thesis || '未填'}\n失效条件：${f.invalidation || '未填'}｜目标：${f.target || '未填'}｜止损：${f.stop || '未填'}`; }
$('#plan-check-btn').addEventListener('click', () => busy($('#plan-check-btn'), async () => {
  const f = Object.fromEntries(new FormData(tf).entries()); f.symbol = f.symbol.toUpperCase().trim(); if (!f.symbol) return toast('先填标的', true);
  const out = $('#plan-check'); out.classList.remove('hidden'); out.innerHTML = '<div class="st"></div><div class="body md"></div>'; const st = steps(out.querySelector('.st'), ['实时期权链', '纪律与相关框架', '历史交易与教训', 'DeepSeek 审核']); const body = out.querySelector('.body');
  st.start(0); if (!T(f.symbol)) { const rf = await gb.marketFetch(f.symbol); if (rf.ok) await loadMarket(); } const t = T(f.symbol); st.done(0, t ? `${fpx(t.price)} · IV/RV ${fmt(t.iv_rv)}` : '无行情');
  st.start(1); const ctx = await brainContext({ symbol: f.symbol, query: `${f.symbol} ${f.structure} ${f.direction} 仓位 风险 失效 ${t?.next_event ? t.next_event.kind : ''} IV/RV ${t?.iv_rv ?? ''}`, limitFrameworks: 3 }); st.done(1, ctx.frameworks.map(s => s.split('/').pop()).join('，') || '无命中');
  st.start(2).done(2, `${ctx.history.length} 条记录 · ${ctx.lessons} 条教训`);
  st.start(3); body.classList.add('stream');
  const r = await ask(SYSTEM, `请审核下面这个交易计划，中文，不超过 12 行，固定四段：\n## 结论\n一行：通过 / 修改后通过 / 不做，加一句原因。\n## 纪律核对\n对照交易者画像里的每条纪律，逐条 ✓ 或 ✗，只列相关的。\n## 风险与修改\n最多三条，每条给具体数字（行权价 / 张数 / 到期 / 止损）。\n## 替代方案\n如果有更好的结构或到期，一行给出；没有写"无"。\n\n【交易计划】\n${planText(f)}\n\n【实时数据】\n${t ? tickerDigest(t) : '无数据'}\n\n${ctx.text}`, { maxTokens: 1000, onText: txt => { body.innerHTML = md(txt); } });
  body.classList.remove('stream'); if (!r.ok) { st.fail(3, r.error); body.innerHTML = aiErrorHtml(r); return; }
  st.done(3, `${r.usage?.total_tokens ?? '?'} tokens`); body.innerHTML = md(r.text); bindWiki(body); lastPlanCheck = { symbol: f.symbol, text: r.text, at: new Date().toISOString().slice(0, 16) };
  const verdict = (r.text.match(/##\s*结论[\s\S]*?\n\s*(通过|修改后通过|不做)/) || [])[1]; if (verdict) toast(`AI 检查：${verdict}`, verdict === '不做');
}));
tf.addEventListener('submit', e => { e.preventDefault(); busy(tf.querySelector('button[type=submit]'), async () => {
  const f = Object.fromEntries(new FormData(tf).entries()); f.symbol = f.symbol.toUpperCase().trim();
  const hist = isHist(); const entryDate = f.entry_date || today(); const t = hist ? null : T(f.symbol);
  if (hist && $('#hist-mode').checked && (!f.exit_date || !f.exit_price)) return toast('历史交易需要出场日期和出场权利金', true);
  const n = (await fetchTrades(true)).filter(x => x.slug.startsWith(`trades/${entryDate}-${f.symbol.toLowerCase()}`)).length + 1; const slug = `trades/${entryDate}-${f.symbol.toLowerCase()}-${n}`;
  const fe = t?.expiries.find(x => x.expiry === f.expiry) || t?.expiries[0];
  const market_ = ['BTC', 'ETH'].includes(f.symbol) ? 'crypto' : (t?.market || 'us');
  const fm = { title: `${f.symbol} ${f.structure} ${f.strikes || ''} ${f.expiry}`.replace(/\s+/g, ' ').trim(), type: 'trade', status: 'open', symbol: f.symbol, direction: f.direction, structure: f.structure, expiry: f.expiry, strikes: f.strikes, entry_price: f.entry_price, qty: f.qty, confidence: f.confidence, setup: f.setup, research: f.research, entry_date: entryDate, thesis: f.thesis, invalidation: f.invalidation, market: market_, entered: hist ? 'history' : 'live' };
  if (t) Object.assign(fm, { entry_iv30: t.iv30, entry_iv_rv: t.iv_rv, entry_underlying: t.price, entry_expected_move_pct: fe?.expected_move_pct });
  let body = `# ${fm.title}\n\n${f.setup ? `Setup [[${f.setup}]]` : ''}${f.research ? ` · 投研 [[${f.research}]]` : ''}\n\n## 论点\n\n${f.thesis}\n\n## 失效条件\n\n${f.invalidation || '（未写）'}\n\n## 目标 / 止损\n\n- 目标：${f.target || '（未写）'}\n- 止损：${f.stop || '（未写）'}\n\n` + (hist ? `## 录入说明\n\n历史交易，${today()} 补录；入场时行情未记录。\n` : `## 入场时市场状态\n\n${t ? tickerDigest(t).split('\n').slice(0, 2).join('\n') : '无行情数据'}\n\n## 纪律核对\n\n${[...$('#trade-check').children].map(c => (c.className === 'ok' ? '- ✓ ' : '- ✗ ') + c.textContent).join('\n')}\n`);
  if (!hist && lastPlanCheck && lastPlanCheck.symbol === f.symbol) { body += `\n## AI 检查（${lastPlanCheck.at}）\n\n${lastPlanCheck.text}\n`; fm.ai_check = (lastPlanCheck.text.match(/##\s*结论[\s\S]*?\n\s*(通过|修改后通过|不做)/) || [])[1] || 'done'; }
  // 历史已完成交易：一次写入 closed 状态
  let pnl = null;
  if (hist && $('#hist-mode').checked) {
    const mult = market_ === 'crypto' ? 1 : 100; const creditStruct = /铁鹰|卖 (Put|Call) 价差|宽跨/.test(f.structure) && f.direction !== 'long';
    pnl = ((+f.exit_price) - (+f.entry_price)) * (+f.qty || 1) * mult * (creditStruct ? -1 : 1);
    Object.assign(fm, { status: 'closed', exit_date: f.exit_date, exit_price: f.exit_price, pnl: pnl.toFixed(2), result: f.quality, lesson: f.lesson });
    body += `\n## 平仓 ${f.exit_date}\n\n- 出场 ${f.exit_price}，盈亏 ${pnl.toFixed(2)}${market_ === 'crypto' ? ' USDT' : ' USD'}\n- 论点：${({ correct: '成立', incorrect: '不成立', partial: '部分成立', unresolvable: '无法判断' })[f.quality]}\n\n## 教训\n\n${f.lesson}\n`;
  }
  const r = await gb.call('put_page', { slug, content: joinFm(fm, body) }); if (!r.ok) return toast(fmtErr(r), true);
  const tk = await gb.call('takes_add', { slug, claim: f.thesis, kind: 'bet', holder: HOLDER, weight: +f.confidence, source: hist ? '历史录入' : '开仓', since: entryDate });
  if (!tk.ok) toast('bet 登记失败：' + tk.error, true);
  if (tk.ok && fm.status === 'closed') {
    const rs = await gb.call('takes_resolve', { slug, row_num: tk.data.row_num, quality: f.quality, evidence: `盈亏 ${pnl.toFixed(2)}；${f.lesson}`, value: pnl, unit: 'usd' });
    if (!rs.ok) toast('bet 结算失败：' + rs.error, true);
    if (f.lesson) await gb.call('takes_add', { slug, claim: f.lesson, kind: 'take', holder: HOLDER, weight: 0.7, source: '历史录入教训', since: f.exit_date });
  }
  pageCache.delete(slug); lastPlanCheck = null; $('#plan-check').classList.add('hidden'); const keepHist = $('#hist-mode').checked; tf.reset(); tf.entry_date.value = today(); $('#hist-mode').checked = keepHist; $('#hist-fields').classList.toggle('hidden', !keepHist); $('#conf-val').textContent = '0.60'; $('#trade-check').innerHTML = ''; $('#trade-msg').textContent = `已记录 ${slug}`; toast(fm.status === 'closed' ? '历史交易已录入，bet 已结算' : '开仓已记录，bet 已登记'); renderStrategy(); renderReview(); refreshStats();
}); });
let closing = null;
function beginClose(slug) {
  closing = tradesCache.find(t => t.slug === slug); if (!closing) return;
  modal(`平仓 ${closing.fm.symbol} ${closing.fm.structure}`, `<form id="close-form" class="form"><div class="frow"><label>出场权利金 / 每张<input name="exit_price" type="number" step="0.01" required autofocus></label><label>论点结果<select name="quality"><option value="correct">成立</option><option value="incorrect">不成立</option><option value="partial">部分成立</option><option value="unresolvable">无法判断</option></select></label></div><label>一句话教训（写给三个月后的自己）<input name="lesson" required></label><div class="frow end"><button type="button" class="btn sm" id="close-cancel">取消</button><button class="btn sm primary">确认平仓并结算 bet</button></div></form><div id="review-wrap" class="hidden"><div class="frow end" style="margin-top:10px"><button id="close-review" class="btn sm">AI 复盘</button></div><div id="review-out" class="md"></div></div>`);
  $('#close-cancel').addEventListener('click', closeModal);
  $('#close-form').addEventListener('submit', e => { e.preventDefault(); busy(e.target.querySelector('.primary'), async () => {
    const f = Object.fromEntries(new FormData(e.target).entries()); const t = closing; const mult = t.fm.market === 'crypto' ? 1 : 100; const creditStruct = /铁鹰|卖 (Put|Call) 价差|宽跨/.test(t.fm.structure) && t.fm.direction !== 'long';
    const pnl = ((+f.exit_price) - (+t.fm.entry_price)) * (+t.fm.qty || 1) * mult * (creditStruct ? -1 : 1); const mk = T(t.fm.symbol);
    const fm = { ...t.fm, status: 'closed', exit_price: f.exit_price, exit_date: today(), pnl: pnl.toFixed(2), result: f.quality, exit_iv30: mk?.iv30, exit_underlying: mk?.price, lesson: f.lesson };
    const body = t.body + `\n\n## 平仓 ${today()}\n\n- 出场 ${f.exit_price}，盈亏 ${pnl.toFixed(2)}${t.fm.market === 'crypto' ? ' USDT' : ' USD'}\n- 论点：${({ correct: '成立', incorrect: '不成立', partial: '部分成立', unresolvable: '无法判断' })[f.quality]}\n- 标的 ${fpx(t.fm.entry_underlying)} → ${fpx(mk?.price)}，IV30 ${fmt(t.fm.entry_iv30, 1)} → ${fmt(mk?.iv30, 1)}\n\n## 教训\n\n${f.lesson}\n`;
    // 顺序：先结算 bet（表格还在镜像文件里）→ 再重写页面（带上表格）→ 最后记教训
    const tl = await gb.call('takes_list', { page_slug: t.slug, kind: 'bet', resolved: false, limit: 5 }); const bet = (tl.ok && Array.isArray(tl.data) ? tl.data : []).find(x => x.active !== false);
    let betMsg = '未找到 bet';
    if (bet) { const rs = await gb.call('takes_resolve', { slug: t.slug, row_num: bet.row_num, quality: f.quality, evidence: `盈亏 ${pnl.toFixed(2)}；${f.lesson}`, value: pnl, unit: 'usd' }); betMsg = rs.ok ? 'bet 已结算' : 'bet 结算失败：' + rs.error; }
    const r = await putWithFence(t.slug, fm, body); if (!r.ok) return toast(fmtErr(r), true);
    await gb.call('takes_add', { slug: t.slug, claim: f.lesson, kind: 'take', holder: HOLDER, weight: 0.7, source: '平仓教训', since: today() });
    closing = { ...t, fm, body }; toast(`已平仓，${betMsg}，教训已入库`); e.target.classList.add('hidden'); $('#review-wrap').classList.remove('hidden'); renderStrategy(); refreshStats();
    $('#close-review').addEventListener('click', () => busy($('#close-review'), async () => {
      const out = $('#review-out'); out.innerHTML = '<div class="st"></div><div class="body md stream"></div>'; const st = steps(out.querySelector('.st'), ['读取复盘规则与交易页', 'DeepSeek 合成']); const body = out.querySelector('.body');
      st.start(0); const skill = await getPage('skills/trade-review'); st.done(0); st.start(1);
      const r2 = await ask(SYSTEM, `按下面的复盘规则，复盘这笔交易。中文，不超过 200 字。\n\n【规则】\n${skill?.compiled_truth || '结论 / 执行合规 / 归因 / 教训'}\n\n【交易页】\n${joinFm(closing.fm, closing.body).slice(0, 4000)}\n\n【当前行情】\n${tickerDigest(T(closing.fm.symbol)).split('\n')[0]}`, { maxTokens: 900, onText: txt => { body.innerHTML = md(txt); } });
      body.classList.remove('stream'); if (!r2.ok) { st.fail(1, r2.error); body.innerHTML = aiErrorHtml(r2); } else { st.done(1); body.innerHTML = md(r2.text); }
      if (r2.ok) await putWithFence(closing.slug, closing.fm, closing.body + `\n\n## AI 复盘\n\n${r2.text}\n`);
    }));
  }); });
}

// ---------- 复盘 ----------
async function renderReview() {
  const sc = await gb.call('takes_scorecard', { holder: HOLDER }); const d = sc.ok ? sc.data : {};
  $('#rv-tiles').innerHTML = [[d.brier == null ? '—' : d.brier.toFixed(3), 'Brier · 越低越好'], [d.accuracy == null ? '—' : Math.round(d.accuracy * 100) + '%', '命中率'], [d.resolved ?? 0, '已结算 bet'], [(d.total_bets ?? 0) - (d.resolved ?? 0), '未结算']].map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const c = await gb.call('takes_calibration', { holder: HOLDER, bucket_size: 0.1 }); const buckets = c.ok && Array.isArray(c.data) ? c.data : [];
  $('#rv-buckets').innerHTML = buckets.length ? buckets.map(b => `<div class="bucket"><span>${(+b.bucket_lo).toFixed(1)}–${(+b.bucket_hi).toFixed(1)}</span><div class="bar"><i style="width:${Math.round(b.observed * 100)}%"></i><b style="left:${Math.round(b.predicted * 100)}%"></b></div><span>${Math.round(b.observed * 100)}% · n=${b.n}</span></div>`).join('') + '<div class="dim small" style="margin-top:6px">蓝条实际命中率，金线声称置信度。蓝短于金 = 过度自信。</div>' : '<div class="dim">还没有已结算的 bet。</div>';
  const closed = (await fetchTrades()).filter(t => t.fm.status === 'closed'); const by = {};
  for (const t of closed) { const k = (t.fm.setup || '无 setup').replace('setups/', ''); (by[k] ||= []).push(+t.fm.pnl || 0); }
  $('#rv-setup tbody').innerHTML = Object.entries(by).map(([k, arr]) => { const w = arr.filter(x => x > 0).length, sum = arr.reduce((a, b) => a + b, 0), avg = sum / arr.length; const v = arr.length >= 5 && avg < 0 ? '<span class="dn">期望为负，暂停</span>' : arr.length < 5 ? '<span class="dim">样本不足</span>' : '<span class="up">继续</span>'; return `<tr><td class="l">${esc(k)}</td><td>${arr.length}</td><td>${Math.round(100 * w / arr.length)}%</td><td class="${cls(sum)}">${fmt(sum, 0)}</td><td class="${cls(avg)}">${fmt(avg, 0)}</td><td class="l">${v}</td></tr>`; }).join('') || '<tr><td colspan="6" class="l dim">暂无已平仓交易</td></tr>';
  const tk = await gb.call('takes_list', { holder: HOLDER, kind: 'take', limit: 30 }); const rows = tk.ok ? (Array.isArray(tk.data) ? tk.data : tk.data.takes || tk.data.rows || []) : [];
  $('#rv-lessons').innerHTML = rows.map(l => `<div class="ls"><span class="d">${esc((l.since_date || l.created_at || '').slice(0, 10))}</span><span>${esc(l.claim || l.text || '')}</span><span class="sl" data-slug="${esc(l.page_slug || l.slug || '')}">${esc((l.page_slug || l.slug || '').split('/').pop())}</span></div>`).join('') || '<div class="dim">平仓时写的教训会出现在这里。</div>';
  $('#rv-lessons').querySelectorAll('.sl').forEach(s => s.addEventListener('click', () => s.dataset.slug && openPage(s.dataset.slug)));
}
$('#rv-weekly').addEventListener('click', () => busy($('#rv-weekly'), async () => {
  const out = $('#rv-weekly-out'); out.innerHTML = '<div class="st"></div><div class="body md"></div>'; const st = steps(out.querySelector('.st'), ['读取校准与交易记录', 'DeepSeek 合成']); const body = out.querySelector('.body');
  st.start(0); const sc = await gb.call('takes_scorecard', { holder: HOLDER }); const closed = (await fetchTrades()).filter(t => t.fm.status === 'closed').slice(0, 30); const skill = await getPage('skills/weekly-calibration'); const me = await getPage('people/me'); st.done(0, `${closed.length} 笔已平仓`);
  st.start(1); body.classList.add('stream');
  const r = await ask(SYSTEM, `按下面的规则写周度校准报告，中文，不超过 300 字，没有数据的段写"无数据"。\n\n【规则】\n${skill?.compiled_truth || ''}\n\n【交易者画像】\n${(me?.compiled_truth || '').slice(0, 1500)}\n\n【scorecard】${JSON.stringify(sc.data)}\n\n【已平仓交易】\n${closed.map(t => `${t.fm.entry_date}→${t.fm.exit_date} ${t.fm.symbol} ${t.fm.structure} setup=${t.fm.setup || '-'} 置信 ${t.fm.confidence} 结果 ${t.fm.result} 盈亏 ${t.fm.pnl} 教训 ${t.fm.lesson || ''}`).join('\n') || '无'}`, { maxTokens: 1200, onText: txt => { body.innerHTML = md(txt); } });
  body.classList.remove('stream'); if (!r.ok) { st.fail(1, r.error); body.innerHTML = aiErrorHtml(r); return; } st.done(1); body.innerHTML = md(r.text);
  if (r.ok) await gb.call('put_page', { slug: `reviews/${today()}-weekly`, content: joinFm({ title: `周度校准 ${today()}`, type: 'daily-review', date: today() }, r.text) });
}));

// ---------- 知识库 ----------
let kbType = 'framework', kbPages = [], kbSlug = null, kbFm = {};
async function renderKnowledge() {
  await refreshStats(); const types = Object.entries(stats?.pages_by_type || {}).sort((a, b) => (TYPE_LABEL[a[0]] ? 0 : 1) - (TYPE_LABEL[b[0]] ? 0 : 1) || b[1] - a[1]);
  if (!types.some(([t]) => t === kbType)) kbType = types[0]?.[0] || 'note';
  $('#kb-groups').innerHTML = types.map(([t, n]) => `<button class="${t === kbType ? 'active' : ''}" data-type="${esc(t)}">${esc(TYPE_LABEL[t] || t)}<span>${n}</span></button>`).join('');
  $$('#kb-groups button').forEach(b => b.addEventListener('click', () => { kbType = b.dataset.type; renderKnowledge(); }));
  $('#kb-type').innerHTML = [...new Set([...types.map(([t]) => t), 'framework', 'setup', 'lesson', 'note', 'research'])].map(t => `<option value="${esc(t)}">${esc(TYPE_LABEL[t] || t)}</option>`).join('');
  const r = await listAll({ type: kbType }); kbPages = (r.rows || []).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')); renderKbList();
}
function renderKbList() {
  const f = $('#kb-filter').value.trim().toLowerCase(); const rows = kbPages.filter(p => !f || (p.slug + ' ' + (p.title || '')).toLowerCase().includes(f));
  $('#kb-list').innerHTML = rows.map(p => `<li data-slug="${esc(p.slug)}" class="${p.slug === kbSlug ? 'sel' : ''}"><div class="t">${esc(p.title || p.slug)}</div><div class="s"><span>${esc(p.slug)}</span><span>${(p.updated_at || '').slice(0, 10)}</span></div></li>`).join('') || '<li class="dim">空</li>';
  $$('#kb-list li[data-slug]').forEach(li => li.addEventListener('click', () => openPage(li.dataset.slug)));
}
$('#kb-filter').addEventListener('input', renderKbList);
$('#kb-purge').addEventListener('click', async () => { if (!kbPages.length || !confirm(`删除「${TYPE_LABEL[kbType] || kbType}」下全部 ${kbPages.length} 页？（软删除）`)) return; const r = await gb.purge(kbType); toast(`已删除 ${r.deleted} 页${r.failed ? '，失败 ' + r.failed : ''}`); kbSlug = null; $('#kb-page').classList.add('hidden'); $('#kb-empty').classList.remove('hidden'); renderKnowledge(); });
$('#kb-new').addEventListener('click', () => { showView('knowledge'); kbSlug = null; kbFm = {}; $('#kb-empty').classList.add('hidden'); $('#kb-page').classList.remove('hidden'); $('#kb-slug').value = ''; $('#kb-title').value = ''; $('#kb-type').value = kbType; $('#kb-body').value = ''; $('#kb-meta').textContent = '新页面'; setKbEdit(true); $('#kb-slug').focus(); });
async function openPage(slug) {
  showView('knowledge'); const d = await getPage(slug, true); if (!d) return toast(`打不开 ${slug}`, true);
  kbSlug = d.slug; kbFm = { ...(d.frontmatter || {}) }; if (d.type !== kbType) { kbType = d.type; renderKnowledge(); } else renderKbList();
  $('#kb-empty').classList.add('hidden'); $('#kb-page').classList.remove('hidden'); $('#kb-slug').value = d.slug; $('#kb-title').value = d.title || '';
  if (![...$('#kb-type').options].some(o => o.value === d.type)) { const o = document.createElement('option'); o.value = o.textContent = d.type; $('#kb-type').appendChild(o); } $('#kb-type').value = d.type;
  $('#kb-body').value = (d.compiled_truth || '') + (d.timeline ? '\n\n## Timeline\n' + d.timeline : '');
  const fmStr = Object.entries(kbFm).filter(([k]) => !/^(frameworks)$/.test(k)).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' · ');
  $('#kb-meta').textContent = `更新 ${(d.updated_at || '').replace('T', ' ').slice(0, 16)}${fmStr ? ' · ' + fmStr : ''}`; setKbEdit(false);
}
function setKbEdit(edit) { $('#kb-body').classList.toggle('hidden', !edit); $('#kb-render').classList.toggle('hidden', edit); if (!edit) { $('#kb-render').innerHTML = md($('#kb-body').value); bindWiki($('#kb-render')); } }
$('#kb-view').addEventListener('click', () => setKbEdit(false)); $('#kb-edit').addEventListener('click', () => setKbEdit(true));
$('#kb-save').addEventListener('click', () => busy($('#kb-save'), async () => { const slug = $('#kb-slug').value.trim(); if (!slug) return toast('slug 不能为空', true); const fm = { ...kbFm, title: $('#kb-title').value.trim() || slug.split('/').pop(), type: $('#kb-type').value }; const r = await putWithFence(slug, fm, $('#kb-body').value); if (!r.ok) return toast(fmtErr(r), true); tradesCache = null; kbSlug = slug; toast(`已保存 ${slug}`); renderKnowledge(); setKbEdit(false); }));
$('#kb-del').addEventListener('click', async () => { if (!kbSlug || !confirm(`删除 ${kbSlug}？`)) return; const r = await gb.call('delete_page', { slug: kbSlug }); if (!r.ok) return toast(fmtErr(r), true); pageCache.delete(kbSlug); tradesCache = null; toast('已删除'); kbSlug = null; $('#kb-page').classList.add('hidden'); $('#kb-empty').classList.remove('hidden'); renderKnowledge(); });
const kblog = s => { const el = $('#kb-log'); el.classList.remove('hidden'); el.textContent += s + '\n'; el.scrollTop = el.scrollHeight; };
$('#kb-import').addEventListener('click', () => busy($('#kb-import'), async () => {
  const files = await gb.pickFiles(); if (!files.length) return; showView('knowledge');
  for (const f of files) {
    const name = f.split('/').pop(); const isPdf = /\.pdf$/i.test(name); let text, extra = {};
    if (isPdf) { kblog(`解析 PDF ${name}`); const d = await gb.pdfExtract(f); if (d.error) { kblog(`✗ ${d.error}`); continue; } kblog(`  ${d.pages} 页，${d.chars} 字`); text = d.text; extra = { source_file: name, pages: d.pages }; } else { text = await gb.readText(f); if (text == null) { kblog(`读取失败 ${f}`); continue; } }
    const base = name.replace(/\.(md|markdown|txt|pdf)$/i, ''); const { fm, body } = splitFm(text); const slug = (fm.slug || ((isPdf ? 'sources/' : 'notes/') + base)).replace(/[\s:：]+/g, '-');
    const r = await gb.call('put_page', { slug, content: joinFm({ title: base, type: isPdf ? 'article' : 'note', ...extra, ...fm }, body) }, { timeoutMs: 600000 }); kblog(r.ok ? `✓ ${slug}（${r.data.chunks} 块）` : `✗ ${slug}: ${r.error}`);
  }
  renderKnowledge();
}));
$('#kb-import-dir').addEventListener('click', () => busy($('#kb-import-dir'), async () => { const dir = await gb.pickDir(); if (!dir) return; kblog(`$ gbrain import ${dir}（期间 serve 暂停）`); const r = await gb.raw(['import', dir], { timeoutMs: 1800000 }); kblog(((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-4).join('\n')); kblog(r.ok ? '完成' : `失败：${r.error}`); renderKnowledge(); }));

// ---------- 问答 ----------
const askHist = [];
$('#ask-form').addEventListener('submit', e => { e.preventDefault(); const q = $('#ask-q').value.trim(); if (!q) return; busy(e.target.querySelector('button'), async () => {
  const th = $('#ask-thread'); th.insertAdjacentHTML('beforeend', `<div class="q">${esc(q)}</div><div class="a card"><div class="st"></div><div class="body md"></div></div>`); const a = th.lastElementChild; a.scrollIntoView({ behavior: 'smooth' }); $('#ask-q').value = '';
  const st = steps(a.querySelector('.st'), ['识别标的与实时数据', '检索大脑', 'DeepSeek 合成']); const body = a.querySelector('.body');
  st.start(0); const sym = (q.match(/\b[A-Z]{2,5}\b/) || [])[0];
  if (sym && !T(sym)) { const rf = await gb.marketFetch(sym); if (rf.ok) await loadMarket(); }
  const live = sym && T(sym) ? `【实时数据 ${sym}】\n${tickerDigest(T(sym))}` : `【行情摘要】\n${marketDigest(16)}`; st.done(0, sym && T(sym) ? sym : '行情摘要');
  st.start(1); const ctx = await brainContext({ symbol: sym, query: q, limitFrameworks: 3 }); st.done(1, [...ctx.frameworks, ...ctx.history].map(s => s.split('/').pop()).slice(0, 4).join('，') || '无命中');
  st.start(2); body.classList.add('stream');
  const r = await aiStream([{ role: 'system', content: SYSTEM + '\n5. 回答不超过 8 行，先结论后依据；如果问题涉及具体交易，给结构、到期、失效条件。' }, ...askHist.slice(-6), { role: 'user', content: `${q}\n\n${live}\n\n${ctx.text}` }], { maxTokens: 1200, onText: txt => { body.innerHTML = md(txt); } });
  body.classList.remove('stream');
  if (!r.ok) { st.fail(2, r.error); body.innerHTML = aiErrorHtml(r); return; }
  st.done(2, `${r.usage?.total_tokens ?? '?'} tokens`);
  askHist.push({ role: 'user', content: q }, { role: 'assistant', content: r.text });
  body.innerHTML = md(r.text) + `<div class="meta">依据 ${[...ctx.frameworks, ...ctx.history].map(s => `<a class="wiki" href="#" data-slug="${esc(s)}">${esc(s)}</a>`).join('，') || '仅实时数据'}</div>`; bindWiki(body);
}); });

// ---------- 设置 ----------
async function loadSettings() {
  const s = await gb.getSettings(); $('#set-repo').value = s.gbrainRepo; $('#set-bun').value = s.bunPath; $('#set-home').value = s.gbrainHome || '';
  $('#set-voyage').value = s.env.VOYAGE_API_KEY || ''; $('#set-anthropic').value = s.env.ANTHROPIC_API_KEY || ''; $('#set-openai').value = s.env.OPENAI_API_KEY || ''; $('#set-deepseek').value = s.env.DEEPSEEK_API_KEY || ''; $('#set-model').value = s.chatModel || '';
  const c = await gb.envCheck(); $('#env-status').innerHTML = [[c.bunOk, 'bun'], [c.repoOk, 'gbrain 仓库'], [c.brainOk, `大脑 ${c.home}`], [c.serveReady, '常驻 serve'], [c.scriptOk, `行情脚本 ${c.script}`], [c.pythonOk, 'python3 + pypdf'], [!!s.env.DEEPSEEK_API_KEY, 'DeepSeek key（投研 / 问答 / 复盘需要）']].map(([ok, t]) => `<div><span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</span> ${esc(t)}</div>`).join('');
  const m = await gb.metrics(); $('#metrics').textContent = `本次会话：op ${m.calls} · 失败 ${m.errors} · 平均 ${m.avgMs} ms · CLI ${m.cliRuns} · serve 重启 ${m.serve?.restarts ?? 0}`;
  $('#wl-text').value = ((await gb.watchlistGet()) || []).join(' ');
}
$('#set-save').addEventListener('click', () => busy($('#set-save'), async () => {
  const s = await gb.getSettings(); s.gbrainRepo = $('#set-repo').value.trim(); s.bunPath = $('#set-bun').value.trim(); s.gbrainHome = $('#set-home').value.trim();
  s.env = { VOYAGE_API_KEY: $('#set-voyage').value.trim(), ANTHROPIC_API_KEY: $('#set-anthropic').value.trim(), OPENAI_API_KEY: $('#set-openai').value.trim(), DEEPSEEK_API_KEY: $('#set-deepseek').value.trim() };
  s.chatModel = $('#set-model').value.trim() || (s.env.DEEPSEEK_API_KEY ? 'deepseek:deepseek-v4-pro' : ''); await gb.setSettings(s);
  if (s.chatModel) { const exp = s.chatModel.startsWith('deepseek:') ? 'deepseek:deepseek-v4-flash' : s.chatModel; const outs = []; for (const [k, v] of [['models.default', s.chatModel], ['chat_model', s.chatModel], ['expansion_model', exp]]) { const r = await gb.raw(['config', 'set', k, v], { timeoutMs: 60000 }); outs.push(`${k} = ${v} → ${r.ok ? 'ok' : r.error}`); } $('#set-out').textContent = outs.join('\n'); }
  toast('设置已保存'); loadSettings(); refreshStats();
}));
$('#set-init').addEventListener('click', () => busy($('#set-init'), async () => { const r = await gb.init(); $('#set-out').textContent = ((r.stdout || '') + (r.stderr || '')).slice(-3000) || (r.ok ? '完成' : r.error); loadSettings(); refreshStats(); }));
$('#set-log').addEventListener('click', async () => gb.openPath((await gb.metrics()).logPath));
$('#wl-save').addEventListener('click', async () => { const l = await gb.watchlistSet($('#wl-text').value.split(/[\s,，]+/)); $('#wl-text').value = l.join(' '); toast(`观察列表 ${l.length} 个，开始同步`); doSync(); });

// ---------- 启动 ----------
(async () => { await loadMarket(); refreshStats(); renderOpps(); if (!market || (Date.now() - new Date(market.fetched_at).getTime()) > 90 * 60000) doSync(); })();
