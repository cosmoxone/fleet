# harness 分析与 goose 分析对比报告（含 Claude Code）

> 日期：2026-09-16（同日增补 Claude Code 对比项）
> 输入：
> - `/home/pc/proj/harness/analysis/codex-appserver-analysis.md`（v1.1，2026-08-30 快照）
> - `/home/pc/proj/harness/analysis/dsh-vs-opencode.md`（v1.1，双仓库源码实测）
> - `/home/pc/proj/harness/analysis/openwork-dsh-relationship-and-rewrite.md`（v1.1，三仓库勘察）
> - 参照：harness/analysis `goose-architecture-analysis.md`（v1.2，2026-08-30 快照）
> - 本文 goose 侧事实源：[goose-architecture-analysis.md](goose-architecture-analysis.md)（**v1.50.1 @ 881f96c00，2026-09-16**，本目录）
> - 本文 Claude Code 侧事实源：[claude-code-architecture-analysis.md](claude-code-architecture-analysis.md)（基于 2026-03-31 source map 泄漏的社区分析汇总，v2.1.88 基线）
> 结论效力：goose 列以 v1.50.1 代码为准；CC 列为二手分析（闭源，仅架构参考）；其余三引擎沿用 harness/analysis 基线（2026-08-30）

---

## 1. 两套分析的方法论差异

| | harness/analysis 系列（A 组） | docs/ goose 分析（B 组） |
|---|---|---|
| 导向 | **选型驱动**：EngineAdapter 候选、逐维对照、"什么需求选什么"判据 | **工程驱动**：代码阅读路线、贡献规则、常见坑——面向在仓库内干活 |
| 框架 | what-is-a-harness 五要素（循环/上下文/受控副作用/状态/反馈观测）+ 六态谱系，跨文档互引 | 单项目纵向四章：全景架构 → 最新进展 → roadmap 考古 → 桌面 Update 专章 |
| 时间维度 | 横向：多引擎同一时刻切片 | 纵向：git log 主题分组（安全主线/GDK 扩张/状态机推进） |
| 基线 | 2026-08-30/31 快照 | 2026-09-16 @ v1.50.1 |
| 知识管理 | 版本记录表 + 事实修订附录（断言可溯源） | "与旧资料差异修正"附录（对 A 组构成增量修订） |

（CC 分析为第三种形态：**逆向/泄漏驱动**——对象闭源，事实全部来自社区对泄漏源码的分析，无法本地验证演进。）

关系判定：**互补而非重叠**——A 组回答"goose 在引擎光谱中处于什么位置"，B 组回答"goose 内部怎么长的"。

## 2. 五引擎架构总对照表

> goose 列基于 v1.50.1 实测；dsh/opencode 列取自 [dsh-vs-opencode.md](../../harness/analysis/dsh-vs-opencode.md)；codex 列取自 [codex-appserver-analysis.md](../../harness/analysis/codex-appserver-analysis.md)；CC 列取自 [claude-code-architecture-analysis.md](claude-code-architecture-analysis.md)（泄漏 v2.1.88）。

