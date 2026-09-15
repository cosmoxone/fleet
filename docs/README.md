# fleet 文档索引

## 当前状态速览（2026-09-15）

**代码已实现**（main，2026-09-15）：
- P0–P5 全部落定（仓库骨架+契约治理 / core 调度核心 / runtime goose 驱动 + acp-smoke / P2 快照+品牌 / P3 打包管线+CI release / P4 文档 / P5 图标）；v0.1.0 release 管线跑通
- **F-1 dsh 驱动（c1–c4）**：5B 桌面验收 7/7 通过并合并（`6a95bb0`）——过程发现与复盘见 `features/dsh-driver-session-report.md` §5B + `progress/2026-09-15_5b-acceptance-retrospective.md`
- **F-2 驱动能力 catalog（S1–S5）**：设计 v0.3 实施 + 5B-lite 点检通过并合并（`64b0d68`）——单一源/codegen+CI 防漂移/UI 预门控/reconnectPolicy 修复（断线自动新会话）/节点 slug；测试 64+705 全绿
- main 领先 origin 25 commits（**未推送**，推送触发 release 流水线，时机待定）

**M0 桥试点已完成并合并（2026-09-15 晚）**：goose CLI 经 fleet-bridge 扩展指挥 dsh 节点全链路通（GOOSE-TO-FLEET-OK）。**V1 门已过（2026-09-15 晚）**：dsh-orchestra/dsh-fleet web 均非 ACP client → **fleetd 排序修正：M2-alt 面⑥（stdio agent+acpx-export，2–4 天）先行**，M2 面③ 后置；dsh 本体经 subagent-acp 即面⑥ 消费者。**下一步**：F-12 M1（fleetd 最小版+桥 attached）或 M2-alt，二选一启动

**后续路径**：`planning/fleet-roadmap-v2.md`（v1.5：F-1…F-12 + 依赖图 + §9 周历）；
精益执行顺序见 `progress/2026-09-15_hub-design-review.md` §8
（**D-1 验收合并 → F-2 catalog+命名 → M0 桥试点 → 按数据推进**）

谱系说明：fork 时期（goose fork 内做多节点扩展）→ 壳项目时期（本仓库）。
当前有效的契约治理文档是根目录 **INTEGRATION.md**（版本矩阵见 `runtime/versions.json`）。

## 当前设计

| 文档 | 内容 | 状态 |
|---|---|---|
| [REFACTORING.md](./REFACTORING.md) | 从 goose fork 到壳项目的重构设计 v1.1（定位、ACP 驱动模型、P0–P5 路线、命名、合规） | **现行** |

## v2 参考设计与研究笔记（2026-08-30 起，待评审）

| 文档 | 特性 ID | 内容 |
|---|---|---|
| [features/dsh-harness-driver.md](./features/dsh-harness-driver.md) | — | dsh 驱动设计 v1.1（已实施 c1-c3）+ 冒烟记录 |
| [features/dsh-driver-session-report.md](./features/dsh-driver-session-report.md) | — | dsh 交接单（5A/5B/§6） |
| [features/mobile-companion-design.md](./features/mobile-companion-design.md) | FLEET-MOBILE-001 | 移动端伴侣参考设计 v0.1 |
| [features/acp-mcp-bridge-design.md](./features/acp-mcp-bridge-design.md) | FLEET-ORCH-001 | ACP→MCP 编排桥（fleetd 面②）v0.3 |
| [features/fleet-core-service-design.md](./features/fleet-core-service-design.md) | FLEET-HUB-001 | fleetd 内核服务/多前端（六面 + 北向矩阵/命名）v0.3 |
| [features/node-naming-spec.md](./features/node-naming-spec.md) | FLEET-NAMING-001 | 节点与 Agent 命名规范 v0.1 |
| [features/driver-capability-catalog-design.md](./features/driver-capability-catalog-design.md) | FLEET-CATALOG-001 | **F-2 驱动能力 catalog 设计 v0.2（已自评审，待实施）** || [features/hermes-driver-design.md](./features/hermes-driver-design.md) | FLEET-HERMES-001 | hermes 接入技术方案 v1.0 |
| [features/openclaw-driver-design.md](./features/openclaw-driver-design.md) | FLEET-OPENCLAW-001 | openclaw 接入技术方案 v1.1 |
| [research/berd-notes.md](./research/berd-notes.md) | — | Block berd 对照（A1–A7） |
| [research/nf-board-notes.md](./research/nf-board-notes.md) | — | nf-board（vibe-kanban）对照（N1–N5）v1.0 |
| [research/orchestration-ecosystem-notes.md](./research/orchestration-ecosystem-notes.md) | — | 生态对照与协同方法谱系 v1.1 |
| [research/remote-node-operation-notes.md](./research/remote-node-operation-notes.md) | — | 操作远端节点六机制谱系 v1.2 |
| [research/v1-acp-client-verification.md](./research/v1-acp-client-verification.md) | — | **V1 核实：面③无消费者/面⑥有实证（F-12 排序修正）** |
| [planning/fleet-roadmap-v2.md](./planning/fleet-roadmap-v2.md) | — | v2 特性规划 v1.5 |
| [progress/2026-09-15_hub-design-review.md](./progress/2026-09-15_hub-design-review.md) | — | 设计网络四维评审记录 |
| [progress/2026-09-15_5b-acceptance-retrospective.md](./progress/2026-09-15_5b-acceptance-retrospective.md) | — | **5B 验收全历程复盘（P0-P4 排障 / M1-M8 方法论 / L1-L10 教训 / agent 最佳实践 8 条）** |
| [progress/2026-09-15_m0-bridge-retrospective.md](./progress/2026-09-15_m0-bridge-retrospective.md) | — | **M0 桥试点复盘（P0-P7 / SDK 试错 / goose 配置字段坑 / M1'-M8' 方法论）** |

## fork 时期（历史工件，快照基线 `0e17bf7..f4066f1`）

| 文档 | 内容 | 状态 |
|---|---|---|
| [DESIGN.md](./DESIGN.md) | 多节点管理 v0.x 架构（ACP 直连、CSP、菜单模型） | 历史背景；实现已并入 app/ 快照 |
| [FEASIBILITY.md](./FEASIBILITY.md) | 上游能力盘点与可行性验证（external backend、TLS/token 链路） | 历史背景；结论已被 REFACTORING §2 吸收 |
| [TESTPLAN.md](./TESTPLAN.md) | v0.6 手工冒烟计划（节点连接、i18n 菜单） | 仍可参照，随壳更新 |
| [RETROSPECTIVE.md](./RETROSPECTIVE.md) | 复盘：darwin 残留二进制、forge stdin-EOF 白屏、sandbox、set-setting 白名单、zh-CN 菜单三连 bug | 教训仍有效（打包/菜单回归时必读） |
| [PACKAGING.md](./PACKAGING.md) | 三平台交叉打包经验（W1–W7 铁律、robust-dl、三重验证） | 教训已资产化为 `scripts/verify-package.mjs` 与 CI；文档保留细节 |

> 脱敏说明：以上文档自 research 仓库迁入（2026-08-29），已核查不含个人/环境敏感信息；
> 文中 IP/指纹/哈希均为一次性示例或公开产物。
