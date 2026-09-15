# OpenClaw 升级与接入实录（2026-09-15 22:50–23:09）

> 性质：**操作实录 + 环境事实卡（runbook）**——供后续 agent 在本机（或同类环境）重复/排障。
> 目标：把本机 openclaw 从 2026.7.1 升级到最新（2026.9.4），并以 `openclaw acp` 作为 fleet 的
> stdio 节点接入。结果：**升级完成、Gateway 跑新版、fleet 侧全链路通**；遗留两个 openclaw
> 侧问题（模型鉴权、acp 桥二连 bug）。

## 1. 环境事实（升级前）

| 项 | 值 |
|---|---|
| 运行中的 Gateway | `/home/pc/.npm-global/lib/node_modules/openclaw/dist/index.js gateway --port 18789`（systemd user 服务 `openclaw-gateway.service`，9月03 起） |
| 全局二进制 A | `~/.npm-global/bin/openclaw` → 2026.7.1 |
| 全局二进制 B | `~/.nvm/versions/node/v24.19.0/bin/openclaw`（npm 前缀分裂的产物） |
| 配置 | `~/.openclaw/openclaw.json`（gateway.auth.token / port 18789） |
| acpx | **2026.7.1 与 npm 2026.9.4 均不带**（dist/extensions 无此插件；acpx 仅存在于源码树 `extensions/acpx`，宿主 ≥2026.4.25 的插件形态） |

## 2. 升级过程（每步的坑）

### 2.1 安装去哪了：npm 前缀分裂
- `npm install -g openclaw@2026.9.4` "成功"，但 `~/.npm-global/bin/openclaw --version` 仍是 2026.7.1。
- **诊断**：`npm prefix -g` = `/home/pc/.nvm/versions/node/v24.19.0`（nvm 接管了全局前缀）；
  `which -a openclaw` 显示两处并存。新版装进了 nvm 前缀。
- **教训**：升级后必须 `which -a` + 逐个 `--version`，确认改的是"目标二进制"。

### 2.2 allow-scripts 拦截
- 首次安装被 npm 的 allow-scripts 策略拦截（版本未变）。按提示加
  `--allow-scripts=openclaw,@google/genai,koffi,tree-sitter-bash,protobufjs` 重装成功。

### 2.3 2026.9.4 严格 schema 拒旧配置（逐层剥洋葱）
新版 CLI 启动即拒（Unrecognized key），需依次处理：
1. `gateway.controlUi.allowInsecureAuth`、`gateway.tailscale.resetOnExit`——手工摘除（备份先行
   `openclaw.json.pre-fleet-b1`）；
2. `meta.lastTouchedAt`（藏在 `meta` 对象里，非顶层）、`gateway.nodes.denyCommands`
   （新版已迁移到 `gateway.nodes.commands.deny`）——**按 doctor 描述的迁移语义手工搬移**，
   不要只删不搬（deny 规则会丢）。
- `openclaw doctor`（干跑）会列出全部问题并描述迁移动作；`doctor --fix` 才执行。

### 2.4 doctor --fix 需要 Gateway 停机（维护模式）
- 报错"Gateway service ownership or shutdown could not be verified"。
- **正解**：`systemctl --user stop openclaw-gateway.service`（服务归属查法：
  `openclaw gateway status --deep` 会打印 systemd unit 路径）→ `doctor --fix` → 起服。

### 2.5 切换服务到新二进制
- 编辑 `~/.config/systemd/user/openclaw-gateway.service` 的 ExecStart 指向 nvm 前缀的 dist/index.js
  → `systemctl --user daemon-reload` → `start` → `is-active` + `gateway status` 验证。
- doctor 同时做了**状态迁移**（device-auth JSON → SQLite，删旧 JSON）——所以**不能只回滚二进制
  不回滚状态**，升级后旧版二进制可能反而不兼容新状态（回滚需谨慎）。

## 3. fleet 侧接入（已通部分）

```jsonc
// ~/.config/Fleet/settings.json 的节点条目（node-cli 生成）
{
  "name": "openclaw-gateway (personal agent)",
  "driver": "stdio",
  "command": "/home/pc/.nvm/versions/node/v24.19.0/bin/openclaw",
  "args": ["acp", "--url", "ws://127.0.0.1:18789",
           "--token-file", "/home/pc/.config/Fleet/openclaw-gateway-token"],
  "url": ""
}
```
- token 从 `~/.openclaw/openclaw.json` 的 `gateway.auth.token` 提取，落 `~/.config/Fleet/openclaw-gateway-token`（0600）；
- **已验证**：initialize（agentInfo `openclaw-acp`，capabilities 含 loadSession/list/resume/close）
  → session/new → prompt → end_turn 回流（3.2s/4.6s）；
- F-3 回环落地后桌面壳同样可开此节点窗。

## 4. 遗留问题（openclaw 侧，非 fleet）

| # | 现象 | 证据 | 状态 |
|---|---|---|---|
| OC-1 | 默认 agent 模型无鉴权 | Gateway 日志：`No route-compatible authentication source is configured for openai.`（请求 openai/gpt-5.6-sol，401）→ 回复为空 | **待用户配置**：在 openclaw 里给默认 agent 配可用 provider，或告知 fleet 侧该用哪个 |
| OC-2 | acp 桥"首连可用、二连拒绝" | Gateway 重启后第一条 ACP 连接完整往返；后续连接报 `Legacy device auth requires migration`（doctor 已迁移仍报） | **上游 bug 候选**：建议反馈 openclaw 仓库（带最小复现：stop→doctor --fix→start→连两次） |
| OC-3 | 源码树（harness）无 dist | `pnpm install && pnpm build` 可自建 2026.9.4+acpx | 低优先；npm 版够用 |

## 5. 速查（本机重复操作）

```bash
OC=/home/pc/.nvm/versions/node/v24.19.0/bin/openclaw   # 2026.9.4
systemctl --user status openclaw-gateway.service        # 服务状态
$OC gateway status --deep                               # 归属/日志路径/配置体检
journalctl --user -u openclaw-gateway -n 50             # 或 /tmp/openclaw/openclaw-$(date +%F).log
# 健康探活（fleet 视角）
curl -s -H "X-Secret-Key: $(cat ~/.config/Fleet/openclaw-gateway-token)" \
  ws://127.0.0.1:18789 2>/dev/null; echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"p","version":"0"}}}' | timeout 15 $OC acp --url ws://127.0.0.1:18789 --token-file ~/.config/Fleet/openclaw-gateway-token
```

## 6. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-16 | 初稿：前缀分裂/allow-scripts/schema 洋葱/doctor 停机语义/服务切版；fleet 接入配方；OC-1~3 遗留 |
