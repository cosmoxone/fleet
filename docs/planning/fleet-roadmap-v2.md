# fleet 壳 v2 特性规划（对齐统一客户端设计）

> 文档：`docs/planning/fleet-roadmap-v2.md` · v1.0（2026-08-30 19:03，基于两仓现行文档）
> 输入依据：dsh-fleet `docs/unified-client.md` **v2.4**（权威）、`docs/roadmap.md` v1.1（4.7/4.8）；
> wb-knowledge `docs/requirements.md` v2.7（FR-39/40/41）、`docs/architecture.md` v1.9（§6/§7）、
> `docs/strategy-plain.md` v1.4；本仓既有决策清单 `docs/progress/2026-08-30_1738-*.md` §4（D-1~D-8）。
> 本文回答：**在生态规划下，fleet 仓后续开发什么、按什么顺序、守什么纪律。**

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
| CU0 spike（WebView 载 dsh web / token→cookie / profile 隔离 / 双插件族同装 / /api 客户端 / 内存实测）：**目标壳=cosmoxwork，两仓共享协议，任一仓先跑通回写** | roadmap 4.7（S1-S6，互审 O2） |
| 分发基建（签名/公证/更新器/HarnessRuntime/手机桥按需）= CU2 前置，**从 dsh-desktop 移植**（MIT） | roadmap 4.8；unified-client §9 |

**一句话**：fleet 仓 = **舰队页供给方 + 内核共享包孵化器 + 骨架验证场**；装修（账户/计费/品牌）不在此发生。

## 2. 与既有决策清单（D-1~D-8）的调和

| 原决策 | 生态语境下的修正 |
|---|---|
| D-1 dsh 验收合并 | 不变，仍是一切前置（roadmap Phase 0 同构的"决策门 G0"思想） |
| D-3 A2 能力 catalog 化 | **升格**：从"app 门控优化"→"舰队页的驱动能力面内核"；按 §8.4 定性为**共享包方向**（先仓内落地，触碰即下沉） |
| D-4 A1 stdio 桥驱动 | 同为**驱动层内核**（fleet 仓先验证，两壳皆可消费）；spike 结论将决定发包形态 |
| D-5 移动端 M1-M3 | 与 CU2"手机桥按需"**对齐时点**；且 dsh-desktop 938 行手机桥为 MIT 可移植件——M1 可大幅加速（试点切片仍可先行验证价值假设） |
| D-7 A3-A7 | A3（供应链锁）在"本地 provision/桥安装"时直接采用 berd 模式，与共享包治理合并考虑 |
| D-8 cordis drift 反馈 | 不变，随手 |

**张力说明**：§8.5 的"fleet 壳不做新特性"与本仓规划并不冲突——本仓新开发定性为三类：①舰队页本职（两壳共享的唯一原生面）；②内核共享包孵化（优先级 3"顺带做"的载体）；③骨架验证（CU0 spike 可由本仓承担，产出回写共享协议）。纯"装修类"功能（账户/计费/品牌）不做。

## 3. 特性路线图（三轨）

### 轨道 ①：舰队页本职（fleet 本行，最高优先）

| # | 特性 | 内容 | 状态/估时 | 生态角色 |
|---|---|---|---|---|
| F-1 | dsh 驱动合并 | 5B 验收 → §6 合并 | **待人工（D-1）** | 舰队页 goose+dsh 双驱动 |
| F-2 | **驱动能力 catalog**（=A2 升格） | `DriverCapabilities` 扩应用层能力面；dsh 用 acp-contract.json 生成；UI 入口预门控 + `remote (cordis.yml)` 文案修复；暴露 `GET /companion/capabilities` 形态的查询面 | 合并后 1–2 天 | **内核共享包候选 #1**（两壳舰队页共用） |
| F-3 | **本地 stdio 桥驱动**（=A1） | 接 @agentclientprotocol 官方桥（codex/claude）；先 spike 后排期 | A2 后 spike 1–2 天 | 驱动层内核；fleet 壳差异化（单机多 harness） |
| F-4 | 快照刷新治理 | 定期刷 goose ui/desktop 快照（INTEGRATION 既有流程）；插件兼容验证纳入回归 | 例行 | 维护模式本职 |

### 轨道 ②：统一前端骨架（CU0-CU1，本仓承担 spike 与内核）

