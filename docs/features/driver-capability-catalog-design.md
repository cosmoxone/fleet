# 特性设计：驱动能力 catalog（F-2，=A2 升格）

> 特性 ID：`FLEET-CATALOG-001` · 状态：**设计 v0.3——已实施 S1–S5（分支 `feature/f2-catalog`，测试 64+705 全绿）**（2026-09-15）
> 目标（roadmap v1.5 F-2 行）：把散落各处的 D7 降级分支收敛为**单一能力事实源**，
> 并同批落地节点命名 slug（`node-naming-spec.md`）。估时 1–2 天（+命名 0.5–1 天）。
> 输入：roadmap §3.1 schema 草案（R3）；`dsh-harness-driver.md` §5.5 D7 矩阵；
> 5B 验收发现（`2026-09-15_5b-acceptance-retrospective.md` P3 → **reconnectPolicy 新需求**）；
> `berd-notes.md` A2（三层门控：静态旗标 + per-call 分支 + 带内兜底）；
> `node-naming-spec.md` v0.1；`fleet-core-service-design.md`（catalog 第四消费方=桥）。

## 1. 问题：D7 降级分支的现状是"手工笛卡尔积"

验收实证（5B/复盘 L3）：每个 UI 入口 × 每个扩展方法都是独立降级面，当前散落在
**8+ 处手编码分支**：

| 位置 | 分支内容 | 来源 |
|---|---|---|
| `acpConnection.ts` openConnection | initialize 按 driver 分流（goose 带 `_meta`，dsh 标准面） | c2 |
| `sessions.ts` sessionList×2 | -32601 → 空列表/空态 | c2 |
| `sessions.ts:256` acpNewSession | 非 goose 跳过 sessionInfo 调用 + 合成 SessionInfo | c2 |
| `ConfigContext.tsx` ×4 catch | config 读失败 → 空配置 | c2 |
| `OnboardingGuard.tsx` | 非 goose 跳过引导 + -32601 放行 | **c4（5B 现场修）** |
| `ChatInput.tsx` | providers/defaults 读失败降级 | c2 |
| `ChatSessionsContainer.tsx:47` | 恢复钩子 restoreSession——**无分支，dsh 必错屏** | **F-2 发现（本次验收）** |
| `fleet.ts` FLEET_DRIVER_OPTIONS | 驱动注册表 app 侧镜像（D3 双落点） | fork 期 |

**问题三连**：① 每加一个驱动（hermes/openclaw 在途）都要人工核对这些面；② 每加一个 UI
入口都要记得问"非 goose 怎么办"（c4 就是忘了问的实例）；③ `FLEET_DRIVER_OPTIONS`
双落点无校验，漂移风险已挂账（D3）。

## 2. 目标与非目标

**目标**：单一 schema 描述每驱动的应用层能力面 → UI 入口**预门控**（渲染前就隐藏/弱化，
而非运行时 -32601 兜底）；现有分支**渐进迁移**（strangler）；同批落地节点 slug。
**非目标**：不实现桥/companion 的消费接线（它们落地时自取）；不改契约 1/2/3 语义；
不做 hermes/openclaw 条目（catalog 落地后**填表即接入**，属各自特性）；UI 文案翻译。

## 3. Schema v1（扩展 roadmap §3.1 草案）

```ts
// core/driver.ts 扩展（全部可选，缺省 = goose 全能——向后兼容）
interface DriverCapabilities {
  protocol: 'acp';
  transports: Array<'http-websocket' | 'stdio'>;
  tlsCertificatePinning: boolean;
  localProvisioning: boolean;
  initializeMeta: 'goose' | 'standard';        // v0.2：显式化 acpConnection 分流依据
  app?: {
    sessionList?: boolean;                      // dsh rc.2: false
    sessionResume?: boolean;                    // dsh rc.2: false
    sessionRename?: boolean;
    onboardingGuard?: boolean;                  // v0.2：c4 的面（dsh: false）
    providers?: boolean;                        // 模型/provider 面板（dsh: false）
    recipes?: boolean;
    schedules?: boolean;
    mcpApps?: boolean;
    steer?: boolean;
    cancel?: 'request' | 'notify-noop';         // dsh rc.2: notify-noop
    reconnectPolicy?: 'resume' | 'fresh-session'; // v0.2 新增（5B 发现 F-2）：goose=resume，dsh=fresh-session
    permissionSurface?: 'acp-standard' | 'silent-policy'; // v0.2：dsh approval.policy=never
    modelLabel?: string;                        // dsh: 'remote (node-configured)'（修 D-2 文案）
    notes?: string[];                           // 降级说明 i18n key
  };
}
```

