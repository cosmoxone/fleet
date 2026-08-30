# 进展与建议汇总（2026-08-30 17:38）

> 文件：`docs/progress/2026-08-30_1738-progress-and-recommendations.md`
> 范围：dsh 特性收口 → berd 研究 → 移动端参考设计这一整段任务弧的进展，以及最近两次答复
> （17:26 A1/A2 澄清、17:32 移动端设计）中的建议汇总。
> 详细依据见文末索引；本文是**决策入口**，不复述细节。

---

## 1. 当前进展总览

### 1.1 dsh 驱动特性（`feature/dsh-driver` 分支，5 commits）

- **代码全部完成**：c1 契约层（runtime/drivers/dsh + 注册表 + versions.json）→ c2 壳穿透
  （driver 全链路 + `get-acp-driver` IPC + initialize/`acpNewSession` 按驱动分流 + -32601 降级）→
  c3（设置页 Driver 下拉 + i18n 三 locale + INTEGRATION/README）。
- **验证完成**：单测 42+699 全绿；契约冒烟 + 真实 LLM（MiniMax-M3 经 pi-ai）stdio/WS 全链路 ✓，
  含工具调用（bash+bwrap 沙箱）。
- **过程产出**：修复 dsh-fleet 桥真 bug（行导向不兼容标准 WS 客户端，已合入其 main）；
  本机验收环境就绪（`~/.dsh-acp` + 常驻桥 :3284 + 预置 Fleet 节点）。
- **唯一阻塞**：桌面人工验收（5B 清单，~5 分钟）→ 通过后按交接单 §6 合并 main。

### 1.2 berd 研究（`docs/research/berd-notes.md`，commit 3212dec）

- 核清"更多 ACP 后端"真相：**goose serve 单枢纽 + @agentclientprotocol 官方 npm 桥**
  （claude/codex/copilot/amp/cursor 以 goose provider 身份接入，会话级 setProvider 切换）。
- 对我们最有价值：**能力门控三层模式**（catalog 静态旗标 + per-call 分支 + 带内兜底）——
  验证了 D7 方向并给出 v2 升级路径；**npm 桥供应链锁**模式（lock 重放 + npm ci + 完整性拒绝 +
  启动 reconciler）。
- 产出建议 A1–A7（见 §3）。

### 1.3 移动端参考设计（`docs/features/mobile-companion-design.md` v0.1，commit 2b75c92）

- 业界参照核实：**Codex = SaaS 薄客户端**（ChatGPT App 遥控云 agent，与 fleet 自托管定位冲突）；
  **dsh-desktop（第三方 MIT）= LAN 手机桥**（源码核实 1869 行：QR 配对 TTL/RPC 白名单/SSR 手机页/
  mux 重连/cloudflared+pinggy 隧道/防御）——工程蓝本。
- 选型：**O1 嵌入式 LAN 桥（v1）→ O2 headless companion（v2）**；O3 手机直连节点仅文档化。
- 定位差异：Codex 遥控云 agent、dsh-desktop 遥控本机、**fleet 遥控"编排器+N 节点"**
  （杀手级场景 = 远程权限应答）。

### 1.4 git / 环境状态速查

| 项 | 状态 |
|---|---|
| fleet 分支 | `feature/dsh-driver`（领先 main 6 commits，working tree 干净） |
| dsh-fleet | 其 main 已含桥修复 + docs（75c2d75/dc1aa37） |
| 常驻服务 | WS 桥 :3284（token `fleet-local-dsh-e2e`，日志 `/tmp/dsh-bridge.log`） |
| 本机资产 | `~/.dsh-acp`（运行时+密钥 600）、`~/.config/Fleet/settings.json`（预置 dsh 节点）、`/home/pc/proj/research/berd`（研究克隆） |

---

## 2. 上次答复的建议（17:26 · A1/A2 白话澄清 + 顺序）

**A1 = 要不要给 fleet 增加"本地 stdio 驱动"**：启用 `core/driver.ts` 预留的 stdio 通道，接入
ACP 官方 npm 桥（claude-agent-acp / codex-acp），fleet 直接 spawn 本地进程——设置里可选
"本地 agent：Claude Code / Codex"。berd 整个产品建立在这些桥上（官方维护、有真实用户）。
成本中等；不做则 fleet 永远只是"远程编排器"。

**A2 = 能力门控 catalog 化（D7 v2）**：把"哪个驱动支持什么"从运行时 -32601 试错改为
驱动注册表静态声明（dsh 的 `acp-contract.json` 为现成数据源），UI 预先隐藏/禁用入口、替换文案。
berd 的 curatedProviders 验证此为主流解。成本低（1–2 天）；**A2 是 A1 的地基**；
顺手解决 5A 的"模型文案写死 `remote (cordis.yml)`"问题。

