# REFACTORING — 从 goose fork 到壳项目（shell）的重构设计

**版本**: v1.1 · 2026-08-29（v1.0 · 2026-08-28）
**动机**: 项目定位澄清 —— 本项目是**多 Agent 调度（fleet）的壳项目**，不是 goose 的发行版。goose 一律以"拉取 + 引用"方式消费（二进制 / 构建产物 / npm 包），不承担 goose 源码维护义务。
**取代**: 本文取代此前"fork 内改名发布"方案（见 §3 review）。
**v1.1 决策记录**（2026-08-29 用户拍板）:
1. 壳名定为 **fleet**（§9 由候选清单改为已决策，附同名冲突分析）；
2. 后端开放性升级：契约从"goose serve 专用"提升为 **ACP 驱动抽象**——goose 是首个驱动，目标支持众多 ACP 兼容后端（deepseek harness 等）（§5）；
3. 落地形态定为**新仓库**（§11）。

---

## 1. 定位声明（本次重构的第一性原则）

| 原则 | 含义 |
|---|---|
| 壳项目 | 我们拥有的是：调度核心 + 桌面壳（窗口/菜单/节点管理 UI）。goose 是被编排的运行时，不是被维护的代码库 |
| 拉取和引用 | goose 后端 = 官方 release 二进制注入；goose UI = 一次性快照（快照后内部化）；goose 协议 = 上游公开 CLI 契约 |
| **后端开放（v1.1）** | 后端契约 = **ACP（Agent Client Protocol）+ 传输安全**，不是 goose 私有协议。goose 是**首个驱动**而非唯一目标；deepseek harness 等 ACP 兼容后端通过同一驱动接口接入 |
| 核心资产 | `core/` 多 Agent 调度（节点生命周期、路由绑定、健康、策略）。UI 与打包都是 core 的宿主 |
| 上游共生 | 通用小修复（如 userData 覆盖）回馈上游 PR，而不是留在 fork 里 |

## 2. 事实基础（重构决策的依据，全部来自代码验证）

### 2.1 fork 改动的定性：30 文件 +2456/-628，**Rust 后端零改动**

| 类别 | 文件 | 定性 |
|---|---|---|
| 纯调度逻辑 | `utils/fleet.ts`(+99) + `fleet.test.ts`(+131) | ✅ 已是纯函数（cbd8342 提取），可直接迁 `core/` |
| 节点管理 UI | `FleetNodesSection.tsx`(+286) + 测试 + `SettingsView` 挂载(+2) + `settings.ts`(+12) | 🔁 迁壳层，从"goose 设置页内嵌"改为"壳自有设置页" |
| main 进程编排 | `main.ts`(+205)：per-window `backendId` 绑定、fleet 菜单注入/热重建、`GOOSE_USER_DATA_DIR` 多实例(8行)、节点错误软化、窗口标题 | 🔁 迁壳层：这些是"壳"的本职代码，快照后归我们所有 |
| i18n | 15 个 locale(+~1400) | 🔁 迁壳层；壳只需维护自己支持的 locale 子集 |
| 安全 | `csp.ts`(+50) 多节点 CSP origins + 测试 | 🔁 迁壳层 |
| 打包 | `forge.config.ts` `resetAdHocDarwinSignature`(1行) | ✅ Linux 交叉打包经验，直接进壳 forge 配置 |
| 治理文档 | `PATCHES.md` `UPSTREAM.md` | ❌ 终结 —— 快照后无 patch 概念，换 INTEGRATION.md |
| 冒烟 | `ui/acp-smoke.mjs` | ✅ 升级为壳的契约测试 |

### 2.2 上游原生能力盘点（决定"引用"可行性）

