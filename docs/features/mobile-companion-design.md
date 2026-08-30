# 参考设计：fleet 移动端伴侣（Mobile Companion）

> 特性 ID：`FLEET-MOBILE-001` · 状态：**参考设计 v0.1 草案，待评审**（2026-08-30）
> 触发：用户提出"codex 支持移动端、dsh desktop 也支持，fleet 理论上也要支持"。
> 本文给出选项、推荐路线与契约草案；**不排期**，供 v2 规划决策。

## 1. 业界参照（事实先行）

| 参照 | 模式 | 对 fleet 的含义 |
|---|---|---|
| **OpenAI Codex**（ChatGPT App 内） | **SaaS 薄客户端**：手机是遥控器，agent 跑在 OpenAI 云（cloud tasks；本地环境经 ChatGPT 桌面端配对回连） | 体验最顺但**与我们定位冲突**：fleet 的差异化是自托管编排自有机器，不做云 SaaS。仅借鉴"手机=轻客户端+任务流式回看"的产品形态 |
| **dsh-desktop**（第三方 DataElement，`/home/pc/proj/harness/dsh-desktop`，MIT） | **自托管 LAN 桥**：Electron 主进程内嵌 `lan-mobile-bridge`（1117 行 + 测试），手机浏览器直连；可选公网隧道（cloudflared quick tunnel / pinggy 双备选） | **工程蓝本**。模式提炼见 §2，逐项可抄 |
| berd（前研究 `docs/research/berd-notes.md`） | 无移动端（Tauri 桌面 only） | 无参照价值，仅确认赛道空白 |

## 2. dsh-desktop 手机桥的可抄模式（源码核实，2026-08-30）

| 模式 | 其实现 | fleet 采纳方式 |
|---|---|---|
| QR 配对 | `qrcode` 生成 `pairingUrl`；**TTL 5min**；`timingSafeEqual` 比对一次性码；配对成功发长期 token | 原样采纳（+ 我们已有的 TLS 指纹可入 QR 元数据） |
| **RPC 白名单** | 手机只能调 `RPC_ALLOWLIST`（9 个方法：list/create/prompt/cancel…），能力差异收敛在 API 边界 | 原样采纳，且**由 A2 能力 catalog 生成**（见 §6） |
| 手机页 | **服务端渲染**（bridge 自带 `renderMobilePage/Reconnect/PairingWait`，无独立 App、无构建链） | 采纳：companion 内嵌轻量响应式页，复用桌面设计令牌 |
| 断线 mux | 指数退避重连（500ms→30s 上限，5s 判稳） | 原样采纳 |
| 公网访问 | cloudflared quick tunnel（自动域名）+ pinggy SSH 隧道备选，provider 抽象 | 采纳抽象；**首推 Tailscale**（见 §7 安全） |
| 防御 | `MAX_BODY_BYTES 64KB`、地址枚举防滥用 | 原样采纳 |

## 3. 目标 / 非目标

**目标**（用户价值按序）：
1. **远程权限应答**：桌面 agent 弹工具权限时，手机一键 允许/拒绝（移动端杀手级场景）；
2. **舰队看板 + 会话回看**：节点健康、进行中会话的实时转录（流式）；
3. **轻派发**：手机发起"在某节点开新会话 + 首条消息"（桌面侧开窗，结果回流手机）；
4. 断线可恢复、扫码即用、默认零暴露。

**非目标**：不做原生 App；不做云 SaaS/中转服务器（与定位冲突）；v1 不做节点增删改（只读注册表）；不做多用户/审计（→ M3）。

## 4. 选项与选型

| 选项 | 描述 | 判定 |
|---|---|---|
| **O1 嵌入式 LAN 桥**（dsh-desktop 同型） | Electron 主进程新增 `companion` 模块，手机连桌面 | **✅ v1 推荐**：复用 settings/lease/权限流，单事实源（桌面），模式已被 dsh-desktop 验证 |
| **O2 headless companion 服务** | 独立 Node 服务复用 `core/`+`runtime/drivers/`，跑在常开机器，桌面退居"专业控制台" | **✅ v2 方向**：桌面不必开机；core 抽象的又一次兑现；但节点注册表与桌面 settings 的同步需设计（导出/共享文件） |
| O3 手机直连节点 | 手机做 ACP 客户端直连 goose serve / dsh 桥（契约 1 本就是网络服务） | **逃生舱，仅文档化**：失去编排视图/权限聚合/dsh 无会话恢复；任何第三方 ACP 客户端天然可用，不投入 |

**关键差异认知**：Codex 手机遥控的是"云里的 agent"；dsh-desktop 遥控的是"本机 harness"；**fleet 遥控的是"编排器 + N 台节点"**——价值密度更高（一个手机管整个舰队），复杂度也更高（多节点 + 权限聚合）。

## 5. v1 架构（O1）

```text
┌─ Electron 主进程 ────────────────────────────────────────────┐
│  companion 模块（新，默认关闭，设置开关 + 端口 + LAN 绑定）      │
│   ├─ HTTP/WS :port（127.0.0.1 默认；LAN 绑定 opt-in）          │
│   ├─ GET /pair → QR{url, oneTimeCode, certFingerprint?}      │
│   ├─ 静态: 移动页（SSR 轻页 + 响应式，服务端渲染）              │
│   └─ /api/v1/*（契约 5 草案，见 §6；RPC 白名单）               │
│  事件桥（新 IPC）：renderer 的 session/update、request_permission │
│   → 主进程 EventBus → companion WS 扇出/挂起队列               │
│  派发：companion → createChat({backendId}) + initialMessage     │
│   （复用既有"add-active-session + 初始消息"事件，零新路径）      │
│  隧道（可选）：cloudflared/pinggy 抽象（抄 dsh-desktop）        │
└──────────────────────────────────────────────────────────────┘
        ▲ LAN / Tailscale / 临时公网隧道
   📱 手机浏览器（扫码配对 → token；无独立 App）
```

