# 特性设计：fleet 内核服务（多前端 ACP 聚合架构，fleetd）

> 特性 ID：`FLEET-HUB-001` · 状态：**参考设计 v0.4 草案——V1 门已过：面⑥ 升第一优先（见 `../research/v1-acp-client-verification.md`）**（2026-09-15；v0.2=review 修正，v0.3 新增面⑥ stdio agent 与北向接入矩阵/命名规范 §4bis）
> 愿景（用户原话归纳）：**fleet 有 UI 外壳，也有 ACP 聚合插件/服务，支持多种前端——
> 其他 UI（dsh-orchestra、dsh-fleet web）或 CLI/agent 皆可消费同一舰队。**
> 关系：**吸收并升维 FLEET-ORCH-001**（ACP→MCP 桥 = 本架构的面②，见 §4 对齐）；
> 承接 mobile design O2（headless）、roadmap F-8（共享包化）与 §4 本地运行时注册模型（P5）；
> 机制谱系依据 `remote-node-operation-notes.md` v1.1（fleet 将占谱系第七位置，见其 §2 勘补）。

## 1. 问题与愿景

**现状**：编排逻辑住在 Electron 壳内——`core/`+`runtime/` 虽已零 Electron 依赖，
但只有壳一个消费者；dsh-orchestra / dsh-fleet web / goose CLI 想用同一舰队，各自重写。

**目标架构**：编排能力下沉为**内核服务 fleetd**，N 个消费面共享同一注册表/驱动/catalog/权限：

```text
面① Electron UI(现状)   面② MCP 桥(=FLEET-ORCH-001)   面③ ACP server(fleet serve,新)
面④ companion HTTP(契约5,已设计)   面⑤ 未来 TUI/CLI
        │                    │                        │
        └────────────────────┴────────────────────────┘
                             ▼
   L1 fleetd（headless 服务层）：会话管理器 · 派发器 · 权限中枢 · 事件总线
                             ▼
   L0 内核（既有资产）：core/(node/registry/router/policy) + runtime/drivers/(goose/dsh)
                        + A2 catalog + acp-smoke + versions.json
                             ▼
   N 个 ACP 节点（常驻直连 / stdio 进程 / 隧道 / 临时沙箱——remote-node-notes 五形态）
```

**非目标**：多用户/租户（单用户自托管）；云 SaaS；重写任何前端 UI 的内部（双工作面纪律）；
账户/计费/品牌（roadmap §6 负面清单不变——本架构属内核共享方向，但"产品化服务"倾向
需 P14 决策把关）。

## 2. 面层设计（faces）

| 面 | 消费者 | 协议 | 状态 | 说明 |
|---|---|---|---|---|
| ① Electron UI | 人（桌面） | 既有 IPC + lease | **现状** | v1 保持内嵌 core 双形态并存（P13），不强制迁移 |
| ② MCP 桥 | 任何 MCP agent（goose CLI/桌面、OpenClaw、dsh web 内 agent） | MCP | **FLEET-ORCH-001 v0.2 已设计** | standalone（库内直连 L0）/ attached（连 fleetd）双模式，见 §4 |
| ③ ACP server | **任何 ACP client UI/壳**（goose desktop、dsh-orchestra、dsh-fleet web、第三方 ACP 客户端） | **契约 1 同构**（`/status` + `/acp?token=` + 406 语义 + TLS 指纹） | **本设计新增** | fleet 对外呈现为**单节点**："fleet-hub (aggregating N nodes)"；与 dsh-fleet 的 `acp-ws.mjs` 桥互为镜像（桥=把 1 个 stdio agent 暴露为 WS；fleet serve=把 N 个 WS agent 聚合为 1 个 WS 面） |
| ④ companion | 手机浏览器 | 契约 5（`/api/v1`） | mobile design 已设计 | 事件桥天然复用 fleetd 事件总线 |
| ⑤ TUI/CLI | 终端 | node-cli 扩展 | 远期 | `node-cli` 演进 |
| **⑥ stdio ACP agent**（v0.3 新增） | **任何 spawn 型宿主**：acpx 生态（openclaw acpx / dsh subagent-acp / omnigent `--from-openclaw`） | ACP over stdio（`fleet agent [--node <slug>]`） | v0.3 新增 | **`openclaw acp` 的架构镜像**：同一聚合内核包成单进程 stdio agent；双模式——`--node X` 单节点透传 / 无参 hub 聚合（与 P12 同源）；配合 `fleet acpx-export`（见 §4bis）可被 acpx 宿主一键导入。**多节点语义（v0.5 澄清）分三层**：①宿主层（v1 主路径）——acpx-export 一节点一条目，宿主 spawn N 进程管 N 节点（acpx 原生模式，dsh 10-provider 级联同构）；②会话层（可选 +0.5 天）——hub 模式多次 session/new，路由键 `_meta.fleet.node = <slug>`（ACP 扩展点，同 goose unstable 机制），无 _meta 落默认节点；③提示层（v2 候选）——"@slug 前缀"文本路由。**单会话内多节点并行编排不属面⑥**（ACP 单会话=单对话流）——那是面② MCP 桥的本职分工 |

