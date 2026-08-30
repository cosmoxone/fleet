# 研究笔记：Block 的 Berd（多 ACP 后端桌面工作台）× fleet 对照

> 研究日期：2026-08-30 · 仓库已克隆至 `/home/pc/proj/research/berd`（main @ `37e706de`）
> 背景：用户提示"思路非常类似，且支持更多 ACP 后端"。结论先行：**架构同源、路线分叉**——berd 验证了我们
> 多后端路线的多个判断（含 D7），并在"本地多 harness 聚合"轴上走得更远；fleet 的差异化在"远程节点编排"轴。
> 本文记录事实与可采纳建议，供 v2 多驱动路线决策参考。

## 1. 元信息

| 项 | 事实 |
|---|---|
| 定位 | Block 出品的开源桌面 Agent 工作台（"desktop agent workspace"），Tauri 2 + React 19 |
| 开发模式 | **小团队闭门开发、公开仓库**：不接受外部 PR（自动关闭），参与方式仅限格式化 issue（CONTRIBUTING 明示） |
| 后端 | goose：`goose-backend.lock.json` 钉 **git commit**（aaif-goose/goose@b9b671c）自建二进制；`GOOSE_BIN` 本地覆盖 |
| 多后端 | 经 **`@agentclientprotocol` 官方 npm 桥**接入 Claude Code / Codex / Copilot / Amp / Cursor（见 §2） |
| 同构细节 | **vendor 了 `@aaif/goose-sdk`（workspace sdk/，与我们 vendor/ 同款）**；`GOOSE_SERVE_URL` 单外部后端 env（≈ 我们的 `GOOSE_EXTERNAL_BACKEND`）；ACP SDK 用 `^0.19.0`（我们是 1.3.0，注意版本线差异） |

## 2. "支持更多 ACP 后端"的真相：单枢纽聚合模式

berd **不是**多驱动并存，而是 **goose serve 作为唯一 ACP WebSocket 端点（枢纽）**，把其它 agent 以 goose provider 身份挂进来：

```text
React/Tauri ── ACP over WS（单连接）──> goose serve（sidecar，pin 自建）
                                            ├─ goose 本体（模型 providers：openai/anthropic/databricks…）
                                            ├─ claude-agent-acp  (@agentclientprotocol/claude-agent-acp 0.66.0)
                                            ├─ codex-acp         (@agentclientprotocol/codex-acp 1.2.0)
                                            ├─ copilot / amp-acp / cursor-agent（doctor crate 安装）
                                            └─ …（pi-acp 已在 catalog 注释中预留）
```

关键机制（代码佐证）：

1. **会话级后端选择**：`session/new` 带 `providerId` + `setProvider(sessionId, providerId)`（`src/shared/api/acp.ts`）——切 agent 不换连接；persona（人设）与 harness 解耦（`sessionExecutionTarget`: `harnessId / modelProviderId / modelId` 三层）。
2. **桥的供应链完全被 berd 托管**：`acp-tools.lock.json`（release 控制的 package.json + **npm 自己的 package-lock 重放**，`npm ci` 解析到钉死图、完整性不符即拒绝；逐 target 校验原生可执行存在后才写 shim 并记 state.json；**启动 reconciler** 自动补齐/升级）；所有安装落在 app 私有目录（`<app-data>/packages`，私有 npm prefix），配套 **managed Node runtime**（`node-runtime.lock.json` 带 sha256）。
3. **桥不装也能用**：`BERD_ACP_TOOLS_DIR` 覆盖目录（开发者模式）；`GOOSE_SERVE_URL` 指向外部 goose（企业场景）。

## 3. 能力门控：我们的 D7 问题，berd 的答案是"catalog 静态旗标 + 按调用分支 + 带内兜底"

这是本次研究对我们**最有直接价值**的部分。berd 同样面对"goose 专有扩展方法 × 非 goose harness"的差异（例证原文：*"External agent harnesses (Claude Code, Codex, ...) ignore that method and expose no system-prompt channel, so we hand the persona off in-band on the first prompt under that agent"*），其解法三层：

| 层 | 做法 | 例子 |
|---|---|---|
| 静态 catalog 旗标 | `curatedProviders.ts` 每后端声明 `supportsInstall / supportsAuth / supportsAuthStatus / supportsModelList / bundledBridge` + `modelSelectionHint` 文案 | amp：`supportsModelList:false` + hint "Use the Amp CLI to configure the model" |
| 按调用分支 | 每个专有调用点判 `isGooseManagedProvider(providerId)`，非 goose 走替代路径 | 系统提示：goose 走 `appendSessionSystemPrompt` 扩展；其它 harness 首轮 prompt **带内移交 persona** |
| 运行时兜底 | 对方 harness "ignore" 未实现方法（ACP 规范忽略未知），不追求硬门控 | — |

对照 fleet D7 v1（运行时 -32601 软化 + 文档矩阵）：**berd 证明 catalog 静态旗标是主流可行解**，且比纯运行时软化 UI 更干净（入口可预先禁用/降文案）。我们已具备升级条件：dsh 的 `acp-contract.json` 本来就是机器可读能力面 → 可并入驱动元数据。

## 4. 其他值得记录的机制

