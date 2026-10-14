# 进展快照：v0.2.0 收口后的当前主要工作盘点

> 日期：2026-10-14 21:42 · 性质：**状态快照（文档盘点，非过程复盘）**
> 基线：main @ `e7b03e2`（**v0.2.0 tag**，2026-09-16 00:24；此后至 2026-10-14 无新提交）
> 输入：`planning/fleet-roadmap-v2.md` v1.5 · `docs/README.md` 状态速览 ·
> `progress/2026-09-15_hub-design-review.md` §8 · `progress/2026-09-15_{5b,m0,night}_*.md` 复盘三篇
> 本文回答：**v0.2.0 之后，当前主要工作有哪些、按什么顺序。**

## 1. 项目背景一句话

**fleet** = 多 Agent ACP 编排壳（goose 首驱动、dsh 第二驱动），生态定位
"舰队页供给方 + 内核共享包孵化器 + 骨架验证场"（roadmap §1）。
**2026-09-16 凌晨收口 v0.2.0 tag**（夜班车：fleetd M1 全量 + hermes 全链路 +
F-3 桌面回环 + CI 抢修转绿；测试 106+707）。

## 2. 已收口（v0.2.0，2026-09-16，无需再管）

| 项 | 内容 | 证据 |
|---|---|---|
| F-1 | dsh 驱动（c1–c4）5B 桌面验收 7/7 合并 | `6a95bb0` |
| F-2 | 驱动能力 catalog（S1–S5：单一源/codegen+CI 防漂移/UI 预门控/reconnectPolicy/slug） | `64b0d68` |
| F-3 | stdio 桥驱动 spike（含 N1：ssh=command 模板）+ 桌面回环物化（stdio 节点可开窗） | `cac1201` |
| F-11 M0 | ACP→MCP 编排桥试点（goose CLI→fleet→dsh 全链路） | GOOSE-TO-FLEET-OK |
| F-12 M2-alt | 面⑥ `fleet agent` stdio agent + `acpx-export`（真节点 E2E 双模式） | AGENT-M2ALT-OK / HUB-ROUTE-OK |
| F-12 M1 | fleetd 全量：loopback 服务 + 桥 attached/回落 + 权限中枢 + 会话管理器 + companion 面④ | FLEETD-DIRECT/ATTACHED/FALLBACK-OK |
| B1 | hermes 全链路接入（"填表即接入"实证：1 个 settings 条目 + 超时调整） | HERMES-B1-OK |

## 3. 当前主要工作（按 roadmap 三轨）

### 3.1 轨道① 舰队页本职（最高优先）

| 项 | 内容 | 状态 |
|---|---|---|
| F-3 增量 | 官方桥（claude/codex）实测 | **等网络环境** |
| F-11 M1 | 桥 attached 正式模式（P8–P10） | 待 fleetd 决策 |
| F-4 | goose ui/desktop 快照刷新治理 | 例行（每次 +0.5 天回归） |

### 3.2 轨道② 统一前端骨架（下一步关键路径）

- **F-5 CU0 工作台页骨架**（S0 sidecar 拉起 → S1 WebContentsView → S2 token→cookie → … S6）
  ——Day-1 冒烟 = S0+S1+S2（0.5–1 天，**V0 门：不通则统一前端全案重估**）
  ——**待 P1 归属确认**（倾向本仓承担；若 cosmoxwork 仓做则本仓退为契约测试+文档回写）
- **F-6** sidecar 注册为"节点零号"（P5 注册模型：goose-local 默认 + dsh-sidecar 可选开关）→
  **F-7** 知识注入派发钩子（走 kb_search 工具面）→
  **F-8** 首个共享包 `@cosmoxone/*`（F-2/F-3 苦活下沉；F-11 桥为候选）
- **F-12 M2**（面③ ACP passthrough server）**后置**——V1 已核实 dsh-orchestra/dsh-fleet web
  均非 ACP client，无近期消费者（`research/v1-acp-client-verification.md`）

### 3.3 轨道③ 分发与移动

- **F-9** 分发基建移植（electron-updater/签名/公证/HarnessRuntime，1–2 周；fleet 自身现无更新器；CU2 前置）
- **F-10** 移动端 companion M1（companion 面④ 已有雏形；只移植 dsh-desktop 工程件——
  QR 配对 TTL/隧道 provider/mux 重连/body cap，**API 面按契约 5 自建**）

## 4. 挂账问题（夜班车复盘遗留）

| 挂账 | 归属 | 下一步 |
|---|---|---|
| openclaw 模型鉴权 | 用户侧 | 配好即完成 B1 半程 |
| openclaw acp 二连 bug（首连成、二连 legacy-auth 拒绝） | 上游 | 反馈上游 |
| **dsh 桥静默死亡 ×5** | 上游 | 已升级为"干扰工作流的常发故障"——建议桥看门狗或优先上游修复 |

## 5. 待决策点（评审要求活跃决策点收敛回 ≤6）

| # | 决策 | 倾向 |
|---|---|---|
| **P1** | CU0 工作台页骨架归属（**当前最关键，F-5 前置**） | 本仓承担 |
| P2 | 共享包命名/位置（CU1 前发包定名） | 先仓内孵化 |
| P5 | 本地双运行时注册模型与默认节点 | goose-local 默认 + dsh-sidecar 开关 |
| P6 | 开源壳匿名埋点 | 默认关、opt-in、本地优先 |

（P7 已关闭、P11 并入 P5、P13 默认即终态——见 hub-design-review §6-E2。）

## 6. 未入账工件（2026-10-14 盘点发现，本次提交已入库）

以下 3 篇研究文档（2026-09-16 产出）盘点时**未 git add、未入 docs/README 索引**，
已随本快照提交一并入库并补索引行：

- `research/goose-architecture-analysis.md`（v1.50.1 @ 881f96c00 源码实测）
- `research/claude-code-architecture-analysis.md`（泄漏源码社区分析汇总，v2.1.88 基线）
- `research/comparison-with-harness-analyses.md`（五引擎对比：goose/CC/codex/dsh/openwork）

## 7. 一句话结论 / 下一步

按精益执行顺序（hub-design-review §8），D-1→F-2→M0→F-3/fleetd M1 均已走完；
**当前下一站 = F-5 CU0 Day-1 冒烟（前置：确认 P1 归属）**，随后 F-6→F-8 首个共享包；
并行可清挂账（openclaw 鉴权 / dsh 桥看门狗）。同时守住评审警示：
**冻结新设计文档增长，先出代码**（防"规划剧场"）。

## 8. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-10-14 | 初稿：v0.2.0 基线盘点（已完成/三轨待办/挂账/决策点/未入账工件） |
