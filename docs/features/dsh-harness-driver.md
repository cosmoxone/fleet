# 特性设计：接入 DeepSeek Harness（dsh）驱动

> 状态：**已实施（c1/c2/c3 落地，2026-08-30，分支 feature/dsh-driver）**；人工全链路验收（真实 dsh 桥 + agent 对话）待桌面环境执行。
> 服务端（被控端）仓库：`../harness/dsh-dir/dsh-fleet`（下称 dsh-fleet）。
> 依据：dsh-fleet `docs/fleet-ui-driver-advisory.md`（M3 建议稿，已评审）+ `docs/fleet-ui-integration-design.md`（M1/M2/M4 已完成）+ 本仓库代码核对（2026-08-30）。
> v1.1 变更（2026-08-30 review）：D1/D2 用户确认采纳；新增 **D7 能力降级模型**（review 发现 F1：renderer 运行时调用 30+ 个 `goose.*_unstable` 扩展方法，`acpNewSession` 在 session/new 后必调 `goose.sessionInfo_unstable`，对 dsh 是阻断项）；§5/§6/§7 相应扩充。

## 9. 实施记录（2026-08-30）

- **c1** `runtime/drivers/dsh/`（driver + 注册表 + 测试）+ versions.json dsh 条目；`core/node.ts effectiveDriverId` 放宽为 `Pick<FleetNode,'driver'>`；
- **c2** driver 全链路穿透（settings→fleet→lease→main→preload→renderer）；`acpConnection` 按驱动 initialize + 驱动缓存（保持重连微任务时序）；`acpNewSession` dsh 分流 + 合成 SessionInfo（模型标注 `remote (cordis.yml)`）；`session.list`/`configReadAll` -32601 降级；`isMethodNotSupportedError` 工具；**实施中发现**：`session/cancel` 走 `notify`（无响应无 -32601 报错面）→ R8 软化仅剩文档说明；steer 已有 catch 兜底（console.warn + 回退普通提交），无需改动；
- **c3** FleetNodesSection Driver 下拉（Select 组件，即时提交 `commitNodeWith`）+ secret 占位符随驱动切换；i18n 三 locale（extract/compile/check/validate 全过）；节点不可达弹窗按驱动文案；INTEGRATION.md 契约 1（dsh 行 = dsh-fleet M5）+ 契约 3（37 handler，`get-acp-driver`）；README 驱动说明；
- 验证：root `pnpm test` 42✓ + `typecheck`✓；app `typecheck`✓ + `test:run` 72 文件 699✓；dsh 桥冒烟见 §6 记录（acp-smoke 对 acp-ws.mjs + mock stdio）。

## 10. 冒烟记录（2026-08-30，桥修复后）

对 `acp-ws.mjs --token` + mock stdio ACP（agentInfo=deepseek-harness-acp）：

| 检查 | 结果 |
|---|---|
| `GET /status` 错/对 secret | 401 / 200 ✓ |
| `GET /acp?token=` 非升级 | **406** ✓（健康检查语义） |
| `node runtime/acp-smoke/acp-smoke.mjs http://127.0.0.1:<p> <token>` | **SMOKE-OK agent: deepseek-harness-acp protocol: 1** ✓ |
| dsh-fleet `client/demo.mjs --ws`（回归） | ✓ |
| dsh-fleet `npm run verify` | 9/9 全绿 ✓ |

**过程中发现并修复（dsh-fleet 侧）**：桥的 `makeWsTextSink` 行导向等待帧内 `\n`，而标准
ACP-over-WS 客户端（SDK/undici，goose serve 模型）每条消息一整帧、帧尾无换行 → 帧滞留
buffer、initialize 无响应；dsh-fleet 自有客户端因发送 `json+"\n"` 未暴露。已在其仓库
`fix/acp-ws-standard-ws-clients` 分支修复（帧 payload 归一行尾换行），双向客户端验证通过。
**教训**：契约测试必须用与生产同构的标准客户端（这正是 acp-smoke 存在的意义）。

## 1. 背景与结论

