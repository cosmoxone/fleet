# ACP Fleet — 多 goose 节点统一管理 UI（goose 为首发后端）

**状态**: v0.6（后端模型定型：本地默认 + 外部节点共存，每窗口绑定）
**日期**: 2026-08-19
**上游依赖**: [aaif-goose/goose](https://github.com/aaif-goose/goose)（Apache-2.0）
**输入文档**: [FEASIBILITY.md](./FEASIBILITY.md) — 方案 A–E 可行性对比（本设计的选型依据）
**变更记录**: v0.1 初稿 → v0.2 评审修订 → v0.3 改提取式 → v0.4 C+ 自用阶段 → v0.5 C 并行三档细化（C-0/C-mini/C+）→ v0.6 后端共存模型定型（§3.7）

---

## 0. 摘要

ACP Fleet 是一个自托管 Web UI，用于连接、使用和运维多个 ACP 协议的 agent 节点（首个支持后端为 goose serve）。

- **协议层**：直接使用标准 ACP over WebSocket 与官方 npm 包（`@agentclientprotocol/sdk`、`@aaif/goose-sdk`），从第一天按多连接架构设计。
- **实现路线**：**提取式（方案 E）**——从上游 desktop 提取 66K LOC 渲染层（Apache-2.0），以 web shim 替换 Electron facade、仅对 acpConnection 一处做深度多连接重构，白得完整 chat 体验（选型对比见 [FEASIBILITY.md](./FEASIBILITY.md)）。
- **定位**：**"ACP agent 节点的运维面板"**（类 Portainer 之于 Docker），而非 chat UI。goose 特有逻辑收敛在独立 adapter 中，未来可兼容其他 ACP agent。
- **节奏**：v0.1 即公开发布（静态 SPA，零部署成本）；v0.2 companion 收口安全；v0.3 网关沉淀商业核心。

---

## 1. 背景与问题

### 1.1 goose serve 的服务形态（代码事实）

| 事实 | 出处 |
|---|---|
| WS 端点 `/acp`，默认 `127.0.0.1:3284` | `crates/goose-cli/src/cli.rs:846` |
| 鉴权：`X-Secret-Key` 头或 `?token=` query；`GOOSE_SERVER__SECRET_KEY` | `crates/goose/src/acp/transport/auth.rs:15-36` |
| 一条 WS 连接多 session 并发；连接间内存隔离 | `server_factory.rs:63-109` |
| 远程需 `--host 0.0.0.0 --tls --allowed-origin <origin>`；默认仅放行 loopback/null/file | `transport/mod.rs:55-99` |
| `GET /health`、`/status` 免鉴权返回 ok（跨域可读性**待 CI 验证**） | `transport/mod.rs:219-243` |
| 自签 TLS 指纹从 stdout `GOOSED_CERT_FINGERPRINT=` 读取 | `transport/tls.rs:99,186` |
| 进程级共享：`Config::global()`、scheduler、SQLite 会话库 | `config/base.rs:392` |

### 1.2 现有 UI 局限与上游风险

- 官方 desktop 渲染进程单例链（`acpConnection.ts:31-35` 五个模块级全局 + 17 个文件依赖无参 `getAcpClient()`），单窗口单后端假设贯穿三层。
- desktop 已有 `externalGoosed` 一对一远程后端（`main.ts:1118`）——说明上游知道该需求，**多后端支持可能被上游官方化（upstream risk）**。

**对策（v0.1 起执行）**：
1. goose 特有能力（goose 扩展方法、通知 schema）收敛在 acp 层独立的 goose adapter 模块（见 §3.3），UI 主干只依赖标准 ACP 接口；
2. 叙事为"ACP fleet 面板"，goose 是首个后端，未来可接其他 ACP agent（Claude Code ACP 等）；
3. 与 AAIF 社区沟通定位：做"官方周边生态"而非替代品，探索贡献方向（见 §8 上游提案）。

### 1.3 用户与可证伪假设

- **P0 自用**（已验证）：多机多节点会话管理。
- **P1 运维（假设，v0.2 前验证）**："服务器上跑 goose 做自动化的小团队需要多节点监控面板"。验证方式：goose 社区（GitHub/Discord）发帖调研 + 在线 demo 留言，若 30 天内无 ≥10 个真实外部用户表达多节点需求，则收敛为个人工具、暂停商业化投入。

---

## 2. 选型原则映射

| 原则 | 决策 |
|---|---|
| 从小开始、先自用 | **v0 = 方案 C+**（desktop 轻量 fork，每窗口绑定节点，2–4 天，只改主进程）；E（提取式 3–4 周）后移为公开 v0.1 且有条件启动（gate：C+ 自用 2–4 周 + P1 社区验证）。 |
| 商业开源、运维落地 | open-core 现在定界（见 §6）：core 永久 Apache-2.0；网关企业功能 BSL 独立仓库。 |
| 方案间整合 | **E（提取式）为 v0.1 实现主体**；B 降级为回退路线（其 Web 部署形态保留）；C（多窗口 externalGoosed）先做 2–3 天远程全链路验证、其节点管理作首屏骨架；D（聚合网关）后移 v0.3 商业核心；A 淘汰，其 acpConnection 重构并入 E。详见 FEASIBILITY.md §3–4。 |
| 先易后难、尽早发布 | **v0.1 即公开**：GitHub 开源 + Pages demo + 一条演示视频；每版独立可用。 |

---

## 3. 技术方案

### 3.1 总体架构（v0.1）

```
浏览器 (React SPA, Vite)
│  ConnectionProvider 接口（direct | companion | gateway 三实现，v0.1 只实现 direct）
│    ├── direct: ws(s)://node:3284/acp?token=…
│    ├── companion (v0.2): ws://127.0.0.1:<port>/proxy/<nodeId>
│    └── gateway (v0.3): ws(s)://fleet.internal/acp
├── 节点注册表：CRUD + /status 健康探测 + 版本记录
├── 连接管理器：Map<endpointId, Connection>（状态机 + 重连）
└── 会话层：SessionKey = (endpointId, sessionLocalId)
```

**关键接口（v0.1 即定型，避免 v0.3 返工）**：

```ts
interface ConnectionProvider {
  connect(node: NodeConfig): Promise<AcpStream>;  // 返回标准 ACP Stream
  health(node: NodeConfig): Promise<NodeHealth>;  // /status 探测
  describe(): 'direct' | 'companion' | 'gateway';
}
```

**每连接状态机**：`idle → connecting → connected → reconnecting(backoff+抖动) → dead`；断连时在途 JSON-RPC 请求超时/取消；权限与 elicitation 请求在断连窗口标记失败并通知 UI；页面后台标签节流纳入重连参数。

**落地方式**：该目标架构承载于提取的 desktop 代码之上——组件层/store 保留上游实现，`core/` 与 `electron-shim/` 为新增层（目录见 §3.3，改造点见 §3.4）。

### 3.2 部署矩阵（v0.1 硬约束）

浏览器混合内容规则：**UI 页面协议安全级别必须 ≥ 节点协议**。

| UI 来源 | 节点 ws:// | 节点 wss:// |
|---|---|---|
| `http://localhost`（本地开发/内网） | ✅ | ✅（证书需受信） |
| `https://fleet.example.com` | ❌ 浏览器拦截 | ✅ |
| `file://` / Electron 壳（远期） | ✅ | ✅ |

**结论**：远程节点一律走 wss（正式证书或反代）；内网纯 HTTP 场景 UI 也用 http 部署。写入验收标准与 README 部署矩阵。

### 3.3 目录规划（提取式仓库，命名待商标核查）

```
fleet/                          # 项目名 TBD：避免直接使用 "Goose" 商标
├── UPSTREAM.md                 # 提取基线：上游 commit、提取范围、回移流程
├── PATCHES.md                  # 对提取代码的所有改动记录（选择性回移依据）
├── app/                        # Web UI：由 desktop src/ 提取改造（保留上游目录结构便于 diff）
│   └── src/
│       ├── core/               # 【新增】fleet 核心
│       │   ├── connectionProvider.ts   # 接口 + direct 实现
│       │   ├── connectionManager.ts    # 多连接状态机（替换 acpConnection 单例）
│       │   ├── nodeRegistry.ts         # 节点 CRUD + 健康 + 版本
│       │   └── credentialStore.ts      # 内存优先 / IndexedDB+WebCrypto
│       ├── electron-shim/      # 【新增】window.electron 的 web 实现（§3.4）
│       │   └── index.ts        #   v0.1: getAcpUrl/settings/凭据 + 桌面 API stub
│       ├── acp/                # 【提取】协议层：adapter/（goose 扩展隔离于此）
│       ├── components/         # 【提取+新增】nodes/(新) sessions/ chat/ ui/ …
│       └── …                   # 【提取】i18n/ theme/ styles/ contexts/ 等（原样保留）
├── companion/                  # v0.2：本地伴侣进程（Node），实现 shim 的文件/凭据部分
└── (gateway/)                  # v0.3：独立仓库，BSL，不在本仓库
```

### 3.4 实现策略：提取式改造（方案 E，详见 FEASIBILITY.md §2.E）

**从零写（原 B 路线）改为提取式**：将 desktop 渲染层（~66K LOC，Apache-2.0）整体提取为 web 应用，改造点集中在两处——

1. **web shim 替换 `window.electron` facade**（47 文件/177 处调用集中于此一个接口，~70 方法）：
   - `getAcpUrl()` → 节点注册表（ConnectionProvider.direct 选节点）
   - `get/setSetting`、`getSecretKey` → localStorage / IndexedDB+WebCrypto
   - 文件类 API（readFile/listFiles/…）→ v0.1 stub 禁用；**v0.2 由 companion 实现同一接口**（桌面能力渐进回归的路径自然成立）
   - 桌面类 API（更新器/菜单栏/窗口管理）→ stub 禁用
2. **acpConnection 单点深度重构**：五个模块全局 → ConnectionManager（多连接状态机）。这是 A/B/E 三案共有的不可避免成本；组件层与 store 键控改造随之进行（`(endpointId, sessionLocalId)`）。

**上游关系**：extract-once（vendor），不承诺跟随上游；维护 `PATCHES.md` 记录对提取代码的所有改动，便于选择性回移上游修复。

**回退路径**：首周以"hello extraction"里程碑验证（shim 打通 + 浏览器跑通现有聊天 UI 连单节点）。若隐性 Electron 依赖远超预估（构建链/组件层散点依赖），回退为原 B 路线（从零写 + adapter 端口化移植）。

**工期**：shim 1 周 + acpConnection 重构 1–2 周 + 节点管理 UI/构建链剥离 3–5 天 ≈ **3–4 周**，交付接近 desktop 完整度的 v0.1（从零写只能交付子集体验）。

### 3.5 安全模型（v0.1 明示）

**威胁模型**：
1. **token 泄露面**：浏览器 WS API 无法自定义头 → token 只能走 URL query → 会落入反代/服务访问日志。文档强制给出反代配置示例（caddy/nginx 关闭 query 日志）；v0.2 companion 首要价值即"token 转为头部、出浏览器"。
2. **XSS 横向移动**：LLM 输出本质不可信 → agent 消息按不可信内容处理（严格 sanitize、CSP、禁 raw HTML）；节点凭据默认仅存内存会话，持久化为可选（IndexedDB + WebCrypto）；token 界面一律打码。
3. **恶意节点反向钓鱼**：ACP 服务端可主动推 `requestPermission`/elicitation → 弹窗**强制显示来源节点标识**（名称+host+专属配色）；禁止跨节点批量确认；UI 严禁在 ACP 交互流中请求用户输入其他节点凭据。
4. **爆炸半径**：shared secret = 节点完全控制权、零权限粒度。README 声明"v0.1 仅限可信网络单人自用"；monitor-only 模式（只调 session/list + /status）作为 UI 选项。

**上游安全提案**（见 §8）：`Sec-WebSocket-Protocol` 传 token、scoped read-only token。

**证书运维**：指纹 pin 采用 TOFU（首次信任）+ 带外核对；证书变更时 UI 展示新旧指纹 diff 并要求显式重信任（v0.2 companion 场景），避免盲目放行或全员锁死。

### 3.6 验收标准（v0.1）

- [ ] **提取完整性**：构建产物零 Electron/Node 依赖（`window.electron` 全部调用经 shim）；UPSTREAM.md 记录提取基线 commit，PATCHES.md 记录全部改动
- [ ] 注册 ≥2 节点，健康探测正常（含跨域 fetch，CI 冒烟验证 /status CORS）
- [ ] 任一节点新建会话完成流式对话；权限弹窗可确认/拒绝且**显示来源节点标识**
- [ ] 历史会话回放；节点掉线自动重连（backoff+抖动），断连窗口在途请求正确失败
- [ ] token 错误 / origin 拒绝 / 证书错误给出明确提示
- [ ] 部署矩阵两种形态各验证一遍（本地 http 全链路；https+wss 反代）
- [ ] `pnpm build` 产物可部署任意静态服务器；README 含部署矩阵与反代配置示例
- [ ] CI：起真实 goose serve 的 e2e 冒烟（连接、会话、CORS）

### 3.7 后端模型（v0.6 定型）：本地默认 + 外部节点共存（每窗口绑定）

**用户语义**：本地 serve 永远是默认后端；外部节点是**增量**而非替代。二者同时工作，聊天窗口各自绑定不同后端。

| 后端 | 配置入口 | 生效范围 | 本地 serve |
|---|---|---|---|
| 本地 | 默认，无需配置 | 普通"新建聊天"窗口 | 起动 |
| fleet 节点（`externalBackends[]`） | 设置 → 共享 → Fleet Nodes | 仅"在节点上新开聊天…"创建的窗口 | 不影响（共存）|
| 上游 externalGoosed（"使用外部服务器"卡） | 设置 → Goose 服务器 | **替换默认后端**（瘦客户端：本机不起 goose，全部窗口连远程） | 不起动 |

**核心规则**（C+ 架构，2026-08-27 实机验证）：

1. **窗口 = (后端, 会话) 对**，创建时绑定，不可迁移；ACP 连接、会话列表、扩展、模型清单都来自绑定后端 → 天然隔离，本地窗口与 N 个远程窗口互不干扰。
2. **New Chat on Node… 菜单常驻**（v0.6 起）：无节点时显示为禁用项并提示添加入口；有节点时为各节点子菜单。菜单随 `externalBackends` 变更热重建（免重启）。
3. 上游卡的"需要重启应用"是其**替换式**语义的实现限制（CSP 在启动时计算、默认后端在启动时决定）；fleet 节点 origin 已全量编入 CSP，增删节点无需重启。
4. **左侧栏（会话列表）= 该窗口绑定后端的会话**：外部节点窗口列出的是远端会话（远端工作目录、远端扩展与模型）；窗口标题"节点名 — Goose"为唯一常驻标识。主题/语言/快捷键等 UI 偏好属本地 Electron，不随后端走。

**边界（不做）**：跨后端聚合会话视图、窗口内后端徽标 → v0.2+ 候选；externalGoosed 卡与 Fleet Nodes 卡合并 → 上游化时再议（保留上游单后端替换语义，服务瘦客户端场景）。

**v0.6 修复记录**：`externalBackends` 此前不在 `validSettingKeys` 白名单 → set-setting 静默拒绝 → 节点无法保存、菜单因空列表而不出现（两个症状一个根因）。

---

## 4. Roadmap

```
v0    自用 dogfood：C+ 轻量 fork（每窗口绑定节点）  —— 2–4 天 ← 立即执行，不发布
      （前置 1 天：stock desktop externalGoosed 连远程节点验证全链路）
v0.1  公开 MVP：提取式多节点聊天 + 节点总览首屏 —— 3–4 周 ← 有条件启动
      gate：C+ 自用 2–4 周 + P1 社区验证出现 ≥10 真实外部用户
      （第 1 周末 = "hello extraction" go/no-go 检查点）
v0.2  companion + 运维面板（安全里程碑）          —— +3 周
v0.3  聚合网关（独立仓库，BSL，商业核心）          —— +4 周
v0.4  团队版（SSO/RBAC/审计）商业预研             —— +6 周，gate 在 P1 假设验证
```

### v0 — 自用 dogfood（方案 C 并行细化，立即执行，不公开发布）

**状态**: C-0 已交付（`fleet/c0/`）；C-mini + C+ 已实现并通过验证（fork commit `711a8b6`：typecheck ✅、单测 677/677 ✅、eslint/prettier ✅；渲染进程零改动）。2026-08-27 Linux dev GUI 实机冒烟通过（serve 健康、窗口渲染、fleet 菜单常驻、节点保存修复），修复见 §3.7 v0.6 修复记录。

**目标**：自己日常可用的并行多节点管理，按 FEASIBILITY.md §2.C 三档递进，投入从半小时到 4 天可选：

1. **C-0（半小时，今天可用）**：零代码——每节点一个启动脚本，`APPDATA` 重定向实现多实例隔离 + `GOOSE_EXTERNAL_BACKEND_URL`/`GOOSE_SERVER__SECRET_KEY` 环境变量指定节点（env 优先于 settings）。前提：节点侧 `goose serve --host 0.0.0.0 --tls --allowed-origin…`。
2. **C-mini（半天，可选）**：fork 加 `GOOSE_USER_DATA_DIR`（~10 行）替代 APPDATA 重定向，语义干净；是 C+ 的第一步。
3. **C+（2–4 天，自用终态）**：单实例 `externalBackends[]` + 每窗口绑定节点 + 原生菜单入口；本地/远程窗口混用；内存效率最高（5 窗口 ≈ 1–1.9G vs C-0 五实例 ≈ 2–3.5G）。

**推荐路径**：C-0 先跑 1–2 周攒体感 → 可接受则止步；嫌多实例重/乱 → 一次 fork 做 C-mini+C+。fork 维护 `PATCHES.md`。

**验收**：并行连接 ≥2 个远程节点各自完成流式对话与权限确认；C-0 下各实例互不干扰（独立锁/设置）；C+ 下同一实例本地窗口与 N 远程窗口并存。

### v0.1 — 公开 MVP（提取式，浏览器直连；有条件启动）

**前置验证（第 1 周内并行，2–3 天）**：按 FEASIBILITY.md 方案 C——用现有 desktop 多窗口 + `externalGoosed` 连一个远程节点，跑通 token/TLS/`--allowed-origin` 全链路。此验证为任何实现路线所必需，并直接产出 hello extraction 的测试节点。

**首个里程碑（第 1 周末）**："hello extraction"——desktop 渲染层在纯浏览器跑通，连接单节点完成对话（shim 最小集：getAcpUrl/settings stub）。此里程碑为方案 E 的 go/no-go 检查点。

**范围**：节点健康总览为**首屏**（运维身份第一眼成立）；节点 CRUD/健康徽章/版本显示；多连接管理（ConnectionManager 重构完成）；节点维度会话列表（分页/搜索）；新会话 + 流式聊天 + 权限/elicitation 弹窗（带来源标识）；历史回放；静态部署。

**发布动作**：GitHub 开源（README 部署矩阵 + 反代示例 + 安全声明）、GitHub Pages 在线 demo（连公共测试节点）、一条演示视频；goose 社区发帖启动 P1 假设验证。

**不做**：多用户、扩展/recipes/调度管理、凭据云端同步。

### v0.2 — companion 与运维基础（安全里程碑）

- **companion**（本地 Node 进程）：`fleet companion start` 一条命令；代理所有节点流量（token 转头部、TLS pin、指纹重信任流程）；凭据加密存 OS keychain；本地文件预览。
- **运维面板**：节点版本漂移告警、错误聚合、401 引导重录入 token、诊断日志尾部。
- **验收**：UI 全流量经 companion；指纹不符阻断+diff 重信任；凭据不落浏览器。

### v0.3 — 聚合网关（商业核心资产，独立仓库 BSL）

- 单入口多路复用到 N 节点；会话 id 路由；统一鉴权（凭据不落浏览器）；审计日志（谁在哪节点做了什么）；健康与故障转移。
- **验收**：既有 ACP 客户端（desktop/CLI）可经网关使用不破坏语义；审计查询 API。
- 护城河判断：chat 层接受被上游超越，价值沉淀在网关（审计/凭据托管/单入口）。

### v0.4 — 团队版（有条件启动）

Gate：P1 假设验证通过（≥10 外部真实用户）。SSO(OIDC)、RBAC、配额成本报表、告警、K8s chart。商业意愿以 waitlist 数据为准。

---

## 5. 指标（从 v0.1 起埋点）

- 北极星：每用户注册节点数、7 日存活节点数。
- 漏斗：demo 访问 → 自部署 → 注册 ≥2 节点。
- v0.4 前：waitlist 转化。

## 6. License 与商业结构（现在定界）

| 层 | License | 仓库 |
|---|---|---|
| core（UI、连接管理、companion） | Apache-2.0 永久 | 本仓库 |
| gateway 企业功能（SSO/审计/RBAC） | BSL-1.1（4 年转 Apache-2.0） | 独立仓库 |

目标用户是自托管人群，BSL + open-core 匹配度高于闭源 SaaS 附加件。事后改 license 会引发社区反弹，故 v0.1 起公示。

## 7. 命名

避开 "Goose" 商标（关系恶化即被迫更名，参考 dockerui→Portainer）。候选：`fleet`/`gaggle`/`aviary`/中性新词——商标检索后定。

## 8. 上游提案清单（贡献换生态位）

1. WS 鉴权支持 `Sec-WebSocket-Protocol` 传 token（消除 query 泄露面）
2. scoped / read-only token（监控无需写权限）
3. `/status` 返回版本号（节点版本漂移检测）+ 可选鉴权开关

---

## 附录：修订记录

### v0.1 → v0.2（评审吸收）

**BLOCKER 已修**：① 混合内容部署矩阵（§3.2）；② token query 泄露面明示+反代配置+companion 收口（§3.5）；③ upstream risk：ACP 泛化定位+goose adapter 隔离+社区沟通（§1.2）；④ v0.1 改为公开发布（§4）。
**MAJOR 已修**：ConnectionProvider 接口先行（§3.1）；连接状态机（§3.1）；安全威胁模型 4 项（§3.5）；P1 假设可证伪+gate（§1.3/§4）；license open-core 定界（§6）；节点总览首屏（§4）；命名避商标（§7）。
**MINOR/SUGGESTION 已纳入**：/status CORS CI 冒烟（§3.6）；IndexedDB+WebCrypto（§3.3）；版本漂移告警（v0.2）；指标埋点（§5）；网关=护城河（§4 v0.3）。

### v0.2 → v0.3（实现策略切换为提取式）

- 实现路线从"从零写 + adapter 移植"改为**提取式方案 E**：提取 desktop 渲染层 ~66K LOC，以 web shim 替换 `window.electron` facade（Electron 耦合集中于此单一接口：47 文件/177 处），仅 acpConnection 单点深度重构（§3.4）。
- 新增"hello extraction"里程碑作为 go/no-go 检查点（§4 v0.1）；失败则回退原"从零写"路线。

### v0.3 → v0.4（新增 v0 自用阶段，最小投入优先）

- 事实修正：stock desktop 的外部后端是**全局单例**（`getActiveExternalBackend`，main.ts:950），并行多节点不成立 → 新增**方案 C+**（每窗口绑定节点，只改主进程 200–400 行，渲染零改动，2–4 天）作为 **v0 dogfood** 立即执行。
- E 从"v0.1 无条件路线"改为**有条件启动**：gate = C+ 自用 2–4 周 + P1 社区验证 ≥10 真实外部用户；无信号则 E 不启动，C+ 即自用终点（商业投入同步暂停）。
- FEASIBILITY.md 同步升 v1.2（C 事实修正 + C+ 方案 + 结论重排）。

### v0.4 → v0.5（C 方案并行细化：C-0/C-mini/C+ 三档）

- 新事实：stock desktop Windows/Linux 有**单实例锁**（`requestSingleInstanceLock`，main.ts:454），锁与 settings 锚定 userData（main.ts:179）→ "零改动多开"需绕锁。
- C 细化为三档（FEASIBILITY.md §2.C）：**C-0** 零代码（APPDATA 重定向 + env 后端配置，半小时）；**C-mini** ~10 行 fork（GOOSE_USER_DATA_DIR，半天，⊂ C+ 改动集）；**C+** 每窗口绑定节点（2–4 天，内存最优）。
- 新增内存估算表（C-0 每实例 0.4–0.7G；C+ 每窗口 0.15–0.4G；16G Windows 舒适 8–10 实例 / 12–18 窗口）+ 实测校准方法。
- v0 推荐路径改为：C-0 当天自用 → 1–2 周体感 → 需要再升级 C-mini+C+。
- 方案 A–E 完整对比沉淀至 [FEASIBILITY.md](./FEASIBILITY.md)，本文档引用之；工期 2 周调整为 3–4 周，换取接近 desktop 完整度的 v0.1 体验。
- 全文与 FEASIBILITY.md 联动修订：§2 选型映射表改为 E 主体（B 回退/C 验证+首屏/D 后移/A 淘汰）；§3.3 目录规划改为提取式仓库（保留上游目录结构 + UPSTREAM.md/PATCHES.md + electron-shim/）；§3.6 新增提取完整性验收项；§4 v0.1 新增方案 C 前置验证；附录去除重复行。

### v0.5 → v0.6（后端共存模型定型）

- **实机验证驱动的设计澄清**：上游 externalGoosed（"使用外部服务器"）是**替换默认后端**语义，与 fleet 节点（**按窗口叠加**）是两个正交模型；澄清二者关系与各自适用场景（瘦客户端 vs 多节点并行），新增 §3.7。
- **New Chat on Node… 菜单常驻**：无节点 → 禁用 + 提示入口（原实现：无节点时整个菜单项隐藏，可发现性差）。
- **修复**：`externalBackends` 未加入 main.ts `validSettingKeys` → set-setting 静默拒绝 → 设置页"可添加但无法保存"+菜单永不出现（同根因）。另修菜单三连环：启动安装被后续 setApplicationMenu 覆盖（全语言）、热重建按字面 `'File'` 匹配不到已翻译的父菜单（zh-CN）、插入位置正则不匹配译文——英文环境下热重建可救回前一项，故既往测试未暴露，zh-CN 实机三 bug 叠加导致菜单彻底不可见。
- **Linux dev GUI 冒烟通过**（此前仅打包产物验证）：serve 健康检查、证书指纹固定、窗口渲染正常。附带排障结论：交叉打包残留 darwin 二进制会导致本机 serve exit 2；`electron-forge start` 在非 TTY stdin 下因 REPL 读到 EOF 提前退出并连带杀掉 vite dev server（需 `tail -f /dev/null |` 挂住 stdin）；chrome-sandbox 无 SUID 时需 `ELECTRON_DISABLE_SANDBOX=1`。
