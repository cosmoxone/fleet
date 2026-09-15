# 研究笔记：nf-board（vibe-kanban 自托管 fork）× fleet 对照

> 研究日期：2026-09-14 · 仓库 `/home/pc/proj/harness/vibe-kanban-v0.1.43`（基线 tag `v0.1.43-nf.0`）
> 背景：用户提示"nf-board 项目还有远程节点接入，有可能可以借鉴"，并指路该目录。
> 结论先行：**nf-board 的远程接入是一套"外呼式中继隧道 + SPAKE2 配对 + SSH-over-tunnel"的完整工程**，
> 恰好正面回答 fleet 的 SSH 远端节点缺口（评审 Q1b）；其 executors 层还含一个 **Rust 版 ACP client**，
> 与 fleet 驱动层直接同构。模式可抄，代码不可抄（Rust 栈 + Apache-2.0）。

## 1. 元信息

| 项 | 事实 |
|---|---|
| 身份 | **nf-kanban** = BloopAI/vibe-kanban @ v0.1.43 的自托管 fork（上游 v0.1.44 起 kanban 退役、官方云关停） |
| 定位 | 看板编排 coding agents：issue → workspace（分支/终端/dev server）→ agent 执行 → diff 审查 → PR |
| 栈 | Rust workspace（35 crates）+ React/TS（local-web / remote-web / web-core 共享）；`npx vibe-kanban` 本地模式 + crates/remote 自托管云（Postgres + ElectricSQL） |
| agent 面 | 12+ 适配器：claude / codex / gemini / copilot / amp / cursor / opencode / droid / qwen / qa_mock + **acp** |
| 许可 | Apache-2.0（保留上游归属）——借鉴模式合规，重实现为宜 |

## 2. 远程节点接入的真相：外呼中继隧道（对 fleet 最有价值的部分）

```text
远端 host（agent 跑活的地方，无公网入站端口）
   │  ① 出站 WS 连接（签名 tungstenite socket）到 relay —— 穿 NAT/防火墙
   ▼
relay（relay-tunnel 服务端）◄──② 浏览器/桌面侧接入
   │      yamux 多路复用（relay-tunnel-core：1MB 窗口/30s 写超时调优）
   │      WebRTC DataChannel 直连优先、WS 回退（relay-webrtc + webrtc_cache）
   ▼
本地物化：TunnelManager.get_or_create_ssh_tunnel()
   → TcpListener::bind("127.0.0.1:0")   ← 每条隧道 = 一个本地回环端口
   → 消费方（VS Code / HTTP 客户端）只看见 localhost:PORT
```

配套件（代码佐证）：

| 件 | 实现 | 对 fleet 的含义 |
|---|---|---|
| `embedded-ssh` | russh **SSH server** 跑在任意 async 流上（典型 = axum WS）——SSH 协议本身过隧道；Ed25519 公钥对"活跃 relay 签名会话"校验 | 证明"任意协议 over 隧道"可行；fleet 方向相反（要当 SSH **client** 拨出），russh 生态两头都有 |
| `desktop-bridge/ssh_config.rs` | 浏览器 Ed25519 JWK → OpenSSH PEM 落 `~/.vk-ssh/keys/{hash}`（创建即 0600）+ 自动写 `~/.ssh/config` 别名 `vk-{host_id}` → VS Code Remote SSH 零配置可用 | **凭据供给 + ssh-config 别名自动落盘**的 UX 模式：fleet 节点接入手册的自动化版 |
| `trusted-key-auth` | **SPAKE2**（Ed25519Group）enrollment：6 位 A-Z0-9 码作 PAKE 口令 → 共享密钥 → 信任公钥集 + 刷新/确认/请求签名 | 比 dsh-desktop 的一次性码（timingSafeEqual）更强的配对原语——移动端 M1 的升级候选 |
| `relay-protocol` / `relay-ws` | WS 帧信封 + 签名 socket | 契约 5（companion API）的传输层参照 |
| `preview-proxy` / `ws-bridge` | dev server 预览过隧道 | "回环端口物化"的又一消费方 |

## 3. executors 层：又一个 ACP client 实现

`crates/executors/src/executors/acp/`（client / harness / session / normalize_logs）：