fleet 是多 Agent 调度壳，goose 是首个驱动。本特性让壳纳管 **dsh 节点**：每台机器上的
`dsh-acp-demo`（DeepSeek Harness 的 ACP v1 服务器，stdio）经 dsh-fleet 的 **WebSocket 桥
`bridge/acp-ws.mjs`** 暴露为与 `goose serve` **同契约**的面（`/status` + `/acp?token=` + 406 语义 + TLS 指纹）。

**核心结论（dsh-fleet 侧已验证，M1–M4）**：

- 桥已实现并经真实 `dsh-acp-demo@0.1.1-rc.2` 验证：`/status`=200、`/acp` 普通 GET=406、WS 升级后 `initialize`（agentInfo=`deepseek-harness-acp`）与 `session/new` 通过；
- fleet 侧**无需改任何外部契约**：ACP over WebSocket、`?token=`、TLS 指纹钉扎、健康检查语义全部复用；
- 差异点分两层：**传输/契约层**（驱动身份注册、initialize 参数、rc.2 方法面缺口——桥已抹平大部分）；**应用层**（renderer 深度使用 goose 专有扩展方法，dsh 节点窗口需要能力降级，见 D7）——后者是本特性的主要工作量所在（v1.1 review 修正）。

## 2. 事实基线（本仓库代码核对）

| 项 | 现状 | 出处 |
|---|---|---|
| 节点模型 | `FleetNode.driver?` 已存在，`effectiveDriverId()` 默认 `'goose'`；**app 层尚无人消费该字段** | `core/node.ts` |
| 驱动抽象 | `AcpDriver` 最小面（connect/healthCheck/capabilities/provision?）已定型，goose 单实现 | `core/driver.ts`、`runtime/drivers/goose/driver.ts` |
| app 自包含 | app（`@fleet/app`）**不 import core/runtime**（快照哲学）；`utils/fleet.ts` 是 core/node+url 的内部镜像 | `app/package.json`、`app/src/utils/fleet.ts` |
| 连接路径 | main `createChat({backendId})` → `getFleetNodeBackend` → TLS trust（TOFU/钉扎）→ `checkBackendStatus`（`/status` + `/acp`→406）→ `gooseServeLeases.createExternal(wsUrl…)` → renderer `get-acp-url` IPC → `acpConnection.openConnection` | `app/src/main.ts:1068-1210`、`app/src/acp/acpConnection.ts` |
| initialize | renderer 发送 goose 扩展：顶层 `_meta: {'goose/useLoginShellPath'}` + `clientCapabilities._meta.goose`（mcpHostCapabilities/customNotifications/recipeParameterRequests） | `acpConnection.ts:141-160` |
| TLS 指纹 | `normalizeFingerprint` 已支持 `sha256/<base64>` 前缀（桥的输出格式） | `main.ts:343` |
| 健康检查 | 依赖 `/acp` 普通 GET → 406 判定认证通过；桥已精确复刻 | `backendStatus.ts:76-92` |
| CSP | `getFleetCspBackends` 按 externalBackends 生成 connect-src，驱动无关 | `utils/csp.ts` |

## 3. dsh rc.2 能力面（实测，来自 dsh-fleet 契约文档）

- 支持：`initialize`/`authenticate`/`session/new`/`session/prompt`/`session/update`/`session/request_permission`；
- **缺**：`session/list|resume|load|close|fork`、`session/set_config_option`；`mcpServers`/`additionalDirectories` 非空即 reject；
- **`session/cancel` 实测返回 `-32601`**（实现未挂载）→ 壳的取消按钮在 dsh 节点上会报"Method not found"，需软化处理（见 §5.6）；
- 会话生命周期：每连接一个新会话进程，断连即清理 → 壳"每窗口新会话"模型天然匹配；历史会话列表/恢复对 dsh 节点不可用。

### 3.1 renderer 的 goose 扩展面（v1.1 review 新增，F1）

壳（goose UI 快照）在标准 ACP 之上大量使用 **goose 专有扩展方法**（`client.goose.*_unstable`，全库 grep 30+ 调用点）：