| 能力 | 出处 | 状态 |
|---|---|---|
| `goose serve --host --port [--tls]` + `GOOSE_SERVER__SECRET_KEY` | 上游 CLI（`serve-node.sh` 只是包装） | ✅ 节点侧 = **原版 goose，零改动** |
| 桌面连接外部后端：`GOOSE_EXTERNAL_BACKEND` env / `externalGoosed` 设置 / secret + TLS 指纹 | 上游 `main.ts` `getExternalBackendUrlFromEnv()` 等 | ✅ **上游原生**。fork 只是把它从"1 个"扩展为"N 个命名节点 + 每窗口绑定" |
| `@aaif/goose-sdk` npm 包 | 上游 | ✅ 壳的类型/协议引用面 |
| 桌面多实例 | ❌ `main.ts:478` `requestSingleInstanceLock()` | **被上游阻断** —— "N 个官方桌面实例"路线不可行，壳（自有 main）是唯一形态 |
| `GOOSE_USER_DATA_DIR` | fork 添加 8 行 | ⚠️ 壳内天然不需要（自有 userData 目录）；若做管理台模式则需上游化 |

### 2.3 结论

> **fork 的本质 = 上游"单外部后端"能力的多路复用编排层，全部落在 Electron 壳层。**
> 这正是"壳项目"定位的实证：把编排层搬进自有仓库，goose 以原样引用，fork 即可终结。

## 3. 旧方案 review（保留 / 作废 / 转变）

| 旧方案条目 | 处置 | 理由 |
|---|---|---|
| A. 双仓库合并进 fork 仓库 | **作废** | 改为新建壳仓库；goose fork 仓库归档为 research 工件 |
| B1. 第 1 层改名（productName/forge/菜单/i18n/图标） | **转变** | 清单仍有效，但主语从"改 goose 的补丁"变为"壳自己的代码"——无 patch 负担，改完即拥有 |
| B2. 第 2 层打包链改名（二进制名/`findGooseBinaryPath`/download 脚本） | **大幅缩水** | 壳引用的是 **stock `goose` 二进制**，名字不改、查找逻辑照抄快照即可；只剩"从哪个 release 拉、SHA256 校验"的管道工作 |
| B3. 第 3 层内部标识符（crate 名/config dir/`GOOSE_*` env） | **作废** | 壳不碰 Rust 源码；`~/.config/goose` 等归 goose 二进制自己的事 |
| C. Apache-2.0 合规 | **简化保留** | 从"修改文件标注义务（§4b）"变为"**二进制/UI 快照再分发的 NOTICE 归属**"；快照代码保留上游版权头 |
| D. 敏感信息与历史清理 | **全保留** | `.env` untrack、提交邮箱检查、文档脱敏；310MB 历史问题**自然消解**——新仓库不携带 goose 全史，快照单 commit，`documentation/` 视频不入库 |
| E. 打包 CI 化 | **保留骨架，主语更换** | 打包对象 = 壳 app；"壳 + 平台二进制注入"模型不变（PACKAGING.md 三铁律仍适用）；新增 goose 版本矩阵 |
| F. 执行顺序 | **重排** | 见 §7 P0–P5 |

## 4. 目标架构

### 4.1 仓库拓扑（单一新仓库）

```
fleet/                               # 新仓库（§11），名 = fleet
├─ core/                             # ★ 多 Agent 调度核心（纯 TS，零 Electron 依赖，后端无关）
│  ├─ node.ts                        #   节点模型：id/name/driver/url/secret/fingerprint/workdir
│  ├─ registry.ts                    #   注册表：增删改查、持久化（现 fleet.ts + node-cli.mjs 合并）
│  ├─ router.ts                      #   路由：window/session → node 绑定（现 getFleetNodeBackend）
│  ├─ policy.ts                      #   调度策略接口：affinity/故障转移/负载感知（预留，v1 只做静态绑定）
│  ├─ driver.ts                      #   ★ ACP 驱动接口（v1.1）：transport/auth/capabilities/health 抽象
│  └─ *.test.ts                      #   纯逻辑测试（现 15 个纯测试直接迁移）
├─ app/                              # ★ Electron 壳（一次性快照自上游 ui/desktop + fleet 改动融入）
│  ├─ src/main.ts                    #   自有 main：N 窗口 × N 后端（fork 已验证的模型）
│  ├─ src/gooseServe.ts              #   快照引入，此后归壳维护；改造为调 core/driver 而非直连
│  ├─ src/components/settings/…      #   FleetNodesSection 改为壳自有设置页（节点类型下拉来自驱动注册表）
│  └─ (renderer/preload/i18n 子集)   #   只留壳支持的 locale
├─ runtime/                          # ★ 后端引用层（不维护后端，只拉取 + 适配）
│  ├─ versions.json                  #   版本矩阵：壳版本 ↔ 各驱动支持的后端版本
│  ├─ drivers/                       #   ★ 驱动实现（每后端一个，实现 core/driver.ts 接口）
│  │  ├─ goose/                      #     首个驱动：fetch-goose.ts（release 下载+SHA256+注入 src/bin）
│  │  │                              #       + serve-node.sh/.ps1（包装 stock `goose serve --tls`）
│  │  └─ (deepseek-harness/ …)       #     后续：ACP 兼容后端适配（stdio/HTTP 传输 + 各自鉴权）
│  └─ acp-smoke/                     #   契约测试（每驱动一套：握手/会话/能力协商）
├─ scripts/                          #   robust-dl.sh / pack-chain.sh 资产化（PACKAGING.md 沉淀）
├─ docs/                             #   DESIGN/FEASIBILITY/TESTPLAN/RETROSPECTIVE/PACKAGING 迁入+脱敏
├─ INTEGRATION.md                    #   契约治理（取代 PATCHES/UPSTREAM/MERGE_FIXES）
└─ NOTICE.md                         #   Apache-2.0 归属：goose 二进制与 UI 快照来源声明
```