- 基于 **`agent_client_protocol` crate**（ACP 官方 Rust SDK）——fleet 用 TS SDK（1.3.0）、berd 用 npm 桥、nf-board 用 Rust crate：三家三个语言线，wire 兼容无恙；
- `AcpEvent` 枚举把 `session/update` 流归一为 User/Message/Thought/ToolCall/Plan/RequestPermission…（`normalize_logs.rs`）；
- 权限：`RequestPermissionRequest` → `ExecutorApprovalService` trait（含 `NoopExecutorApprovalService` 兜底）——与 fleet 桥设计（FLEET-ORCH-001 §6 策略引擎）同一问题域，双模式思路可对照；
- 其余 agent（claude/codex…）各自 struct 适配 + `executor_discovery.rs` 探测安装。

## 4. fleet ↔ nf-board 对照

| 维度 | fleet | nf-board |
|---|---|---|
| 核心问题 | 一台壳**编排 N 台远程 ACP 节点**（多机会话/lease） | 看板**驱动本地/远端 workspace 里的 agent**（任务级生命周期） |
| 远程可达性 | **缺口**：节点须直连 http(s)；SSH 仅能手掀 `ssh -L` | **强项**：外呼中继（NAT 零入站）+ yamux 多路复用 + WebRTC 直连 |
| 隧道物化 | 无 | 回环端口（TunnelManager）——**消费方零感知** |
| ACP 消费 | TS SDK，驱动注册表（goose/dsh） | Rust SDK，executors/acp 单适配 + 12 家 CLI 适配 |
| 配对/信任 | TLS 自签 + 指纹钉扎（TOFU）；移动端草案 = QR 一次性码 | SPAKE2 enrollment + Ed25519 信任键 + 刷新 |
| 权限流 | ACP request_permission → 桌面 UI（移动端草案扩展手机） | ExecutorApprovalService trait + Noop |
| 语言/栈 | TS/Electron + 纯 TS core | Rust + React |

## 5. 可采纳建议（按优先级）

| # | 建议 | 优先级 | 落点 |
|---|---|---|---|
| N1 | **回环端口物化 + 出站隧道模式**：远端节点接入分两层——(a) 立即：`ssh -L` 手册配方（零代码）；(b) 工程化：driver `transports` 增 `'ssh'`（TS ssh2 库 direct-tcpip 通道）或 NF 式外呼中继（节点侧小 agent 拨回家）。**关键技巧：无论哪种，隧道都以 127.0.0.1:port 物化 → `FleetNode.url` 模型零改动、契约 1 零改动**，生命周期由壳管理 | **P0**（评审 Q1b 的正解） | F-3 spike 范围扩展 + 节点运维手册 |
| N2 | SPAKE2/PAKE 配对升级移动端 M1（替换/叠加 QR 一次性码）；TS 侧库可用性（spake2/opaque-ke 纯 JS 实现）需评估 | P1 | F-10 / mobile design §7 |
| N3 | 凭据自动供给模式（key 0600 + ssh-config 别名自动写入）：节点接入从"手册"变"一键" | P1 | 节点运维手册的 v2 |
| N4 | executors/acp 的 `AcpEvent` 归一层与 approvals trait 对照 fleet 驱动层/桥设计——特别是 Noop 兜底与 normalize_logs 的流归一做法 | P2 | FLEET-ORCH-001 / F-2 |
| N5 | WebRTC 直连优先 + WS 回退：companion v2（O2 headless）若要跨公网，可免自建中继 | P2 | F-10 M2+ |

**明确不照搬**：Rust 重栈（fleet 是 TS）；看板/issue 领域模型；云端计费闭环（crates/remote billing）；ElectricSQL 同步。

## 6. 注意事项

- 上游已 sunset（v0.1.44 退役 kanban），fork 自担维护——借鉴时以"模式提炼 + 注明出处"为宜，勿建代码依赖；
- relay 面的安全模型（签名会话、key refresh）与其云形态耦合较深，fleet 若只取隧道件需自行裁剪信任链；
- TS 生态的 ssh2/yamux/WebRTC(libdatachannel → wrtc) 可行性均为"预计可用"，立项前需一天 spike 验证（同 F-3 口径）。

## 7. 一句话结论

nf-board 把"远程接入"做成了**节点外呼 + 中继多路复用 + 本地回环物化**的成熟工程，fleet 把"多节点编排"做成了**ACP 驱动注册表 + 逐窗 lease**——两块正好互补：借它的隧道物化模式补 fleet 的 SSH/NAT 缺口（`FleetNode` 模型一行不改），借它的 SPAKE2 配对加固移动端，其余各自保留差异化。
