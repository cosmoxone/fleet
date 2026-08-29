# 可行性研究 — 多 goose serve 节点管理 UI

**状态**: v1.3（C 并行细化：C-0/C-mini/C+ 三档 + 内存估算）
**日期**: 2026-08-19
**配套文档**: [DESIGN.md](./DESIGN.md)（设计方案，本文档为其输入与依据）

---

## 1. 研究背景

目标：构建一个 UI，可同时连接并管理多个 `goose serve` 实例（下称"节点"）。

### 1.1 上游代码事实（已核实，版本：main @ 2026-08-19）

**goose serve（服务端）**

| 事实 | 出处 |
|---|---|
| WS 端点固定 `/acp`，默认 `127.0.0.1:3284`；ACP JSON-RPC 协议 | `crates/goose-cli/src/cli.rs:843-850` |
| 鉴权：`X-Secret-Key` 头 **或** `?token=` query；由 `GOOSE_SERVER__SECRET_KEY` 控制 | `crates/goose/src/acp/transport/auth.rs:15-36` |
| 一条 WS 连接可承载多个并发 session；每连接一个 Agent 服务对象，连接间内存状态隔离 | `server_factory.rs:63-109` |
| Origin 校验默认仅放行 loopback/null/file；`--allowed-origin` 提供精确白名单（禁 `*`） | `transport/mod.rs:55-99, 231-237` |
| `GET /health`、`/status` 免鉴权返回 ok，适合存活探测 | `transport/mod.rs:219-243` |
| 自签 TLS：stdout 打印 `GOOSED_CERT_FINGERPRINT=<sha256>` | `transport/tls.rs:99,186` |
| 进程级共享状态：`Config::global()`（OnceLock）、scheduler、SQLite 会话库 → 同进程多客户端改配置会互相影响 | `config/base.rs:392`、`server_factory.rs:22-61` |
| 每实例默认启用 `developer` 扩展 | `cli.rs:1415-1424` |

**desktop UI（客户端）**

| 事实 | 出处 |
|---|---|
| Electron 三层：主进程 spawn `goose serve` 子进程（每聊天窗口一个，LeaseRegistry 按窗口引用计数管理生命周期） | `main.ts:1204-1263`、`gooseServeLeaseRegistry.ts:17-163` |
| 渲染进程**直连** WS（数据面不经主进程）；URL 经 IPC `get-acp-url` 按窗口下发 | `preload.ts:263`、`acpConnection.ts:131-137` |
| **单连接假设**：`acpConnection.ts:31-35` 五个模块级全局（currentConnection/pendingConnection/generation/recovering/recoveryListeners） | 同左 |
| **17 个文件**依赖无参 `getAcpClient()`（providers 26 处、recipe 11 处、sessions 15 处…），隐式假设"当前唯一连接" | `acp/*` 全目录 |
| 状态管理：自研 pub/sub store，`Map<sessionId, entry>`，React 经 `useAcpChatSessionSnapshot` 订阅 | `chatSessionStore.ts:116-131, 565-587` |
| 已支持单一外部后端：`externalGoosed` 设置（含证书指纹信任） | `main.ts:1118-1171` |
| Electron API 耦合集中在单一 facade `window.electron`：**47 文件 / 177 处**调用（不含测试），preload 暴露约 70 个方法 | `preload.ts:120-180` |
| 渲染层规模：约 **65,879 行**（ts/tsx，不含测试） | wc 统计 |
| 复用资产：官方 npm `@agentclientprotocol/sdk`、`@aaif/goose-sdk@0.20.2`（均 Apache-2.0） | npm |

---

## 2. 候选方案

### 方案 A：Fork desktop，单窗口多后端（深度重构）

把渲染进程 `acpConnection` 单例改为 `Map<backendId, AcpConnection>`，store 按 `(backendId, sessionId)` 复合键控，通知路由复合键化。

- ✅ 单窗口统一体验：跨实例会话聚合、并排会话、实例切换器
- ❌ 工程量大：17 文件调用链全部带 backend 上下文；ConfigContext/ModelContext（每实例 provider/模型不同）要 per-backend 化；重连逻辑 per-backend
- ❌ 与上游合并困难（desktop 万行级、迭代快）
- **估量**：核心改造 2–4 周；长期维护成本高

### 方案 B：全新 Web UI（从零写，复用 acp 协议层）

Vite + React 从零开始，只移植 desktop 的纯函数/纯组件（adapter 层、消息渲染），从第一天按多连接架构设计。

