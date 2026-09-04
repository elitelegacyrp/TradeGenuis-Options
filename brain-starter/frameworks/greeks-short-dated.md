---
title: 短期期权的希腊字母：0–14 DTE 的 gamma、theta、vega 行为
type: framework
tags: [greeks, gamma, theta, vega, 0dte]
---

# 短期期权的希腊字母

短期期权和长期期权是两种不同的工具。0–14 DTE 的合约里，gamma 和 theta 主导一切，vega 退居其次。

## Gamma

- ATM 期权的 gamma 随到期临近急剧上升，0DTE ATM 的 gamma 是 30DTE 的 5 倍以上。
- 对买方：标的走 1 个预期波动，权利金可能翻倍；对卖方：同样的走势可能让 delta 从 0.2 变 0.7，亏损非线性。
- 用法：买 gamma 要在预期波动被低估时（预期波动 < 0.6 × ATR），且方向已经出现；卖 gamma 要有翼保护。

## Theta

- 最后 3 天 theta 加速，最后 1 天从开盘到收盘衰减的权利金占当日权利金的 70% 以上，且午后最快。
- 0DTE 买方 13:00（美东）以后不开新仓；卖方相反，午后卖的 theta 效率最高。
- 币安期权每天 08:00 UTC 到期，theta 加速发生在北京时间凌晨到早上。

## Vega

- 7 DTE 以内 vega 很小，IV 变化对权利金影响有限；IV 压缩策略要用事件到期的合约才有足够 vega 暴露。
- 事件前买波动率（[[setups/pre-event-long-vol]]）要用 10–30 DTE，7 DTE 以内 vega 不够、theta 太贵。

## Delta 作为概率

- |Δ| 近似"到期时价内的概率"。卖 16Δ 两翼的铁鹰，理论胜率约 68%；卖 30Δ 约 40% 概率被触及一侧。
- 借方价差买 55Δ 卖 30Δ：盈亏平衡在两个行权价之间，胜率 45–55%，盈亏比通常 1–2。

## Pin risk

到期日标的贴着行权价收盘，指派不确定。美股 0DTE 单腿在收盘前 30 分钟必须离场；价差在两腿之间收盘时要主动平仓。

相关：[[frameworks/expected-move]]、[[setups/momentum-0dte]]、[[frameworks/position-sizing]]。