**与 §3.1 草案的差异（v0.2 自评审产物）**：`initializeMeta`（把 acpConnection 的隐藏依据
显式化）；`onboardingGuard`（c4 的面）；`reconnectPolicy`（验收新需求）；`permissionSurface`
（权限面语义，companion/桥都要用）。命名 slug **不在本 schema**——它是节点级元数据
（`FleetNode.slug?`），与驱动级 catalog 属同一批 schema 变更但不同模型（§6）。

## 4. 数据落点与防漂移（C-D1 的倾向方案）

**约束**：app 不 import core/runtime（快照边界纪律，`fleet.ts:23` 注释明示）；
`versions.json` 先例 = runtime 侧 TS/JSON，app 不直接读。

**方案：单一源 + codegen 镜像 + CI 校验**（D3 双落点的 strangler 正解，F-8 共享包前的过渡）：

```text
runtime/drivers/index.ts（单一源：DRIVERS + DriverCapabilities 常量）
   │ scripts/gen-driver-capabilities.mjs（新增，纯 codegen）
   ▼
app/src/utils/generated/driverCapabilities.ts（生成物，头部标注 DO NOT EDIT）
   ▼
CI job：重跑 codegen → git diff --exit-code（漂移即红）
```

现有 `FLEET_DRIVER_OPTIONS`（`fleet.ts` 手工镜像）改由生成物取代——**手写镜像退出历史**。

## 5. 消费方与 strangler 迁移表

| 消费方 | v1 接线 | 迁移的现有分支 |
|---|---|---|
| ① 桌面 UI 门控 | FleetNodesSection 表单提示、菜单/面板入口按旗标渲染（sessionList/providers/recipes/schedules/mcpApps/steer） | `sessions.ts` sessionList×2 → 预判 false 直接空态（保留 catch 为二道防线）；ChatInput/ConfigContext 同理 |
| ①' 连接与会话 | `acpConnection` initialize 按 `initializeMeta`；`acpNewSession` 合成分支保留（运行时行为，catalog 只供判断） | 分支依据改读 catalog |
| ①'' **重连策略**（v0.2 新增，修验收 F-2） | `ChatSessionsContainer` 恢复钩子：`reconnectPolicy==='fresh-session'` → **静默开新会话**（替代错误屏）；`'resume'` → 现有 restoreSession | 新增分支（这是本特性唯一的**行为修复**） |
| ①''' OnboardingGuard | c4 分支依据改读 `onboardingGuard` 旗标 | 逻辑不变 |
| ② companion `GET /capabilities` | mobile design §6 预留，本特性只保证数据可得 | — |
| ③ A1 新驱动模板 | hermes/openclaw 接入时**填表即接入**（各自特性消费） | — |
| ④ 桥（ORCH-001） | 工具面按 catalog 生成（设计已引用） | — |

**二道防线原则**（berd A2 三层的第三层）：运行时 -32601 软化**全部保留**——catalog 错了
（上游能力变化）时 UI 不崩，只是退化为现状。

## 6. 节点命名 slug 并入（同批 schema 变更，不同模型）

按 `node-naming-spec.md` v0.1：`FleetNode.slug?`（可选，懒派生，老节点零迁移）+
registry 唯一性校验（冲突报错）+ `FLEET_DRIVER_OPTIONS` 表单侧 `--slug` 输入与自动填充。
canonical/acpx 键为纯派生函数（`fleet/<slug>`、`fleet-<slug>`），落 `core/node.ts`。

## 7. 实施计划与判据

| 步 | 内容 | 估时 |
|---|---|---|
| S1 | `core/driver.ts` schema + `runtime/drivers/index.ts` 单一源（goose 全能 + dsh 条目按 §3.1/验收事实填） + 单测 | 0.5 天 |
| S2 | codegen 脚本 + 生成物 + CI 校验 job + 删手写 FLEET_DRIVER_OPTIONS（引用点改生成物） | 0.5 天 |
| S3 | UI 门控迁移（§5 表 ①/①'/①'''，strangler：旗标预门控 + 保留 catch）+ 旗标→入口映射单测 | 0.5 天 |
| S4 | **reconnectPolicy 行为修复**：fresh-session 静默新会话（含 ChatSessionsContainer 改造 + 行为测试：mock 断连→恢复→无错误屏→可对话） | 0.5 天 |
| S5 | 节点 slug（§6）+ node-cli/表单 + 校验单测 | 0.5–1 天 |
| S6 | dsh `acp-contract.json` → dsh 条目转换脚本（可选，v1 手填亦可） | 0.5 天（可后置） |

