# 研究笔记：操作远端节点的机制谱系（fleet 视角）

> 日期：2026-09-14 · 状态：**参考笔记 v1.2**（v1.1=评审勘补，v1.2=§6 勘正）
> 问题：**"操作一台远端机器上的 agent"有哪些已验证机制？fleet 该组合哪几种？**
> 输入：本仓既有讨论（`nf-board-notes.md`、`orchestration-ecosystem-notes.md` v1.1、
> `acp-mcp-bridge-design.md` v0.2、roadmap-v2 v1.2）；harness 分析 `omnigent-analysis.md`
> v1.1、`ruflo-analysis.md` v1、`openclaw-analysis-2026-09-14.md` §16/§17 + 源码抽查
> （`extensions/acpx`、`crates/ruflo-federation-peer`、`crates/ruflo-agntcy`）；
> `meta-harness-trio-summary.md` v1.1。

## 1. 六种机制总览（源码级事实）

| # | 机制 | 连接方向 | 协议 | 节点厚度 | 信任/安全 | 派发语义 |
|---|---|---|---|---|---|---|
| **A** | **fleet FleetNode**（现状） | 直连：壳=ACP client → 节点 ACP server | ACP over WS（公开标准） | **厚**：常驻完整 agent 服务（goose serve/dsh 桥） | token + TLS 指纹钉扎 + TOFU | 逐窗 lease，每窗新会话 |
| **B** | **vibe-kanban relay**（nf-board） | **外呼**：host 出站 WS 到 relay，NAT 零入站 | 私有 relay 帧 + yamux 多路复用 + WebRTC 直连回退 | 任务宿主（任务期生命周期） | 签名 socket + SPAKE2 配对 + Ed25519 信任键 | 任务卡 → workspace → agent |
| **C** | **OpenClaw Nodes** | **外呼**：node=WS client 接入 Gateway（Apple Watch 走 HTTPS polling） | 私有 gateway-protocol（typebox，N-1 窗口） | **薄**：命令面（camera/system/computer.act）+ 可选 worker session hosting | 两步配对 + 三重门 + 审批绑定（防 TOCTOU）+ deny 总赢 | node.invoke（流式/容量/取消）+ worker 派发（sealed artifact + 容器隔离） |
| **D** | **OpenClaw acpx / `openclaw acp`** | 双向两条：acpx=**本地** spawn ACP agent 进程；`openclaw acp`=Gateway **暴露** ACP server 面 | ACP（stdio / WS） | agent 进程（stdio）；Gateway（server） | OpenClaw 拥有会话/权限/投递，agent 自持认证 | acpx 注册表：`agents: {<id>: {command, args, env, cwd}}`（zod 校验）；含 codex-auth-bridge、pi-session-catalog（远程续接 Pi/Codex 会话） |
| **E** | **omnigent**（编排平台） | 混合：本地 runner + 厂商 native 桥；远端=**云沙箱 placement**（10+ provider：Modal/Daytona/E2B/K8s…）+ 多端会话接力（host/connect frames） | 自有 OpenAPI（73 path）+ ACP 面（OpenClaw 经 acpx→`acp:` 条目桥接，源码实测） | 引擎在沙箱内（策略可拉沙箱并**暂停等审批**） | CEL 表达式策略引擎 + 审批-沙箱联动 + 双本地内核沙箱 + L7 egress 代理 | 同会话混用多家 harness；subagent_routing/tool_dispatch |
| **F** | **ruflo 联邦**（对等派） | **对等**：federation-peer 单进程/机器，QUIC P2P | 自有联邦消息 + AGNTCY（CASA envelope） | 本地 agent（stdio 移交） | **AIMDS 三门内容安全**（sanitize→policy→mitigate，<60ms）跑在每一联邦跳；CASA=意图范围授权 envelope，deny-by-default 纯函数（不调模型） | swarm 调度循环（Router→Swarm→Agents→Memory 学习回环）；hooks 自动路由增强 Claude Code/Codex |

## 2. 定位图：连接方向 × 节点厚度

