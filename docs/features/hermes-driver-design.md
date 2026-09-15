# 技术方案分析：接入 Hermes Agent 节点

> 特性 ID：`FLEET-HERMES-001` · 状态：**参考分析 v1.0，待评审**（2026-09-15）
> 输入：harness `hermes-agent-analysis-2026-09-15.md`（v2026.9.14 = 0.21.3 源码分析）+
> 本地源码抽查（`acp_adapter/`、`pyproject.toml`）；本仓 dsh 接入经验
> （`dsh-harness-driver.md` D1–D7、会话报告）与 F-2/F-3/F-11 既有设计。
> 本文回答：**fleet 接入 hermes 有哪几条技术路径、各自工作量与风险、推荐顺序**。
> 精益声明：遵照 `2026-09-15_hub-design-review.md` E1 冻结令——本文**不新增 roadmap
> 候选**，结论挂靠既有 F-2/F-3 轨道。

## 1. 事实基线：hermes 的 ACP 面（源码级）

| 项 | 事实 | 出处 |
|---|---|---|
| ACP Server | **内建**：`hermes acp` / `hermes-acp` / `python -m acp_adapter.entry`，stdio 传输（stdout=JSON-RPC，日志走 stderr） | `acp_adapter/entry.py`、pyproject `hermes-acp = "acp_adapter.entry:main"` |
| 依赖 | `agent-client-protocol==0.9.0`（Python SDK，精确锁版；与 fleet TS SDK 1.3.0 不同版本线，仅需 wire 兼容——initialize 协议版本协商） | pyproject extras `acp` |
| 会话生命周期 | **全量**：NewSession / **ListSessions（游标分页）/ LoadSession / ResumeSession / ForkSession**；断线重连语义（SubagentReconnectResult 先例） | `acp_adapter/server.py` |
| 模型面 | **标准 ACP 面直供**：session 响应携带 `models`（ModelInfo 列表 + current_model_id）+ `modes`——provider:model 全目录经标准字段暴露，非私有扩展 | server.py `_build_model_state`（L641） |
| 权限 | 审批桥接：hermes 危险命令审批 ↔ ACP PermissionOption（allow_once/session/always/deny，ID 稳定）——**映射语义与壳的权限对话框天然对齐** | `acp_adapter/permissions.py` |
| MCP 透传 | ACP 客户端下发的 mcpServers（stdio/HTTP/SSE）经 `_register_session_mcp_servers` 注册 | server.py L170 |
| ACP Client | 另有把 Copilot CLI（`copilot --acp`）包成 OpenAI 兼容后端的 client 路径（与本特性无直接关系） | `agent/copilot_acp_client.py` |
| 其他 | `mcp_serve.py`（hermes 亦可为 MCP server）；Python ≥3.11,<3.14；MIT | — |

## 2. 能力矩阵：hermes 是 fleet 首个"标准超集"节点

| 能力 | goose | dsh rc.2 | **hermes** | 对 fleet 的意义 |
|---|---|---|---|---|
| 会话历史 list/resume/load/fork | ✓（goose 扩展） | ✗（降级为空态） | **✓ 标准 ACP** | dsh 窗口"历史侧栏永远空"的痛点在 hermes 上消失 |
| 模型选择 | ✓（goose 扩展） | ✗（cordis.yml 固定，文案降级 D-2） | **✓（标准 `models` 字段）** | 壳的模型选择器仍是 goose 扩展驱动 → UI 仍需门控，但**数据在标准面就有**，未来增强只需读标准字段 |
| 权限应答 | ✓ | policy=never（静默） | **✓（四档 PermissionOption）** | 权限 UI 主链路首次在非 goose 节点可用 |
| cancel | ✓ | noop | ✓（预期，待冒烟验证） | — |
| mcpServers 透传 | ✓ | 非空即拒 | ✓ | 壳当前不发 mcpServers，无冲突 |
| goose `*_unstable` 扩展（30+） | ✓ | ✗ → D7 降级 | **✗ → 同样走 D7** | **唯一需要降级的面**——且 `acpNewSession` 必调的 `sessionInfo_unstable` 同样 -32601，dsh 分流的"非 goose 分支"（合成 SessionInfo）可**直接复用** |

**结论**：dsh 是"标准子集"（缺这缺那，降级面大），hermes 是"标准超集、goose 扩展缺失"——**D7 降级模型的最小适用对象**，接入工作量比 dsh 更小。

## 3. 三条接入路径

### 路径 B（推荐先行）：远程 WS 节点——复用 dsh-fleet 桥，零新传输件

dsh-fleet 的 `bridge/acp-ws.mjs` 本就是**通用 stdio-ACP→WS 桥**（`--cmd` 参数任意）：

```bash
# 远端机器（hermes 已安装并配置好 provider 凭据）
node acp-ws.mjs --port 3285 --token <secret> --cmd "hermes acp"
```

fleet 侧工作（沿用 dsh c1–c3 模式，估 **1–2 天**）：