### 4.2 方案比选（为什么是"一次性快照壳"）

| 方案 | 描述 | 优点 | 致命伤 | 结论 |
|---|---|---|---|---|
| **C1 快照壳**（推荐） | `ui/desktop` 连同 fleet 改动**一次性拷贝**进壳仓库，此后按需 cherry-pick；goose 后端用官方 release 二进制 | 零外部契约漂移（main↔renderer 内部化）；fork 已验证的代码全部保留；升级节奏完全自主 | UI 新功能不自动跟进；需"择机重快照"流程 | ✅ **采用** |
| C2 薄壳 + 上游 renderer 工件 | 只写自己的 main（重实现 36 个 `ipcMain.handle` + preload 契约），renderer 每次从上游 release 提取 | UI 永远最新；main 极小 | 36 个 IPC 的私有契约随上游版本漂移，升级=适配 treadmill；**与"不维护 goose"目标矛盾**（被契约拖着走） | 备选，仅当上游 IPC 面稳定后考虑 |
| D 管理台 + N 个官方桌面实例 | 每节点一个 stock goose desktop（env 注入外部后端） | 零 UI 代码 | **上游单实例锁阻断**（§2.2）；需 userData 隔离上游化；UX 分裂 | ❌ 不可行（除非上游接受 PR） |
| A 延续 fork | 改名发布 fork | 最省事 | 与定位直接冲突：永远背着 30 文件 patch 的 rebase 义务 | ❌ 否决 |

> C1 与"不维护 goose"的关系澄清：快照后这些代码**不再是 goose 的补丁，而是壳的自有代码**（起点源自上游，Apache-2.0 合法）。我们不再有"跟随上游 ui"的义务，只有"想吸收上游改进时"的机会——维护的是自己的 app，不是别人的仓库。

## 5. 后端引用方式与契约治理（v1.1：从 goose 专用提升为 ACP 驱动模型）

### 5.1 核心抽象：ACP 驱动接口

fleet 的后端契约是 **ACP（Agent Client Protocol）+ 传输安全**，goose 只是它的第一个实现。`core/driver.ts` 定义驱动接口，`runtime/drivers/<name>/` 提供实现：

```ts
interface AcpDriver {
  readonly id: string;                  // 'goose' | 'deepseek-harness' | ...
  readonly displayName: string;
  capabilities(): DriverCapabilities;   // 会话/工具/权限/流式能力协商（ACP 标准面）
  connect(node: FleetNode): AcpSession; // 传输无关：http(s) / ws / stdio 由驱动自选
  healthCheck(node: FleetNode): Promise<HealthReport>;
  provision?(node: FleetNode): Promise<void>;  // 可选：本地拉起节点（goose: spawn serve；纯远程后端可缺省）
}
```