**面③ 是本设计的增量**，语义要点：
- **initialize**：fleet 以 agent 身份应答（agentInfo `fleet-hub`）；`clientCapabilities` 透传给被选节点；
- **session/new 路由**：v1 = **passthrough**（`_meta.fleet.nodeId` 显式选节点，或 router/policy 默认节点）；**聚合模式后置**（P12）——`session/list` 跨节点聚合有语义陷阱（dsh 无 list），v1 只投影绑定节点的 catalog（D7 降级模型复用）；
- **未知方法透明转发**（v0.2 补，最小版成立的前提）：fleet 不识别的 JSON-RPC 方法（含各 UI 的 `goose.*_unstable` 类扩展）**原样转发给绑定节点**——扩展调用在支持的节点上自然工作，不支持的按 ACP 规范 -32601（D7 软化复用）；fleet 自身只实现标准面 + catalog 投影，不逐个适配扩展；
- **会话生命周期**（v0.2 补）：镜像节点语义（client 断连 → 节点会话清理，与壳逐窗模型同构）；跨断线恢复 v1 不承诺（归 P12 聚合模式再议）；
- **prompt/update/request_permission/cancel**：双向转发；权限走权限中枢（§3）；
- **能力投影**：按所绑定节点的 A2 catalog 动态降级（第四消费方机制的再消费）；
- **嵌套舰队**：上游 fleet 可把下游 fleet serve 注册为普通节点——hop 限制（桥设计 §9）延伸到面③。

## 3. L1 服务层（fleetd）四大件

| 件 | 职责 | 复用/先例 |
|---|---|---|
| **会话管理器** | 统一 session 生命周期（面②③④ 的会话在此登记；面① Electron lease **v1 不收编**，P13）；节点级并发语义按 catalog（dsh 单 in-flight） | leaseRegistry 语义借鉴；OC worker hosting 的 slot/保留语义远期参照 |
| **派发器** | dispatch（= 桥 W3/W4 语义：流式/超时/容量/取消） | FLEET-ORCH-001 §5 + OC-N4 |
| **权限中枢** | request_permission 单点汇入 → 策略引擎（deny-first/allow-list/审批绑定 OC-N3）或扇出到面①④（先答先得）——**桥 standalone 策略引擎与手机挂起队列在此合流** | 桥 §6 + mobile §5 |
| **事件总线** | session/update 流的订阅/扇出（多面同看一个会话） | mobile 事件桥的泛化 |

## 4. 与 FLEET-ORCH-001（goose CLI 操作远程节点）的对齐——**完全兼容，桥升维为面②**