| # | 工作 | 复用 |
|---|---|---|
| B1 | `runtime/drivers/hermes/`（driver + 注册表 + 测试）+ versions.json 条目（钉 hermes 0.21.x + agent-client-protocol 0.9.0） | c1 模式 |
| B2 | app 侧：`FLEET_DRIVER_OPTIONS` 镜像加 hermes（D3 双落点）+ i18n 三 locale + 节点不可达文案 | c3 模式 |
| B3 | `acpNewSession`：hermes 走**既有非 goose 分支**（合成 SessionInfo、跳过 goose `_meta`）；模型标注可读标准 `models` 的 current_model_id（比 dsh 的 `remote (cordis.yml)` 中性文案更进一步，顺手修 D-2 的正解形态） | c2 的 dsh 分流直接复用 |
| B4 | 冒烟：acp-smoke 对桥 + `hermes acp`；手工验收单（5B 同款，重点补：模型选择器降级巡查、权限四档弹窗、session list 非空态） | acp-smoke 现成 |

### 路径 A：本地 stdio 节点——随 F-3 落地，hermes 是首个标准条目

`hermes acp` 即 F-3 stdio 驱动的理想第一目标：`{ command: "hermes", args: ["acp"] }`
恰是 acpx 格式的一个条目（remote-node-notes §3-D 的直接兑现）。**不单独排期**，作为
F-3 spike 的第二验证对象（第一个是 @agentclientprotocol 官方桥）。
> 远程变体（v1.0 注）：stdio 默认本机进程；经 F-3 扩展 scope 的 **ssh 命令模板**
> （roadmap v1.2 起）可写为 `ssh <host> hermes acp`——进程语义本地、执行位置远程，
> 属 F-3 spike 评估范围，非本特性独立工作。

### 路径 C：hermes 作为编排者——零成本消费面②

hermes 是 MCP 工具消费者 → 加载 FLEET-ORCH-001 桥（standalone）即可让 hermes 用自然
语言指挥 fleet 舰队。**不需要任何 hermes 侧工作**；注意递归：hermes 既是 fleet 节点又
编排 fleet 节点 → hop 限制（桥 §9）必须启用——hermes 接入让这条防线从理论变成现实需要。

## 4. 风险与前置

| # | 风险/前置 | 处置 |
|---|---|---|
| R1 | **ACP 适配器成熟度**：acp_adapter 仅 4.1k LOC / 14 模块，相对整个 hermes 是新增薄层——session 生命周期/流式事件的实际行为需冒烟实证（分析文档为静态分析） | B4 冒烟必做；先跑 acp-smoke 再接真实 LLM |
| R2 | **版本漂移快**：hermes 日历版本（v2026.9.14），ACP 面可能随版本变 | versions.json 钉版 + acp-smoke 进 CI 回归（与 goose/dsh 同治理） |
| R3 | **环境前置**：Python ≥3.11,<3.14 + `pip install -e ".[acp]"` + 至少一个 provider 凭据（hermes 自持认证，凭据不进 fleet） | 部署配方入节点运维手册（Q1b 缺口的延续）；本机尚无 hermes 运行环境（V-H1 待装） |
| R4 | SDK 版本线差异（Python 0.9 vs TS 1.3） | wire 兼容靠 initialize 协商；冒烟即验证 |
| R5 | 权限映射细节：hermes 审批桥的 option 形态 vs 壳权限对话框渲染 | B4 手工单专项巡查 |
| R6 | 模型选择器 UI：数据在标准面但壳 UI 是 goose 扩展驱动 | v1 门控降级（catalog 旗标），增强（读标准 models）作为 F-2 之后的独立小特性 |

## 5. 与既有设计的对齐

- **D7 降级模型**：hermes 成为第二个非 goose 驱动，验证"分流 + 合成 + -32601 软化"的通用性；
- **A2/F-2 catalog**：三驱动能力画像差异极大（goose=扩展超集 / dsh=标准子集 / hermes=标准超集）
  ——**catalog 的必要性被第三次证明**；hermes 条目大部分旗标为 true；
- **F-3**：路径 A 即其首个真实条目（acpx 格式）；F-11/面②：路径 C 是桥的又一消费者；
- **不做**：不改 hermes 上游（消费 `hermes acp` 公开命令面，符合 INTEGRATION 治理）；
  不为 hermes 建 gateway/api_server 集成（用不到消息网关）。

## 6. 建议顺序（lean）

```
现在        不动（D-1 验收 + F-2 catalog 仍是关键路径——见 hub-design-review §8）
F-2 落地后  路径 B spike（1–2 天）：远端 hermes 经桥接入 + 新增驱动条目 + 冒烟/验收单
            → 若通过，hermes 成为舰队新增常驻节点（首个"标准超集"节点；
              与 openclaw 择一先 spike，见 openclaw-driver-design §6）
随 F-3      路径 A：hermes acp 入 stdio 注册表首条（acpx 格式）
桥落地后    路径 C：hermes 作为编排者（零成本），启用 hop 限制
```

## 7. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-15 | 初稿：ACP 面事实基线（源码级）；能力矩阵（hermes=标准超集，D7 最小适用）；三路径（B 远程桥 1–2 天先行 / A 随 F-3 / C 零成本消费面②）；R1–R6 风险与 V-H1 前置；遵 lean 冻结令不新增 roadmap 候选 |