要点：
- **手机页不渲染原始 agent 输出**（XSS 面）——复用桌面 renderer 的净化管线产物（结构化消息快照），DESIGN.md §148 的教训直接适用；
- **权限应答流**：renderer 收 `session/request_permission` → 事件桥挂起（带 TTL，默认桌面 UI 并存，先答先得）→ 手机应答经 companion 回注 → renderer 提交；
- **节点探活**：companion 读 settings 注册表 + 周期 `drivers.healthCheck`（core 驱动面已有），结果缓存供 `/api/v1/nodes`。

## 6. API 面（INTEGRATION.md 契约 5 草案，`/api/v1`）

| 端点 | 说明 | 门控来源 |
|---|---|---|
| `GET /nodes` | 节点 + 健康 + 驱动 id | — |
| `GET /sessions` / `WS /sessions/:id/events` | 活跃会话清单（lease 视角）/ 转录流（只读镜像） | A2 catalog（dsh：无历史恢复 → 仅活跃窗） |
| `POST /sessions/:id/permission/:reqId` `{outcome}` | 权限应答（TTL、单答、审计行） | — |
| `POST /dispatch` `{nodeId, prompt}` | 桌面开新窗 + 首条消息 | A2 catalog（dsh：新会话，单 in-flight） |
| `POST /sessions/:id/cancel` | 转发 cancel | A2（dsh rc.2：noop，UI 隐藏） |
| `GET /companion/capabilities` | **A2 catalog 投影**：本 fleet 实例支持什么（手机 UI 据此渲染） | — |

> 白名单机制 = dsh-desktop `RPC_ALLOWLIST` 的 catalog 化升级：**允许的 RPC 集合由各驱动能力面生成**，而非手写两份。这是 A2 的第三个消费方（桌面 UI、A1 新驱动、移动端）。

## 7. 安全模型（默认零暴露）

1. **默认关闭**；开启需显式选 LAN 绑定；`networkInterfaces` 枚举生成 QR URL；
2. 配对：一次性码（`timingSafeEqual`、5min TTL）→ 长期 token（可吊销列表）；**companion token ≠ 节点 secret**，手机永不接触节点凭据（companion 代理/转发，不透传注册表）；
3. 传输：LAN 明文仅限"局域网 + 只读看板"；**推荐 Tailscale**（`tailscale serve` 出真证书 → Secure Context → PWA/Web Push 可用）；临时公网走 cloudflared quick/pinggy（抄 dsh-desktop，标注风险：公网 URL 即攻击面，权限应答默认禁用隧道模式）；
4. 权限应答：短 TTL、单答、桌面与手机先答先得、审计日志（谁在何时批了什么）；
5. `MAX_BODY_BYTES`、限速、`/pair` 限频；错误信息不回显敏感值（沿 env scrub 惯例）；
6. 与现有 TLS 指纹钉扎（契约 1）正交：companion↔手机的安全是**新面**，不改变壳↔节点既有信任模型。

## 8. 分期

| 期 | 内容 | 依赖 | 估计 |
|---|---|---|---|
| **M1 只读 + 权限应答** | companion 骨架 + QR 配对 + 节点/会话看板 + 权限应答 + 白名单 | 无（独立于 A1/A2，但建议 A2 先行以获得 catalog 门控） | ~1 周 |
| **M2 派发 + PWA** | dispatch/cancel、Tailscale HTTPS 指引、PWA + Web Push（权限请求推到手机） | M1 | ~1 周 |
| **M3 headless（O2）** | 独立 companion 服务复用 core/，注册表同步，多用户 + 审计 | M1/M2 稳定后 | 2–3 周 |

试点切片（半天可验证）：主进程起 HTTP + QR + `/nodes` 只读 —— 不动 renderer，先验证"手机扫码看到舰队健康"的价值假设。

## 9. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| LAN http 非 Secure Context → PWA/推送不可用 | Tunnels 或 Tailscale serve 提供真 TLS；v1 接受普通网页 |
| 权限应答竞态（桌面/手机同时答） | 单答语义 + TTL + 审计 |
| dsh 单 in-flight / 无会话恢复 | catalog 门控：手机只显示活跃窗，派发=新会话 |
| 桌面必须开机（O1 固有） | M3 headless 解决；文档明示 |
| 手机端 XSS（agent 输出不可信） | 只回放净化后的结构化快照，禁 raw HTML |
| 公网隧道暴露面 | 默认禁用权限应答于隧道模式；QR 标注风险 |

**开放问题（待评审拍板）**：① M1 是否提前到 dsh 合并后立即做（依赖 A2 先行 ~1-2 天）；② O2 headless 的注册表同步选型（共享文件 vs 桌面导出 API）；③ 是否接受 pinggy/cloudflared 作为内置选项还是仅文档指引。

## 10. 与现有资产的关系

- **契约 1（壳↔节点）零改动**；新增**契约 5（companion API，/api/v1 版本化）**入 INTEGRATION.md；
- 事件桥是新内部 IPC（契约 3 +N，同 D7 的 `get-acp-driver` 先例）；
- **A2（能力 catalog 化）是本设计的前置**——手机 UI 的全部门控来自 `GET /companion/capabilities`；
- 顺带解决交接单 5A 的文案问题（`remote (cordis.yml)` → catalog 驱动的中性文案）；
- dsh-desktop 为 MIT 第三方项目：**借鉴模式，不合并代码**（其 unified-client.md X2 同判）。
