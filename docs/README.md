# fleet 文档索引

## 当前状态速览（2026-09-15）

**代码已实现**：
- **main**：P0–P5 全部落定（仓库骨架+契约治理 / `core/` 调度核心 35 测试 / `runtime/` goose 驱动 + acp-smoke / P2 快照+品牌 / P3 打包管线+CI release / P4 文档 / P5 图标）；v0.1.0 release 管线跑通
- **`feature/dsh-driver`**（领先 main 7 commits）：dsh 驱动 c1–c4 **已实施并通过 5B 桌面验收（2026-09-15 17:51，7/7）**——验收记录与过程发现见 `features/dsh-driver-session-report.md` §5B（F-1 已修；F-2 转 catalog `reconnectPolicy`；F-3 待上游反馈）
- 2026-09-14/15 会话：纯设计产出（下表 9 新 + 2 改，**未提交**），零代码变更

**已设计待实施**（参考设计，见下表）：ORCH-001 桥 / HUB-001 fleetd / NAMING-001 / HERMES-001 / OPENCLAW-001

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
| [features/hermes-driver-design.md](./features/hermes-driver-design.md) | FLEET-HERMES-001 | hermes 接入技术方案 v1.0 |
| [features/openclaw-driver-design.md](./features/openclaw-driver-design.md) | FLEET-OPENCLAW-001 | openclaw 接入技术方案 v1.1 |
| [research/berd-notes.md](./research/berd-notes.md) | — | Block berd 对照（A1–A7） |
| [research/nf-board-notes.md](./research/nf-board-notes.md) | — | nf-board（vibe-kanban）对照（N1–N5）v1.0 |
| [research/orchestration-ecosystem-notes.md](./research/orchestration-ecosystem-notes.md) | — | 生态对照与协同方法谱系 v1.1 |
| [research/remote-node-operation-notes.md](./research/remote-node-operation-notes.md) | — | 操作远端节点六机制谱系 v1.2 |
| [planning/fleet-roadmap-v2.md](./planning/fleet-roadmap-v2.md) | — | v2 特性规划 v1.5 |
| [progress/2026-09-15_hub-design-review.md](./progress/2026-09-15_hub-design-review.md) | — | 设计网络四维评审记录 |

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
