---
title: 单笔交易复盘
type: skill
trigger: 复盘 / review trade
---

# 单笔交易复盘（skill）

输入：一个 trades/ 页面。输出结构固定：

- **论点是否成立**：入场时写的论点 vs 实际发生。一句话。
- **执行是否合规**：对照 people/me 的纪律逐条打勾或打叉（仓位、止损、时间窗口、事件规避）。
- **结果归因**：盈亏来自方向（delta）、波动率（vega）还是时间（theta）？用入场/出场 IV 和标的涨跌估算。
- **setup 归档**：这笔属于哪个 setup？该 setup 的规则需要修改吗？
- **一句话教训**：写进交易页 `## 教训`，并作为 take 记录（holder=people/me，kind=take）。

禁止：安慰、泛泛而谈、"下次注意"。