- ✅ 架构干净，天生多后端；可部署为网页
- ✅ 无 Electron 打包负担
- ❌ **UI 体验重建成本被低估**：desktop 渲染层 66K LOC（markdown/工具卡片/设置面板/i18n/主题/快捷键…），从零写"完整体验"以月计；MVP 只能交付裁剪版体验
- **估量**：MVP（多实例 + 聊天 + 权限 + 会话列表）1–2 周，但体验约为 desktop 的子集

### 方案 C：多窗口模式（最小改动）

利用"Electron 每窗口独立渲染进程 → 模块单例天然按窗口隔离"的事实。主进程 LeaseRegistry 本就是 `Map<windowId, lease>`。加一个"后端管理"窗口，点实例 → 走**已存在的** `externalGoosed`/`createExternal` 路径打开聊天窗口。

- ✅ 几乎不碰渲染进程单例链；享受 desktop 全部功能
- ❌ UX 是"一窗口一实例"，无跨实例统一视图；每窗口内存开销大
- **估量**：2–3 天

**事实修正（v1.2）**：原样 stock 不支持并行多节点——`getActiveExternalBackend()`（`main.ts:950`）返回全局唯一外部后端（env 或单个 settings 项），同实例所有窗口共享之；并行需 N 个独立实例。因此 C 必须扩展为 **C+** 才能达到自用目标。

### 方案 C 并行细化（v1.3）：C-0 / C-mini / C+

**多开的唯一硬阻碍**是单实例锁：`requestSingleInstanceLock()`（`main.ts:454`，Windows/Linux 生效，二次启动即退出）。锁与 `settings.json` 都锚定在 `userData`（= `%APPDATA%\<AppName>`，`main.ts:179`）。绕开锁 = 让每个实例有不同的 userData。三档方案：

#### C-0：零代码多开（APPDATA 重定向）⭐ 自用首选起点

**原理**：Electron 的 `userData` 派生自 `%APPDATA%`。启动前重定向 `APPDATA` → 每实例独立 userData → 锁与设置天然隔离。配合后端配置走环境变量（`getActiveExternalBackend` 中 **env 优先于 settings**，`main.ts:950-958`），零代码实现并行。

```bat
:: fleet-node1.bat — 每节点一份
@echo off
set APPDATA=D:\goose-fleet\inst1          REM 独立 userData（锁+settings 隔离）
set GOOSE_EXTERNAL_BACKEND=1
set GOOSE_EXTERNAL_BACKEND_URL=http://192.168.1.11:3284   REM 或 https://
set GOOSE_SERVER__SECRET_KEY=<node1-secret>
start "" "C:\Users\you\AppData\Local\Programs\Goose\Goose.exe"
```

- ✅ **不改任何代码、不用构建**，今天就能用；每实例完整 desktop 功能
- ⚠️ 注意事项：①自签 TLS 场景每实例各自首次信任；②若还设置了 settings 里的 `externalGoosed.enabled`，**env 优先级更高**，settings 项被忽略——多开全用 env 即可；③APPDATA 重定向也隔离了应用更新状态，各实例自行更新（都装自同一 exe，更新仍是同一份程序文件，仅状态分离）；④菜单栏/托盘图标会每实例一个，建议关掉；⑤ macOS 无锁（`gotTheLock` 恒 true）但共享 settings 会互写，同样可用 `HOME` 重定向法。
- **估量**：半小时（写 N 个 .bat / 或一个带参数的通用 .ps1）

#### C-mini：极小补丁多开（GOOSE_USER_DATA_DIR，~10 行）

**原理**：fork 后在 `main.ts` 最顶部（模块级 `SETTINGS_FILE` 计算之前，`main.ts:179`）插入：

```ts
if (process.env.GOOSE_USER_DATA_DIR) {
  app.setPath('userData', process.env.GOOSE_USER_DATA_DIR);
}
```

**动机**：APPDATA 重定向是"锤子"（整目录搬家，波及更新状态等）；专用 env 只搬 userData，语义干净。顺带可加每实例独立日志目录。**建议与 C+ 合并为同一次 fork 的第一步**（C-mini ⊂ C+ 改动集）。

- ✅ 语义精确；为 C+ 铺路
- ❌ 需要 fork + 一次构建（pnpm build / forge package）
- **估量**：半天（含首次构建环境搭建）

#### C+：每窗口绑定节点（fork，主进程 ~200–400 行）⭐ 自用终态

单实例内 `externalBackends[]` 多节点列表 + 新建窗口时选节点（`getBackendForWindow`），本地/远程窗口混用。原生菜单入口，不写 React。

- ✅ 单实例多窗口，**内存效率最高**（主进程/GPU/网络服务共享，见下表）；UX 最顺
- ❌ 需 fork + 构建改动最多
- **估量**：2–4 天

**内存对照（估算值，待实测校准；Windows x64，远程后端模式，不含本地 goose serve 进程）**：