**完成判据**（对齐 roadmap §3.1 末并扩展）：
1. dsh 节点窗口的模型/Recipes/Schedules/MCP/引导/历史入口**渲染前**即按 catalog 门控（-32601 软化仅作二道防线，日志可证）；
2. **断线重连后 dsh 窗口自动进入新会话，无"加载会话失败"错误屏**（验收 F-2 缺口的回归测试）；
3. D-2 文案修复（`remote (node-configured)`）；
4. `git diff --exit-code` CI 门禁上线；手写驱动镜像删除；
5. slug：重名冲突报错 + 老节点零迁移单测。

## 8. 风险与决策点

| 风险 | 缓解 |
|---|---|
| catalog 与上游真实能力漂移（dsh rc 升级） | versions.json 钉版 + acp-smoke 回归 + 二道防线兜底 |
| codegen 链增加构建复杂度 | 生成物入库（非构建时生成），CI 只做校验——克隆即可用 |
| 过度设计（YAGNI） | v1 只收**已实证面**（本表全部来自 c2-c4/验收事实）；推测性字段不做 |
| S4 会话替换管线的复杂度 | fresh-session 复用"返回首页→新会话"既有路径（createSession + 导航），不发明新机制 |

| # | 决策点 | 倾向 |
|---|---|---|
| C-D1 | 数据落点：codegen 镜像 vs JSON 共享 vs IPC | **codegen + CI**（§4） |
| C-D2 | strangler 范围：v1 迁移哪些分支 | §5 表全部（都是一行依据替换，风险低）；S4 是唯一行为变更 |
| C-D3 | notes 文案 key 进 catalog | 进（i18n key 而非文案本体，翻译仍在 locale 文件） |

## 9. 自评审记录（v0.1 → v0.2）| # | 发现 | 处置 |
|---|---|---|
| R1 | v0.1 schema 漏了 c4 已修的面（onboardingGuard）和 acpConnection 的分流依据（initializeMeta）——**设计输入没吃透自家最近一次修复** | 补两字段（§3） |
| R2 | v0.1 未包含验收 P3 的 reconnectPolicy 需求 | 补字段 + S4 行为修复 + 判据 2 |
| R3 | "slug 进 catalog"表述会混淆节点级/驱动级两个模型 | §3 末尾澄清 + §6 独立成节 |
| R4 | codegen 生成物若只在构建时生成，克隆后不可跑 | 改为生成物入库 + CI 校验（§4、风险表） |
| R5 | 判据缺"回归 F-2 缺口"的测试形态 | 判据 2 明确（mock 断连→恢复→无错屏→可对话） |
| R6 | S4 若发明新会话替换机制会扩大风险面 | 风险表明确复用既有 createSession 路径 |
| R7（v0.3 实施偏差） | §6 原计划 app 表单含 slug 输入——但 app 不能 import core，slug 校验逻辑会二次手工镜像（刚被 S2 消灭的 D3 模式） | **缓行**：node-cli 为 slug 授权面（走 core 全量校验）；app 表单集成等首个消费者（M2-alt 面⑥/桥需要展示 slug 时）再定 codegen 或 IPC 方案 |
| R8（v0.3 实施记录） | S6（acp-contract.json 转换脚本）未做 | 按设计"可后置"执行：dsh 条目手填且已有测试锁定事实 |

## 10. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-09-15 | 初稿（内部，未发布） |
| v0.2 | 2026-09-15 | 自评审后发布：schema 补 initializeMeta/onboardingGuard/reconnectPolicy/permissionSurface；codegen 入库+CI 方案；S1-S6 计划与判据；R1-R6 记录 |
| v0.3 | 2026-09-15 | **实施记录（分支 feature/f2-catalog）**：S1 单一源+校验器（fb534b5）；S2 codegen+CI+手写镜像退场（ca1a9e6）；S4 reconnectPolicy 行为修复=5B F-2 缺口闭环（b7e9354）；S3 路由级预门控+模型栏中性 label（e5698f1）；S5 slug 落地 core/registry/cli（05c14cb）。测试 42→64 / 699→705。偏差：R7 app 表单缓行、R8=S6 后置；**5B-lite 真机点检通过**（2026-09-15 19:31：断线 25s→自动新会话无错误屏、F2-S4-OK 响应、路由空态文案 ✓；chatSessionController 恢复错误日志归零）——随点检合并 main |
