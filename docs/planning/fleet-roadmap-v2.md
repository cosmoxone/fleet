# fleet 壳 v2 特性规划（对齐统一客户端设计）

> 文档：`docs/planning/fleet-roadmap-v2.md` · **v1.2**（2026-09-14 增补：nf-board 引用 + F-11 候选；v1.1 = 2026-08-30 19:09 review 细化版）
> 输入依据：dsh-fleet `docs/unified-client.md` **v2.4**（权威）、`docs/roadmap.md` v1.1（4.7/4.8/0.9）；
> wb-knowledge `docs/requirements.md` v2.7（FR-39/40/41）、`docs/architecture.md` v1.9（§6/§7）、
> `docs/strategy-plain.md` v1.4；本仓既有决策清单 `docs/progress/2026-08-30_1738-*.md` §4（D-1~D-8）。
> 本文回答：**在生态规划下，fleet 仓后续开发什么、按什么顺序、守什么纪律。**
>
> v1.1 review 修正（R1-R12，全部已落入正文）：R1 F-6 外部包依赖补降级路径 + F-5 增设 S0；
> R2 新增 §4 本地运行时注册模型（P5）；R3 F-2 补 schema 草案与消费方；R4 F-5 补代码落点/安全子项/
> 两层估时；R5 新增 §5 需求追溯矩阵；R6 新增 §6 "本仓不做"清单（含 wb 插件连云 token 归属）；
> R7 估时口径修正（Day-1 冒烟 vs CU0 完整验收）；R8 F-10 移植口径澄清；R9 新增 §7 验证策略（L0/L1）
> 与 P6 埋点决策；R10 决策点补 if-then 分支；R11 新增 §9 里程碑周历；R12 版本化。

---

## 1. 生态位定案与 fleet 壳的角色（两仓文档提炼）

```
引流层(全开源):① dsh 插件族(裸 dsh web 可装) ② fleet 壳(个人多机) ③ OW 薄 fork(组织)
转化层(闭源):cosmoxwork(唯一商业转化面;消费 cloudagent)
共享内核:sidecar 管理/进程/嵌入/更新器/ACP 驱动层 → 下沉 @cosmoxone/* 共享包
```

| 对 fleet 壳的定位 | 出处 |
|---|---|
| fleet 壳 = **自持开源入口壳**（唯一）；cosmoxwork 的**毛坯/开源底座**（"源自"） | wb FR-41 v2.0；strategy-plain v1.4 |
| 驾驶舱三件套：**工作台页**（WebView 嵌 dsh web）+ **舰队页**（fleet 本行）+ **账户面**（Pro 闭环，闭源装修层） | FR-41；unified-client §2 |
| **舰队页是"唯一必须原生的"页面**，由 fleet 侧供给；其余 UI 留在 dsh web 生态（插件不重实现） | unified-client §10.2 双工作面纪律 |
| 双工作面分工：壳原生只做"跨机与商业面"；单机会话/插件 UI 全在 dsh web | unified-client §1 洞察② |
| 内核共享纪律：**新苦活只写进共享包，禁止壳间抄代码**；差异缩到品牌层 | unified-client §8.4 收敛三阶段 |
| 资源五级：插件/管道=主投入；**cosmoxwork=唯一新功能点**；共享包=顺带；**fleet 壳=维护模式（新特性月占比 ≤10%）**；OW 壳层最低 | unified-client §8.5 |
| sidecar dsh = 总控 = 本地工作台 = 舰队**节点零号**（一个进程三身份） | unified-client §1 洞察① |
| CU0 spike：**目标壳=cosmoxwork，两仓共享协议，任一仓先跑通回写** | roadmap 4.7（S1-S6，互审 O2） |
| 分发基建（签名/公证/更新器/HarnessRuntime/手机桥按需）= CU2 前置，**从 dsh-desktop 移植**（MIT） | roadmap 4.8；unified-client §9 |

> 事实注脚：① 本仓 Electron **43.3.0**（app/package.json），`WebContentsView` 可用（22+），S1 无版本障碍；
> ② 手机桥行数：上游文档记 938，本仓实 clone 计 1117（`lan-mobile-bridge.ts`），以实测为准——上游数字是旧快照。

**一句话**：fleet 仓 = **舰队页供给方 + 内核共享包孵化器 + 骨架验证场**；装修（账户/计费/品牌）不在此发生。

## 2. 与既有决策清单（D-1~D-8）的调和