- **berdctl**（app 内置 CLI，供 agent 控制桌面 app）：三层架构——clap CLI / localhost broker（transport-only：host+origin 校验、in-flight 上限、超时）/ renderer 注册表（**zod 严格解析 + 策略，是信任边界**，因任何同用户进程可直 POST broker）。对我们未来"被控端反向操控壳"或 headless 编排有参考。
- **企业分发 seams**：distro overlay（私有 agent/资源/更新渠道/签名）不入公共树；`no-managed-acp-tools` feature 可裁剪桥集合。
- **experiments**：用户级实验开关注册表（dev 默认开、prod 默认关），配 guardrails 与测试要求——我们 zh-CN 菜单那种"渐进上线"场景可直接借鉴。
- **goose 钉法对比**：berd = git commit + 自建（跟 main，需 Rust 工具链）；fleet = 官方 release 二进制 + sha256（发布门控，无需构建）。两者都成立，我们的选择更贴近"消费公开契约"治理。
- 工程化：Biome + design-system tokens（DESIGN.md 是设计令牌文档）、playwright app-e2e、lefthook、renovate。

## 5. fleet ↔ berd 对照

| 维度 | fleet | berd |
|---|---|---|
| 核心问题 | **分布式**：一台壳编排 N 台机器的远程后端 | **单机**：一个桌面聚合本地多 harness |
| 后端拓扑 | 每节点独立 ACP WS 后端（goose serve / dsh 桥），逐窗绑定（lease） | 单连接单枢纽（goose serve），会话级 provider 切换 |
| 驱动抽象 | `core/driver.ts`（ transports: http-websocket/stdio，已为 stdio 留位） | 无显式 driver 抽象（后端差异收敛在 goose 的 provider 机制 + catalog 旗标） |
| 多后端手段 | 驱动注册表（goose + dsh，v2 扩展） | npm 桥挂 goose（Claude/Codex/Copilot/Amp/Cursor） |
| 远程能力 | 节点管理/TLS 钉扎/健康检查/CSP/多窗 | `GOOSE_SERVE_URL` 单外部 URL（无 fleet 化） |
| 能力门控 | D7：运行时 -32601 软化 + 文档矩阵（v1） | catalog 静态旗标 + per-call 分支 + 带内兜底（成熟） |
| 版本治理 | versions.json：release 资产 + sha256 | locks：git commit 自建 / npm lock 重放 / node 运行时 |
| goose-sdk | vendor（同款 @aaif/goose-sdk） | vendor（workspace sdk/） |
| 开放性 | 接受贡献（Apache-2.0） | 不收外部 PR，仅 issue |

## 6. 对 fleet 的可采纳建议（按优先级）

| # | 建议 | 优先级 | 落点 |
|---|---|---|---|
| A1 | **把 `@agentclientprotocol` 官方桥（claude-agent-acp、codex-acp…）列为 v2 本地 stdio 驱动候选**：`core/driver.ts` 的 `transports` 联合类型早已含 `'stdio'`；berd 的桥生态证明这条路有上游维护（ACP 官方组织发包）。与远程节点互补：任一 fleet 节点未来也可挂多 harness | P0（v2 路线输入） | REFACTORING v2 多驱动注册表规划 |
| A2 | **能力门控 catalog 化（D7 v2）**：驱动元数据携带能力面（dsh 已有 `acp-contract.json` 机器可读来源），UI 入口静态禁用/降文案替代（或叠加）运行时 -32601 软化 | P0 | `runtime/drivers/*` 元数据 + app 侧驱动表（D3 双落点）|
| A3 | **npm 桥供应链模式**：未来若做 dsh/桥本地 provision（当前 D4=false），采用"package.json+package-lock 重放 + `npm ci` + 完整性拒绝 + 原生可执行校验 + 启动 reconciler + app 私有目录"，而非裸包管理器安装——我们今天在 `~/.dsh-acp` 踩的全局隔离坑，正是该设计所规避的 | P1 | 若立项 localProvisioning |
| A4 | **带内兜底范式**：无系统提示通道的后端，首轮 prompt 带内移交 persona/指令（berd `acpPersonaHandoff`）——dsh 未来若支持自定义 persona 可用 | P1 | 需求出现时 |
| A5 | experiments 实验开关框架（渐进上线 UI 行为） | P2 | app 设置 |
| A6 | berdctl 三层（transport-only broker + zod 注册表信任边界）——若 fleet 做本地 CLI/被控接口 | P2 | 需求出现时 |
| A7 | app-e2e（playwright）补桌面级冒烟——正是我们当前 5B 人工清单想自动化的那层 | P2 | `.github` |

**明确不建议照搬**：单枢纽模式（放弃我们的远程编排差异化）；git-commit 自建 goose（放弃 release 门控）；闭门贡献模式。

## 7. 注意事项

- berd 桥包版本（claude 0.66 / codex 1.2）迭代快，lock 文件声明"需要 owner 与刷新节奏"——若采纳 A1，fleet 也需承担同类升级节奏。
- ACP SDK 版本线差异（berd 0.19 vs fleet 1.3.0）：桥与壳间只需 ACP wire 兼容，但若直接复用桥 npm 包需确认其对 client 侧 SDK 无强耦合（桥是 agent 侧，天然解耦，风险低）。
- berd 不收 PR：任何借鉴以"重新实现 + 注明灵感来源"为宜。

## 8. 一句话结论

berd 与 fleet 在"一个壳、多个 ACP 后端、vendor goose-sdk、同款 env 覆盖"上高度同源；它把"更多后端"做成了 **goose 枢纽下的本地 npm 桥生态 + catalog 能力旗标**，而 fleet 做的是 **远程节点的驱动化编排**——两条轴不冲突，v2 完全可以"远程驱动（goose/dsh…）+ 本地 stdio 桥驱动（claude/codex…）"并举，berd 的 catalog 门控与供应链锁是当下就能抄的两块好砖。