要点：
- **传输解耦**：goose 驱动走 `https + secret + TLS 指纹`（上游已验证）；后续 ACP 后端可能走 stdio 或 wss——差异全部封在驱动内，`core/` 与 `app/` 不感知；
- **鉴权解耦**：节点模型 `secret/fingerprint` 字段由驱动自定义子模式（goose 用 `GOOSE_SERVER__SECRET_KEY`，deepseek harness 用其自身的）；
- **core 后端无关**：调度/路由/健康策略只面向 `FleetNode` + `AcpSession`，新驱动零改动 core。

### 5.2 契约清单（写入 `INTEGRATION.md`，各配契约测试）

| # | 契约 | 稳定性 | 治理 |
|---|---|---|---|
| 1 | 壳 ↔ 节点：**ACP** over http(s)/wss/stdio（goose 实现 = `goose serve` + `GOOSE_SERVER__SECRET_KEY` + TLS 指纹） | 高（ACP 是跨厂商公开协议；goose 面为其公开 CLI） | `runtime/acp-smoke/` 每驱动一套 CI 契约测试（握手/会话/能力协商） |
| 2 | 壳 ↔ 后端二进制：`resources/bin/goose(.exe)` 注入 + 版本三处对齐（壳 manifest = 注入二进制 = SDK） | 中（goose 驱动专属） | `fetch-goose.ts` 校验 SHA256；打包三重验证（W4） |
| 3 | 壳内 main ↔ renderer（快照内部化） | **不再是外部契约** | 自有测试覆盖；升级 goose UI = 择机重快照 + diff 审查 |

### 5.3 演进路线（多后端）

| 版本 | 里程碑 | 内容 |
|---|---|---|
| v1 | goose 单驱动 | 驱动接口定型（以 goose 为唯一参照实现），`app/gooseServe.ts` 改造为调用 `core/driver` |
| v1.x | 驱动接口硬化 | 用第 2 个真实后端（deepseek harness）验证抽象完整性：stdio/自建鉴权/能力差异暴露接口缺口并补齐 |
| v2 | 多驱动生态 | 驱动注册表对 UI 开放（设置页"节点类型"下拉）；驱动可独立仓库发布（npm 包 `@fleet/driver-*`） |

> 设计纪律：**在只有 goose 一个实现时不做过早抽象**——v1 的 driver.ts 只提取 goose 已验证的最小面（connect/health/capabilities/provision），deepseek harness 接入时再扩展。避免"想象中的多态"。

### 5.4 升级策略

- 后端升级：改 `versions.json` → 拉新 release 二进制 → 契约测试 1/2 过 → 出壳新版本（低成本，可频繁）
- UI 吸收上游：按需（半年 / 安全修复），`git diff 上游tag..新tag -- ui/desktop` 审查后选择性重快照，频率自定（低频，不构成义务）

**上游共生（机会主义，不阻塞主线）**：`GOOSE_USER_DATA_DIR`（8 行）、zh-CN 菜单 label 修复等通用改进回馈上游 PR——PR 被合并则减少未来重快照的冲突面。

## 6. 与既有资产的去向

| 既有资产 | 去向 |
|---|---|
| 外层仓库（docs + `fleet/`） | docs → 壳仓库 `docs/`（**逐篇脱敏**后）；`fleet/node-cli.mjs` 并入 `core/registry.ts` 的 CLI 入口；`serve-node.*` → `runtime/node/` |
| `goose/` fork 仓库（8 commits） | 归档为 research 工件（本地保留或推私有仓库）；其 git 历史即"快照含 fleet 改动"的出处证明，LICENSE 义务见 §8 |
| `PATCHES.md` `UPSTREAM.md` `MERGE_FIXES.md` | 终结；快照时点与基线记录并入 `INTEGRATION.md` |
| `PACKAGING.md` 三铁律/W1–W7 | 全部继续有效，随 scripts/ 资产化搬入壳仓库 |

## 7. 迁移路线（P0–P5，合计约 4~5 天）