| 维度 | codex | opencode | dsh | goose (v1.50.1) | **Claude Code (v2.1.88†)** |
|---|---|---|---|---|---|
| 出品方/治理 | OpenAI，Apache-2.0 | Anomaly/sst 社区，MIT | DeepSeek，MIT，0.1.x pre-release | Block 起家 → **AAIF 基金会**，Apache-2.0 | Anthropic，**闭源**（2026-03-31 source map 泄漏） |
| 技术栈 | Rust monorepo ~50 crates | TS/Bun，Effect-TS 服务化进行时 | TS/Node + Cordis 全插件，~150 包 | Rust workspace 16 crates + Electron/React 桌面 | TS + Bun + **Ink（React 终端渲染）**，~512K 行 |
| **架构哲学** | **门面模式最强形态**：宽而专有的版本化 RPC 门（33 域） | **产品内核 + 钩子插件**，内核服务化抽取中 | **无特权内核**：一切皆插件，发行物=配置树 | **内核 + 开放协议门面**：自有 server 层已删（#10224），协议面让位公共 ACP | **产品即内核**：简单 while 循环 + 循环外围系统（权限/压缩/扩展/编排），无引擎边界 |
| 宿主接入面 | app-server v1/v2，33 域（账号/attestation/插件搜索/remote_control） | `opencode serve` HTTP+SSE+auth；ACP 为**桥接** | stdio JSON-RPC（TS+Py SDK）；ACP **原生** profile | `goose serve` → `/acp` WebSocket+token；ACP **原生** | **无官方开放协议面**——终端产品本体；嵌入走 claude-agent-sdk/外部 ACP 适配 |
| 传输 | stdio + websocket + **in-process 内存通道** | HTTP 网络优先 | stdio 优先 | WebSocket（宿主 spawn 子进程后连接） | 进程内（CLI 单进程）；remote bridge/tmux mailbox 为任务类型 |
| 进程模型 | **daemon 托管**（managed install/update loop/跨会话浏览） | HTTP server 常驻 | **无 daemon**，宿主直管子进程 | **无 daemon**，宿主 spawn（`gooseServe.ts`） | 单进程 CLI；多 agent 为同进程异步任务（in_process_teammate） |
| 循环形态 | core 引擎一体 | session/agent 内核代码 | agent-loop 是插件，可整体替换 | **状态机算子化**（`ops_*` 一等算子），legacy 双轨迁移中 | **流式 async generator**（`query()` 逐事件 yield；并发分区批执行+sibling 联动取消） |
| 上下文管理 | —（未深挖） | session/compaction + overflow | compaction 插件家族 + spill | `goose-context-management` 分层 + moim 多模型编排 | **渐进式压缩管道**（micro→auto→session-memory→reactive 四级阈值）+ memdir 持久记忆 + **Dream 后台固化**——五家最精细 |
| 会话/存储 | thread/turn/item 三层 + 历史投影 | effect-sqlite/drizzle + 事件投影（无 fail-closed） | append-only 事件日志 + **fail-closed 词汇表** | session/ 持久化 + 跨会话搜索 + 多格式导入 | append-oriented JSONL + 子代理独立 sidechain 转录 |
| 工具体系 | 引擎内建（core crate） | read/edit/**apply_patch**/glob/grep/shell/lsp | bash/fs/web/lsp/terminal(pty)/subagent 家族 | MCP 70+ + 内建 5 个 MCP server + **MCP server runner** | 核心常驻 + 特性门控 + **延迟加载（ToolSearchTool 按需取 schema）** + 动态 MCP |
| 沙箱/安全 | execpolicy（Seatbelt+Landlock）+ windows_sandbox/attestation 域 | 无内核级沙箱（依赖宿主/容器） | landlock/ACL + 审批 waterfall + 输出有界性 | permission 体系 + **extension_malware_check（五家唯一）** | 无内核级沙箱；**per-action 权限管道**（7 模式 + LLM 分类器 auto 模式 + 7 层安全机制） |
| Provider | OpenAI 系 | models.dev 社区目录 50+ | llm seam + pi-ai 目录 + OAuth 热刷新 | 30+ 原生 + **ACP 包装型（竞品 CLI 当后端）** | Anthropic 1P / Bedrock / Vertex |
| Subagent | — | task 工具 + markdown agent | 家族（fork/spawn/acp/claude-code/codex/dsh-sdk） | subagent_execution_tool/handler + summon 体系 | **三级编排**（sub-agent → coordinator → 持久 team）+ **fork 缓存共享优化** |
| 扩展机制 | config/plugin/hook**协议域** + plugin_search | JS hooks 模块 + opencode.json + markdown | 全插件（Service Definition/Provider/Consumer seam） | MCP + skills + recipes + hooks + goose apps + scheduler | **四件套 MCP/plugins/skills/hooks**（16 事件×5 类型×8 配置源）——行业概念源头 |
| 通道/远程化 | remote_control 配对（云/移动驱动本地） | share（云分享）/control-plane/sync | 无（dsh-desktop 有手机桥） | **roaming（iroh P2P）+ gateway/telegram**——最激进"外联化" | remote_agent/tmux mailbox；无 roaming 级外联 |
| SDK | 无独立 SDK 包（npm 仅二进制包装） | `@opencode-ai/sdk`（HTTP） | TS + Python 双语官方 SDK | **GDK**：goose-agent + uniffi 多语言绑定，release-plz 独立发版 | claude-agent-sdk（官方宿主嵌入手）；npm 分发 |
| 工程文化 | 协议版本化演进（v1/v2 并存） | 迭代速度优先（src 零测试） | 极端纪律（100% 覆盖率门禁/录制回放） | 887 commits/90天、release-plz 全自动、buzz 机器人 | GrowthBook/Statsig 特性门控 + 死代码消除、60fps UI 指标——**产品实验文化** |
| 消费者定位 | 自家产品优先（ChatGPT 桌面/移动） | 开箱即用 + 社区生态 | 第三方嵌入/白标优先 | 桌面/CLI/GDK 三平级，基金会治理 | **终端开发者（CLI 产品本体）** |

† CC 列全部来自泄漏源码的社区分析（详见事实源文档），闭源不可本地验证，仅作架构参照。

## 3. 趋同点（全行业信号）