| 原决策 | 生态语境下的修正 |
|---|---|
| D-1 dsh 验收合并 | 不变，仍是一切前置（roadmap Phase 0 同构的"决策门 G0"思想） |
| D-3 A2 能力 catalog 化 | **升格**：从"app 门控优化"→"舰队页的驱动能力面内核"；按 §8.4 定性为**共享包方向**（先仓内落地，触碰即下沉） |
| D-4 A1 stdio 桥驱动 | 同为**驱动层内核**（fleet 仓先验证，两壳皆可消费）；spike 结论将决定发包形态 |
| D-5 移动端 M1-M3 | 与 CU2"手机桥按需"**对齐时点**；dsh-desktop 手机桥为 MIT 可移植件——M1 可加速（口径见 F-10） |
| D-7 A3-A7 | A3（供应链锁）在"本地 provision/桥安装"时采用 berd 模式（acp-tools.lock 式 lock 重放），与共享包治理合并考虑；A7（playwright app-e2e）并入 §7 验证策略 |
| D-8 cordis drift 反馈 | 不变；**追加** wb FR-39 残留（"基座=dsh-desktop"与 FR-41/unified-client v2.4 冲突）一并反馈 |

**张力说明**：§8.5 的"fleet 壳不做新特性"与本仓规划不冲突——本仓新开发定性为三类：①舰队页本职（两壳共享的唯一原生面）；②内核共享包孵化（优先级 3"顺带做"的载体）；③骨架验证（CU0 spike 可由本仓承担，产出回写共享协议）。纯"装修类"功能不做（负面清单见 §6）。

## 3. 特性路线图（三轨）

### 轨道 ①：舰队页本职（fleet 本行，最高优先）

| # | 特性 | 内容 | 状态/估时 | 完成判据 |
|---|---|---|---|---|
| F-1 | dsh 驱动合并 | 5B 验收 → §6 合并 | **待人工（D-1）** | 交接单 5B 全勾 + main 合并 |
| F-2 | **驱动能力 catalog**（=A2 升格） | 设计文档 **v0.2 已自评审**（`docs/features/driver-capability-catalog-design.md`，FLEET-CATALOG-001：schema 含 reconnectPolicy/onboardingGuard、codegen+CI 防漂移、S1-S6）；含节点命名 slug（`node-naming-spec.md`）；§3.1 为其输入草案 | 设计完成；实施 1–2 天（+命名 0.5–1 天） | 判据见设计文档 §7（含：断线重连 dsh 自动新会话无错误屏=验收 F-2 缺口回归） |
| F-3 | **本地 stdio 桥驱动**（=A1） | 接 @agentclientprotocol 官方桥（codex/claude）；**spike 范围含远程传输评估**（`'ssh'` transport / ssh 命令模板 / 隧道回环物化，`docs/research/nf-board-notes.md` N1）；stdio 注册表格式参照/兼容 OpenClaw acpx（转换器隔离，`docs/research/remote-node-operation-notes.md` §3） | F-2 后 spike 1–2 天 | spike：stdio driver + acp-smoke 直连桥进程跑通一个真实 agent 会话 |
| F-4 | 快照刷新治理 | 定期刷 goose ui/desktop 快照（INTEGRATION 既有流程）；插件兼容验证纳入回归 | 例行（每次快照刷新 +0.5 天回归） | 快照刷新 PR 含 fleet-nodes/wb 插件兼容验证清单 |
| F-11 | **ACP→MCP 编排桥**（候选，v1.2 新增） | agent-native 舰队指挥：任何 MCP agent 经桥 dispatch 节点（复用 core/runtime；A2 catalog 第四消费方；F-8 首发包候选） | 参考设计 v0.3 待评审（`docs/features/acp-mcp-bridge-design.md`：P7 已落定=桥为 FLEET-HUB-001 面②；P8–P10 待评审） | 试点切片 0.5–1 天，判据见设计文档 §10 |

#### 3.1 F-2 schema 草案（R3）

