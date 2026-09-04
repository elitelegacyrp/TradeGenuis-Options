# gbrain 补丁 / gbrain patch

`gbrain-stdio-takes-holders.patch`：gbrain 的 stdio MCP 服务把 takes 持有者白名单硬编码为 `['world']`，桌面客户端以 `people/me` 记录 bet 时会报 `permission_denied`。补丁让它读取环境变量 `GBRAIN_STDIO_TAKES_HOLDERS`（逗号分隔），未设置时保持上游默认。客户端启动 serve 时注入 `world,people/me,brain`。

基于 gbrain 提交 `GBRAIN_COMMIT` 里记录的版本生成。gbrain 升级后需重新应用：

```bash
cd ~/Desktop/gbrain && git apply /path/to/patches/gbrain-stdio-takes-holders.patch
```

---

The stdio MCP server in gbrain hardcodes the takes-holder allow-list to `['world']`, so the desktop client gets `permission_denied` when registering bets as `people/me`. The patch reads `GBRAIN_STDIO_TAKES_HOLDERS` (comma separated) and falls back to the upstream default. The client injects `world,people/me,brain` when it starts serve. Re-apply after upgrading gbrain.