| 面 | 方法（节选） | dsh rc.2 结果 |
|---|---|---|
| **会话**（阻断项） | `sessionInfo_unstable`（`acpNewSession` 在 session/new 后**必调**，sessions.ts:251）、`sessionRename/Import/Export/ShareNostr/ConversationTruncate/WorkingDirUpdate_unstable`、`session.load` | -32601 → **首个 dsh 会话创建即失败** |
| 模型/Provider | `providersList_unstable`、`providersConfigSave_unstable` | -32601（语义上也不需要：dsh 模型由远端 cordis.yml 固定） |
| 扩展/MCP | `configExtensionsList_unstable`、`sessionExtensionsAdd/List/Remove_unstable` | -32601；rc.2 `mcpServers` 非空即拒 |
| 计划任务 | `schedules*_unstable`（11 个） | -32601 |
| Recipes | `recipes*_unstable`（7 个） | -32601 |
| Sources | `sourcesList_unstable` | -32601 |

标准面（`initialize/session/new/prompt/update/request_permission/respond_permission/cancel*`）无 goose 依赖，聊天主链路可走通——前提是 D7 摘除 `sessionInfo_unstable` 这个必经调用。

## 4. 设计决策

| # | 决策 | 说明 |
|---|---|---|
| D1 | 驱动 id = **`'dsh'`**，displayName = **`DeepSeek Harness (dsh-acp-demo via acp-ws bridge)`** | 与 advisory/versions.json 建议一致；`deepseek-harness` 全名太长，留作 displayName |
| D2 | **initialize 参数按驱动自适应**：driver=dsh 时不发 goose `_meta` 扩展（顶层与 clientCapabilities 内） | dsh-acp 用 zod 校验，虽然按 ACP 规范应忽略未知字段，但 rc.2 未经我们参数组合实测；驱动自适应最稳，且为未来驱动立范式 |
| D3 | 驱动清单**双落点**：`runtime/drivers/`（core 面契约实现+注册表）与 `app/src/utils/fleet.ts`（UI 下拉静态表） | app 不依赖 core（快照边界），镜像与 `validateFleetNode` 现状一致；在两处注明互为镜像 |
| D4 | dsh 驱动 **不实现 `provision`**（`localProvisioning: false`） | dsh 节点由 dsh-fleet 部署系统（脚本/容器）提供；本地起桥属于部署工具职责 |
| D5 | `driver` 字段对老节点缺省 = goose，**零迁移** | `effectiveDriverId` 语义保持 |
| D6 | versions.json 新增 `drivers.dsh` 条目（无 assets，npm 包 + 桥为来源） | schema 2 允许按驱动差异字段（goose 有 assets，dsh 有 npmPackage）；fetch-goose.ts 只读 `drivers.goose`（内联类型断言，多余键无害），c1 加回归确认 |
| **D7** | **能力降级模型（v1.1 新增）**：① `acpNewSession` 按驱动分流——dsh 路径不调 `goose.sessionInfo_unstable`，用 initialize + session/new 响应合成最小 SessionInfo（标题=首条用户消息，模型标注"remote (cordis.yml)"）；② `session/new` 的 `_meta`（client/enabledExtensions/recipe*）对 dsh 省略；③ 其余 `goose.*` 调用点统一 -32601 软化（见 §5.5 矩阵）；④ 完整 per-feature 门控（隐藏菜单/面板）推迟到后续版本，v1 只保证"不崩溃、有解释" | dsh 模型语义上就该远端固定；会话恢复 rc.2 无面；v1 以最小改动打通"开窗即聊"主链路 |

## 5. 改动清单（按文件）

### 5.1 core / runtime（契约层）

1. **新增 `runtime/drivers/dsh/driver.ts`**：`dshDriver: AcpDriver`
   - `capabilities()`: `{ protocol:'acp', transports:['http-websocket'], tlsCertificatePinning:true, localProvisioning:false }`；
   - `connect/healthCheck` 与 gooseDriver 同构（同 SDK + `acpWebSocketUrlFromHttpBase`），initialize 用 `clientCapabilities: {}`（不带 goose 扩展），`PROTOCOL_VERSION`（整数 1）；
2. **新增 `runtime/drivers/index.ts`**（驱动注册表）：`DRIVERS: Record<string, AcpDriver>`（goose + dsh）、`resolveDriver(id)`、`listDriverOptions()`；
3. **新增 `runtime/drivers/dsh/driver.test.ts`**：能力面断言 + 离线节点 healthCheck 不抛（仿 goose driver.test.ts）；
4. **`runtime/versions.json`**：`drivers.dsh = { protocol:'acp-over-websocket', npmPackage:'@deepseek-ai/dsh-acp-demo', validatedVersion:'0.1.1-rc.2', bridge:'dsh-fleet bridge/acp-ws.mjs (goose-serve-compatible contract)', notes: 无二进制资产 }`。