```text
                 节点薄（命令面/进程）
                        │
        C OpenClaw ─────┼───── D acpx(本地进程)        ← 外呼/本地区
        Nodes(外呼)     │
                        │
 直连 ◄─────────────────┼──────────────────► 外呼/对等
        A fleet ────────┼───── B vk relay(外呼中继)
        FleetNode(直连) │      F ruflo(对等联邦+QUIC)
                        │      E omnigent(云沙箱=远端拉起)
                 节点厚（常驻服务）
                        │
```

**三个派系**：直连派（A：fleet 独此一家——用公开协议换治理简单）、外呼派（B/C：解决
NAT/零入站，代价是私有协议与中继基建）、对等联邦派（F：无中心，代价是内容安全与身份
基建）。**E 是"第三维"**：远端不是既有的机器，而是**按需拉起的临时沙箱**。

> **v1.1 勘补（评审发现）：fleet 的第七个位置**——上表把 fleet 固定在 client 位（A），
> 但 `fleet serve`（ACP server 面，FLEET-HUB-001 面③）会让 fleet **同时占据 D 位**
> （与 `openclaw acp` 同型：聚合者自身暴露 ACP server 被上游消费）。谱系由此闭合：
> 任何 ACP 生态成员都可在"client 位 / server 位 / 双位"之间选择，fleet 的差异化 =
> **双位 + 异构驱动注册表**。另注意由此产生的**嵌套舰队**（fleet 作为上游 fleet 的
> 节点）——hop 限制（FLEET-ORCH-001 §9）延伸适用。
>
> 其余评审缺口（多面并发下的会话所有权、dsh-orchestra/dsh-fleet 对接形态）已由
> `fleet-core-service-design.md`（§3 会话管理器、§2 面③、§6-M2）承接，本文不重复。

## 3. 与 fleet 的组合关系（逐机制判定）

### D（acpx / `openclaw acp`）——立即有用，两个落点

1. **`openclaw acp` 把 Gateway 变成 ACP server** → 天然符合契约 1 语义 → **OpenClaw 可
   注册为 fleet 第三驱动**（omnigent 已实证 "drive a live OpenClaw Gateway session over
   ACP"）。一个新驱动条目 + 契约冒烟即可 spike（半天级）；
2. **acpx 注册表格式 = F-3 stdio 驱动配置的直接参照**：`agents: {id: {command, args,
   env, cwd}}` 正是 fleet `transports: ['stdio']` 需要的形态。**兼容导入 acpx 清单**
   （omnigent 的 JSON5→`acp:` 转换已证可行）= F-3 落地即免费接入 acpx 生态里的
   Claude/Codex/Pi 等 agent。注意：acpx 是 OpenClaw 插件（host ≥2026.4.25），格式可能
   漂移——**参照 + 转换器隔离，不做硬依赖**。

### E（omnigent）——中期参照，fleet 缺的"临时节点"形态

fleet 当前只有**常驻厚节点**；omnigent 的云沙箱 placement 展示了**临时节点**语义
（按需拉起、策略门控、用完即弃）。对 roadmap 的意义：F-11 桥的 dispatch 若加
`ephemeral` 节点类型（云沙箱起 ACP agent → 注册 → 用毕注销），就补齐了"舰队"的
弹性维度；其 **CEL 策略引擎 + 审批-沙箱联动**（策略触发拉沙箱并暂停等审批）是桥
策略引擎（§6 standalone 模式）的成熟参照。alpha 期，参照不依赖。

### F（ruflo）——远期思想源，近期不引入

QUIC+AIMDS 全家桶对 fleet 过重，但两个思想可轻量借鉴：
1. **联邦跳间内容扫描**（sanitize→policy→mitigate <60ms）——桥 §9 的 prompt injection
   缓解可取其"轻量门"思想（对 dispatch 的 prompt/回灌做规则扫描，非全 AIMDS）；
2. **CASA 意图 envelope**（deny-by-default、确定性、不调模型）——与 OC-N3 审批绑定
   同族，桥的 allow-list 可演化为"意图范围授权"（批准的是意图类别+参数哈希，不是
   工具名）。另注意：AGNTCY 的 SLIM transport 仍是 **stub**（无 crates.io 包，feature
   关闭）——对等联邦生态未熟，观察即可；ruflo 增长数字自带 proof 账本（生态叙事
   数据化），参照其机制时打折其宣称。

### B / C——已在既有笔记，此处仅归纳

