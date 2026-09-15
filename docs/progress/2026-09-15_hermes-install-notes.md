# Hermes Agent 安装与接入实录（2026-09-15 23:19–23:33）

> 性质：**操作实录 + 配置事实卡（runbook）**——供后续 agent 复现/排障。
> 目标：安装 hermes-agent（v2026.9.14 / v0.21.3）并以 `hermes-acp`（stdio ACP 面）接入 fleet。
> 结果：**全链路通**（fleet stdio 驱动 → hermes-acp → MiniMax M3 → `HERMES-B1-OK`）。

## 1. 安装（venv 隔离，零污染）

```bash
cd ~/proj/harness/hermes-agent
python3 -m venv .venv-fleet                 # Python 3.12.3 ✓（要求 >=3.11,<3.14）
timeout 280 .venv-fleet/bin/pip install -e ".[acp]" --quiet
.venv-fleet/bin/hermes --version            # Hermes Agent v0.21.3 (2026.9.14)
```
- `.[acp]` extra = `agent-client-protocol==0.9.0`（Python SDK；与 fleet 的 TS SDK 1.3 仅需线上
  协议协商兼容，实测 initialize ✓）；
- 入口：`hermes-acp`（= `acp_adapter.entry:main`，独立脚本）；`hermes acp` 子命令亦存在。

## 2. 冷启动特性（影响超时设计）

- 首启懒装依赖（boto3 等）→ **initialize 可能 >8s**：fleet 的 stdio 驱动健康检查超时已从 8s
  提到 **30s**（`runtime/drivers/stdio/driver.ts`，本日实证提交）；
- SQLite 版本告警（WAL-reset bug 检测）无害：hermes 自动降级 journal_mode=DELETE；
- 无鉴权时后台探测（openrouter/nous）会标 unhealthy 60s——日志噪音，不影响 ACP 面。

## 3. ACP 能力面（实测 initialize 应答）

```
agentCapabilities: loadSession=true; sessionCapabilities: fork/list/resume
```
——hermes 是 fleet 首个"标准超集"节点（设计文档 FLEET-HERMES-001 的预言实证）：
session 历史侧栏/恢复按 catalog 可开（当前 stdio 条目保守声明 sessionList:false，后续可上调）。

## 4. 模型通道（三轮试错 → 正解）

| 轮 | 配置 | 结果 | 教训 |
|---|---|---|---|
| 1 | `OPENAI_API_KEY` + `OPENAI_BASE_URL`（MiniMax /v1）+ `HERMES_MODEL=MiniMax-M3` | 401 Missing Authentication header | 模型名 `MiniMax-M3` 把 provider 路由到 hermes 原生 minimax 通道，OPENAI_* 根本没用上 |
| 2 | `MINIMAX_API_KEY` + `MINIMAX_BASE_URL=…/v1`（dsh 同款） | 404 page not found | hermes 是 **Anthropic Messages 栈**；minimax 走它家的 **`/anthropic` 端点**（源码 `_MINIMAX_ANTHROPIC_URLS` 实证），不吃 /v1 |
| 3 | `MINIMAX_BASE_URL=https://api.minimaxi.com/anthropic` | **HERMES-B1-OK**（provider=minimax，10 updates） | 配 provider 前先问：**wire 协议族是 openai-compatible 还是 anthropic？** |

凭据来源：`~/.dsh-acp/.env` 的 `MINIMAX_API_KEY`（与 dsh 节点共用同一家配额，注意用量）。

## 5. fleet 节点条目（最终形态）

```jsonc
{
  "name": "hermes local",
  "driver": "stdio",
  "command": "/home/pc/proj/harness/hermes-agent/.venv-fleet/bin/hermes-acp",
  "url": "",
  "env": {
    "MINIMAX_API_KEY": "<from ~/.dsh-acp/.env>",
    "MINIMAX_BASE_URL": "https://api.minimaxi.com/anthropic",
    "HERMES_MODEL": "MiniMax-M3"
  }
}
```
- env 经 `FleetNode.env` 注入（spawn 时合并 process.env）——凭据不进仓库；
- F-3 回环落地后桌面壳可直接开 `hermes local` 窗（首连 10–30s 冷启动）。

## 6. 速查

```bash
H=~/proj/harness/hermes-agent/.venv-fleet/bin
$H/hermes --version
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"p","version":"0"}}}' | $H/hermes-acp   # 应答含 agentCapabilities
# fleet 视角派发（走 stdio 驱动）
cd ~/proj/harness/hermes-agent && cd /home/pc/proj/fleet && npx tsx -e "…" # 见 fleetd/bridge dispatch 工具
```

## 7. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-16 | 初稿：安装/冷启动/能力面/模型通道三轮试错表/节点配方/速查 |