| 对齐点 | 结论 |
|---|---|
| 概念 | 桥 = "ACP client 包装成 MCP server"；在多前端架构中 = **面②（agent/CLI 消费面）的标准实现**。原设计无需推翻 |
| 双模式 | 桥 **standalone**（直接 import L0 core/runtime，fleetd 未部署时可用——试点切片零依赖不变）+ **attached**（连 fleetd API，共享会话管理/权限中枢/事件总线）——对应原 P7 决策的最终答案：桥 = fleetd 的 MCP adapter，包仍可独立发布 |
| 权限 | 桥 standalone 策略引擎 = 权限中枢的同构子集；attached 模式下权限汇入中枢，手机/桌面可代答 |
| 试点不受影响 | §10 试点切片（半天）原样执行——standalone 路径就是 fleetd 的 L0 内嵌形态验证 |

**goose CLI 操作远程节点这条链的最终形态**：`goose CLI --extension acp-mcp-bridge →
桥(standalone 或 attached) → fleetd/L0 → N 节点`；同一舰队同时被桌面 UI、dsh-orchestra
（经面③）、手机（面④）消费——**"一次注册，处处编排"**。

## 4bis 北向编排者接入：命名规范与接入矩阵（v0.3 新增）

> 问题（用户提出）：fleet 把不同 runtime 连起来后，节点/agent 如何命名？北向以 goose
> 编排是一种形态，若编排方是 hermes / dsh / opencode(OpenWork) / workbuddy 呢？

### 4bis.1 命名规范（三层）

| 层 | 规则 | 用途 |
|---|---|---|
| 注册表 `name` | 保持现状：用户自由标签（非空） | 桌面 UI/菜单显示 |
| **`slug`**（新增派生） | `[a-z0-9-]+`、唯一、创建后不可变——派生/迁移/保留字/冲突策略等细则**外移至 `node-naming-spec.md`**（单一事实源） | 一切机读场景的规范键 |
| **规范名 `fleet/<slug>`** | 对外统一标识（acpx 键形 `fleet-<slug>`） | ACP 面③ 路由（`_meta.fleet.node=<slug>`）、MCP 工具描述、companion API、日志/审计、桥的 dispatch 参数 |

### 4bis.2 编排者接入矩阵

| 北向编排者 | 其原生消费机制 | 接入面 | fleet 侧成本 |
|---|---|---|---|
| **goose**（CLI/桌面） | MCP extensions | **面②** MCP 桥 | FLEET-ORCH-001 原案 |
| **hermes** | MCP 工具消费 | **面②** | 零（hermes-driver 路径 C） |
| **openclaw** | MCP + acpx 注册表 | **面② 或 面⑥/acpx-export** 双通道 | 零 |
| **opencode / OpenWork** | MCP | **面②** | 零 |
| **dsh harness** | subagent-acp（实证"任何 ACP 兼容 agent 可配驱动"，见 harness manager-layer-design §4.5.4） | **面⑥/acpx-export（或面③）** | 零（spawn 型最自然） |
| **workbuddy（wb 插件族）** | dsh 插件形态（**V-WB1 待核**其 MCP/ACP 消费能力） | 随 dsh 通道 | 待核 |
| **omnigent** | `acp:` 条目（onboarding 即 acpx 格式导入） | **面⑥** | 零 |
| **编辑器类 ACP client**（zed 等） | ACP | **面③** fleet serve | 零 |
| 未来新编排者 | 三面任一 | 选既有面 | **设计判据：零 fleet 代码**；仅当三者皆不吃才做薄适配 |

### 4bis.3 `fleet acpx-export`（面⑥ 的生态杠杆）

`fleet acpx-export` 输出 acpx 格式注册表（每节点一条）：

```json5
{
  agents: {
    "fleet-goose-local":  { command: "fleet", args: ["agent", "--node", "goose-local"] },
    "fleet-dsh-sandbox":  { command: "fleet", args: ["agent", "--node", "dsh-sandbox"] },
    "fleet-hermes":       { command: "fleet", args: ["agent", "--node", "hermes"] }
  }
}
```

任何 acpx 兼容宿主（openclaw acpx、dsh subagent-acp、omnigent）导入即得**全部舰队节点
为可 spawn 的 ACP agent**——remote-node-notes §3-D 的"acpx 格式白拿"在此反向兑现：
**fleet 既是 acpx 格式的消费者（F-3 导入），也是生产者（导出）**。

