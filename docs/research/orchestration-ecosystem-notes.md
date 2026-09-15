# 研究笔记：多 Agent 编排生态对照与协同方法谱系

> 日期：2026-09-14 · 状态：**参考笔记 v1.1**
> 输入：`nf-board-notes.md`（本仓）；harness `openclaw-analysis-2026-09-14.md`（v 更新至
> 17:54，含 §16 Nodes 子系统详解 + §17 node 联邦讨论）+ 本地源码抽查；harness
> `omnigent-analysis.md` v1.1（acpx→ACP 桥实测）；harness `manager-layer-design.md` v1.3；
> `berd-notes.md`。
> 本文回答三个问题：① fleet 与 vibe-kanban 是否同质化；② FleetNode 与 OpenClaw 的
> Node 机制是否类似；③ 多节点 agent 协同还有什么高效方法。
>
> **v1.1 勘误**：v1.0 基于 §12（Node.js 运行时治理）得出"同名异义、零相似"的结论
> **不完整**——文档 17:54 新增的 §16/§17 揭示 OpenClaw 另有完整的 **Nodes 子系统**
> （外围设备/机器接入 Gateway 的编排面，~74K LOC），与 FleetNode **同一问题域**。
> §2 已重写；§1/§3 结论不变、补强。

## 1. fleet × vibe-kanban（nf-board）：同质化判定

**结论：功能相邻、层次不同，协议层零冲突；两个收敛方向值得盯。**

| 维度 | fleet | vibe-kanban | 判定 |
|---|---|---|---|
| 编排单位 | **会话**（人开窗、逐窗 lease、实时交互） | **任务**（issue → workspace → agent 跑完 → diff 审查 → PR） | 根本差异：交互流 vs 流水线 |
| 节点语义 | 注册表里的**远程 ACP 端点**（goose/dsh，常驻服务） | workspace 所在的**执行宿主**（relay 接入，任务期生命周期） | 不同物 |
| 协议 | 契约 1 = ACP over WS + token（自有治理） | 无节点注册协议；relay 是**传输基建**不是协议 | 无同质化 |
| ACP 消费 | 唯一主干（TS SDK） | 12 个 executor 之一（Rust SDK） | 共用标准 = 互补 |
| 权限流 | request_permission → 桌面 UI | ExecutorApprovalService → 看板审批 | 问题域同构，交互面不同 |

**收敛方向（watch）**：fleet 做任务级派发（FLEET-ORCH-001 dispatch / 任务卡片）→ 进入
vk 地盘，差异化必须靠**多节点异构驱动**；vk 的 `executors/acp` 加交互式多节点聊天不难，
但偏离其看板主业，概率低。

## 2. fleet × OpenClaw：Nodes 子系统对照（v1.1 重写）

### 2.1 事实基线（harness 分析 §16/§17，源码级）

OpenClaw 的 **"node"** = 接入 Gateway 的**配套设备/机器**（macOS/iOS/watchOS/Android/
headless），以 `role: "node"` 经设备配对接入，通过 Gateway WS（Apple Watch 例外：签名
HTTPS polling）暴露**命令面**（`camera.*`/`device.*`/`system.*`/`computer.act`），并可
**承载完整 worker session**（sealed artifact + 容器隔离）。全栈 ~74K LOC。注意与 §12
的 "Node 机制"（Node.js 运行时治理）**同名异义、互不相关**——v1.0 误把后者当作全部。

关键机制（对照 fleet 时的锚点）：
- **两步配对**：device pairing（`openclaw devices approve`）→ node command surface
  approval（`openclaw nodes approve`，独立 requestId）；commandless 节点连接后无有效命令；
- **三重门 + dangerous opt-in**：declared（连接时声明）→ approved（配对记录）→
  gateway allowlist（平台默认 + allow/deny，**deny 总赢**）；插件命令还有第四重门；
- **审批绑定防 TOCTOU**：approve 后 plan LOCKED，只转发锁定参数；interpreter 绑定唯一
  文件（变化即拒）；环境变量裁剪（剥 NODE_OPTIONS/BASH_ENV 等）；
- **worker session hosting**：Gateway 选有空闲 slot 的节点（每核 1 slot，超载等 10s）→
  下发 sealed worker artifact（content-hash 校验、原子发布、重连不重下）→ 容器隔离
  （docker/podman，只挂 bundle ro + workspace rw）→ WS 隧道回 Gateway → 断线
  placement 保留、14 天内重连续用；
- **node.invoke 流式语义**：progress 0-based seq 排序、inactivityTimeout 从首个 progress
  起算（后续 progress 重置）、hardTimeout 全程、cancel 终止进程树、
  WORKER_CAPACITY_EXHAUSTED 等错误码；
