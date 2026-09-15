# 参考设计：ACP→MCP 编排桥（agent-native 舰队指挥）

> 特性 ID：`FLEET-ORCH-001` · 状态：**参考设计 v0.3 草案，待评审**（2026-09-15；v0.3 对齐 FLEET-HUB-001——本桥定位为其面②，见 §4bis）
> 触发：用户提出脑洞——"goose CLI 本身如何具备连接多个 ACP 节点的能力，让一个 goose
> 与其他 ACP 节点对话、控制其他节点的 agent"。
> 关联：`docs/planning/fleet-roadmap-v2.md`（建议立项 F-11，F-8 共享包首发候选）；
> `docs/features/dsh-harness-driver.md`（驱动层与能力降级）；`docs/research/berd-notes.md`
>（A6 berdctl 先例、A2 catalog）；`docs/features/mobile-companion-design.md`（权限应答流）；
> `docs/research/orchestration-ecosystem-notes.md`（生态对照与协同方法谱系）；
> harness `openclaw-analysis-2026-09-14.md` §16/§17（node.invoke 流式/三重门/审批绑定先例）；
> `docs/features/fleet-core-service-design.md`（FLEET-HUB-001：本桥 = 其面②）。

## 0. 面定位声明（v0.3，对齐 FLEET-HUB-001）

本桥在 fleet 多前端架构中的位置 = **面②（agent/CLI 消费面）**，双模式运行：
**standalone**（直接 import L0 core/runtime，fleetd 未部署即可用——§10 试点路径不变）
与 **attached**（连接 fleetd 服务，共享会话管理器/权限中枢/事件总线；权限可被桌面/手机代答）。
P7 的最终答案：桥 = fleetd 的 MCP adapter，包仍可独立发布。
> 本文不排期，供 v2 规划决策。

## 1. 技术本质：一次"角色反转"

```text
现状：  人 ──► Electron 壳（ACP client）──► N 个 ACP 节点（goose serve / dsh 桥）
                          ▲ 编排决策 = 人点菜单（core/policy.ts v1 静态绑定）

脑洞：  人 ──► goose agent ──MCP 工具──► 桥（ACP client）──► N 个 ACP 节点
                          ▲ 编排决策 = LLM 按自然语言调度舰队
```

两条关键认知：

1. **ACP 对 client 无"必须是 UI"的要求**。client 职责 = initialize / prompt /
   消费 update 流 / 应答 request_permission——任何进程可担任。
2. **goose 已有消费外部能力的标准口子：extensions（MCP 工具），CLI 与桌面共用**。

结论：不改 goose，而是写一个 **ACP→MCP 桥**——"ACP client 伪装成 MCP server"，
把编排舰队封装成 goose（乃至任何 MCP-capable agent）可调用的工具。

## 2. 路径对比

| 路径 | 做法 | 判定 |
|---|---|---|
| **A：MCP 桥** | 新桥进程（ACP client 包装为 MCP server），goose 以 extension 加载 | ✅ 推荐：零侵入上游，符合 INTEGRATION 治理（不维护 goose 源码） |
| B：改 goose 源码 | fork 加多 ACP 端点概念 | ❌ 违反项目宪法（release 二进制 + 公开契约消费） |
| C：节点包装成 goose provider | 假 OpenAI endpoint 转译 ACP（berd 反向） | ⚠️ 有状态多轮工具协议硬塞无状态补全接口，语义扭曲，不建议 |

注：goose 现有 `GOOSE_SERVE_URL` / provider 机制只能指定**单个**外部后端为 goose 的
运行处（berd 用法），无"多节点逐次对话"概念，不满足本特性目标。

## 3. 目标 / 非目标

**目标**：
1. 任何 MCP-capable agent（goose CLI/桌面、dsh web 内 agent）用自然语言指挥舰队：
   "把任务 X 送到节点 Y"；
2. 复用 fleet 全部节点资产：注册表、驱动（goose/dsh）、健康检查、TLS 钉扎；
3. 权限应答有明确策略且默认保守（deny-first）。