1. **宿主接入面军备竞赛**：四家引擎（codex/opencode/dsh/goose）全部长出官方宿主接口——竞争重心上移到编排与产品层；**CC 是反例印证**：作为最成功的产品它反而无开放宿主面，说明"产品力 ≠ 引擎开放性"，引擎开放是给"别人做产品"铺路的
2. **JSON-RPC over stdio 为公共底座**；插件/hooks/MCP 三件套概念趋同——**概念的共同源头是 CC**（skills/hooks/CLAUDE.md/权限模式）：dsh 的"CC hooks 桥"直接复用 hooks.json，goose 的 skills/hooks、opencode 的 markdown agent 均为同源演化
3. **本地 agent 被云与手机驱动**：remote_control（codex）↔ roaming+telegram（goose）↔ share/control-plane（opencode）↔ 手机桥（dsh-desktop）↔ remote bridge（CC）
4. **上下文压缩分层化**：CC 四级渐进管道 → goose context-management 分层 / dsh compaction 家族 / opencode compaction+overflow——各家用不同实现回应同一问题
5. "内核可嵌入化"同向：codex in-process 宿主 ↔ goose-agent（GDK）↔ opencode core 抽取 ↔ dsh sdk-minimal ↔ CC claude-agent-sdk

## 4. 哲学光谱定位

```
门面宽度 ──────────────────────────────────────────► 协议标准化程度
codex(33域专有宽门)  opencode(HTTP产品面)  dsh(组合树)  goose(ACP公共窄门)
        CC（无门面：产品即内核，终端原生）—— 光谱之外的参照系
└── 内核均不可替换（codex/goose/CC/opencode）────┘  └── 全可替换（dsh）┘
```

- **codex 是"给引擎装一扇正式的宽门"**：域越宽越好，引擎内部一体化
- **dsh 是"让整棵树可重组"**：没有门面与内核的分界
- **opencode 是"产品即内核，钩子即扩展"**
- **goose 是"内核最强工程化 + 门面让位开放标准"**：不与 codex 比门面宽度，换生态位
- **CC 是"根本没有引擎边界"**：产品本体即内核（arXiv："核心是简单 while 循环，代码都在循环周围"）——它是其余四家的**概念输出者与模仿对象**，但不参与"可嵌入引擎"竞争
- 循环维度独一档：goose 把 harness 工程实践**编译进内核算子**（`ops_*`）；CC 用 generator 语义实现同等检查点能力——两种"把工程实践结构化"的路线

## 5. 对 harness/analysis 侧 goose 文档（v1.2）的修正清单

| # | A 组表述 | v1.50.1 事实 |
|---|---|---|
| 1 | （隐含 goose-server/goosed 存在；本仓库根 AGENTS.md 同样过时） | **goose-server crate 已删除**（#10224）：桌面 spawn `goose serve` 走 ACP over WebSocket |
| 2 | 内建扩展含 developer/subprocess 等 | 内建 MCP server 仅 5 个；developer 子系统已并入 `goose` crate 的 `agents/platform_extensions` |
| 3 | provider "重构中" | `goose-providers`/`goose-provider-types` crate 已立（openrouter 已迁入 #11757）；ACP 包装型 provider 持续增加 |
| 4 | crates ~25 个 | workspace 16 crates（`goose` 本体 167K LOC 占绝对主体） |
| 5 | — | 新增结构性事实：桌面 auto-updater 重写（zip+目录交换，#10614）、ACP npm 包拆分（#11846）、buzz 自动化（"issues are the new PRs"） |

A 组的谱系判断（goose 仍为"引擎"形态、通道层外联化激进）在 v1.50.1 上**成立且更强**。

## 6. 对 EngineAdapter 选型的含义（更新 A 组结论）

| 需求 | 更优选择 | 备注 |
|---|---|---|
| 标准协议接入、避免专有绑定 | **goose（ACP 原生）** / dsh | opencode 为桥接实现 |
| 多语言嵌入（Kotlin/Python/npm） | **goose GDK** / dsh 双 SDK | codex 无独立 SDK 包 |
| 协议域最宽（账号/遥测/attestation） | codex app-server | 专有但版本化 |
| 白标/换 loop/深度审计 | dsh | 组合模型无可替代 |
| 远程/移动驱动本地 agent | **goose（roaming+telegram）** / codex remote_control | — |
| 开箱即用编码 agent + 社区模型目录 | opencode | — |
| 借鉴 per-action 安全与压缩管道设计 | **CC（架构参照）** | 闭源不可依赖；经 claude-agent-sdk 或 ACP 适配器间接消费 |

五候选中 CC 定位特殊：**架构教科书而非可嵌入引擎**——其权限管道、渐进压缩、延迟工具加载、fork 缓存优化是其余引擎已在追赶的设计基准。

---

## 相关文档

- [goose-architecture-analysis.md](goose-architecture-analysis.md) — goose 侧事实源（v1.50.1）
- [claude-code-architecture-analysis.md](claude-code-architecture-analysis.md) — Claude Code 侧事实源（泄漏 v2.1.88 社区分析汇总）
- [REPO-UPDATE.md](REPO-UPDATE.md) — 本目录转为 v1.50.1 研究目录的更新记录
- harness/analysis: codex-appserver-analysis / dsh-vs-opencode / openwork-dsh-relationship-and-rewrite / goose-architecture-analysis(v1.2) — 对比输入
