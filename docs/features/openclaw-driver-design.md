# 技术方案分析：接入 OpenClaw 节点

> 特性 ID：`FLEET-OPENCLAW-001` · 状态：**参考分析 v1.1，待评审**（2026-09-15）
> 输入：harness `openclaw-analysis-2026-09-14.md`（§16/§17）+ 源码抽查（`src/cli/acp-cli.ts`、
> `src/acp/` ~50 文件、`packages/acp-core/`）；harness `omnigent/docs/openclaw.md`
> （**端到端已验证的接入配方**，用户指路）；本仓 hermes-driver-design 同构对照。
> 精益声明：遵 `2026-09-15_hub-design-review.md` E1 冻结令——不新增 roadmap 候选，挂靠
> 既有 F-2/F-3 轨道。此前 `remote-node-notes §3-D` / `ecosystem-notes §2.2` 已预告
> OpenClaw 驱动接入，本文给出可执行方案。

## 1. 事实基线：`openclaw acp` 的 ACP 面（源码级）

| 项 | 事实 | 出处 |
|---|---|---|
| 命令 | `openclaw acp` = "**ACP bridge backed by the Gateway**"：stdio ACP server → `GatewayClient`（WS）→ Gateway。另有 `openclaw acp client`（交互式 ACP 客户端，冒烟利器） | `src/cli/acp-cli.ts`、`src/acp/server.ts` |
| 认证 | `--url <gateway-ws>` + `--token/--token-file/--password(-file)`；omnigent 文档强调 **token-file + 最小权限** | acp-cli.ts、secret-file.ts |
| 会话绑定 | **`--session <key>`（如 `agent:main:main`）/ `--session-label`**——ACP 会话映射到 **Gateway 持久会话键**（OpenClaw 的会话是常驻个人助理会话，非逐连接临时） | acp-cli.ts、persistent-bindings.* |
| 会话生命周期 | **齐全**：translator.session-list / session-lifecycle / **replay** / persistent-bindings（断线重绑）均有实现与测试 | `src/acp/translator.*` |
| 流式/取消 | ✓（omnigent 端到端验证：init/session/prompt/**cancel/流式回复/worktree/原生工具执行**） | omnigent docs/openclaw.md |
| 权限 | ✓ `permission-relay` + `approval-classifier`——审批经 ACP 走（非 OpenClaw chat） | src/acp/ |
| mcpServers | **✗ 拒绝 per-session MCP**（omnigent 明示 `omnigent_mcp: false` 强制）——同 dsh | omnigent docs |
| models 暴露 | **未见** model_catalog 等价物（Gateway 有 models 配置但 ACP 面未暴露）→ catalog 记 false，模型标注 `gateway (node-configured)` | 源码扫描（待冒烟确认 V-OC2） |
| 额外面 | provenance 模式（off/meta/meta+receipt）、event-ledger（SQLite）、session modes | src/acp/ |
| SDK | `@agentclientprotocol/sdk`（**与 fleet 同一 TS SDK 家族**） | server.ts imports |

## 2. 能力矩阵：舰队第四种节点画像

| 能力 | goose | dsh | hermes | **openclaw** |
|---|---|---|---|---|
| 核心会话/流式/取消 | ✓ | ✓ | ✓ | ✓（已验证） |
| session list/resume/replay | ✓(扩展) | ✗ | ✓(标准) | **✓（含断线重绑）** |
| 权限应答 | ✓ | 静默 | ✓四档 | **✓（relay+分类器）** |
| 模型选择 | ✓(扩展) | ✗ | ✓(标准字段) | **✗（待确认）** |
| mcpServers | ✓ | 拒绝 | ✓ | **拒绝** |
| goose 扩展 | ✓ | ✗ | ✗ | **✗ → D7 非 goose 分支复用** |
| 节点人格 | 工作型 agent | 受限 harness | 学习型/自足工具 | **常驻个人助理**（channels/memory/routing 在节点侧） |

**定位价值**：接入后 fleet 舰队覆盖四种互补画像——goose（工作）、dsh（受限沙箱）、
hermes（学习/超集）、openclaw（个人助理+多通道在场）。A2 catalog 第四个真实条目。

## 3. 三条接入路径（与 hermes 同构）

### 路径 B（推荐先行）：远程 WS 节点——桥包 `openclaw acp`

```bash
# Gateway 所在远端机器（或任何可达 Gateway 的机器）
node acp-ws.mjs --port 3286 --token <secret> \
  --cmd "openclaw acp --url <gateway-ws> --token-file /path/token"
```

拓扑（"hub over a hub"，omnigent 原语）：
`fleet ─WS(契约1)→ acp-ws 桥 ─stdio→ openclaw acp ─WS→ Gateway(记忆/路由/通道)`。

**归属与链路简化（v1.1 补）**：`openclaw acp` 是 **OpenClaw 官方组件**（上游自带，
`src/cli/acp-cli.ts`，仅 stdio、无 WS 传输选项）；acp-ws 桥是 dsh-fleet 的通用件。
三跳中每跳都简单可靠，但进程链长（桥 + acp 桥 + Gateway 三进程常驻）。更简洁的形态：
1. **F-3 落地后（推荐终态）**：fleet 经 stdio 驱动直接 spawn `openclaw acp`，链路降为
   两跳（`fleet ─stdio→ openclaw acp ─WS→ Gateway`）——stdio 是最可靠传输（无端口、
   无额外鉴权层），Gateway WS 经 Tailscale/`ssh -L` 直达即可。**前置：fleet 宿主机需
   安装 openclaw CLI 并持 Gateway 凭据（token-file）**；
2. **上游反馈（远期，一跳终态）**：请求 OpenClaw Gateway 原生 ACP-over-WS 模式
   （现仅 stdio）——若实现，openclaw 即成为契约 1 的天然一跳节点；
3. 现状三跳仅作 **F-3 落地前的过渡验证拓扑**，不作为长期形态。

fleet 侧工作（**1–2 天**，c1–c3 模式）：

| # | 工作 | 复用 |
|---|---|---|
| B1 | `runtime/drivers/openclaw/` + versions.json（钉 openclaw v2026.9.x） | c1 |
| B2 | app `FLEET_DRIVER_OPTIONS` 镜像 + i18n 三 locale（D3 双落点） | c3 |
| B3 | `acpNewSession` 走非 goose 分支（合成 SessionInfo）；模型标注 `gateway (node-configured)` | c2 分流复用 |
| B4 | 冒烟：`openclaw acp client` 自测 + acp-smoke 经桥；手工验收单（重点 §4-V-OC1） | acp-smoke 现成 |

### 路径 A：本地 stdio 节点——随 F-3

`{ command: "openclaw", args: ["acp", "--url", ..., "--token-file", ...] }` 即 acpx 格式
条目（本地 Gateway 场景）。同 hermes：不单独排期，作 F-3 验证对象。

### 路径 C：OpenClaw 作为编排者——零成本消费面②

OpenClaw 原生消费 MCP server → 加载 FLEET-ORCH-001 桥即可指挥舰队；其 Nodes 子系统的
三重门（OC-N2）与桥的治理三层（v0.2）语义同族，互操作故事自洽。hop 限制同样必须启用。

## 4. 风险与待核实（比 hermes 多一条关键项）

| # | 项 | 处置 |
|---|---|---|
| **V-OC1（关键）** | **多窗会话键策略**：`--session` 是桥进程级默认键（`agent:main:main`）——若 WS 桥每连接 spawn 一个 `openclaw acp`（dsh 桥语义），多个 fleet 窗口会各自连接但**默认落到同一 Gateway 会话键**，对话交错（共享助理语义）；需核实 translator 是否按 ACP 会话派生键（session-lifecycle/persistent-bindings 暗示有映射，但未见多会话键派生证据） | spike 第一验证项；若不支持派生 → v1 约束"openclaw 节点单窗使用"（与 dsh 单 in-flight 同级门控），或桥 `--session` 按连接注入唯一键 |
| V-OC2 | models 是否经 ACP 暴露（源码未见） | 冒烟确认，catalog 相应置位 |
| R1 | 日历版本漂移（v2026.9.4）+ 上游迭代快 | versions.json 钉版 + acp-smoke 进 CI |
| R2 | mcpServers 拒绝 | 壳今天不发 → 无冲突；catalog 记 false 防未来误发 |
| R3 | Control UI 双向不同步（omnigent 已知限制） | 对 fleet 无影响（fleet 是唯一客户端视角）；文档记录 |
| R4 | token 最小权限 | 部署配方入节点运维手册（token-file + 最小权限，沿 omnigent CAUTION） |

## 5. 与既有设计的对齐

- **D7**：非 goose 驱动 +1（goose 扩展缺失，其余超集）——分流/合成/软化又一次复用；
- **A2/F-2**：catalog 真实条目 #4，画像差异表（§2）即 catalog 数据源；
- **F-3**：路径 A 即 acpx 格式条目；F-11/面②：路径 C 消费者+1；
- **治理**：消费 `openclaw acp` 公开命令面，零上游改动（INTEGRATION 合规）。

## 6. 建议顺序（lean）

```
现在      D-1 验收 + F-2 catalog（关键路径不变）
F-2 后    视需求在 hermes(B) / openclaw(B) 中**先做一个**（都是 1–2 天 c1-c3 模式；
          openclaw 多 V-OC1 会话键核实，hermes 多环境前置 V-H1——择一 spike）
随 F-3    路径 A（stdio 条目）；桥落地后路径 C
```

## 7. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-15 | 初稿：`openclaw acp` 事实基线（源码级）；能力矩阵（第四画像：常驻个人助理）；三路径同构 hermes；V-OC1 多窗会话键策略为关键待核实项；lean 顺序（与 hermes 择一先 spike） |
| v1.1 | 2026-09-15 | 路径 B 补"归属与链路简化"：openclaw acp=官方组件仅 stdio；F-3 后两跳为推荐终态、上游 WS 模式为一跳终态、三跳仅为过渡验证拓扑 |