B（nf-board-notes N1–N5）：外呼中继 + **回环物化**（`FleetNode` 模型零改动）是 SSH/NAT
缺口的正解；C（OC-N1–N7）：两步配对/三重门/审批绑定/invoke 流式已回写桥设计 v0.2 与
ecosystem-notes v1.1。

## 4. fleet 组合策略（决策表）

| 时点 | 动作 | 依据机制 | 成本 |
|---|---|---|---|
| **短期**（随 F-3 spike） | stdio 驱动注册表格式参照/兼容 acpx（转换器隔离） | D | 低（格式对齐，半天含在 spike 内） |
| **短期**（独立 spike） | OpenClaw 第三驱动：`openclaw acp` + 契约冒烟 | D | 半天 |
| **中期**（F-3 后） | 外呼传输：`'ssh'` transport / 中继 + 回环物化 | B+N1 | 1–2 天 spike（roadmap F-3 已扩 scope） |
| **中期**（F-11 桥落地时） | 桥权限引擎吸收 CEL 式策略 + 审批绑定 + 轻量内容门 | C(OC-N3)/E/F | 随桥实现 |
| **远期**（观察） | 临时云沙箱节点（ephemeral driver）；对等联邦/A2A | E/F | 生态定型后再评 |

**组合后的 fleet 完整形态**：常驻直连节点（A，现状）+ 本地 stdio 进程节点（D/acpx 格式）
+ 外呼隧道节点（B 回环物化）+ ACP 化的 OpenClaw 节点（D）+（远期）临时沙箱节点（E）
——五种节点形态全部走**同一契约 1 + 同一驱动注册表 + 同一 A2 catalog**，这正是
"驱动注册表"抽象的兑现路径；桥（FLEET-ORCH-001）则是这些节点之上的 agent-native 面。

## 5. 风险与注意

| 风险 | 说明 |
|---|---|
| acpx 格式漂移 | OpenClaw 插件自有格式，host 版本门槛——转换器隔离 + 冒烟锁定 |
| 私有协议两面性 | B/C 的外呼优势以私有协议为代价；fleet 若走中继，**ACP-over-tunnel**（隧道透明承载契约 1）优于新协议 |
| AGNTCY 未定型 | SLIM 无发布包；F 的联邦身份/安全基建无现成依赖 |
| omnigent alpha | API 稳定性未知；参照模式不建依赖 |
| ruflo 叙事打折 | proof/ledger 自证增长；v3 分叉迹象 |
| 机制蔓延 | 五种节点形态共用契约/注册表/catalog 是红线——新形态不得绕过驱动抽象另起协议 |

## 6. 一句话结论

六种机制里，**acpx（格式+生态）与 `openclaw acp`（第三驱动）是当下就能白拿的两件**，
外呼中继（回环物化）是补 SSH/NAT 的正解，云沙箱临时节点与对等联邦分别代表弹性与
去中心的远期维度——fleet 的正确姿势不是选边，而是**用契约 1 + 驱动注册表 + A2 catalog
这张"通用插座"把它们逐个接进来**。（v1.2 勘正：五形态统一于**驱动注册表 + A2 catalog**，而非"同一契约 1"——stdio 进程形态走驱动 stdio 通道、网络形态走契约 1，协议面本就不同，统一发生在驱动抽象层。）

## 7. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-14 | 初稿：六机制谱系（fleet/vk relay/OpenClaw Nodes/acpx/omnigent/ruflo 联邦）；方向×厚度定位图；D/E/F 组合判定（acpx 格式参照、云沙箱临时节点、AIMDS/CASA 思想）；组合策略决策表与风险清单 |
| v1.1 | 2026-09-15 | 评审勘补：§2 增"fleet 第七个位置"（`fleet serve` 使 fleet 双位：client 位 + D 位；嵌套舰队与 hop 限制延伸）；会话所有权与 dsh-orchestra/dsh-fleet 对接缺口指向 `fleet-core-service-design.md`（FLEET-HUB-001）承接 |
| v1.2 | 2026-09-15 | §6 勘正（hub-review L3）：五形态统一于**驱动注册表 + A2 catalog**而非"同一契约 1"——stdio 进程形态走驱动 stdio 通道、网络形态走契约 1，统一发生在驱动抽象层 |