- **健康度/在场**：host stats 60s 上报（离线保留 lastKnownAge）；presence 只上报 HID
  idle duration（防伪造时间/防 prompt injection，`active_node=<id>` 是唯一模型可见字段）；
- **版本偏斜**：N-1 协议窗口，先升 Gateway 再升 node；
- **§17 联邦结论**：一个 OpenClaw 安装 = gateway 半 + client 半**同包**，可同时跑本地
  Gateway 并以 node 身份接入另一个 Gateway（macOS .app 为证）；但 **node 永远是 client**，
  无 Gateway 间循环，因此**没有环检测**（分析 §17.6 明示）。

### 2.2 FleetNode ↔ OpenClaw Nodes 对照表

| 维度 | OpenClaw Nodes | fleet FleetNode | 判定 |
|---|---|---|---|
| 问题域 | 多机 agent/能力编排（Gateway 为中心） | 多机 ACP 节点编排（壳为中心） | **同一问题域**（v1.0 判"零相似"作废） |
| 接入方向 | **节点外呼**接入 Gateway（节点=WS client） | **壳直连**节点（壳=client，节点=常驻 server） | 方向相反——与 nf-board relay 同属外呼派，fleet 是直连派 |
| 节点上跑什么 | 命令面（camera/system/computer.act）+ 可选 worker session | 完整 agent 服务（goose serve / dsh 桥） | OpenClaw 节点薄、fleet 节点厚 |
| 异构性 | 同构（OpenClaw node-host runtime 或协议重实现） | **异构驱动**（goose/dsh/…注册表 + catalog） | fleet 差异化所在 |
| 协议 | 自有 gateway-protocol（typebox，N-1 窗口） | ACP 公开标准 + token + TLS 钉扎 | fleet 借标准降治理成本 |
| 配对 | 两步（device + command surface），双 requestId | 单步表单（URL/secret/指纹） | OpenClaw 精细得多 |
| 能力声明 | declared + 平台默认 allowlist + dangerous opt-in | A2 catalog（规划中，静态声明） | 同一思想：能力面显式化 |
| 权限深度 | 三重门 + 审批绑定（TOCTOU 防护） | token + 指纹钉扎 + TOFU | OpenClaw 深一个量级 |
| 派发语义 | node.invoke（流式 progress + 单终响应 + slot 容量） | 逐窗 lease（每窗新会话） | 前者即 FLEET-ORCH-001 dispatch 的成熟先例 |
| 断线语义 | pending work 排队 + 14 天重连保留 | lease 恢复 + 重连微任务 | 类似，粒度不同 |
| 健康度 | host stats 60s + presence + lastKnownAge | /status 单点探活 | 可借鉴增强 |

**定位结论**：OpenClaw = "个人 agent 网关 + 外围设备舰队"（汇聚入站消息，扇出控制命令）；
fleet = "ACP 会话编排壳"（扇出交互会话）。**同题不同解**：都做"一个中心编排 N 台机器上的
agent 活动"，OpenClaw 用自有协议+外呼+命令面，fleet 用公开 ACP+直连+会话面。互补面：
`openclaw acp` 可暴露 Gateway ACP 面（omnigent 已验证）→ **OpenClaw 可注册为 fleet 第三
驱动**；反向（fleet 节点充当 OpenClaw node）需实现其私有 node 协议，不建议。

### 2.3 可采纳清单（v1.1 重排：OC-RT 保留运行时治理，OC-N 新增 Nodes 子系统）

| # | 建议 | 落点 |
|---|---|---|
| OC-N1 | **两步配对**（设备身份 → 能力面批准，双 requestId） | 节点接入 UX v2：先把节点配对进来，再按 A2 catalog 逐面批准——天然契合 catalog 门控 |
| OC-N2 | **三重门 + dangerous opt-in + deny 总赢** | FLEET-ORCH-001 桥与 companion 的权限模型（catalog 声明 → 用户批准 → 运行时 allowlist） |
| OC-N3 | **审批绑定防 TOCTOU**（approve 后 locked plan、interpreter 文件绑定、env 裁剪） | 桥的权限应答（§6）与未来任务派发的执行面 |
| OC-N4 | **node.invoke 流式语义**（0-based seq / inactivity 从首个 progress 起算 / hardTimeout / 容量错误码） | 桥 W4（dispatch 超时与进度）直接抄——已回写 `acp-mcp-bridge-design.md` |
| OC-N5 | **worker session hosting 范式**（sealed artifact + 容器隔离 + slot 容量 + 14 天保留） | 未来任务级派发（协同谱系②）的工程蓝本；dsh 已有 bwrap 沙箱先例 |
| OC-N6 | **N-1 版本窗口 + 先中心后节点升级序** | versions.json 治理补协议面条款（壳 N、节点 N-1 兼容） |
| OC-N7 | **host stats 60s + presence（只发 idle duration）+ lastKnownAge** | 舰队页节点健康面板增强（比单点 /status 丰富，且 presence 的防注入设计值得照抄） |
| OC-RT1 | Node.js 私域运行时三件套（地板线/私有副本/恢复探测） | 与 berd A3、fetch-goose 同族——"运行时治理"共享件候选 |
| OC-RT2 | 启动期能力探测（node-sqlite roundtrip） | 与 A2 catalog 互补：静态声明一道、关键能力探测二道 |
| OC-RT3 | 进程树监督（信号桥/zombie 收割/supervisor） | F-5 S0 sidecar 与 leaseRegistry 进程清理 |