### 4bis.4 原则

**同一聚合内核，传输无关暴露**：stdio=面⑥、WS=面③、MCP=面②。不按编排者定制接口，
按其**原生消费机制**选面——goose 系走 MCP、ACP 系走 ③/⑥、人走 ①④。新编排者接入的
验收判据就是上表末行：**零 fleet 代码**。

## 5. 生态位与治理校验

- roadmap §6 负面清单：不违反（无账户/品牌/多用户）；但面③ 使 fleet 具备"服务产品"形态，
  **红线重申**：单用户自托管、不建云、装修归 cosmoxwork——P14 把关；
- 契约治理：面③ = 契约 1 的 **server 侧实现**（fleet 首次当 server）——INTEGRATION.md 需补
  "fleet serve 契约"小节（复用 `/status`+`/acp`+token+指纹钉扎，零新协议）；面④ 契约 5 不变；
  桥 = MCP 标准工具面；
- 与 dsh 生态：fleetd 的面③ 可被 dsh web 侧 UI 直接当节点添加；面② 亦可打包为 **dsh 插件**
  形态（生态位①"裸 dsh 可装"再 +1）——`acp 聚合插件`即此（用户愿景用词）；
- 版本治理：fleetd 自身版本 + 节点协议 N-1 窗口（OC-N6）入 versions.json。

## 6. 实施路径（里程碑，依赖 F-2 catalog 先行）

| 阶段 | 内容 | 判据 | 依赖 | 估时（v0.2 补） |
|---|---|---|---|---|
| M0 | 桥试点切片（FLEET-ORCH-001 §10，standalone） | 原判据 | 无（P 决策即可启动） | 0.5–1 天 |
| M1 | fleetd 最小版：注册表 API + 派发器 + 桥 attached 模式 | 桥 attached 跑通同试点 | M0 + F-2 | ~1 周 |
| M2 | 面③ 最小版：passthrough 路由 + catalog 投影 + 权限转发 | **acp-smoke 反向打 fleet serve 通过**；dsh-orchestra/dsh-fleet web 或 goose desktop 添加 fleet 节点开窗成功 | M1 + F-2 | **2–3 周**（隐藏工作量大：扩展透明转发、会话生命周期、断连语义、权限转发——勿按"薄代理"低估） |
| **M2-alt**（v0.3 增，review 补排期缺口） | **面⑥ stdio agent 最小版**：`fleet agent --node <slug>` 单节点透传 + `acpx-export` | acpx 宿主（omnigent `--from-openclaw` / openclaw acpx / dsh subagent-acp）导入并驱动 fleet 节点成功 | M1 或**与 M1 并行**——无服务面（无端口/鉴权/TLS），**估 2–4 天，轻于面③，建议先行** | 2–4 天 |
| M3 | 会话管理器收编面②③④ + 事件总线多面同看；面① 是否迁移 = P13 | 手机与桌面同看桥派发的会话 | M2 + mobile M1 | 2 周+ |
| M4 | 聚合模式（session/list 聚合等）与临时沙箱节点 | 按 P12 评估 | 远期 | 后置 |

**验证**：L1 全程可 mock（既有 mock ACP 先例）；M2 的验收即"第三方 UI 即插即用"实证
（V1 待核实项：dsh-orchestra / dsh-fleet web 是否已具备 ACP client 面及其 initialize 扩展容错——
若只吃标准 ACP 面，fleet serve 恰好零扩展暴露，兼容性反而最好）。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 面① Electron 迁移成本（lease 深耦合 main.ts） | P13 双形态并存，永不强制；fleetd 先只管面②③④ |
| 聚合语义复杂度 | P12：v1 只 passthrough，聚合后置 |
| 多面权限竞态 | 单答语义 + TTL + 审计（mobile §5 先例）+ 审批绑定（OC-N3） |
| fleet serve 暴露面安全 | 契约 1 全套复用（token/TLS 钉扎/TOFU）；默认仅 loopback |
| **standalone 桥直读 settings.json 的一致性**（v0.2 补） | 与运行中 Electron 的内存态可能短暂不一致——attached 模式为正解；standalone 场景在节点文档标注"改配置需重启桥或用 node-cli" |
| **嵌套舰队的 hop 执行是 advisory**（v0.2 补） | ACP 无 hop 字段，只能经 `_meta.fleet` 扩展携带——仅 fleet 系客户端会设置，异构客户端无法强制；防线实际靠深度上限（服务端会话计数）而非协议字段 |
| scope 蔓延成"平台化" | P14 + 负面清单重申；单用户红线 |
| 双 runtime 形态漂移 | F-8 共享包纪律：L0/L1 只有一份实现（strangler 式收编） |

