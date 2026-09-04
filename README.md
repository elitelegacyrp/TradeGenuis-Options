# TradeGenuis Options

[中文](#中文) · [English](#english)

---

## 中文

美股 + 币安加密期权的桌面投研工作台。工作流：**机会扫描 → 投研报告 → 交易记录与复盘 → 知识库**。底层用 [gbrain](https://github.com/garrytan/gbrain) 做知识库与检索，用 DeepSeek 做合成，行情全部来自免费公开接口，实时获取、不入库。

### 它做什么

- **机会**：对观察列表扫描 7 类信号（波动率溢价、事件溢价、波动率便宜、动量、偏斜极端、期限倒挂、0DTE gamma），每条用当前期权链的真实报价算出一个具体结构：腿、权利金、胜率、盈亏比、优势、期望值。优势模型 = 实现波动率与隐含波动率的差（卖方 `(1−RV/IV)×权利金/最大亏损`，买方 `RV/IV−1`），优势 ≤ 0 的不显示。每条标注数据来源与时间。
- **投研**：实时期权链（每个到期的 ATM IV、直跨、预期波动、P/C、25Δ 偏斜、最大持仓）+ 知识库检索（相关框架、该标的历史交易、教训）→ DeepSeek 生成固定五段的中文报告（结论 / 依据 / 策略 / 风险 / 置信度），自动存入知识库，可追问、可一键采纳为交易计划。
- **交易**：录入前「AI 检查计划」对照你的纪律、框架、历史给出 通过 / 修改后通过 / 不做；开仓自动登记一条 bet；平仓自动结算 bet、把教训存为 take；历史交易可直接录入。校准页显示 Brier 分数、按置信度分桶的"声称 vs 实际"、按 setup 的期望值判停。
- **知识库**：框架、策略模板、投研报告、教训、画像，全部是可编辑的 Markdown，可导入 md / txt / PDF。
- **问答**：任何问题先检索知识库和实时数据，再合成，结论先行，标注依据页面。

### 数据来源（免费、无需 key）

| 数据 | 来源 |
|---|---|
| 美股期权链（IV、希腊字母、持仓量） | CBOE 延迟 15 分钟 |
| 美股报价、历史、财报日历 | Nasdaq |
| BTC / ETH 现货与期权 | Binance 公开接口 |
| FOMC 日程 | 美联储官网，脚本内硬编码，每年核对 |

### 安装

需要 macOS（Apple Silicon 已验证）、Node 18+、Python 3。

```bash
# 1. gbrain（知识库引擎）+ Bun
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/garrytan/gbrain.git ~/Desktop/gbrain
cd ~/Desktop/gbrain && bun install && bun link
# 本地补丁：让常驻 serve 允许以 people/me 记录 takes（见 patches/）
git apply ~/Desktop/TradeGenuis-Options/patches/gbrain-stdio-takes-holders.patch   # 一行补丁，见 patches/

# 2. 本机向量模型（免费）
brew install ollama && brew services start ollama && ollama pull nomic-embed-text

# 3. 初始化大脑并导入起始知识库
gbrain init --pglite --embedding-model ollama:nomic-embed-text
mkdir -p ~/brain-options && cp -R brain-starter/* ~/brain-options/ && cp ~/brain-options/people/me.example.md ~/brain-options/people/me.md
cd ~/brain-options && git init && git add -A && git commit -m init
gbrain import ~/brain-options

# 4. PDF 导入依赖
python3 -m pip install pypdf

# 5. 客户端
cd ~/Desktop/TradeGenuis-Options && npm install && npm start
# 打包（含 ad-hoc 签名与 zip）：npm run dist → dist/TradeGenuis Options-<版本>-arm64-mac.zip
```

启动后在「设置」填 `DEEPSEEK_API_KEY`（投研、问答、检查、复盘需要），其余功能无需 key。

先改 `~/brain-options/people/me.md` 写你自己的交易风格与纪律，然后在知识库里重新导入。它是所有 AI 输出的核对基准。

### 下载安装（不想自己打包）

到 [Releases](https://github.com/Theclues/TradeGenuis-Options/releases) 下载 `TradeGenuis Options-<版本>-arm64-mac.zip`，解压后把 App 拖进「应用程序」。App 是 ad-hoc 签名、未经苹果公证，首次打开若提示"无法验证开发者"或"已损坏"，在终端执行一次：

```bash
xattr -dr com.apple.quarantine "/Applications/TradeGenuis Options.app"
```

或到 系统设置 → 隐私与安全性 → 页面底部「仍要打开」。

App 只是客户端，仍需按上面第 1–4 步装好 gbrain、Ollama 和起始知识库。

### 架构

- Electron 主进程常驻一个 `gbrain serve`（stdio MCP），所有读写走它；PGLite 是进程独占锁，多个 CLI 进程并发会等锁失败。没有 MCP 等价物的命令（导入目录 / embed / doctor）走"暂停 serve → 执行 → 恢复"通道。
- `scripts/market_sync.py` 生成 `~/.gbrain/options/latest.json`；`--symbol X` 单标的实时刷新；IV 历史累计到 `history.json`，20 天后出 IV Rank。
- AI 直连 DeepSeek（流式，默认关闭思考模式），知识库只负责检索。所有提示词在 `renderer/app.js`。
- takes（bet / 教训）以 `~/brain-options/<slug>.md` 里的 Markdown 表格为准，客户端重写页面前会保留它。

### 目录

```
main.js            主进程：serve 客户端、CLI 通道、行情脚本、DeepSeek 流式
mcp-client.js      stdio JSON-RPC 客户端
preload.js         IPC 桥
renderer/          界面（index.html / style.css / app.js）
scripts/           market_sync.py 行情与机会扫描
brain-starter/     起始知识库：9 篇框架、4 个策略模板、4 个工作流、画像模板
patches/           对 gbrain 的一行补丁
```

### 免责

本软件只做数据整理与分析辅助，不构成投资建议。期权可能损失全部权利金乃至更多。

---

## English

A desktop research workbench for US equity options and Binance crypto options. Workflow: **opportunity scan → research report → trade journal & review → knowledge base**. Built on [gbrain](https://github.com/garrytan/gbrain) for the knowledge base and retrieval, DeepSeek for synthesis. Market data comes from free public endpoints, fetched live and never stored in the brain.

### What it does

- **Opportunities**: scans your watchlist for 7 signals (volatility premium, event premium, cheap volatility, momentum, skew extremes, term-structure inversion, 0DTE gamma). Each one is priced into a concrete structure from the live chain: legs, premium, win rate, reward/risk, edge, expected value. Edge = realized vs implied volatility gap (sellers `(1−RV/IV)×credit/max loss`, buyers `RV/IV−1`); non-positive edge is hidden. Every card shows its data source and timestamp.
- **Research**: live chain (per-expiry ATM IV, straddle, expected move, P/C, 25Δ skew, top OI) + brain retrieval (relevant frameworks, your past trades on the symbol, lessons) → DeepSeek writes a fixed five-section report (conclusion / evidence / strategy / risk / confidence). Saved to the knowledge base; follow-up questions; one click to adopt as a trade plan.
- **Trades**: "AI plan check" before entry compares the plan against your discipline, frameworks and history and returns pass / pass with changes / don't. Opening a trade registers a bet; closing resolves the bet and stores the lesson as a take. Historical trades can be entered directly. Calibration shows Brier score, claimed vs actual by confidence bucket, and per-setup expectancy.
- **Knowledge base**: frameworks, setup templates, research reports, lessons, profile. All editable Markdown; import md / txt / PDF.
- **Ask**: every question retrieves the brain and live data first, then synthesizes, conclusion first, with cited pages.

### Data sources (free, no key)

| Data | Source |
|---|---|
| US option chains (IV, greeks, OI) | CBOE delayed 15 min |
| US quotes, history, earnings calendar | Nasdaq |
| BTC / ETH spot and options | Binance public API |
| FOMC schedule | federalreserve.gov, hardcoded in the script, verify yearly |

### Install

macOS (Apple Silicon verified), Node 18+, Python 3.

```bash
# 1. gbrain + Bun
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/garrytan/gbrain.git ~/Desktop/gbrain
cd ~/Desktop/gbrain && bun install && bun link
git apply ~/Desktop/TradeGenuis-Options/patches/gbrain-stdio-takes-holders.patch   # one-line patch, see patches/

# 2. Local embeddings (free)
brew install ollama && brew services start ollama && ollama pull nomic-embed-text

# 3. Init the brain and import the starter knowledge base
gbrain init --pglite --embedding-model ollama:nomic-embed-text
mkdir -p ~/brain-options && cp -R brain-starter/* ~/brain-options/ && cp ~/brain-options/people/me.example.md ~/brain-options/people/me.md
cd ~/brain-options && git init && git add -A && git commit -m init
gbrain import ~/brain-options

# 4. PDF import dependency
python3 -m pip install pypdf

# 5. Client
cd ~/Desktop/TradeGenuis-Options && npm install && npm start
# Package (ad-hoc signed zip): npm run dist → dist/TradeGenuis Options-<version>-arm64-mac.zip
```

Enter `DEEPSEEK_API_KEY` in Settings (needed for research, ask, plan check, review). Everything else works without a key.

Edit `~/brain-options/people/me.md` with your own style and discipline first, then re-import. It is the baseline every AI output is checked against.

### Download (no build)

Grab `TradeGenuis Options-<version>-arm64-mac.zip` from [Releases](https://github.com/Theclues/TradeGenuis-Options/releases), unzip, drag the app into Applications. It is ad-hoc signed and not notarized; if macOS says "damaged" or "unidentified developer", run once:

```bash
xattr -dr com.apple.quarantine "/Applications/TradeGenuis Options.app"
```

or System Settings → Privacy & Security → "Open Anyway".

The app is only the client; steps 1–4 above (gbrain, Ollama, starter brain) are still required.

### Architecture

- The Electron main process keeps one resident `gbrain serve` (stdio MCP); all reads and writes go through it. PGLite holds an exclusive process lock, so concurrent CLI processes would block. Commands without an MCP equivalent (directory import / embed / doctor) use a pause-serve → run → resume lane.
- `scripts/market_sync.py` writes `~/.gbrain/options/latest.json`; `--symbol X` refreshes one symbol; IV history accumulates in `history.json` (IV Rank after 20 days).
- AI calls DeepSeek directly (streaming, thinking mode off by default); the brain only does retrieval. All prompts live in `renderer/app.js`.
- Takes (bets / lessons) are canonical in the Markdown table inside `~/brain-options/<slug>.md`; the client preserves it on every page rewrite.

### Layout

```
main.js            main process: serve client, CLI lane, market script, DeepSeek streaming
mcp-client.js      stdio JSON-RPC client
preload.js         IPC bridge
renderer/          UI (index.html / style.css / app.js)
scripts/           market_sync.py — market data and opportunity scan
brain-starter/     starter knowledge base: 9 frameworks, 4 setups, 4 workflows, profile template
patches/           the one-line gbrain patch
```

### Disclaimer

This software organizes data and assists analysis. It is not investment advice. Options can lose the entire premium and more.
