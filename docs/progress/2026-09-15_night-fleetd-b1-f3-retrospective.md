# 复盘：夜班车——fleetd M1 收官、B1 双驱动接入、CI 抢修与 F-3 回环物化

> 日期：2026-09-15 22:27 – 09-16 00:12 · 性质：**过程复盘 + 可复用方法论（供其他 agent 学习加载）**
> 范围：B2（fleetd M1：首切片→权限中枢→会话管理器→companion）‖ B1（openclaw/hermes 接入）
> → CI 全天红灯抢修 → F-3 后续（桌面回环物化）。**前序**：同日 5B 验收复盘、M0 桥复盘。
> 结果：M1 全量闭环（fleetd 四件）、hermes 全链路（HERMES-B1-OK）、openclaw 半程（等模型鉴权）、
> CI 转绿、stdio 节点可开桌面窗；全部推送且 CI 绿。**收口 v0.2.0。**

## 1. 目标与背景

- 用户既定路线：**M2-alt → F-3 → B2(fleetd M1) → B1(openclaw/hermes)**——本段执行后三站；
- M1 = HUB 设计的"fleetd 最小版"全量：服务 + 桥 attached + 权限中枢 + 会话管理器 + companion 面④；
- B1 = "填表即接入"命题的实战检验（catalog 就绪后新驱动接入应接近零代码）。

## 2. 时间线

| 时刻 | 事件 | 结果 |
|---|---|---|
| 22:27–22:36 | fleetd 首切片（server+CLI+桥 attached/回落） | E2E 三段 ✓（DIRECT/ATTACHED/FALLBACK） |
| 22:36–22:50 | M1 余量：权限中枢 + 会话管理器 + stdio 传输统一 | 活体 E2E `ALLOWED:allow` ✓ |
| 22:50–22:56 | B1 openclaw：版本核查（npm 无 acpx）→ 升级 2026.9.4 → 迁移 → Gateway 重启 | 握手+会话+prompt 通；卡模型鉴权与二连 bug |
| 22:56–23:09 | CI 取证：**全天 12 连红**，最后绿=M0 前 | 三真因定位 |
| 23:09–23:19 | CI 三修复（Zod 泛型/desktopShell 键/itLive guard） | `a91a37c` CI ✓ |
| 23:19–23:33 | hermes：venv 安装 → minimax 通道三轮调通 | `HERMES-B1-OK` |
| 23:33–23:44 | companion 面④（/companion 页 + ?token= SSE） | 测试 15 ✓ |
| 23:44–00:12 | F-3 后续：stdioLoopback + main 分支 + 表单 + 门控翻转 | 707+106 全绿，推送 `cac1201` |

## 3. 问题清单（现象→诊断→根因→处置）

### P0 fleetd 会话路径不懂 stdio 节点
- **现象**：权限中枢活体 E2E 502——`openBridgeSession` 只会 WS，stdio 节点 url 为空。
- **根因**：会话层与驱动层割裂——stdio 能力在 F-3 驱动里，会话代码在 bridge 里。
- **处置**：`openBridgeSession` 按节点形态选传输（`command` → stdio 流 / 否则 WS）。
- **教训**：**同一能力的两条路径（驱动层 request 形态 vs 会话层流式形态）要尽早合流**，
  否则每个新形态都要修两处——本次"传输选择下沉到会话层"就是合流点。

### P1 openclaw 升级三连坑（详见独立文档）
- npm 前缀之谜（装去 nvm 而非 ~/.npm-global）→ `which -a` 两处二进制并存；
- 2026.9.4 严格 schema 拒旧配置（3 废弃键逐层剥）→ `doctor --fix` 需停 Gateway；
- 升级后 acp 桥**首连成功、二连 legacy-auth 拒绝**（上游迁移 bug，挂账反馈）。

### P2 CI 全天红灯而我不知（**本段最重教训**）
- **现象**：用户问"卡死了吗"时正在取证；CI 自 M0 起 12 连红，我全天未看一眼。
- **根因**：本地门禁绿 ≠ CI 绿——本地有活桥/已装环境，CI 是裸机；
  M0 的 `pnpm add`（zod 4.4.3 入树）+ F-3 改动（漏跑 app tsc）+ 活节点测试（CI 必红）三因叠加。
- **处置**：三修复 + **新守则**：①每步后跑 app typecheck（不只 root）；②**推送后必看 CI 结论**；
  ③依赖环境的测试必须 env-guard（`itLive`）。

### P3 hermes 模型通道三轮试错（详见独立文档）
- OPENAI_* 注入 → 401（模型名路由去了别的 provider）；
- 原生 `MINIMAX_*` + `/v1` base → 404；
- **正解**：hermes 是 Anthropic Messages 栈，minimax 要走 `/anthropic` 端点 → `HERMES-B1-OK`。
- **教训**：**读源码确认 provider 的 wire 协议族**（openai-compatible vs anthropic）再配 base。