## 8. 决策点（P11–P14）

| # | 决策 | 倾向 |
|---|---|---|
| P11 | fleetd 部署默认形态 | v1 = **随 Electron 内嵌**（复用进程/生命周期）+ 独立 daemon 可选；**与 P5（本地运行时注册模型）同源，评审时合并决策**（v0.2） |
| P12 | 面③ v1 路由模式 | passthrough（显式 nodeId）先行；聚合后置 |
| P13 | 面① 是否最终收编 | 双形态永久并存为可接受终态；收编仅在有跨面会话需求时推进（review E2：**默认即终态，非活跃决策**） |
| P14 | 面③/ fleetd 是否入 v2 roadmap（F-12） | **建议入**（M1-M2 对齐 F-8 节奏）；详见 roadmap v1.4 |

## 9. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-09-15 | 初稿：三层架构（L0 内核/L1 fleetd/L2 五面）；面③ ACP server（契约 1 server 侧 + passthrough 路由 + catalog 投影）；与 FLEET-ORCH-001 对齐（桥=面②，standalone/attached 双模式）；M0-M4 路径；P11-P14 |
| v0.2 | 2026-09-15 | review 修正（见 `docs/progress/2026-09-15_hub-design-review.md`）：§2 面③ 补"未知方法透明转发"与"会话生命周期镜像"（最小版前提）；§6 补估时（M2=2-3 周，隐藏工作量显式化）；§7 补 settings 一致性与 hop advisory 两风险；§8 P7 关闭、P11 标注与 P5 同源 |
| v0.3 | 2026-09-15 | 新增 §4bis 北向编排者接入：命名规范（name/slug/`fleet/<slug>` 三层）；编排者矩阵（goose/hermes/openclaw/opencode/dsh/workbuddy/omnigent/编辑器 → 面②/③/⑥，判据=零 fleet 代码）；**面⑥ stdio ACP agent**（`fleet agent [--node]`，openclaw acp 架构镜像）+ `fleet acpx-export`（fleet 由 acpx 消费者变生产者）。**同日 review 补**：M2-alt 里程碑（面⑥ 2–4 天、轻于面③、可先行）；命名细则外移 `node-naming-spec.md`（FLEET-NAMING-001） |
| v0.4 | 2026-09-15 | **V1 核实落账**：dsh-orchestra/dsh-fleet web 均非 ACP client（面③无近期消费者）→ 里程碑重排序：**M2-alt（面⑥+acpx-export）先行、M2（面③）后置**（dsh 本体即 stdio 消费者实证）；M0 同日完成（goose CLI→桥→dsh 全链路） |
| v0.5 | 2026-09-15 | 面⑥ 多节点语义澄清（用户问询触发）：三层模型——宿主层（acpx-export 一节点一条目，v1 主路径，与 dsh 10-provider 级联同构）/ 会话层（`_meta.fleet.node` 路由键，可选）/ 提示层（@slug 文本路由，v2 候选）；并明确单会话并行编排归面② 桥（分工边界） |
| v0.6 | 2026-09-15 | M2-alt v1 范围裁定：层1 核心+hub 默认节点最小版；层2 `_meta` 路由推迟（无现成消费者会发该键，防规划剧场；键名已定，触发即加） |