```ts
// core/driver.ts 扩展（向后兼容：全部可选，缺省 = goose 全能）
interface DriverCapabilities {
  protocol: 'acp';
  transports: Array<'http-websocket' | 'stdio'>;
  tlsCertificatePinning: boolean;
  localProvisioning: boolean;
  // ── 应用层能力面（v2 新增，来源：dsh acp-contract.json / goose 实测面）──
  app?: {
    sessionList?: boolean;        // dsh rc.2: false
    sessionResume?: boolean;      // dsh rc.2: false
    sessionRename?: boolean;
    providers?: boolean;          // 模型/provider 面板
    recipes?: boolean;
    schedules?: boolean;
    mcpApps?: boolean;
    steer?: boolean;
    cancel?: 'request' | 'notify-noop';  // dsh rc.2: notify-noop（UI 隐藏/弱化）
    modelLabel?: string;          // dsh: 'remote (node-configured)'——顺带修 D-2 文案
    notes?: string[];             // 降级说明文案 key（i18n）
  };
}
```

**三个消费方**：① 桌面 UI 入口门控（FleetNodesSection/菜单/面板按旗标渲染）；② companion
`GET /capabilities`（移动端设计 §6）；③ A1 新驱动接入模板（填表即接入）。
**数据源**：dsh `docs/acp-contract.json`（机器可读方法面）→ 转换脚本生成 dsh 条目；goose 全 true 手工核对。
**完成判据**：dsh 节点窗口的模型/Recipes/Schedules/MCP 入口按 catalog 预门控（不再靠 -32601 运行时软化兜底——保留为二道防线）；文案 D-2 修复；单测覆盖旗标→入口映射。

### 轨道 ②：统一前端骨架（CU0-CU1，本仓承担 spike 与内核）

#### 3.2 F-5 CU0 工作台页骨架（S0-S6 细化，R1/R4/R7）

| 步 | 内容 | 本仓落点 | 完成判据 |
|---|---|---|---|
| **S0**（v1.1 新增） | **最小 sidecar 拉起**：spawn `dsh web --port <预选> --host 127.0.0.1 --no-open`（rc.2 flag 实测，不支持则随机端口+日志提取）；生命周期（启动/退出/清理/健康） | 新 `app/src/sidecar/`（对齐 wb RuntimeSnapshot 契约语义，**不依赖未发布的 @wb/dsh-sidecar-host**——包可用后替换，见 F-6） | 壳内一键起/停 sidecar，崩溃可重启，日志可诊断 |
| S1 | WebContentsView 加载 sidecar dsh web | `main.ts`（Electron 43 ✓）+ 窗口布局（工作台页=主窗内 view 或独立窗，随 P1 定） | dsh web 完整可用（含插件 UI），无降级 |
| S2 | token→cookie：stdout/harness.log 提取 → `session.cookies.set` | sidecar 模块 + view session | dsh web 免登录态进入 |
| S3 | profile/DSH_HOME 隔离（不污染用户全局 dsh 配置） | sidecar 模块 env | `DSH_HOME` 指向壳私有目录；双实例不互踩 |
| S4 | 双插件族同 profile 共装：`dsh plugin add` 装 fleet-nodes + wb 插件 | sidecar 启动序列 | 一个 dsh 实例同时呈现 fleet-nodes tab 与知识工作台 |
| S5 | 壳主进程作 /api 客户端（loopback + token） | 主进程 fetch 封装 | 壳原生面可读 sidecar 状态/会话 |
| S6 | 内存/启动实测（记录基线） | 诊断输出 | 基线数字入文档（后续 CU 门数据） |

**安全子项**（并入 S1 验收，不可裁剪）：view 导航白名单（仅 `http://127.0.0.1:<port>`，外部链接交系统浏览器）；`contextIsolation` 保持；禁 `window.open`/新窗劫持；主窗 CSP（`app/src/utils/csp.ts`）按需放行 loopback 资源加载。
**估时两层**（R7）：Day-1 冒烟 = S0+S1+S2 最小验证（0.5–1 天，**V0 门：不通=统一前端全案重估**）→ CU0 完整验收 S0-S6（1–2 周）。