**非目标**：不改 goose/dsh 上游任何代码；v1 不做 UI（纯工具面）；不替代壳的
"人在环"桌面体验（两者并存：人用舰队页，agent 用桥）；v1 不做跨 agent 会话续接
（每节点按驱动能力开新会话或复用池，见 §8 P9）。

## 4. 工作分解（路径 A）

| # | 工作 | 说明 |
|---|---|---|
| W1 | MCP server 骨架 | `@modelcontextprotocol/sdk`；可执行入口（`npx` / goose extension 配置片段） |
| W2 | 内嵌 ACP client | **复用 `runtime/drivers/`**（goose/dsh 驱动：连接、健康检查、TLS 指纹钉扎） |
| W3 | 工具面（见 §5） | `list_nodes` / `node_health` / `dispatch`（+可选会话工具） |
| W4 | 流式与超时 | MCP progress notification 转发 session/update 进度；dispatch 超时语义参照 OpenClaw node.invoke（progress 0-based seq 排序、inactivity 从首个 progress 起算后续重置、hardTimeout 覆盖审批+执行全程、容量/断连错误码映射）；超时→`session/cancel`（dsh cancel=noop → **由 A2 catalog 门控不暴露/降级**） |
| W5 | 权限应答策略引擎 | 桥作为 client 必须应答 `request_permission`：deny-first / allow-list / timeout（dsh `approval.policy` 同思想先例） |
| W6 | 会话池 | dsh 每连接一会话、断连即清 → 多轮需桥持长连接；goose 支持 resume → 差异由 catalog 表达 |
| W7 | 测试与分发 | 复用 acp-smoke + mock ACP（L1 无密钥验证，验证策略 §7 现成先例）；npm 包 |

## 5. 工具面草案（v1）

| 工具 | 入参 | 语义 |
|---|---|---|
| `list_nodes` | — | 节点清单（name/driver/健康），来自注册表 |
| `node_health` | `nodeId` | 复用驱动 `healthCheck`（/status + /acp→406） |
| `dispatch` | `nodeId, prompt, sessionId?` | 新会话（或复用）发 prompt，等 end_turn 聚合返回（dsh `<think>` 内联为已知形态） |
| `continue_session`（可选） | `sessionId, prompt` | 多轮；dsh 节点要求桥持长连接 |
| `cancel_session`（可选） | `sessionId` | 仅对 catalog 标记 `cancel: 'request'` 的节点暴露 |

工具描述文本按 **A2/F-2 能力 catalog** 生成（第四个消费方：桌面 UI、companion、
A1 驱动、本桥）——dsh 的 cancel/resume/历史缺口自动收敛进工具面，不靠运行时 -32601 兜底。

**工具面治理三层**（OC-N2，参照 OpenClaw 三重门）：① catalog 声明（节点能力面）→
② 用户批准面（设置中逐节点/逐命令批准，两步配对语义）→ ③ 运行时 allowlist
（allow/deny 覆盖，**deny 总赢**）。**并发/容量语义**（OC-N4）：dsh 单 in-flight 由
catalog 表达；节点并发满时 dispatch 排队（上限 10s）或立即返回容量错误码，不无限等待。

## 6. 权限应答：双模式

- **standalone**（默认）：策略引擎自主应答（deny-first / allow-list / timeout），
  附审计日志（谁在何时对哪个节点批了什么）；**审批绑定**（OC-N3，防 TOCTOU）：
  allow-list 命中时绑定"工具 + 输入哈希"，批准后锁定参数再转发，调用方事后改字段不生效；
- **attached**（可选）：桥经事件桥连接桌面壳 + 移动 companion——权限请求扇出给
  桌面 UI 与手机（先答先得，同 mobile design §5 挂起队列语义），把"远程权限应答"
  从手机扩展到"编排 agent 发起的会话"。

## 7. 与现有资产的关系（复用矩阵）