### P4 node-cli 键名错配（连字符 vs 驼峰）
- `--args-json` 存为键 `args-json`，代码读 `argsJson` → args 静默丢失 → openclaw 裸启动进 TUI。
- **教训**：CLI 参数键名要么统一转换（`-`→camel），要么索引处显式引号——测试应覆盖"参数确实落盘"。

### P5 loopback 集成的三次返工
- `return` 误跳开窗流程 → 改 if/else；替换残留重复块；TS 流收窄 `never`（捕获后置 null）→ `as` 断言重置。
- **教训**：**大段 python replace 改主进程代码后必须立即 diff 全览**，不能只看插入点。

### P6 dsh 桥第 4/5 次静默死亡
- 两次打断测试（一次被误判为 my-code 回归）。`itLive` guard 让套件对它免疫 ✓。
- **升级处置**：已从"上游挂账"升级为"干扰工作流的常发故障"——建议给桥加看门狗或优先上游修复。

## 4. 方法论（新增，接前两篇的 M 系列）

| # | 模式 | 本段应用 |
|---|---|---|
| M9 | **CI 结论是门禁的一部分**：push 后必查 run 结论，不看=没跑 | P2 |
| M10 | **环境依赖测试 env-guard**：活桥/真机测试用 `itLive`（探测可用才跑），CI 永远确定性 | CI 修复③ |
| M11 | **双二进制并存时 `which -a` + 逐个 `--version`**：npm 前缀分裂的标配排查 | P1 |
| M12 | **provider 配置先问 wire 协议族**：openai-compatible vs anthropic 决定 base URL 形态 | P3 |
| M13 | **大段脚本化改码后 `git diff` 全览**：插入点之外的残留/重复一目了然 | P5 |
| M14 | **服务停启走服务归属**：systemd unit 的服务用 systemctl 停，别 kill 裸进程（openclaw Gateway 迁移） | P1 |

## 5. 经验教训

- **L1 "填表即接入"被验证**：hermes 接入的 fleet 侧改动 = 1 个 settings 条目 + 健康检查超时调整
  （30s，冷启动实证）——catalog+stdio 驱动把"新驱动"压缩成"新配置"；
- **L2 权限中枢的价值立刻兑现**：companion 页让"断线测试时权限没处答"变成了"手机上点允许"——
  设计文档里的杀手场景一天内从纸面到可用；
- **L3 hub 失败≠桥失败是最重要的 M1 决策**：`via: standalone` 回落让 fleetd 可以随时挂/升级，
  消费者无感——这个模式值得推广到所有"增强层"；
- **L4 用户环境是最诚实的测试床**：npm 前缀分裂、Gateway 常驻、zod 锁文件……五个问题里四个
  只有真环境能暴露；
- **L5 门控要有生命周期**：`desktopShell:false→true` 完整走完"先挡后放"，证明 catalog 门控
  不只是文档承诺。

## 6. 最佳实践清单（追加）

9. push 后立即 `gh run list` 确认 CI；红则先修 CI 再继续特性（债务窗口 ≤ 一次推送）。
10. 依赖活服务的测试：探测→`itLive`/`it.skip`；描述里写明依赖（"needs local dsh bridge"）。
11. 主进程集成（main.ts）：小步改 + 每步 `tsc --noEmit` + `git diff` 全览；禁大段盲替换。
12. 第三方 provider 配置三问：协议族？鉴权头？base 是否含版本路径？
13. 升级常驻服务：查服务归属（systemd）→ 停 → 迁移（doctor）→ 切 unit 二进制 → 起 → 验健康。
14. venv 隔离装 Python agent（`.venv-fleet`），不污染用户 Python；凭据经 `FleetNode.env` 注入。

## 7. 工件索引

| 类 | 项 |
|---|---|
| commits | `7c27148`(M1 首切片) `ecfa7d1`(落账) `M1余量` `b333ba3`(cli 键) `a91a37c`(CI 三修) `392419d`(超时) `5da02d6`(companion) `cac1201`(F-3 回环) |
| 新代码 | `fleetd/`（server/main/permissionHub/companion）· `bridge/src/{attach,stdioTransport}.ts` · `app/src/utils/stdioLoopback.ts` |
| 证据 | FLEETD-DIRECT/BRIDGE-ATTACHED/FALLBACK-OK · ALLOWED:allow（权限中枢）· HERMES-B1-OK · 桌面 stdio 窗（用户点验） |
| 配套文档 | `2026-09-15_openclaw-upgrade-notes.md` · `2026-09-15_hermes-install-notes.md` |
| 挂账 | openclaw 模型鉴权（用户侧）· openclaw acp 二连 bug（上游）· dsh 桥死亡×5（上游，升级优先级） |

## 8. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-16 | 初稿：P0–P6 / M9–M14 / L1–L5 / 最佳实践 9–14 / 工件索引 |