### 5.2 app 设置模型与穿透（main 进程）

5. **`app/src/utils/settings.ts`**：`FleetNodeConfig` += `driver?: string`；
6. **`app/src/utils/fleet.ts`**：
   - `ExternalBackend` += `driver?: string`；`getFleetNodeBackend` 透传；
   - 新增 `FLEET_DRIVER_OPTIONS = [{id:'goose',…},{id:'dsh',…}]`（镜像 runtime/drivers，D3）+ `effectiveDriver` 助手（默认 goose）；
7. **`app/src/gooseServeLeaseRegistry.ts`**：`GooseServeLease` += `driver?: string`；`createExternal(..., driver?)` 记录；
8. **`app/src/main.ts`**：`createExternal(..., effectiveDriver(externalBackend))`；新增 IPC `get-acp-driver`（按 windowId 返回 lease.driver ?? 'goose'）；
9. **`app/src/preload.ts`**：暴露 `getAcpDriver(): Promise<string>`（内部契约 3 清单 +1，自检清单同步 INTEGRATION.md）。

### 5.3 renderer 连接自适应

10. **`app/src/acp/acpConnection.ts`**：`openConnection` 并行取 `getAcpUrl()` + `getAcpDriver()`；driver !== 'goose' 时 initialize 参数去掉两处 `_meta`（保留 `clientCapabilities: { elicitation: { form: {} } }` 标准面与 clientInfo）。
11. **`app/src/acp/sessions.ts`**（D7①）：`acpNewSession`/`acpLoadSession` 按驱动分流——dsh 路径省略 `_meta`、不调 `goose.sessionInfo_unstable`，合成最小 `SessionInfo`；会话列表/恢复入口对 dsh 窗口返回空集（不调远端）。

### 5.4 UI（设置页）

11. **`FleetNodesSection.tsx`**：节点卡片新增 **Driver 下拉**（goose | DeepSeek Harness，默认 goose），写回 `node.driver`；SecretKey 占位符按驱动切换（goose: `GOOSE_SERVER__SECRET_KEY on the node`；dsh: `acp-ws bridge --token`）；描述文案去 goose 专属化（"Remote ACP backends…"）；
12. **i18n**：`app/src/i18n/messages/{en,zh-CN,zh-TW}.json` 新增 `fleetNodesSection.driver` 等消息（跑 `i18n-compile.js`，遵守 locale 子集纪律）。

### 5.5 能力降级与软化（rc.2 缺口 + goose 扩展面，D7）

13. **`session/cancel` 软化**：定位 renderer 取消调用点（chatSessionController），捕获 `-32601` 时按"已取消/尽力而为"处理并 toast 说明（dsh rc.2 无 cancel），不报硬错误。
14. **`goose.*_unstable` 统一软化**：在 acp client 层（gooseAcpClient/sessions/providers 等调用点）增加驱动感知的错误映射——dsh 窗口上 -32601 → "此节点后端（DeepSeek Harness）不支持该功能"，而非未处理异常。v1 降级矩阵：

| UI 面 | dsh 节点 v1 表现 |
|---|---|
| 聊天主链路（prompt/update/权限/elicitation） | ✅ 完整可用 |
| 模型/Provider 选择 | 占位显示"由远端 cordis.yml 配置"；设置面板不弹错 |
| 会话历史/恢复/重命名/分享/导入导出/截断 | 入口禁用或空态 + 说明 |
| Recipes、Schedules、Extensions/MCP、Sources | 入口禁用 + 说明（-32601 软化兜底） |
| 取消响应 | 尽力而为（R8） |

### 5.6 文档与契约治理