| 阶段 | 内容 | 验收标准 | 工作量 |
|---|---|---|---|
| **P0 契约盘点** | ① 生成 main↔renderer IPC 面 36 handler 清单（快照自检）② 写 `INTEGRATION.md` + `versions.json` 初版（goose 1.47.0）③ 快照边界清单（哪些文件拷、哪些丢弃：documentation/、上游 CI、evals…） | INTEGRATION.md 评审通过 | 0.5d |
| **P1 壳仓库骨架 + core/** | 新仓库初始化（§11）；迁 `fleet.ts`+15 纯测试 → `core/`；`node-cli.mjs`+`serve-node.*` → core/runtime；**提取 `core/driver.ts` 最小接口（goose 单实现，§5.3 纪律）**；`acp-smoke.mjs` → CI | core 单测全绿；node-cli 对临时 settings.json CRUD 通过；driver 接口以 goose 实现走通 | 1d |
| **P2 快照落位 + 品牌 = Fleet** | `ui/desktop` → `app/`（剔除上游 CI/文档）；改 productName=**Fleet**/包名/菜单/图标/i18n 子集/URL scheme `fleet://`；`GOOSE_USER_DATA_DIR` 保留为壳自有能力；`gooseServe.ts` 改造为经 `core/driver` 连接 | 本地 `electron-forge start`：单窗口连 1 节点可用；**zh-CN 菜单回归**（retrospective 三连 bug 区，单列冒烟项） | 1~1.5d |
| **P3 打包管道** | 壳 forge 配置（含 `resetAdHocDarwinSignature` 经验）；`fetch-goose.ts`（release 拉取+SHA256+注入）；GitHub Actions：build→make zip(deb/rpm 本机)→三重验证→draft release | CI 出 `Shell-win32-x64.zip`，`unzip -l` 见 `resources/bin/goose.exe`，asar 抽 main.js 见 fleet 标记 | 1d |
| **P4 文档迁移 + 发布** | docs 脱敏迁入；README（fork 声明+fleet 介绍+安装）；NOTICE.md；push + 首个 tag | 公开仓库可达，Release 产物 SHA256 齐全 | 0.5~1d |
| **P5 上游回馈（并行）** | `GOOSE_USER_DATA_DIR` PR 等 | 提交即可，不阻塞 | 机会主义 |

P2/P3 依赖 P1 的 core；P0 是文档先行，可在 P1 期间并行定稿。

## 8. 许可与合规（Apache-2.0，比 fork 形态更简单）

1. `NOTICE.md`：声明分发物包含 goose 官方二进制（版本、来源 URL、Apache-2.0）+ UI 源自 `aaif-goose/goose`（快照基线 commit）；含上游版权行；
2. 快照代码**保留上游文件头版权注释**（未修改 §4b 义务即不触发标注要求；壳后续修改的文件建议加 `Modified by <shell>` 头）；
3. 壳自有新代码（core/、runtime/）可自选许可证——建议同为 Apache-2.0（生态一致，未来回馈上游无障碍）；
4. 商标：产品名独立（§9），README 使用 nominative use（"orchestrates goose agents"）合法且必要；不用 goose logo。

## 9. 命名 —— **已决策：fleet**（2026-08-29）

### 9.1 决策

- 仓库名：`fleet`（自有 org/user 命名空间下）
- productName：`Fleet`；exe/App 名：`Fleet(.exe/.app)`；URL scheme：`fleet://`（避免与官方 goose 的 `goose://` 冲突，v0.6 共存模型必需）
- userData 目录：`%APPDATA%/Fleet` 等 —— 与官方 Goose 安装天然隔离
- 内部叙事一致性红利：现有 fleet 代码（`FleetNodesSection`、`externalBackends`、`FLEET_MENU_LABEL`、node-cli）本就以 fleet 命名，**改名成本趋近于零**，仅 productName/forge/图标/README 门面

### 9.2 同名冲突分析（发布前需人工复核一遍）

| 对象 | 冲突 | 评估 |
|---|---|---|
| GitHub `fleetdm/fleet`（设备管理，star 数高） | 名字相同、领域不同 | 开源非商业场景风险低；商用前查商标类别 9/42；README 用一句话区分定位 |
| Rancher `fleet`（GitOps）、coreos/fleet（存档） | infra 领域知名 | 同上；我们的描述词（multi-agent ACP orchestrator）与之不重叠 |
| npm 包名 `fleet` | 已被占 | 不裸用；发包用 scope（`@fleet/core`、`@fleet/driver-goose`）或另定包名 |
| goose 商标 | **无冲突** | fleet 完全独立命名，满足"名称不与 goose 相同"的原始约束；README 中 goose 仅作 nominative use |

