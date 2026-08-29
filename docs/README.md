# fleet 文档索引

谱系说明：fork 时期（goose fork 内做多节点扩展）→ 壳项目时期（本仓库）。
当前有效的契约治理文档是根目录 **INTEGRATION.md**（版本矩阵见 `runtime/versions.json`）。

## 当前设计

| 文档 | 内容 | 状态 |
|---|---|---|
| [REFACTORING.md](./REFACTORING.md) | 从 goose fork 到壳项目的重构设计 v1.1（定位、ACP 驱动模型、P0–P5 路线、命名、合规） | **现行** |

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