15. **`INTEGRATION.md`**：契约 1 补 dsh 行（经 dsh-fleet `acp-ws.mjs` 提供同契约；版本矩阵见 versions.json）——即 dsh-fleet 设计文档的 **M5**；契约 3 IPC 清单补 `get-acp-driver`；
16. **`README.md`**：一句话说明节点可为 goose 或 DeepSeek Harness（dsh，经 WS 桥）；
17. **main.ts 错误弹窗文案**（F3）：节点不可达弹窗 detail 去掉写死的 `GOOSE_SERVER__SECRET_KEY` 措辞，按驱动给出（goose：secret key；dsh：bridge token）；
18. **类型镜像同步**（F4）：`window.electron` 若在 renderer 侧另有全局声明（d.ts），`getAcpDriver` 一并补齐；
19. **本文档**（docs/features/dsh-harness-driver.md）随实施更新状态。

## 6. 测试与验收

| 层 | 内容 |
|---|---|
| core/runtime 单测 | `pnpm test`：dsh driver.test.ts（能力面 + 离线 healthCheck）+ 注册表解析测试全绿；**versions.json 加 dsh 后 fetch-goose.ts 回归**（F5，可仅类型/解析级） |
| app 单测 | `utils/fleet`（driver 透传/默认值）、`FleetNodesSection`（下拉写回）、`acpConnection`（按驱动初始化参数——mock electron API）、**`acpNewSession` dsh 分流（不调 sessionInfo_unstable、合成 SessionInfo）**；`pnpm --filter @fleet/app test:run` |
| 契约冒烟 | `node runtime/acp-smoke/acp-smoke.mjs http://127.0.0.1:3284 <token>` 对 dsh-fleet 桥 → `SMOKE-OK agent: deepseek-harness-acp`（脚本协议无关，无需改） |
| 人工全链路 | dsh-fleet 起 `acp-ws.mjs`（--token，可选 --tls）→ 壳添加 dsh 节点（url/secret/指纹）→ 健康检查绿 → `New Chat on Node…` → 与 dsh agent 对话（含工具调用与权限应答）→ 断线重连；**dsh 窗口上打开设置/模型面板不崩溃、显示降级说明** |
| 回归 | goose 节点（缺省 driver）全链路不回归（含 sessionInfo/providers 等扩展调用）；zh-CN 菜单/设置文案检查（retrospective 教训） |

验收清单对齐 advisory §5 + dsh-fleet 设计文档 §6，另加：无 token/密钥进入日志与诊断。

## 7. 风险与开放问题

| # | 风险 | 缓解 |
|---|---|---|
| **F1 遗留** | dsh 分流路径漏掉某个 goose 扩展调用点（30+ 处），导致 dsh 窗口局部报错 | D7③ 统一 -32601 软化兜底（宁降级不崩溃）+ 人工全链路验收含设置面板巡查；后续版本做 per-feature 门控 |
| R3' | dsh-acp 对 goose `_meta` 的实际容忍度未实测 | D2 驱动自适应后不发送（initialize + session/new 两处），风险消除；冒烟覆盖 |
| R8 | `session/cancel` -32601 | §5.5 软化 + 文档明示 rc.2 限制 |
| 会话恢复 | dsh 无 session/list/resume，壳的会话历史 UI 对 dsh 节点不可用 | v1 文档明示（窗口级新会话模型可用）；rc.3/master 面补齐后跟进 |
| 合成 SessionInfo | dsh 路径合成的会话元数据（标题/模型）可能下游消费不全（如 model_config 显示） | c2 单测 + 人工验收；下游消费 SessionInfo 的面在分流时逐一核对 |
| 桥单点 | WS 桥是 dsh-fleet 维护的第三方面 | 契约测试 + versions.json 记录 validatedVersion；桥契约漂移由 acp-smoke 暴露 |
| locale | 新增消息需三 locale 齐 | i18n-check.js 已有校验 |

## 8. 实施顺序（建议 3 个 PR/commit）

1. **c1 契约层**：runtime/drivers/dsh + 注册表 + versions.json + 单测 + fetch-goose 回归（§5.1）——纯增量，零 app 影响；
2. **c2 壳穿透与会话分流**：settings/utils/lease/main/preload/acpConnection 自适应 + **acpNewSession dsh 分流 + 统一 -32601 软化** + 单测（§5.2–5.3、§5.5 部分）；
3. **c3 UI + 文档**：FleetNodesSection + i18n + 弹窗文案 + INTEGRATION/README（§5.4、§5.6）+ 冒烟记录。
