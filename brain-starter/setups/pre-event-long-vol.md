---
type: framework
title: 事件前买波动率
dte: 3-14
direction: neutral
ingested_via: 'mcp:put_page'
ingested_at: '2026-09-04T06:11:25.130Z'
source_kind: 'mcp:put_page'
---

# 事件前买波动率

**论点**：事件（财报 / FOMC / 产品发布）前 5–10 天，IV 往往还没充分抬升；提前买入跨式或宽跨，事件临近时 IV 上升带来 vega 收益，事件前一天卖出，不持有过事件。

**入场条件**
- IV/RV < 1.0，且 IV30 处于该标的 3 个月低位。
- 距事件 5–10 个交易日。

**失效 / 止损**
- IV 持续下行、权利金亏 30% → 离场。

**目标**：事件前一天平仓，不赌事件方向。

**风险**：theta；标的横盘时 vega 收益不够抵消。

BTC除外
