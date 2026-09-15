# 规范：节点与 Agent 命名（node naming spec）

> 状态：**规范草案 v0.1，待评审**（2026-09-15）· 特性 ID：`FLEET-NAMING-001`
> 适用范围：`core/node.ts` 现状模型 + `fleet-core-service-design.md` v0.3 各面（②③⑥④）+
> acpx-export · 单一事实源：命名细则只在本篇，HUB §4bis.1 仅存摘要指针。
> 触发：用户点名"节点名字问题待明确：如何给这些节点/agent 起名称"。

## 1. 现状与问题

现状（`core/node.ts`）：`FleetNode.name` 自由文本，仅校验非空——**可重名、可含任意
字符（空格/括号/中文/emoji）**；`id` 为不可见 UUID。

名称的消费面正在从 1 个涨到 6 个：

| 消费面 | 场态 | 对名称的要求 |
|---|---|---|
| 桌面菜单/New Chat on Node | 已有 | 人读即可 |
| MCP 桥 `list_nodes`/`dispatch(node)` | 设计中（面②） | 机读稳定键 |
| ACP 面③ 路由 `_meta.fleet.node` | 设计中 | 机读稳定键 |
| 面⑥ `fleet agent --node` + **acpx-export 的 JSON5 键** | 设计中 | 安全标识符（宿主各异） |
| companion API（面④） | 设计中 | 机读稳定键 |
| 审计/日志/hop 元数据 | 设计中 | 稳定 + 可追溯 |

问题清单：**P1** 重名歧义（菜单/矩阵/审计无法区分）；**P2** 机读不安全（空格括号中文
进 JSON5 键/命令参数/URL）；**P3** 改名导致外部引用（审计行、他人导入的 acpx 条目、
`_meta` 路由）断裂；**P4** 嵌套舰队（下游 fleet 的节点在上游的命名空间）未定义。

## 2. 三层模型（核心决定）

| 层 | 规则 | 可变性 | 消费场景 |
|---|---|---|---|
| **displayName**（= 现状 `name`，字段不改名） | 任意非空文本，CJK 友好，允许修改 | 可改 | UI/菜单/看板/通知 |
| **slug**（新增，`FleetNode.slug?`） | `^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$`（1–40 字符）；保留字黑名单：`new`、`all`、`nodes`、`fleet`、`local`、`default`、`agent`、`serve` | **创建后不可变**（与 id 同级稳定性） | 一切机读场景的规范键 |
| **canonical / acpx 键**（纯派生，不落库） | 展示形 `fleet/<slug>`；acpx 键形 `fleet-<slug>`（`/`→`-`，因 JSON5 键与命令参数习惯） | 派生 | ACP 路由、审计行、acpx-export 条目 |

设计理由：displayName/slug 二分 = k8s label/name 的成熟先例；slug 不可变保证 P3 不发生；
canonical 两形解决"展示美观（斜杠层级感）"与"标识符安全（连字符）"的张力。

## 3. 派生与迁移

**派生规则**（displayName → slug 建议，UI 自动填充、用户可改）：
小写化 → 非 `[a-z0-9]` 折叠为 `-` → 去首尾 `-`、折叠连续 `-` → 超长截断至 40 →
命中保留字加前缀 `n-`。**空结果**（纯 CJK/符号名）→ 留空要求手填，或一键生成
`n-<6 位 base36>`（N-D2 决策）。

**唯一性**：registry 强制（`addNode`/重命名时校验）——**冲突报错，不做静默自动后缀**
（显式优于隐式：静默 `-2` 会让"哪个是我引用过的节点"在重导出/重装后不可判定）。

**迁移**（老节点零迁移，沿 D5 承诺）：`slug` 可选字段；读取时若缺，**懒派生并缓存**
（同 name 稳定派生，不落盘）；用户显式保存（表单/node-cli）后固化。已有重名节点在
固化前懒派生结果相同 → 固化时才触发唯一性冲突 → 逐个手改，不做批量静默改名。

## 4. 各面一致性（谁用什么）

| 面 | 用法 |
|---|---|
| ① Electron UI | 菜单/表格显示 displayName（slug 作副行/tooltip） |
| ② MCP 桥 | `list_nodes` 返回 `{slug, displayName, driver, health}`；`dispatch(node=slug)` 参数只收 slug |
| ③ fleet serve | 路由经 `_meta.fleet.node=<slug>`；agentInfo 展示 `fleet-hub (N nodes)` |
| ⑥ fleet agent / acpx-export | 命令 `fleet agent --node <slug>`；导出键 `fleet-<slug>` |
| ④ companion API | 节点字段主键 slug，displayName 附带 |
| 审计/日志/hop | 一律 canonical `fleet/<slug>`；hop 元数据（`_meta.fleet.hop`）同载体 |

**嵌套舰队**（P4，远期开放问题）：下游 fleet 节点在上游的规范名建议
`fleet/<下游 fleet slug>/<节点 slug>`——两级前缀上限 + hop 深度上限联动；M4 前不定案。

## 5. 落点与工作量

| 落点 | 内容 |
|---|---|
| `core/node.ts` | slug 校验 + 派生函数 + 保留字表 |
| `core/registry.ts` | 唯一性校验（add/update 路径） |
| `node-cli` | `--slug` 参数 + rename 时 slug 不可变提示 |
| app 镜像 | FleetNodesSection 表单（slug 输入 + 自动填充 + 冲突提示）+ i18n 三 locale |
| 测试 | 派生/唯一性/保留字/懒派生迁移/两形转换 |

估时 **0.5–1 天**；建议**并入 F-2 catalog 迭代**（同为节点元数据面，一次 schema 变更）。

## 6. 示例

| displayName | slug | canonical | acpx 键 |
|---|---|---|---|
| `dsh-local (minimax M3)` | `dsh-local-minimax-m3` | `fleet/dsh-local-minimax-m3` | `fleet-dsh-local-minimax-m3` |
| `家里的 goose`（纯 CJK） | 手填 `goose-home` | `fleet/goose-home` | `fleet-goose-home` |
| `New`（保留字） | `n-new` | `fleet/n-new` | `fleet-n-new` |

## 7. 决策点

| # | 决策 | 倾向 |
|---|---|---|
| N-D1 | slug 冲突策略 | **报错**（显式）——修订 HUB v0.3 草案曾提的"自动后缀" |
| N-D2 | 纯 CJK 名的 slug 来源 | 手填为主 + 一键短 id 兜底 |
| N-D3 | slug 不可变性 | 不可变（改名只动 displayName）；确需换 slug = 删旧建新 + 引用迁移提示 |

## 8. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-09-15 | 初稿：三层模型（displayName/slug/canonical 两形）；派生与懒迁移（老节点零迁移）；六面一致性表；N-D1~D3 决策点（N-D1 修订"自动后缀"为报错）；估时 0.5–1 天并入 F-2 |