| 形态 | 构成 | 典型内存 |
|---|---|---|
| C-0 / C-mini 每实例 | 主进程 80–150M + GPU 60–150M + 网络服务等 30–60M + 渲染器 150–400M | **0.4–0.7 GB** |
| C+ 单实例基座 | 主进程 + GPU + 网络服务等（共享） | 0.25–0.35 GB |
| C+ 每增一窗口 | 仅渲染器 | **0.15–0.4 GB** |

- **5 节点**：C-0/C-mini ≈ 2–3.5 GB；C+（5 窗口）≈ 1–1.9 GB
- **Windows 16G**：系统+常驻约 4.5–5.5G，可用 ~10G → C-0/C-mini 舒适 **8–10 实例**（理论上限 ~14）；C+ 舒适 **12–18 窗口**
- 渲染器内存随会话长度/图片/长 markdown 增长；远程节点侧各自占 100–300M（在节点机器上，不占本机）

**实测校准方法**（首次部署时跑一次）：`Get-Process Goose* | Sort WorkingSet64 -desc | Format-Table Name, @{n='MB';e={[math]::Round($_.WorkingSet64/1MB)}}` 分别在空闲/典型会话/长会话三态记录，回填本表。

**推荐路径**：C-0（半小时，今天自用）→ 用 1–2 周攒体感 → 若多开体验可接受则止步；若嫌 N 实例重/乱 → C-mini+C+ 一次 fork 到位（C-mini 是 C+ 的第一步）。

### 方案 C+：desktop 轻量 fork——每窗口绑定节点（v1.2 新增，自用首选）⭐⭐

**思路**：只改 **Electron 主进程**，渲染进程一行不动（单例按窗口隔离的天赋继续免费享有）：

```
改动点（全部在 main.ts 一侧，约 200–400 行）：
1. settings：externalGoosed（单个）旁新增 externalBackends: [{id, name, url, secret,
   certFingerprint?, workingDir?}]（保留旧字段兼容）
2. getActiveExternalBackend(settings) → getBackendForWindow(settings, backendId)：
   新建聊天窗口时按所选节点解析；未选则保持现状（本地 spawn）
   —— LeaseRegistry 已是 Map<windowId, lease>，get-acp-url 已按窗口返回，均为现成机制
3. 入口 UI 最小化：不写 React 页面，用原生菜单/对话框（Menu → "New Chat on Node…"）
   列出已配置节点 → 打开绑定该节点的窗口
4. 混用：本地 spawn 窗口与远程节点窗口可在同一实例并存（现状做不到）
```

- ✅ 渲染进程零改动 → 无 66K LOC 提取、无单例重构、无 shim——E 的三大成本全部绕开
- ✅ 保留 desktop 全部功能（权限弹窗/recipes/扩展/更新器/证书信任 `trustBackendCertificate`/OS keychain）
- ✅ 天然安全边界：一窗口一节点 → 权限/elicitation 弹窗无跨节点混淆；token 不进浏览器存储
- ✅ 自带 TLS 指纹信任流程（desktop 已有），比 v0.1 Web UI 的 TLS 故事更完整
- ❌ 仍是"一窗口一节点"UX、每窗口内存开销；无跨节点统一视图（自用可接受）
- ❌ 维护 = 跟随上游 desktop 的 fork 补丁（改动面小，冲突概率低）
- **估量**：**2–4 天**，得到日常可用的并行多节点自用环境

### 方案 D：ACP 聚合网关（一个入口代理 N 后端）

网关对上游暴露**单个** ACP 端点，内部作为 ACP 客户端连 N 个 goose serve，会话 id 前缀路由，合并 `session/list`。

- ✅ 上游 UI 零改动
- ❌ 协议多路复用复杂：permission/elicitation 回传路由、initialize 能力协商、每实例 config/providers 不同无法合并表达——desktop 设置面板会失真；本质是骗过单连接假设
- **估量**：1–2 周，长期是维护负担

### 方案 E：提取式改造（v1.1 新增，B 的实现策略变体）⭐

**思路**：产品形态与架构仍按 B（多连接 Web UI，见 DESIGN.md），但实现方式不是"从零写 + 少量移植"，而是**把 desktop 渲染层整体提取出来改造**：