| 资产 | 角色 |
|---|---|
| `core/`（node/registry/router/policy） | 节点注册表与解析直接 import（零 Electron 依赖第二次兑现，第一次 = 移动端 O2 headless） |
| `runtime/drivers/` | W2 全部连接逻辑 |
| `runtime/acp-smoke` + mock 先例 | L1 验证路径 |
| A2/F-2 catalog | 工具面生成（第四消费方） |
| 移动端权限应答流 | attached 模式的事件扇出 |
| berd A6（berdctl） | "agent 控制壳"的先例呼应 |

生态位合法性：roadmap-v2 三类合法开发中的 ②内核共享包孵化；**F-8
（`@cosmoxone/*`）最佳首发候选**——比 sidecar 件更小、无 UI 依赖、复用面最纯。
落点建议 `packages/acp-mcp-bridge/`（或先 `runtime/` 侧孵化）。

## 8. 决策点（沿用 P 编号续编）

| # | 决策 | 倾向 |
|---|---|---|
| P7 | 桥形态归属 | fleet 仓共享包起步；是否兼作 dsh 插件形态（生态位①）后续评估 |
| P8 | 权限策略默认值 | **deny-first**（LLM 自主调度扩大 prompt injection 面，保守起步） |
| P9 | 会话语义 | v1 无状态 dispatch（简单），会话池作 v1.1 增量 |
| P10 | 注册表单事实源 | 读 fleet 壳 settings.json vs 独立配置——与移动端 O2 同步问题（D-6②）同构，一并定 |

## 9. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| **递归编排**（goose A → 节点 B（也是 goose 且装桥）→ 环） | hop/深度限制；prompt 注入"你已是第 N 跳"元数据——OpenClaw 因无 Gateway 间联邦而缺环检测（其分析 §17.6），开放生态的桥**必须自带**此防线 |
| **prompt injection 放大**（远端输出进入编排 agent 上下文） | deny-first + 工具白名单 + 审计 |
| secret 持有 | 桥持节点凭据，沿 GENERATED_SECRET 惯例，不进明文配置 |
| 长任务 vs MCP 超时 | 超时→cancel 语义差异由 catalog 兜底 |
| 上游演进（goose 原生 subagent） | 跨厂商 ACP 编排（goose 编排 dsh）预计仍是空白；路径 A 零侵入，不毁约 |
| **远程节点可达性**（SSH/内网） | 现状节点须直连 http(s)；三层出路：`ssh -L` 手册配方（零代码）→ driver `transports` 增 `'ssh'`（ssh2 direct-tcpip 或外呼中继，回环端口物化，`FleetNode` 模型零改动）→ F-3 stdio 驱动 + ssh 命令模板（dsh-acp-demo 原生 stdio，`ssh remote dsh-acp-demo` 天然可行）——对照研究见 `docs/research/nf-board-notes.md`（N1，P0） |

## 10. 试点切片（半天–1 天）

1. 桥进程 + 内置 mock ACP（L1）→ goose CLI 配 extension → 人说"把 X 送到节点 mock"
   → 观察 goose 调 `dispatch` 并复述结果；
2. 换真节点：本地 goose serve + 常驻 dsh 桥 `:3284` → "一个 goose 同时指挥
   goose 节点与 dsh 节点"的最小证明；
3. 通过后按 §8 决策点立项排期（建议 F-11）。

## 11. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-09-14 | 初稿：角色反转本质 / 路径对比 / W1-W7 / 工具面草案 / 双模式权限 / 复用矩阵 / P7-P10 / 风险（含 SSH 可达性注记） |
| v0.2 | 2026-09-14 | 吸收 OpenClaw Nodes 对照（`orchestration-ecosystem-notes.md` v1.1）：§5 工具面治理三层 + 并发容量语义（OC-N2/N4）；§6 审批绑定防 TOCTOU（OC-N3）；§9 递归风险补 OpenClaw 无环检测佐证；关联补 harness 分析文档出处 |
| v0.3 | 2026-09-15 | 对齐 FLEET-HUB-001（`fleet-core-service-design.md`）：新增 §0 面定位声明（桥=面②，standalone/attached 双模式）；P7 落定；试点路径（standalone）不受影响 |
