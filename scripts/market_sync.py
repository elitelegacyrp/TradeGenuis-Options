#!/usr/bin/env python3
"""
期权行情 + 机会扫描。只输出 JSON，不写大脑（行情是数据不是知识）。

用法：
  market_sync.py                 全观察列表同步 → ~/.gbrain/options/latest.json
  market_sync.py --symbol NVDA   单标的实时刷新，更新 latest.json 里该标的并打印它的 JSON

数据源（免费、无 key）：
  CBOE 延迟期权链（IV/希腊字母/OI）、Nasdaq 报价/历史/财报日历、Binance 现货 + eapi 期权。
FOMC 日期来自 federalreserve.gov，每年核对一次。

工程约束：每个请求 timeout 20s 重试 3 次；单标的失败不影响其他；输出带 fetched_at 与 errors[]；
IV 历史按天累计到 history.json（用于 IV Rank）；阈值与 frameworks/opportunity-scoring 同源。
"""
import json, os, sys, time, math, datetime, urllib.request, statistics, re

HOME = os.path.expanduser('~')
OPT_DIR = os.path.join(HOME, '.gbrain', 'options')
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh) GBrainOptions/0.2', 'Accept': 'application/json, text/plain, */*'}
DEFAULT_WATCHLIST = ['BTC', 'ETH', 'SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'AMZN', 'MSFT', 'GOOGL',
                     'COIN', 'PLTR', 'MSTR', 'NFLX', 'AVGO', 'HOOD', 'MU']
CRYPTO = ['BTC', 'ETH']
ZERO_DTE_OK = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'BTC', 'ETH']
ETFS = ('SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'TLT', 'XLF', 'XLE', 'SMH', 'ARKK', 'SLV', 'USO', 'HYG', 'EEM')
FOMC_DATES = ['2026-09-16', '2026-10-28', '2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09',
              '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08']
TODAY = datetime.date.today()


def log(msg):
    print(f'[sync] {msg}', flush=True)


def get_json(url, tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:  # noqa
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'{url.split("?")[0]} -> {last}')


def num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).replace('$', '').replace(',', '').replace('%', '').strip()
    try:
        return float(s)
    except ValueError:
        return None


def is_crypto_sym(sym):
    return sym in CRYPTO


def trading_days_until(d):
    """粗略交易日数（不含节假日）。"""
    target = datetime.date.fromisoformat(d)
    n, cur = 0, TODAY
    while cur < target:
        cur += datetime.timedelta(days=1)
        if cur.weekday() < 5:
            n += 1
    return n


# ---------- 观察列表 / 历史 ----------
def load_json(name, default):
    try:
        return json.load(open(os.path.join(OPT_DIR, name)))
    except Exception:
        return default


def save_json(name, obj):
    os.makedirs(OPT_DIR, exist_ok=True)
    tmp = os.path.join(OPT_DIR, name + '.tmp')
    json.dump(obj, open(tmp, 'w'), ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(OPT_DIR, name))


def load_watchlist():
    wl = load_json('watchlist.json', None)
    if isinstance(wl, list) and wl:
        return [s.upper() for s in wl]
    save_json('watchlist.json', DEFAULT_WATCHLIST)
    return DEFAULT_WATCHLIST


# ---------- Nasdaq ----------
def nasdaq_quote(sym):
    ac = 'etf' if sym in ETFS else 'stocks'
    d = get_json(f'https://api.nasdaq.com/api/quote/{sym}/info?assetclass={ac}')['data']
    pd_ = d.get('primaryData') or {}
    return {'price': num(pd_.get('lastSalePrice')), 'change_pct': num(pd_.get('percentageChange')), 'name': d.get('companyName'), 'asset_class': ac}


def nasdaq_history(sym, ac, days=45):
    frm = (TODAY - datetime.timedelta(days=days * 2)).isoformat()
    d = get_json(f'https://api.nasdaq.com/api/quote/{sym}/historical?assetclass={ac}&fromdate={frm}&todate={TODAY.isoformat()}&limit={days * 2}')['data']
    rows = (d or {}).get('tradesTable', {}).get('rows', []) or []
    out = [{'date': r['date'], 'close': num(r.get('close')), 'high': num(r.get('high')), 'low': num(r.get('low'))} for r in rows if num(r.get('close'))]
    out.reverse()
    return out[-days:]


def earnings_window(days=14):
    out = []
    for i in range(days):
        day = TODAY + datetime.timedelta(days=i)
        if day.weekday() >= 5:
            continue
        try:
            d = get_json(f'https://api.nasdaq.com/api/calendar/earnings?date={day.isoformat()}')
            rows = ((d.get('data') or {}).get('rows')) or []
        except Exception as e:
            log(f'earnings {day} failed: {e}')
            continue
        for r in rows:
            out.append({'date': day.isoformat(), 'symbol': r.get('symbol'), 'name': r.get('name'), 'time': r.get('time'),
                        'eps_forecast': r.get('epsForecast'), 'market_cap': num(r.get('marketCap')), 'kind': 'earnings'})
        time.sleep(0.25)
    return out


# ---------- Binance ----------
def binance_spot(asset):
    t = get_json(f'https://api.binance.com/api/v3/ticker/24hr?symbol={asset}USDT')
    return {'price': num(t['lastPrice']), 'change_pct': num(t['priceChangePercent']), 'name': f'{asset}/USDT', 'asset_class': 'crypto'}


def binance_history(asset, days=45):
    ks = get_json(f'https://api.binance.com/api/v3/klines?symbol={asset}USDT&interval=1d&limit={days}')
    return [{'date': datetime.datetime.utcfromtimestamp(k[0] / 1000).date().isoformat(), 'close': num(k[4]), 'high': num(k[2]), 'low': num(k[3])} for k in ks]


_BIN = {}


def binance_tables():
    if not _BIN:
        _BIN['mark'] = {m['symbol']: m for m in get_json('https://eapi.binance.com/eapi/v1/mark')}
        _BIN['tick'] = {t['symbol']: t for t in get_json('https://eapi.binance.com/eapi/v1/ticker')}
    return _BIN['mark'], _BIN['tick']


def binance_chain(asset):
    mark, tick = binance_tables()
    by_exp = {}
    for sym, m in mark.items():
        parts = sym.split('-')
        if len(parts) != 4 or parts[0] != asset:
            continue
        ymd, strike, cp = parts[1], num(parts[2]), parts[3]
        exp = f'20{ymd[:2]}-{ymd[2:4]}-{ymd[4:]}'
        t = tick.get(sym, {})
        iv = num(m.get('markIV'))
        by_exp.setdefault(exp, []).append({'expiry': exp, 'cp': cp, 'strike': strike, 'iv': iv if iv and iv > 0 else None,
                                           'delta': num(m.get('delta')), 'theta': num(m.get('theta')), 'bid': num(t.get('bidPrice')), 'ask': num(t.get('askPrice')),
                                           'mid': num(m.get('markPrice')), 'volume': num(t.get('volume')), 'open_interest': None})
    for exp in sorted(by_exp)[:6]:
        try:
            ymd = exp[2:4] + exp[5:7] + exp[8:10]
            oi = {o['symbol']: num(o.get('sumOpenInterest')) for o in get_json(f'https://eapi.binance.com/eapi/v1/openInterest?underlyingAsset={asset}&expiration={ymd}')}
            for r in by_exp[exp]:
                r['open_interest'] = oi.get(f'{asset}-{ymd}-{int(r["strike"])}-{r["cp"]}')
        except Exception as e:
            log(f'{asset} OI {exp}: {e}')
    return {'by_exp': by_exp, 'price': None, 'iv30': None}


# ---------- CBOE ----------
OPT_RE = re.compile(r'^([A-Z]+)(\d{6})([CP])(\d{8})$')


def cboe_chain(sym):
    d = get_json(f'https://cdn.cboe.com/api/global/delayed_quotes/options/{sym}.json')['data']
    by_exp = {}
    for o in d.get('options', []):
        m = OPT_RE.match(o['option'])
        if not m:
            continue
        _, ymd, cp, strike = m.groups()
        exp = f'20{ymd[:2]}-{ymd[2:4]}-{ymd[4:]}'
        bid, ask = o.get('bid'), o.get('ask')
        by_exp.setdefault(exp, []).append({'expiry': exp, 'cp': cp, 'strike': int(strike) / 1000, 'iv': o.get('iv'), 'delta': o.get('delta'), 'theta': o.get('theta'),
                                           'bid': bid, 'ask': ask, 'mid': (bid + ask) / 2 if bid is not None and ask is not None else None,
                                           'volume': o.get('volume'), 'open_interest': o.get('open_interest')})
    return {'by_exp': by_exp, 'price': d.get('current_price'), 'iv30': d.get('iv30')}


# ---------- 统计 ----------
def realized_vol(closes, window=20):
    if len(closes) < window + 1:
        return None
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(len(closes) - window, len(closes))]
    return statistics.pstdev(rets) * math.sqrt(252) * 100


def atr_pct(hist, window=14):
    if len(hist) < window + 1:
        return None
    trs = [max(h['high'] - h['low'], abs(h['high'] - hist[i - 1]['close']), abs(h['low'] - hist[i - 1]['close']))
           for i, h in enumerate(hist) if i >= len(hist) - window and h['high'] and h['low']]
    return statistics.mean(trs) / hist[-1]['close'] * 100 if trs else None


def nearest(rows, key, target):
    rows = [r for r in rows if r.get(key) is not None and r.get('mid') is not None]
    return min(rows, key=lambda r: abs(r[key] - target)) if rows else None


def summarize_expiry(price, rows, expiry):
    dte = (datetime.date.fromisoformat(expiry) - TODAY).days
    calls = [r for r in rows if r['cp'] == 'C' and r['mid'] is not None]
    puts = [r for r in rows if r['cp'] == 'P' and r['mid'] is not None]
    if not calls or not puts:
        return None
    atm_c = min(calls, key=lambda r: abs(r['strike'] - price))
    atm_p = min(puts, key=lambda r: abs(r['strike'] - price))
    straddle = atm_c['mid'] + atm_p['mid']
    call_oi = sum(r['open_interest'] or 0 for r in calls)
    put_oi = sum(r['open_interest'] or 0 for r in puts)
    call_vol = sum(r['volume'] or 0 for r in calls)
    put_vol = sum(r['volume'] or 0 for r in puts)
    p25 = nearest([r for r in puts if r['iv']], 'delta', -0.25)
    c25 = nearest([r for r in calls if r['iv']], 'delta', 0.25)
    skew = (p25['iv'] - c25['iv']) * 100 if p25 and c25 and p25['iv'] and c25['iv'] else None
    top_oi = sorted(rows, key=lambda r: -(r['open_interest'] or 0))[:6]
    return {'expiry': expiry, 'dte': dte, 'atm_strike': atm_c['strike'], 'atm_iv': round(((atm_c['iv'] or 0) + (atm_p['iv'] or 0)) / 2 * 100, 1),
            'straddle': round(straddle, 2), 'expected_move_pct': round(straddle / price * 100, 2) if price else None,
            'call_oi': int(call_oi), 'put_oi': int(put_oi), 'pc_oi': round(put_oi / call_oi, 2) if call_oi else None,
            'call_vol': int(call_vol), 'put_vol': int(put_vol), 'pc_vol': round(put_vol / call_vol, 2) if call_vol else None,
            'skew_25d': round(skew, 1) if skew is not None else None,
            'top_oi': [{'strike': r['strike'], 'cp': r['cp'], 'oi': int(r['open_interest'] or 0), 'iv': round((r['iv'] or 0) * 100, 1)} for r in top_oi]}


# ---------- 结构定价 ----------
def spread_ok(r):
    return r and r['bid'] is not None and r['ask'] is not None and r['mid'] and (r['ask'] - r['bid']) <= max(0.05, r['mid'] * 0.2)


def leg(r, side):
    return {'side': side, 'cp': r['cp'], 'strike': r['strike'], 'mid': round(r['mid'], 2), 'delta': round(r['delta'], 2) if r['delta'] is not None else None,
            'iv': round(r['iv'] * 100, 1) if r.get('iv') else None, 'oi': int(r['open_interest'] or 0)}


def iron_condor(rows, price, mult, target_delta=0.16, wing_pct=None):
    calls = [r for r in rows if r['cp'] == 'C']
    puts = [r for r in rows if r['cp'] == 'P']
    sp = nearest(puts, 'delta', -target_delta)
    sc = nearest(calls, 'delta', target_delta)
    if not (spread_ok(sp) and spread_ok(sc)) or sp['strike'] >= price or sc['strike'] <= price:
        return None
    width = wing_pct * price if wing_pct else max(price * 0.02, sp['strike'] * 0.02)
    lp = nearest([r for r in puts if r['strike'] < sp['strike']], 'strike', sp['strike'] - width)
    lc = nearest([r for r in calls if r['strike'] > sc['strike']], 'strike', sc['strike'] + width)
    if not (lp and lc):
        return None
    credit = sp['mid'] + sc['mid'] - lp['mid'] - lc['mid']
    w = max(sp['strike'] - lp['strike'], lc['strike'] - sc['strike'])
    if credit <= 0 or w <= 0:
        return None
    max_loss = w - credit
    pop = max(0.05, 1 - (abs(sp['delta'] or 0.16) + (sc['delta'] or 0.16)))
    return finish('铁鹰', [leg(sp, '卖'), leg(lp, '买'), leg(sc, '卖'), leg(lc, '买')], credit, max_loss, pop, mult, credit=True)


def credit_vertical(rows, price, mult, cp, short_delta=0.25):
    side = [r for r in rows if r['cp'] == cp]
    s = nearest(side, 'delta', -short_delta if cp == 'P' else short_delta)
    if not spread_ok(s):
        return None
    width = max(price * 0.02, 0.5)
    l = nearest([r for r in side if (r['strike'] < s['strike'] if cp == 'P' else r['strike'] > s['strike'])], 'strike', s['strike'] - width if cp == 'P' else s['strike'] + width)
    if not l:
        return None
    credit = s['mid'] - l['mid']
    w = abs(s['strike'] - l['strike'])
    if credit <= 0:
        return None
    pop = max(0.05, 1 - abs(s['delta'] or short_delta))
    return finish('卖 Put 价差' if cp == 'P' else '卖 Call 价差', [leg(s, '卖'), leg(l, '买')], credit, w - credit, pop, mult, credit=True)


def debit_vertical(rows, price, mult, cp):
    side = [r for r in rows if r['cp'] == cp]
    b = nearest(side, 'delta', -0.55 if cp == 'P' else 0.55)
    s = nearest(side, 'delta', -0.30 if cp == 'P' else 0.30)
    if not (spread_ok(b) and spread_ok(s)) or b['strike'] == s['strike']:
        return None
    debit = b['mid'] - s['mid']
    w = abs(s['strike'] - b['strike'])
    if debit <= 0 or w <= debit:
        return None
    pop = (abs(b['delta'] or 0.55) + abs(s['delta'] or 0.3)) / 2
    return finish('借方 Call 价差' if cp == 'C' else '借方 Put 价差', [leg(b, '买'), leg(s, '卖')], w - debit, debit, pop, mult, credit=False)


def straddle(rows, price, mult):
    c = min([r for r in rows if r['cp'] == 'C' and r['mid']], key=lambda r: abs(r['strike'] - price), default=None)
    p = min([r for r in rows if r['cp'] == 'P' and r['mid']], key=lambda r: abs(r['strike'] - price), default=None)
    if not (spread_ok(c) and spread_ok(p)):
        return None
    cost = c['mid'] + p['mid']
    # 事件前买 vega 的目标是 IV 上升 20% 时权利金约 +25%，不是持有到期；胜率按历史经验 0.5
    return finish('跨式', [leg(c, '买'), leg(p, '买')], cost * 0.5, cost * 0.35, 0.5, mult, credit=False, note='目标 +50% 权利金，止损 −35%，事件前一天离场')


def single_leg(rows, price, mult, cp):
    r = nearest([x for x in rows if x['cp'] == cp], 'delta', -0.35 if cp == 'P' else 0.35)
    if not spread_ok(r):
        return None
    cost = r['mid']
    return finish('单腿 ' + ('Call' if cp == 'C' else 'Put'), [leg(r, '买')], cost * 0.8, cost * 0.5, 0.45, mult, credit=False, note='目标 +80% 减半仓，止损 −50%')


_K = {'rv': None, 'iv': None}  # 当前标的的 RV20 / IV30，由 scan() 设置


def finish(name, legs, max_gain, max_loss, pop, mult, credit, note=None, bonus=0.0, edge_override=None):
    """期权在隐含波动率下是公允定价，delta 胜率算出的期望恒为 0。真实优势来自实现波动率与隐含波动率的差：
    k = RV20 / 关键腿 IV（卖方看卖腿，买方看买腿）。
    卖方：权利金里有 (1-k) 的溢价 → 优势 = (1-k) × 权利金 / 最大亏损；
    买方：期权被低估 (k-1) → 优势 = k-1（相对最大亏损=权利金）；
    bonus：信号自带的非波动率优势（动量方向 +0.15，事件前 vega 抬升 +0.10），在 frameworks/opportunity-scoring 里声明。
    pop 显示用：卖方被击穿概率 ≈ 隐含 × k，买方到达概率 ≈ 隐含 × k。"""
    if max_loss <= 0 or max_gain <= 0:
        return None
    ref = next((l for l in legs if l['side'] == ('卖' if credit else '买') and l.get('iv')), None)
    iv_ref = (ref['iv'] if ref else _K['iv']) or None
    k = (_K['rv'] / iv_ref) if (_K['rv'] and iv_ref) else 1.0
    k = min(1.6, max(0.5, k))
    pop_adj = max(0.05, min(0.95, (1 - (1 - pop) * k) if credit else min(0.9, pop * k)))
    edge = edge_override if edge_override is not None else (((1 - k) * max_gain / max_loss) if credit else (k - 1))
    edge += bonus
    return {'name': name, 'legs': legs, 'is_credit': credit, 'price': round(max_gain if credit else max_loss, 2),
            'max_gain': round(max_gain * mult, 2), 'max_loss': round(max_loss * mult, 2), 'pop': round(pop_adj, 2), 'pop_implied': round(pop, 2),
            'k_rv_iv': round(k, 2), 'iv_ref': iv_ref, 'bonus': bonus, 'rr': round(max_gain / max_loss, 2), 'edge': round(edge, 3), 'ev': round(edge * max_loss * mult, 2),
            'multiplier': mult, 'note': note}


# ---------- 信号 → 机会 ----------
def pick_expiry(exps, lo, hi, prefer):
    c = [e for e in exps if lo <= e['dte'] <= hi]
    return min(c, key=lambda e: abs(e['dte'] - prefer)) if c else None


def scan(t, chain, exps, events):
    """t: ticker dict（已含 iv30/rv20/atr/closes）。返回机会列表。"""
    opps = []
    sym, price = t['symbol'], t['price']
    mult = 1 if t['market'] == 'crypto' else 100
    iv, rv, ivrv, atr = t['iv30'], t['rv20'], t['iv_rv'], t['atr_pct']
    _K['rv'], _K['iv'] = rv, iv
    provenance = f"{'Binance' if t['market'] == 'crypto' else 'CBOE 延迟 15 分钟 + Nasdaq'} · {t['fetched_at'][11:16]}"
    days_to_event = trading_days_until(events[0]['date']) if events else None
    fomc_today = TODAY.isoformat() in FOMC_DATES
    closes = t['closes']
    front = exps[0] if exps else None
    liquidity = lambda s: min(15, sum(l['oi'] for l in s['legs']) / 2000 * 15) if s else 0

    def add(kind, title, rationale, setup, exp, struct, strength):
        if not struct or struct['edge'] <= 0:
            return
        score = round(min(60, strength) + min(25, struct['edge'] * 100) + liquidity(struct))
        opps.append({'symbol': sym, 'market': t['market'], 'kind': kind, 'title': title, 'rationale': rationale, 'setup': setup,
                     'expiry': exp['expiry'], 'dte': exp['dte'], 'structure': struct, 'score': int(score), 'provenance': provenance})

    # 1 波动率溢价
    if ivrv and ivrv >= 1.3 and (days_to_event is None or days_to_event > 3):
        exp = pick_expiry(exps, 7, 21, 14)
        if exp:
            s = iron_condor(chain['by_exp'][exp['expiry']], price, mult)
            add('卖波动率', f'{sym} 波动率溢价', f'IV30 {iv:.1f} 对 RV20 {rv:.1f}，IV/RV {ivrv:.2f}，溢价 {(iv - rv) / iv * 100:.0f}%；{exp["dte"]} 天到期预期波动 ±{exp["expected_move_pct"]}%，卖 16Δ 两翼铁鹰。',
                'setups/earnings-iv-crush', exp, s, 20 + (ivrv - 1.3) * 100)
    # 2 事件溢价
    if events and days_to_event is not None and days_to_event <= 5 and events[0]['kind'] == 'earnings':
        ev_exp = next((e for e in exps if e['expiry'] >= events[0]['date']), None)
        if ev_exp and iv:
            prem = ev_exp['atm_iv'] / iv
            if prem >= 1.5:
                s = iron_condor(chain['by_exp'][ev_exp['expiry']], price, mult, wing_pct=ev_exp['expected_move_pct'] / 100 * 0.75)
                add('事件溢价', f'{sym} 财报 {events[0]["date"]}', f'事件到期 ATM IV {ev_exp["atm_iv"]}% 是 IV30 {iv:.1f} 的 {prem:.1f} 倍，预期波动 ±{ev_exp["expected_move_pct"]}%（直跨 {ev_exp["straddle"]}）。财报前 1 天收盘建仓，开盘 1 小时内平。',
                    'setups/earnings-iv-crush', ev_exp, s, 25 + (prem - 1.5) * 30)
    # 3 波动率便宜
    if ivrv and ivrv <= 0.8 and days_to_event is not None and 5 <= days_to_event <= 15:
        exp = pick_expiry(exps, 10, 30, 20)
        if exp:
            s = straddle(chain['by_exp'][exp['expiry']], price, mult)
            if s: s['edge'] = round(s['edge'] + 0.10, 3); s['bonus'] = 0.10; s['ev'] = round(s['edge'] * s['max_loss'], 2)
            add('买波动率', f'{sym} 事件前 IV 低', f'IV/RV {ivrv:.2f}，{events[0]["kind"] == "fomc" and "FOMC" or "财报"} 在 {days_to_event} 个交易日后，事件前 IV 通常抬升；买 {exp["dte"]} 天跨式吃 vega，事件前一天离场。',
                'setups/pre-event-long-vol', exp, s, 20 + (0.8 - ivrv) * 100)
    # 4 动量
    if len(closes) >= 21 and ivrv and ivrv <= 1.3:
        hi20, lo20 = max(closes[-21:-1]), min(closes[-21:-1])
        chg = t['change_pct'] or 0
        exp = pick_expiry(exps, 7, 21, 14)
        if exp and closes[-1] >= hi20 and chg > 0:
            s = debit_vertical(chain['by_exp'][exp['expiry']], price, mult, 'C')
            if s: s['edge'] = round(s['edge'] + 0.15, 3); s['bonus'] = 0.15; s['ev'] = round(s['edge'] * s['max_loss'], 2)
            add('动量', f'{sym} 创 20 日新高', f'收盘 {price:.2f} 突破 20 日高点 {hi20:.2f}，当日 {chg:+.1f}%，IV/RV {ivrv:.2f} 未过热；买 55Δ 卖 30Δ 借方 call 价差，跌回 {hi20:.2f} 以下失效。',
                'setups/debit-spread-swing', exp, s, 25 + min(20, (closes[-1] / hi20 - 1) * 500))
        elif exp and closes[-1] <= lo20 and chg < 0:
            s = debit_vertical(chain['by_exp'][exp['expiry']], price, mult, 'P')
            if s: s['edge'] = round(s['edge'] + 0.15, 3); s['bonus'] = 0.15; s['ev'] = round(s['edge'] * s['max_loss'], 2)
            add('动量', f'{sym} 创 20 日新低', f'收盘 {price:.2f} 跌破 20 日低点 {lo20:.2f}，当日 {chg:+.1f}%，IV/RV {ivrv:.2f}；买 55Δ 卖 30Δ 借方 put 价差，收回 {lo20:.2f} 以上失效。',
                'setups/debit-spread-swing', exp, s, 25 + min(20, (1 - closes[-1] / lo20) * 500))
    # 5 偏斜极端
    if front and front['skew_25d'] is not None:
        exp = pick_expiry(exps, 5, 21, 10) or front
        sk = exp['skew_25d'] if exp['skew_25d'] is not None else front['skew_25d']
        if sk >= 8:
            s = credit_vertical(chain['by_exp'][exp['expiry']], price, mult, 'P')
            add('偏斜', f'{sym} Put 偏斜 +{sk:.0f}', f'25Δ 偏斜 +{sk:.1f} 个 IV 点，下行保护被抢；卖 25Δ put 价差收偏斜溢价，{exp["dte"]} 天到期。', 'frameworks/skew-and-term-structure', exp, s, 20 + (sk - 8) * 4)
        elif sk <= -3:
            s = credit_vertical(chain['by_exp'][exp['expiry']], price, mult, 'C')
            add('偏斜', f'{sym} Call 偏斜 {sk:.0f}', f'25Δ 偏斜 {sk:.1f}，call 比 put 贵（追涨）；卖 25Δ call 价差，{exp["dte"]} 天到期。', 'frameworks/skew-and-term-structure', exp, s, 20 + (-3 - sk) * 6)
    # 6 期限倒挂（无事件）
    if front and iv and front['dte'] >= 1 and front['atm_iv'] >= iv * 1.15 and (days_to_event is None or days_to_event > 10):
        back = pick_expiry(exps, 25, 60, 35)
        if back:
            rows_f, rows_b = chain['by_exp'][front['expiry']], chain['by_exp'][back['expiry']]
            cf = min([r for r in rows_f if r['cp'] == 'C' and r['mid']], key=lambda r: abs(r['strike'] - price), default=None)
            cb = nearest([r for r in rows_b if r['cp'] == 'C'], 'strike', cf['strike']) if cf else None
            if cf and cb and spread_ok(cf) and spread_ok(cb) and cb['mid'] > cf['mid']:
                debit = cb['mid'] - cf['mid']
                s = finish('日历价差', [leg(cf, '卖'), leg(cb, '买')], debit * 0.6, debit, 0.55, mult, credit=False, note='近月到期时平仓，目标 +60%', edge_override=round((front['atm_iv'] / iv - 1) * 0.5, 3))
                add('期限结构', f'{sym} 近月 IV 倒挂', f'近月 ATM IV {front["atm_iv"]}% 高于 IV30 {iv:.1f} 的 {front["atm_iv"] / iv:.2f} 倍且无已知事件；卖 {front["expiry"]} 买 {back["expiry"]} 同行权日历价差。',
                    'frameworks/skew-and-term-structure', front, s, 20 + (front['atm_iv'] / iv - 1.15) * 100)
    # 7 0DTE gamma —— 只在能交易的时段产生，且 ATR 按剩余时间折算
    zero_ok, atr_scaled = False, atr
    if sym in ZERO_DTE_OK and front and front['dte'] <= 1 and atr and not fomc_today:
        now_utc = datetime.datetime.utcnow()
        if is_crypto_sym(sym):
            exp_dt = datetime.datetime.fromisoformat(front['expiry']) + datetime.timedelta(hours=8)
            hours = (exp_dt - now_utc).total_seconds() / 3600
            if hours >= 6:
                zero_ok, atr_scaled = True, atr * math.sqrt(min(hours, 24) / 24)
        else:
            et = now_utc - datetime.timedelta(hours=4)  # 夏令时 EDT；冬令时误差 1 小时可接受
            if et.weekday() < 5 and (9, 30) <= (et.hour, et.minute) <= (13, 0) and front['dte'] == 0:
                zero_ok, atr_scaled = True, atr * math.sqrt(max(1, (16 - et.hour - et.minute / 60)) / 6.5)
    if zero_ok:
        atr = atr_scaled
        ratio = front['expected_move_pct'] / atr if atr else None
        rows = chain['by_exp'][front['expiry']]
        if ratio and ratio <= 0.6:
            up = (t['change_pct'] or 0) >= 0
            s = single_leg(rows, price, mult, 'C' if up else 'P')
            if s: s['edge'] = round(min(1.0, 1 / ratio - 1), 3); s['ev'] = round(s['edge'] * s['max_loss'], 2)
            add('0DTE', f'{sym} 当日 gamma 便宜', f'{front["dte"]} 天到期预期波动 ±{front["expected_move_pct"]}% 只有 ATR14 {atr:.2f}% 的 {ratio:.2f} 倍；顺当日方向买 35Δ 单腿，13:00（美东）后不开仓。', 'setups/momentum-0dte', front, s, 20 + (0.6 - ratio) * 80)
        elif ratio and ratio >= 1.4:
            s = iron_condor(rows, price, mult, target_delta=0.2)
            if s: s['edge'] = round((1 - 1 / ratio) * s['max_gain'] / s['max_loss'], 3); s['ev'] = round(s['edge'] * s['max_loss'], 2)
            add('0DTE', f'{sym} 当日 gamma 贵', f'{front["dte"]} 天到期预期波动 ±{front["expected_move_pct"]}% 是 ATR14 {atr:.2f}% 的 {ratio:.2f} 倍；卖 20Δ 两翼铁鹰吃午后 theta。', 'setups/momentum-0dte', front, s, 20 + (ratio - 1.4) * 40)
    return opps


# ---------- 单标的处理 ----------
def process(sym, earn_by_sym, history):
    is_crypto = sym in CRYPTO
    q = binance_spot(sym) if is_crypto else nasdaq_quote(sym)
    hist = []
    try:
        hist = binance_history(sym) if is_crypto else nasdaq_history(sym, q['asset_class'])
    except Exception as e:
        log(f'{sym} history: {e}')
    chain = binance_chain(sym) if is_crypto else cboe_chain(sym)
    price = chain.get('price') or q['price']
    exps = []
    for exp in sorted(chain['by_exp']):
        dte = (datetime.date.fromisoformat(exp) - TODAY).days
        if dte < 0 or dte > 60:
            continue
        s = summarize_expiry(price, chain['by_exp'][exp], exp)
        if s:
            exps.append(s)
        if len(exps) >= 8:
            break
    iv30 = chain.get('iv30')
    if is_crypto or not iv30:
        cands = [(abs(e['dte'] - 30), e['atm_iv']) for e in exps if 20 <= e['dte'] <= 45]
        iv30 = min(cands)[1] if cands else (exps[-1]['atm_iv'] if exps else None)
    closes = [h['close'] for h in hist]
    rv20 = realized_vol(closes)
    atr = atr_pct(hist)
    # IV 历史 → IV Rank
    h = history.setdefault(sym, {})
    if iv30:
        h[TODAY.isoformat()] = round(iv30, 2)
        for k in sorted(h)[:-260]:
            del h[k]
    vals = list(h.values())
    iv_rank = round((iv30 - min(vals)) / (max(vals) - min(vals)) * 100) if iv30 and len(vals) >= 20 and max(vals) > min(vals) else None
    events = sorted(earn_by_sym.get(sym, []) + [{'date': d, 'kind': 'fomc', 'symbol': sym} for d in FOMC_DATES if 0 <= (datetime.date.fromisoformat(d) - TODAY).days <= 30] if sym in ('SPY', 'QQQ', 'IWM', 'BTC', 'ETH') else earn_by_sym.get(sym, []), key=lambda e: e['date'])
    t = {'symbol': sym, 'name': q.get('name'), 'market': 'crypto' if is_crypto else 'us', 'venue': 'Binance' if is_crypto else 'CBOE / Nasdaq',
         'price': price, 'change_pct': q.get('change_pct'), 'iv30': round(iv30, 1) if iv30 else None, 'rv20': round(rv20, 1) if rv20 else None,
         'iv_rv': round(iv30 / rv20, 2) if iv30 and rv20 else None, 'iv_rank': iv_rank, 'iv_days': len(vals), 'atr_pct': round(atr, 2) if atr else None,
         'ret_5d': round((closes[-1] / closes[-6] - 1) * 100, 2) if len(closes) >= 6 else None,
         'ret_20d': round((closes[-1] / closes[-21] - 1) * 100, 2) if len(closes) >= 21 else None,
         'hi_20d': round(max(closes[-21:-1]), 2) if len(closes) >= 21 else None, 'lo_20d': round(min(closes[-21:-1]), 2) if len(closes) >= 21 else None,
         'closes': closes[-30:], 'expiries': exps, 'next_event': events[0] if events else None, 'events': events[:4],
         'fetched_at': datetime.datetime.now().isoformat(timespec='seconds')}
    t['front_premium'] = round(exps[0]['atm_iv'] / iv30, 2) if exps and iv30 else None
    t['provenance'] = f"{'Binance' if is_crypto else 'CBOE 延迟 15 分钟 + Nasdaq'} · {t['fetched_at'][11:16]}"
    t['opportunities'] = scan(t, chain, exps, events)
    return t


def main():
    args = sys.argv[1:]
    single = args[args.index('--symbol') + 1].upper() if '--symbol' in args else None
    os.makedirs(OPT_DIR, exist_ok=True)
    history = load_json('history.json', {})
    latest = load_json('latest.json', {}) or {}
    wl = load_watchlist()
    if single:
        earn_by_sym = {}
        for e in latest.get('earnings', []):
            earn_by_sym.setdefault(e['symbol'], []).append(e)
        t = process(single, earn_by_sym, history)
        latest.setdefault('tickers', {})[single] = t
        latest['opportunities'] = [o for o in latest.get('opportunities', []) if o['symbol'] != single] + t['opportunities']
        latest['opportunities'].sort(key=lambda o: -o['score'])
        save_json('latest.json', latest)
        save_json('history.json', history)
        print(json.dumps(t, ensure_ascii=False))
        return 0
    log(f'watchlist {wl}')
    earn_all = earnings_window()
    earn_by_sym = {}
    for e in earn_all:
        earn_by_sym.setdefault(e['symbol'], []).append(e)
    tickers, errors, opps = {}, [], []
    for sym in wl:
        try:
            t = process(sym, earn_by_sym, history)
            tickers[sym] = t
            opps += t['opportunities']
            log(f'{sym} ok price={t["price"]} iv30={t["iv30"]} ivrv={t["iv_rv"]} opps={len(t["opportunities"])}')
            time.sleep(0.3)
        except Exception as e:
            errors.append(f'{sym}: {e}')
            log(f'{sym} FAILED {e}')
    wl_set = set(wl)
    big = [e for e in earn_all if e['symbol'] in wl_set or (e.get('market_cap') or 0) > 2e10]
    big += [{'date': d, 'symbol': 'FOMC', 'name': 'FOMC 利率决议', 'time': '14:00 ET', 'kind': 'fomc'} for d in FOMC_DATES if 0 <= (datetime.date.fromisoformat(d) - TODAY).days <= 120]
    big.sort(key=lambda e: e['date'])
    opps.sort(key=lambda o: -o['score'])
    save_json('latest.json', {'fetched_at': datetime.datetime.now().isoformat(timespec='seconds'), 'date': TODAY.isoformat(), 'watchlist': wl,
                              'tickers': tickers, 'earnings': big[:120], 'opportunities': opps, 'errors': errors, 'fomc_today': TODAY.isoformat() in FOMC_DATES})
    save_json('history.json', history)
    log(f'done: {len(tickers)}/{len(wl)} tickers, {len(opps)} opportunities, {len(errors)} errors')
    return 0 if tickers else 1


if __name__ == '__main__':
    sys.exit(main())