| # | 特性 | 内容 | 估时 | 说明 |
|---|---|---|---|---|
| F-5 | **CU0 工作台页骨架**（S1-S6 spike） | WebContentsView 加载 sidecar dsh web；token→cookie 桥；DSH_HOME/profile 隔离；wb+fleet 插件族同 profile 共装验证；壳主进程作 /api 客户端；内存/启动实测 | spike 1–2 周 | **待跨仓确认归属**（决策 P1）；按互审 O2，产出（命令/脚本/坑）回写本仓 docs 供 cosmoxwork 引用。V0 门：S1+S2 不通=全案重估 |
| F-6 | **sidecar 集成 = 节点零号** | 消费 `@wb/dsh-sidecar-host`（A11 共享包）把本地 dsh 注册进舰队：node-00 探活/会话语义与远端统一 | F-5 后 1 周 | 舰队页纯增益；总控派发语义同源 |
| F-7 | 知识注入派发钩子（CU1 预留） | 派发 prompt 上下文可携带 kb 引用（走 kb_search 工具面，不新增协议） | 预留接口，~2 天 | 仅拼装钩子，检索本体在 wb 侧 |
| F-8 | **内核共享包化** | F-2/F-3/F-5/F-6 产出的苦活（驱动层/catalog/sidecar 嵌入/更新器）按 §8.4 下沉 `@cosmoxone/*`；CI 版本矩阵校验两壳契约一致；度量共享包覆盖率（目标 80%+） | 伴随各特性 | 防漂移纪律：新增苦活只进包，不落壳 |

### 轨道 ③：分发与移动（CU2 前置 + 手机桥）

| # | 特性 | 内容 | 估时 | 说明 |
|---|---|---|---|---|
| F-9 | 分发基建移植 | electron-updater/签名/公证/HarnessRuntime 布局（dsh-desktop 清单，MIT+出处标注） | 1–2 周 | fleet 壳自身受益（现无更新器）；CU2 前置 |
| F-10 | 移动端 companion（M1-M3） | 按既有 `mobile-companion-design.md`；**M1 可移植 dsh-desktop lan-mobile-bridge 加速**（QR/RPC 白名单/隧道/mux 六模式现成） | M1 ~1 周（移植后缩短） | 时点跟随 CU2 或 G-合并结果；能力门控依赖 F-2 |

### 依赖图

```
F-1(dsh合并) ──► F-2(catalog) ──► F-3(stdio驱动 spike→排期)
                    │
                    ├──► F-10(移动端 M1;需 F-9 部分件)
                    └──► F-5(CU0 骨架,待P1) ──► F-6(节点零号) ──► F-7(kb注入钩子)
F-8(共享包化) 伴随 F-2/F-3/F-5/F-6 持续进行
```

## 4. 新增决策点（P1-P4，跨仓对齐；并入进展文档决策清单）

| # | 决策点 | 选项与倾向 |
|---|---|---|
| P1 | **CU0 工作台页骨架归属**：本仓做内核+骨架（推荐——Electron 工程已在、产出可回写共享协议）vs 全部在 cosmoxwork 仓做 | 倾向本仓承担 spike（定性为内核孵化，不违反 §8.5）；需 dsh-fleet/wb 侧确认 |
| P2 | 共享包命名与仓库位置：`@cosmoxone/*` 独立小仓 vs 本仓 `packages/` 先行后迁 | 倾向先仓内孵化（F-2/F-3 天然在本仓），发包时机随 CU1；对齐 A11 六决策 |
| P3 | A1 本地 stdio 桥驱动的产品归属：开源壳特性（推荐）vs cosmoxwork 专属 | 倾向开源（驱动层=内核；引流价值高） |
| P4 | 移动端 M1 时点：CU2"按需" vs A2 后提前 | 倾向提前做半天试点切片（零风险验证），正式 M1 跟 CU2；G-合并 结果可加速 |

## 5. 纪律与风险

| 纪律/风险 | 应对 |
|---|---|
| "fleet 壳不做新特性"边界 | 本仓只做：舰队页本职/内核孵化/骨架验证；账户·计费·品牌一律不做（装修在 cosmoxwork） |
| 壳间抄代码（防漂移红线） | F-8：苦活只进共享包；触碰即下沉（strangler 式 C2） |
| CU0 V0 门 | S1（WebView 加载）+S2（token→cookie）不通 → 统一前端方案全案重估（两仓既定） |
| 快照刷新与上游漂移 | F-4 例行；插件兼容验证进回归清单 |
| 文档不一致（跨仓） | wb `FR-39` 仍残留"基座=dsh-desktop"（v0.7 遗留），与 FR-41/unified-client v2.4 冲突 → 建议反馈 wb 侧清理（并入 D-8 一并提） |
| 三仓节奏耦合 | 决策门沿用：G0（dsh 验收）→ G-合并（双域交叉观测）→ G-壳收敛（CU2 评估） |

## 6. 建议的近期执行序列（更新版）

```
1. D-1:5B 桌面验收 → 合并 dsh(唯一阻塞)
2. F-2/A2:驱动能力 catalog(1-2 天;含文案修复;共享包方向第一个件)
3. F-3/A1:stdio 桥 spike(1-2 天)——与 P3 决策联动
4. F-5/CU0:工作台页骨架 spike(待 P1 确认;1-2 周)——统一前端落地第一步
5. F-9 分发基建 / F-10 移动端 M1(跟随 CU2 或 G-合并;可先试点切片)
并行:F-8 共享包化纪律贯穿;F-4 快照例行
```