**建议的执行顺序**：

```
现在：     完成 5B 桌面验收 → 按交接单 §6 合并 dsh（唯一阻塞项）
合并后：   ① A2（1–2 天，小改动，含文案修复）
          ② A1 spike（选 codex-acp 或 claude-agent-acp 一个，1–2 天验证
             stdio driver + acp-smoke 直连；不承诺 UI，只验证技术路线）
          ③ 视 spike 结果决定 A1 正式排期与范围
A3–A7：   挂起，按需立项
```

---

## 3. 本次答复的建议（17:32 · 移动端参考设计）

1. **不照搬 Codex 的 SaaS 模式**（与自托管定位冲突），以 **dsh-desktop 的 LAN 桥为工程蓝本**
   （六项模式逐项可抄，MIT 但只借鉴不合并代码）。
2. **选型 O1→O2 两段走**：v1 嵌入 Electron 主进程的 companion 模块（复用 settings/lease/权限流，
   单事实源在桌面）；v2 headless 服务复用 `core/`+驱动（桌面不必开机）。
3. **三个关键设计决策**：
   - **A2 是前置**——手机 UI 全部门控来自 `GET /companion/capabilities`（A2 的第三个消费方）；
   - **凭据隔离**——companion token ≠ 节点 secret，手机永不接触节点凭据；默认零暴露、QR 配对、
     首推 Tailscale（真 TLS → PWA/Web Push 可用）；
   - **契约治理**——契约 1 零改动，新增契约 5（`/api/v1` 版本化）；派发复用桌面既有
     `createChat + initialMessage` 路径。
4. **分期**：M1 只读看板+远程权限应答（~1 周）→ M2 派发+PWA 推送（~1 周）→ M3 headless（2–3 周）；
   另有**半天试点切片**（HTTP+QR+`/nodes` 只读）可先验证价值假设。
5. **待评审的三处开放问题（附倾向）**：
   - ① M1 是否在 dsh 合并后立即启动 → **倾向：是，且 A2 先行**（A1/A2/移动端由此串成 v2 主线）；
   - ② O2 headless 的注册表同步选型（共享文件 vs 桌面导出 API）→ **倾向：先共享文件（导出式）起步**；
   - ③ 公网隧道内置 vs 仅文档指引 → **倾向：v1 仅文档指引**（cloudflared/pinggy 留作 M2 评估），
     隧道模式下默认禁用权限应答。

---

## 4. 汇总：待人工决策清单（含建议默认值）

| # | 决策项 | 建议默认 | 时机 |
|---|---|---|---|
| D-1 | dsh 5B 桌面验收 + 合并 | 按 5A/5B/§6 执行 | **立即（唯一阻塞）** |
| D-2 | 5A 遗留文案（`remote (cordis.yml)`） | 并入 A2 一并修（catalog 驱动中性文案） | 随 A2 |
| D-3 | A2 能力 catalog 化 | **采纳，dsh 合并后第一个迭代（1–2 天）** | 合并后 |
| D-4 | A1 本地 stdio 桥驱动 | **采纳为 v2 路线；先做 1–2 天 spike**（codex 或 claude 桥任选其一） | A2 后 |
| D-5 | 移动端 M1 | **采纳；A2 后启动**（~1 周）；可先跑半天试点切片 | A2 后 |
| D-6 | 移动端开放问题①②③ | 见 §3.5 倾向 | M1 评审时定 |
| D-7 | A3–A7（供应链/带内 persona/experiments/CLI/app-e2e） | 挂起按需 | 按需 |
| D-8 | cordis.yml rc.2 schema drift 上游反馈 | 建议回馈 dsh-fleet | 随手 |

---

## 5. 文档与提交索引

| 文档 | 路径 | commit |
|---|---|---|
| dsh 特性设计 + 实施/冒烟记录 | `docs/features/dsh-harness-driver.md` | 945467f 等 |
| dsh 交接单（5A/5B/§6） | `docs/features/dsh-driver-session-report.md` | 182f0ab |
| berd 研究笔记（A1–A7） | `docs/research/berd-notes.md` | 3212dec |
| 移动端参考设计 v0.1 | `docs/features/mobile-companion-design.md` | 2b75c92 |
| 本汇总 | `docs/progress/2026-08-30_1738-progress-and-recommendations.md` | 本次 |

代码：`73e3a75`(c1) → `9f01e49`(c2) → `d0d80fa`(c3) → `182f0ab`/`3212dec`/`2b75c92`(docs)，
均在本分支待合并；dsh-fleet 侧 `75c2d75` + `dc1aa37` 已在其 main。