| # | 特性 | 内容 | 估时 | 依赖/降级 |
|---|---|---|---|---|
| F-5 | CU0 骨架（上表） | 见 §3.2 | 冒烟 0.5–1 天；完整 1–2 周 | **待 P1 归属确认**；若 P1 定 cosmoxwork 仓做 → 本仓退为契约测试+文档回写，F-6/F-7 顺延 |
| F-6 | **sidecar 集成 = 节点零号** | 按 §4 注册模型把 sidecar 注册为本地节点（探活/会话/派发语义与远端统一） | F-5 后 1 周 | **依赖 S0 自建件**；`@wb/dsh-sidecar-host` 发布后替换（A11 六决策对齐，P2） |
| F-7 | 知识注入派发钩子（CU1 预留） | 派发 prompt 上下文可携带 kb 引用（走 kb_search 工具面，不新增协议） | ~2 天 | 检索本体在 wb 侧；本仓只做拼装钩子 |
| F-8 | **内核共享包化** | F-2/F-3/F-5/F-6 苦活按 §8.4 下沉 `@cosmoxone/*`（或 P2 定名）；CI 版本矩阵校验两壳契约一致；共享包覆盖率度量（目标 80%+） | 伴随各特性 | 防漂移红线：新增苦活只进包 |
| F-12 | **fleetd 内核服务 / 多前端**（候选，v1.4 新增） | 编排下沉 headless 服务，六面消费：Electron UI（面①）/ MCP 桥=面②（FLEET-ORCH-001）/ **fleet serve ACP 面③**（任何 ACP client UI——dsh-orchestra、dsh-fleet web、goose desktop——把 fleet 当单节点接入）/ companion（面④）/ CLI（面⑤）/ **面⑥ stdio agent + acpx-export**（v0.3，北向编排者矩阵与命名规范见 §4bis）；L0-L2 分层与 M0-M4 见 `fleet-core-service-design.md`（FLEET-HUB-001） | 参考设计 v0.3 待评审；M1-M2 对齐 F-8 节奏 | M2：acp-smoke 反向打 fleet serve 通过 + 第三方 UI 添加 fleet 节点开窗成功 |

### 轨道 ③：分发与移动（CU2 前置 + 手机桥）

| # | 特性 | 内容 | 估时 | 说明 |
|---|---|---|---|---|
| F-9 | 分发基建移植 | electron-updater/签名/公证/HarnessRuntime 布局（dsh-desktop 清单，MIT+出处标注） | 1–2 周 | fleet 壳自身受益（现无更新器）；CU2 前置 |
| F-10 | 移动端 companion（M1-M3） | 架构遵循本仓 `mobile-companion-design.md`（契约 5：舰队+权限应答语义）；配对可升级 SPAKE2、跨公网可评估 WebRTC 直连（`docs/research/nf-board-notes.md` N2/N5） | M1 ~1 周 | **移植口径（R8）**：dsh-desktop 桥是"harness URL 转发"语义，非我们的舰队语义——只移植其工程件（QR 配对 TTL/隧道 provider/mux 重连/body cap），**API 面按契约 5 自建** |

### 依赖图

```
F-1(dsh合并) ──► F-2(catalog) ──► F-3(stdio驱动 spike→排期)
                    │
                    ├──► F-10(移动端 M1;需 F-9 部分件)
                    └──► F-5(CU0 骨架,待P1) ──► F-6(节点零号) ──► F-7(kb注入钩子)
F-8(共享包化) 伴随 F-2/F-3/F-5/F-6 持续进行
F-11(编排桥,候选) 依赖 F-2(catalog)；为 F-8 首发包候选
```

## 4. 本地运行时注册模型（v1.1 新增，P5 决策载体）

**问题（R2）**：fleet 壳既有默认窗 = 本地 `goose serve`（lease 路径）；统一客户端愿景的 node-00 = dsh sidecar。
直接叠加会出现"本地双运行时、两个本地入口"的语义混乱。

**提案：本地运行时一般化为注册表条目**——

| 节点 | 运行时 | 生命周期 | 身份 |
|---|---|---|---|
| `goose-local`（既有默认） | 本地 goose serve | 既有 lease（按窗 spawn） | 舰队页本地默认节点 |
| `dsh-local`（F-6 新增） | dsh sidecar | 常驻（S0 管理），可选自动启动 | 本地工作台 + 总控（cosmoxwork 语境的"node-00"） |

- 注册模型：`FleetNode` 增加 `local?: { runtime: 'goose-serve' | 'dsh-sidecar'; managed: boolean }`，
  探活/健康/会话入口与远端节点同一套代码路径（驱动层已天然统一，改动集中在 lease/注册表）；
- 开源壳默认策略（建议）：`goose-local` 保持默认本地节点；`dsh-sidecar` 为**可选启用**（设置开关，
  因 dsh 栈体积/密钥前置）；cosmoxwork 发行版可预置 dsh-sidecar 为 node-00（品牌差异层，不在本仓做）；
- 密钥/凭据：sidecar 本地 loopback token 由壳持有（不进 settings.json 明文，沿 GENERATED_SECRET 惯例）。