```
提取 src/（66K LOC React 应用）
  ├── 保留：React 组件、acp 协议层、store、i18n、主题、styles
  ├── 替换：main.ts(Electron) → web 入口（Vite dev/build 即可）
  ├── 替换：preload 的 window.electron → 【web shim】实现同一接口
  │     ├── getAcpUrl() → 节点注册表（ConnectionProvider.direct）
  │     ├── get/setSetting, getSecretKey → localStorage/IndexedDB(+WebCrypto)
  │     ├── 文件类(readFile/listFiles/…) → v0.1 stub 禁用；v0.2 由 companion 实现
  │     └── 桌面类(更新/菜单栏/窗口管理) → stub 禁用
  ├── 重构：acpConnection 五个模块单例 → ConnectionManager（多连接，A 方案的核心改造，
  │        但只此一处深度重构，组件层不动）
  └── 新增：节点管理首屏（健康总览、注册/编辑）
```

**可行性依据（本轮核实）**：
- Electron 耦合**集中在单一 facade**（`window.electron`，47 文件/177 处）——替换点集中，无需散弹式修改
- UI 层（组件/store/i18n/主题）本身**不依赖 Electron 二进制**，是纯 React 代码
- License Apache-2.0，提取合法（保留版权声明）

- ✅ **完整 chat 体验白得**：66K LOC 的 markdown/工具卡片/权限弹窗/设置/i18n/主题/快捷键
- ✅ 改造点集中：一个 shim（~70 方法，其中过半可 stub）+ 一处深度重构（acpConnection）
- ✅ companion（v0.2）可以**实现同一个 shim 接口的文件/凭据部分**——桌面能力渐进回归的路径自然成立
- ❌ 上游分叉：提取即 vendor，无法低成本跟随上游（对策：extract-once，维护 PATCHES.md 记录所有改动，选择性手动回移）
- ❌ 携带不需要的功能（更新器、公告、菜单栏…）需 stub/剥离；66K LOC 的阅读理解成本
- **估量**：shim 1 周 + acpConnection 多连接重构 1–2 周（A/B/E 三案共有的不可避免成本）+ 节点管理 UI 与构建链剥离 3–5 天 ≈ **3–4 周得到接近 desktop 完整度的 v0.1**

---

## 3. 对比总结

| | A 深度重构 | B 从零写 | C 多窗口 | D 聚合网关 | **E 提取式** |
|---|---|---|---|---|---|
| 工作量 | 🔴 2–4 周 | 🟡 1–2 周(MVP) | 🟢 2–3 天 | 🔴 1–2 周+维护 | 🟡 3–4 周 |
| v0.1 功能完整度 | ✅ 全 | 🔴 子集 | ✅ 全 | 🟡 失真 | ✅ 接近全 |
| 多实例体验 | ✅ 单窗统一 | ✅ 单页统一 | ❌ 一窗一实例 | ✅ 统一(有失真) | ✅ 单页统一 |
| 跟随上游 | 🔴 难 | 🟢 独立演进 | 🟢 易 | 🟡 协议层耦合 | 🔴 extract-once |
| 无桌面依赖(可 Web 部署) | ❌ | ✅ | ❌ | — | ✅(shim 后) |
| 长期维护 | 🔴 | 🟢 | 🟢 | 🔴 | 🟡 |

**结论**：
- **C+ 取代 E 成为立即执行路线**（自用目标，2–4 天）：只改 main 进程实现每窗口绑定节点，渲染进程零改动，风险最低、见效最快。
- **C（原样 stock）保留为验证手段**（1 天内）：跑通远程节点 token/TLS/origin 全链路——既验证 C+ 的可行性，也为未来任何路线积累部署经验。
- **E（提取式）后移为公开 v0.1 的候选路线**：启动 gate = C+ 自用 2–4 周后，社区 P1 验证出现 ≥10 个真实外部多节点需求（无信号则 E 永不启动，C+ 即终点）。
- **A 淘汰**（E 吸收其唯一优点，E 又被 C+ 替代）；**B 从零写**仅作 E 失败时的回退；**D 后移至 v0.3 商业组件**（网关定位为审计/单入口资产，而非多连接的手段）。

## 4. 方案间整合（已纳入 DESIGN.md）

**v0 自用（立即）**：C（stock 验证，1 天）→ C+（每窗口绑定节点，2–4 天）；**公开 v0.1（有条件）**：E 提取式，gate 在 P1 验证；**v0.2+**：D 网关（BSL 商业核心）。B 仅作 E 失败回退；A 淘汰。C+ 的多节点 settings schema 为 E 的节点注册表提供先行验证。

## 5. 遗留风险（详见 DESIGN.md §3.5）

1. 上游多后端官方化（upstream risk）→ ACP 泛化定位 + adapter 隔离
2. E 的隐性依赖风险：shim 面可能比 177 处统计更大（构建链 vite.main/preload 配置、forge 依赖需剥离）→ 首周做 shim 打通验证（"hello extraction"里程碑）再全面投入
3. 浏览器混合内容/自签证书限制 → 部署矩阵 + v0.2 companion