**OpenClaw 没做而 fleet 已设计的**：**环检测/hop 限制**——OpenClaw 无 Gateway 间联邦故无
环风险（§17.6 明示缺此保护），fleet 的桥设计 §9 恰好补此缺；**跨厂商协议**——其 node 协议
是私有的，ACP 生态（goose/dsh/berd/任意 ACP agent）进不来。

## 3. 多节点协同方法谱系（按耦合度）

| 方法 | 适用 | fleet 落点 |
|---|---|---|
| ① 中心编排（hub-spoke，LLM orchestrator + workers） | 任务可分解、需人监督 | **FLEET-ORCH-001 已设计**；两层优于递归（hop 限制）；OpenClaw node.invoke 即其成熟先例（OC-N4） |
| ② 任务队列/派发（卡片 + 容量调度，agent 并行消费） | 子任务独立、批量 | vk 看板 + OpenClaw worker hosting（OC-N5）双重先例；fleet 差异化 = 跨异构节点派发 |
| ③ DAG/流水线（确定性工作流） | 分解结构已知 | 复用 goose schedules/recipes 做节点级 pipeline |
| ④ 共享环境/stigmergy（git worktree / 文件 / 知识库当介质） | 产出可合并 | 已有抓手：`FleetNode.workingDir` + 契约 3 的 `list-git-worktree-dirs`；F-7 kb 注入 = 跨节点共享记忆；OpenClaw workspace 保留/转移是同域参照 |
| ⑤ A2A 对等网（agent card、agent 间直接委托） | 无中心、跨组织 | 观察项（OpenClaw 也有 a2a 协议桥）；生态未定型，不急 |
| ⑥ 群体验证/共识（N 节点答同题，diff/judge） | 正确性敏感、评测 | **fleet 天然优势**：多驱动多节点跑同 prompt = "舰队委员会"，benchmark 平台可承接 |

**三条硬经验**（harness `manager-layer-design.md` v1.3）：
1. **结构化交接**：worker 回灌带 HandoffInfo（reason/status/recap），续行/重派/放弃由编排者决策；
2. **字符预算**：worker 返回设上限（参照 8000/16000），防单 worker 灌爆编排者上下文；
3. **按耦合度选模式**：紧耦合①+流式、松耦合②、探索型⑥、正确性关键⑥+④；
   **深链递归（>2 跳）在延迟与错误复合上几乎总是亏的**。

**建议落地顺序**：FLEET-ORCH-001 试点（①）→ 舰队委员会切片（⑥，半天可验）→ 视数据决定 ②/④。

## 4. 与本仓文档的关系

| 文档 | 关系 |
|---|---|
| `docs/research/nf-board-notes.md` | §1/§3② 的事实基础（N1–N5） |
| `docs/features/acp-mcp-bridge-design.md` | §3① 的载体（FLEET-ORCH-001）；OC-N4 已回写其 W4 |
| `docs/planning/fleet-roadmap-v2.md` | F-11（v1.2 新增）；§3 各落点对应 F-5/F-7/F-10 |
| `docs/research/berd-notes.md` | OC-RT1 的供应链锁对照（A3） |
| harness `openclaw-analysis-2026-09-14.md` | §2 事实源（§12 运行时 / §16 Nodes / §17 联邦） |

## 5. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-14 | 初稿：vk 同质化判定；OpenClaw 对照（基于 §12，误判 Node 机制=全部）；协同谱系六法 |
| v1.1 | 2026-09-14 | **勘误重写 §2**：依据分析文档 17:54 新增的 §16/§17——OpenClaw Nodes 为多机编排子系统（~74K LOC），与 FleetNode 同一问题域；对照表重写（外呼 vs 直连/私有协议 vs ACP/两步配对/三重门/worker hosting）；可采纳清单扩为 OC-N1~N7 + OC-RT1~3；§3 补 OpenClaw 先例引用；OC-N4 回写桥设计 W4 |