## 5. 需求追溯矩阵（v1.1 新增，R5）

| 上游需求 | 本仓覆盖 | 备注 |
|---|---|---|
| wb FR-41（入口壳=fleet 壳，三件套） | 工作台页=F-5；舰队页=F-1~F-3；账户面=**不做**（§6） | 账户面属 cosmoxwork 装修 |
| wb FR-39（统一客户端整合） | F-5/F-6/F-7 | FR-39 正文残留"基座=dsh-desktop"，以 FR-41 为准（待反馈，D-8） |
| wb FR-40（cloudagent 治理层） | **不接**（开源壳无账户面；wb 插件连云 token 见 §6 口径） | 契约上不阻塞 |
| roadmap 4.7 CU0（S1-S6+两仓共享协议） | F-5（含 S0 扩展） | 产出（命令/脚本/坑清单）回写本仓 docs 供对方引用（互审 O2） |
| roadmap 4.8 分发基建移植 | F-9（+F-10 手机桥按需） | MIT+出处标注 |
| unified-client A5（知识注入派发接口） | F-7 | 走 kb_search 工具面，不新增协议 |
| unified-client A11（共享组件治理六决策） | F-8 + P2 | 本仓侧对应：包名/位置/版本矩阵/消费方式 |
| unified-client A10（sidecar-host 消费） | F-5 S0 降级路径 | 包未发布，先自建对齐契约，后替换 |

## 6. "本仓不做"清单（v1.1 新增，R6）

| 不做 | 归属/理由 |
|---|---|
| 账户/计费/许可 UI、登录态、token 代发 | cosmoxwork 装修层（§8.5 唯一转化面） |
| Pro 闭源插件族、市场前端、`.dshpreset` 商业预置集分发 | cosmoxwork/生态层 |
| 品牌/皮肤/产品命名层 | 品牌差异层 |
| kb 检索/知识治理本体 | wb 插件族（工作台页内自足） |
| 组织治理（RBAC/SSO/审计导出） | cloudagent 域 |
| **wb 插件连云 token 的壳代发** | 账户面功能。fleet 开源壳内 wb 插件按"裸 dsh 模式"运行：纯本地或用户在插件设置自填（上游纪律"插件不挟持功能"两侧一致） |
| 重写 dsh web 任何 UI | 永不（双工作面纪律） |

## 7. 验证策略（v1.1 新增，R9；吸收 roadmap 0.9 L0/L1 思想）

| 层 | 手段 | 适用 |
|---|---|---|
| L0 启动健康（零依赖） | 现有单测+typecheck+契约冒烟（CI） | 每提交 |
| L1 无密钥/无真实远端 | loopback mock：mock stdio ACP（dsh 桥+mock 已有先例）验 UI/探活/派发路径；**F-5 的 S4 插件共装、F-6 注册模型都先在 L1 验** | 特性开发期 |
| L2 真实环境 | 真 dsh 栈 + minimax（本机已就绪）；桌面人工清单 | 里程碑验收 |
| L3 桌面自动化（A7） | playwright app-e2e（重点：F-5 工作台页、F-2 门控回归） | CU0 后引入，先覆盖高危路径 |
| 埋点（P6 待决） | 若采纳：本地存储、默认关闭、opt-in；数据项=激活（首次探活/派发/工作台页使用）——服务 G-合并 观测 | 决策后 |

## 8. 决策点（P1-P6，v1.1 补分支）

| # | 决策点 | 倾向 | 若不采纳 |
|---|---|---|---|
| P1 | CU0 工作台页骨架归属 | **本仓承担**（定性内核孵化+Spike 产出可回写；Electron 工程已在） | cosmoxwork 仓做 → 本仓退为契约测试+文档回写；F-6/F-7 顺延至其 S1-S6 出结果 |
| P2 | 共享包命名/位置 | 先仓内孵化（`packages/` 或 core/runtime 演进），CU1 前发包定名（对齐 A11） | 独立仓先行 → 增加一次迁移成本，但不阻塞 |
| P3 | A1 stdio 桥驱动产品归属 | **开源**（驱动层=内核，引流价值高） | cosmoxwork 专属 → 本仓差异化收窄，spike 仍可做（结论两壳共享） |
| P4 | 移动端 M1 时点 | 试点切片先行；正式 M1 跟 CU2 或 G-合并 | 严格等 CU2 → 价值验证延后，风险低 |
| **P5**（新） | 本地运行时注册模型与默认本地节点（§4） | goose-local 默认 + dsh-sidecar 可选开关 | 维持"本地 goose 特例+sidecar 另起"→ 语义分裂，舰队页两套本地逻辑 |
| **P6**（新） | 开源壳是否内置匿名埋点 | 默认关、opt-in、本地优先 | 不做 → G-合并 观测缺本仓数据源（可用插件侧埋点替代） |