### 9.3 与旧候选的关系

v1.0 的 Flock/Gaggle/Aviary 候选作废。fleet 的隐喻（舰队/机群 ↔ 节点群调度）与产品本质一致，且与既有代码命名连续。

## 10. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 快照腐化：上游 UI 演进，壳逐渐落后 | 中 | 契约 1/2 独立于 UI 可持续升级；重快照流程文档化；cherry-pick 只挑 bugfix |
| `goose serve` API 变更破坏契约 1 | 中 | 版本矩阵锁定 + acp-smoke CI；升级 = 显式动作 |
| **驱动接口过早抽象**（v1.1 新增） | 中 | §5.3 设计纪律：v1 只提取 goose 已验证的最小面，第 2 个后端接入时再扩展 |
| **deepseek harness 协议细节与 ACP 有出入**（v1.1 新增） | 中 | 适配层吸收差异，不污染 core；契约测试覆盖握手/能力协商分歧点 |
| **fleet 同名产品混淆**（v1.1 新增） | 低 | §9.2 一句话定位区分；发包用 scope；商用前商标检索 |
| i18n 子集与上游 locale 漂移 | 低 | 壳只承诺自选 locale；翻译缺失降级英文 |
| 打包链在新仓库的隐性依赖（hermit/justfile 等） | 中 | P3 首次全平台打包为准；PACKAGING.md 教训直接进 scripts |
| 旧文档泄密（RETROSPECTIVE/PACKAGING 含工作环境细节） | 中 | P4 逐篇脱敏清单化；不确定内容宁可删 |

## 11. 仓库落地策略 —— **决策：新仓库**（2026-08-29）

问题：重构在"现有仓库的新分支"还是"新仓库"进行？**结论：新仓库 `fleet`。**

### 11.1 为什么不是分支

| 若用分支 | 问题 |
|---|---|
| goose fork 仓库的分支 | 携带 goose 基线大 commit（.git 310MB、上游 documentation/ 视频约百 MB）——正是要甩掉的历史；且该仓库定位已变为 research 工件 |
| 外层 remote-goose 仓库的分支 | 其历史 = 工程日志（含待脱敏内容），分支会继承全部敏感历史；push 前仍需 filter-repo 清洗 = 与新建仓库等价工作量，却背着旧结构 |

分支方案的唯一场景是"先在旧仓库试验再搬家"，但 P0/P1 本身就是轻量文档+纯逻辑迁移，直接在新仓库做反而省一次搬家。

### 11.2 新仓库的收益

1. **首个 commit 即目标形态**：快照 + core + runtime 结构化落位，天然形成策展历史（P0 文档 → P1 core → P2 快照，分 commit）；
2. 旧方案 D 节的"历史清洗/filter-repo/邮箱改写"工作**直接消失**（不做历史移植就无历史包袱）；
3. LICENSE/NOTICE/CI/分支保护从第一天按新定位设计；
4. 与 §6 的旧资产处置完全自洽。

### 11.3 旧仓库处置（与 §6 一致）

- `goose/` fork 仓库：本地保留或推私有归档——其 git 历史（`0e17bf7..f4066f1`）是快照代码出处与许可证合规的证明材料；
- 外层 remote-goose 仓库：文档脱敏后复制进新仓库 `docs/`（新 commit，不嫁接历史），原仓库归档只读。

---
*v1.0（2026-08-28）：fork 路线否决，壳项目路线确立。事实依据见 §2（全部经代码验证：fork diff `0e17bf7..HEAD`、上游 `main.ts`/`serve-node.sh`/`node-cli.mjs`）。*
*v1.1（2026-08-29）：壳名定为 fleet（§9）；后端契约升级为 ACP 驱动模型，goose 为首个驱动、deepseek harness 为路线图第二驱动（§5）；落地形态定为新仓库（§11）。*