## 9. 里程碑周历（v1.1 新增，R11；示意，非承诺）

```
W1   D-1 验收合并 ──► F-2 catalog(1-2d) ──► F-3 spike(1-2d) + P1/P3 确认
W2   F-5 Day-1 冒烟(S0+S1+S2, V0 门) ──► 通过则 CU0 完整推进(S3-S6)
W3-4 F-6 节点零号(P5 定案) ──► F-7 钩子;F-8 首个包候选(catalog 或 sidecar 件)
W5+  F-9 分发基建 ──► F-10 M1(试点切片可随时插队)
并行 F-4 快照例行;CU 线对齐点:CU0=F-5 完成;CU1=F-6/F-7;CU2 前置=F-9
```

## 10. 纪律与风险

| 纪律/风险 | 应对 |
|---|---|
| "fleet 壳不做新特性"边界 | 本仓只做三类合法开发（§2 张力说明）；负面清单 §6 兜底 |
| 壳间抄代码（防漂移红线） | F-8：苦活只进共享包；触碰即下沉（strangler 式 C2） |
| CU0 V0 门 | S0+S1+S2 冒烟不通 → 统一前端方案全案重估（两仓既定；v1.1 将 S0 纳入门内——sidecar 拉起失败同样致命） |
| `@wb/dsh-sidecar-host` 未发布 | F-5 S0 自建对齐契约；包发布后替换（A10 ②纪律）；防长期双轨：替换任务随包发布即排 |
| 本地双运行时语义混乱 | §4 注册模型 + P5 决策 |
| 快照刷新与上游漂移 | F-4 例行；插件兼容验证进回归清单 |
| 跨仓文档不一致 | wb FR-39 残留（D-8 追加）；本仓回写 CU0 产出时同步对方 docs（互审 O2） |
| 三仓节奏耦合 | 决策门沿用：G0（dsh 验收）→ G-合并（双域交叉观测）→ G-壳收敛（CU2 评估） |
| WebContentsView 安全面 | §3.2 安全子项不可裁剪；外部链接一律交系统浏览器 |

## 11. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-08-30 | 初稿：生态位定案/D-1~D-8 调和/三轨 F-1~F-10/P1-P4/纪律风险 |
| v1.1 | 2026-08-30 | review 细化（R1-R12）：S0 新增与 sidecar 自建降级；§4 本地运行时注册模型（P5）；F-2 schema 草案；F-5 落点/安全子项/两层估时；§5 追溯矩阵；§6 负面清单（含 wb 插件 token 口径）；§7 验证策略 L0-L3 与 P6；决策点补分支；§9 周历；事实注脚（Electron 43/桥行数） |
| v1.2 | 2026-09-14 | 增补：nf-board 研究笔记引用（F-3 spike 含远程传输评估 N1；F-10 配对/隧道 N2/N5）；新增 F-11 ACP→MCP 编排桥（候选，指向 FLEET-ORCH-001 参考设计 v0.1，P7–P10）；依赖图与 §3 轨道① 相应更新 |
| v1.3 | 2026-09-14 | F-3 增补：stdio 注册表格式参照/兼容 OpenClaw acpx（依据 `docs/research/remote-node-operation-notes.md` §3-D，转换器隔离） |
| v1.4 | 2026-09-15 | 新增 F-12 候选（fleetd 内核服务/多前端，指向 `fleet-core-service-design.md` FLEET-HUB-001 v0.1；桥 = 其面②，FLEET-ORCH-001 同日升 v0.3 对齐）；F-11 依赖关系不变 |
| v1.5 | 2026-09-15 | 一致性对齐（全网 review）：F-11/F-12 行版本引用勘正（桥 v0.3；HUB v0.3 六面含面⑥）；F-2 增补节点命名 slug schema（`node-naming-spec.md` FLEET-NAMING-001，+0.5–1 天）。文档侧同步：openclaw v1.1 / hermes 措辞去序数化（"择一先 spike"）/ remote-node-notes v1.2（L3 勘正落账）/ docs/README 索引更新 |
