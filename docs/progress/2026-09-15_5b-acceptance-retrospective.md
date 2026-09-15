# 复盘：dsh 驱动 5B 桌面验收——agent 主导的测试、排障与合并全过程

> 日期：2026-09-15（17:05–17:55）· 性质：**过程复盘 + 可复用方法论（供其他 agent 学习加载）**
> 范围：D-1 验收（dsh 驱动 5B 清单）从启动环境到 `merge --no-ff` 的完整过程。
> 结果：**5B 7/7 通过；发现并修复 1 个 fleet 侧 bug（c4）；记录 2 个后续项（F-2 catalog
> 字段 / 上游反馈）；合并 `6a95bb0`，分支删除，main 领先 origin 14 commits**。
> 关联：`features/dsh-driver-session-report.md` §5B 验收记录（事实账）；本文是过程与方法论。

## 1. 任务与目标

- **目标**：执行 dsh 驱动特性的人工桌面验收（5B 七项清单，约 5 分钟），通过则按 §6 合并 main。该验收是全项目**唯一阻塞项**（D-1，已等待 2 天）。
- **角色分工**：agent 负责环境启动、日志诊断、代码修复、门禁与合并；人类负责**屏幕上的点击与观察**（这正是人工验收的定义——自动化门禁之外的最后一道）。
- **预期风险**（交接单 §7 明示）：renderer 的 dsh 路径从未在真实 UI 跑过——本次验收的真正目的就是抓这类问题。

## 2. 时间线（关键事件）

| 时刻 | 事件 | 结果/commit |
|---|---|---|
| 17:05 | 人类首次启动，Electron 下载卡死（1%，ETA 3276s），Ctrl-C | 环境问题 P0a |
| 17:08 | agent 以 `ELECTRON_MIRROR=npmmirror` 重启 → 下载秒过；随即 SUID sandbox FATAL | 环境问题 P0b |
| 17:09 | `ELECTRON_DISABLE_SANDBOX=1` 重启 → app 起来（vite :5173） | ✓ |
| 17:11 | 人类报告：dsh 开窗成功但报"无法连接到 Goose 服务器" | **发现 F-1** |
| 17:12–17:15 | 双侧日志诊断 → i18n key 反查 → `OnboardingGuard` 定位 → 修复（c4）→ 699 测试+typecheck 绿 | `2f1c7d1` |
| 17:19 | 人类确认：聊天界面 ✓、DESKTOP-OK ✓（模型空态=/tmp 目录=预期降级） | 清单 1、2 ✓ |
| 17:30 | 工具调用 DESKTOP-TOOL ✓；zh-CN、goose 回归 ✓ | 清单 3、6、7 ✓ |
| 17:31 | 断线测试 #1：杀桥→重启；人类"啥也没看到，窗口关了" | **发现全 app 退出 + 桥死亡** |
| 17:38–17:40 | 带 `ELECTRON_ENABLE_LOGGING=1` 复现准备；发现桥又静默死亡 → 复活 | **发现 F-3** |
| 17:43 | 断线测试 #2（25 秒窗）：app 存活；标记-增量日志分析定位重连调用链 | **定位 F-2** |
| 17:47 | 人类报告：重连横幅 ✓→错误屏（一键恢复）→RECONNECTED-OK ✓ | 清单 4 ✓（带降级） |
| 17:51 | 取消按钮无硬错误 → **7/7**；验收记录入交接单 | `8435d35` |
| 17:52 | 终门禁重跑（42+699+typecheck）→ `merge --no-ff` → 删分支 | `6a95bb0` |

## 3. 问题清单与解决过程（现象→诊断→根因→处置）

### P0 环境：启动链三连坑（先于一切代码问题）
1. **Electron 下载卡死**：人类终端未继承代理。诊断：`env` 显示 agent shell 有 `https_proxy=127.0.0.1:7897` 而人类终端没有。处置：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（不依赖代理，更稳）。
2. **SUID sandbox FATAL**：`chrome-sandbox` 需 root:4755。诊断：`sudo -n` 需密码不可自动化。处置：dev 用 `ELECTRON_DISABLE_SANDBOX=1`；根治命令已备忘（人类空闲时 `sudo chown root:root … && sudo chmod 4755 …`）。
3. **pkill 自杀**：`pkill -f "@fleet/app"` 匹配了自身命令行整串，把自己 shell 杀掉（命令无输出）。处置：改用 `[e]lectron/dist/electron` 括号技巧或精确 pid。

### P1（=F-1，已修）OnboardingGuard 误报连接失败
- **现象**：dsh 开窗 → 全屏"无法连接到 Goose 服务器 / 服务器可能正在启动"。
- **诊断路径**：① 桥日志显示请求已到达 agent（id 至 23/24）且 initialize/session 成功 → **连接其实是通的**，排除网络；② 桥日志见 `defaults/read` 连续 3 次 -32601 → 像重试；③ 错误文案在 `zh-CN.json:2475` → key=`onboardingGuard.checkProviderErrorTitle` → 定位 `OnboardingGuard.checkProvider`：重试 3 次后置错误态。
- **根因**：D7 降级矩阵漏面——守卫假定后端有 goose 扩展面；dsh 的 -32601 被当作"连不上"。
- **修复（c4）**：守卫开检前 `getAcpDriver()!=='goose'` 直接放行；catch 中 `isMethodNotSupportedError` 同样放行（双保险）。测试 699 ✓ typecheck ✓ → commit `2f1c7d1` → 重启壳复测通过。
- **验证闭环**：人类重新开窗直达聊天界面。

### P2 全 app 退出之谜（一次误判的教训）
- **现象**：断线测试 #1 后人类报告"窗口关了"；检查 `electron` 进程 = 0。
- **初判**：怀疑断线导致渲染层致命崩溃。
- **实证修正**：带渲染层日志复现（测试 #2）——app 全程存活（7 进程），所有错误均为**已捕获**（`CONSOLE ... "Failed to load ACP session"`，非 unhandled）。#1 的全退很可能 = 人类已关主窗 + dsh 窗走了错误路径关闭 → 最后窗口关 → app 退出（Electron 默认行为）。
- **教训**：单次观察不足以定因；**复现 + 日志**才是证据。改用 `ELECTRON_ENABLE_LOGGING=1` 后 renderer 的 console 全部进 `/tmp/fleet-app.log`。

### P3（=F-2，转 catalog）重连恢复错误屏
- **现象**：桥重启后窗口先"重连接…"横幅（✓ 正常），随后"加载会话失败：session/info -32601"错误屏；"重试"死路，"返回首页"→新会话→可正常聊（RECONNECTED-OK ✓）。
- **诊断（标记-增量法）**：`MARK=$(wc -l < log)` → 断线 → `tail -n +$MARK | grep -iE "error|session/info…"` → 三条调用链现形：`useNavigationSessions`（侧栏，断线前）、`chatSessionController.loadSessionFromServer`（重连后 ×3）、`ChatInput`（providers）。全部已捕获。源码确认触发点：`ChatSessionsContainer` 的 `subscribeToAcpRecovery` 在恢复完成后对每个活跃会话 `restoreSession` → `acpLoadSession` → `sessionInfo_unstable` → dsh 必 -32601 → `failSessionLoad` → 错误屏。
- **定性**：非崩溃、语义准确（dsh 每连接一会话，旧会话真不可恢复）、一键可恢复——**验收通过，UX 缺陷记录**。
- **正确修法（不现场做）**：per-driver 重连策略 → **F-2 catalog 增加 `reconnectPolicy` 字段**（dsh=`fresh-session` 自动开新会话、goose=`resume`）。理由：正确实现需会话替换管线（store+路由），验收现场赶工风险大；且该策略本质是能力元数据，归 catalog 比硬编码对。

### P4（=F-3，上游）桥静默死亡
- **现象**：两次复现——app 退出序列后 / 复测前，桥进程消失，`/status` 000，日志**无栈无终止记录**（终点停在一条 -32601 响应）。
- **处置**：每次按交接单命令复活（pid 559241→579407→584904→586528）；定性为 **dsh-fleet 侧健壮性问题**，记录待上游反馈（同 A3 渠道），不阻塞本仓验收。

## 4. 诊断方法论（可复用模式，按使用顺序）

| # | 模式 | 本次应用 |
|---|---|---|
| M1 | **双侧日志对齐**：app log + 对端服务 log 同看 | P1 定位"连接其实通了"靠桥日志的 id 序列 |
| M2 | **错误文案反查**：UI 文案 → locale key → 组件 | "无法连接到 Goose 服务器"→`onboardingGuard.checkProviderErrorTitle`→`OnboardingGuard.tsx` |
| M3 | **调用链 grep**：wire 方法名 → 调用方 → 有无 catch | `sessionInfo_unstable` 6 处调用 → 逐一确认捕获情况 |
| M4 | **标记-增量分析**：`wc -l` 记位置 → 事件后 `tail -n +MARK` + 过滤 | 断线窗口期日志切片，排除历史噪音 |
| M5 | **带日志复现**：无法静态定因就加 `ELECTRON_ENABLE_LOGGING=1` 重演 | P2/P3 的决定性证据 |
| M6 | **区分已捕获 vs 未捕获**：`CONSOLE "..."` ≠ unhandled rejection | P2/P3 定性为降级不优雅而非崩溃 |
| M7 | **环境先于代码**：启动链问题先排除（下载/沙箱/代理/端口） | P0 三连 |
| M8 | **服务健康先行**：报"连不上"先 `curl /status` 查对端再怀疑自己 | P4 桥死被发现 |

## 5. 经验教训

- **L1 自动化门禁的边界**：42+699 单测、契约冒烟、真实 LLM E2E 全绿，仍拦不住 F-1——**UI 首跑问题只有真人点出来**。人工验收不可裁剪，也不可被"测试都绿了"诱惑跳过。
- **L2 -32601 的两重性**：找到 catch 块 = 降级（可接受）；没找到 = 致命（必修）。诊断时**必须追到 catch**，不能停在"又是 Method not found"。
- **L3 能力降级是"面"的笛卡尔积**：守卫、侧栏、聊天控制器、输入框、重连钩子……每个 UI 入口 × 每个扩展方法都是独立的面。D7 矩阵要按**入口**盘点，不是按方法盘点——这正是 F-2 catalog 的存在理由。
- **L4 现场修复纪律**：小修 → 全量门禁 → commit → 再继续验收。不攒大改、不在验收中途重构（P3 的正确修法被有意推迟）。
- **L5 单次观察≠根因**：P2 的误判证明，没日志的"看到"不可作为结论；复现优先于推断。
- **L6 给人类的指令要指明观察位**："恢复态提示在 dsh 聊天窗口内部（横幅/遮罩），不是独立页面"——第一次没说清导致"啥也没看到"。
- **L7 降级语义"准确优于美观"**：错误屏语义对但 UX 差 → 记录 + 归入正确层（catalog）择期修，而不是现场打补丁美化。
- **L8 上游问题分流不阻塞**：桥静默死亡（F-3）记录、反馈、继续——验收对象是 fleet 侧行为，对端 bug 不构成本仓 blocker。
- **L9 文档随动作落账**：5B 记录在合并**前**写入交接单并随分支入库——main 的历史因此完整可溯。
- **L10 启动配方备忘**：`ELECTRON_MIRROR + ELECTRON_DISABLE_SANDBOX + DISPLAY=:0 + nohup pnpm --filter @fleet/app start` 应写入开发文档，避免每个 agent/人类重新踩一遍。

## 6. 最佳实践清单（未来 agent 直接加载）

1. 验收前：确认对端服务健康（`curl /status`）+ 记录日志文件位置与当前行数（M4 预埋）。
2. 启动壳：使用 §5-L10 配方；渲染层日志常开（`ELECTRON_ENABLE_LOGGING=1`）。
3. 报错时：先 M8（对端活吗）→ M1（双侧日志）→ M2（文案反查）→ M3（调用链+catch）→ 必要时 M5 复现。
4. 修复时：最小 diff；`pnpm --filter @fleet/app test:run && typecheck` 后再 commit；commit message 写清现象/根因/漏面归属。
5. 断线/重连类测试：明确告知人类**在哪看**（聊天窗内横幅）；断线窗口 ≥25 秒；复测前先验对端复活。
6. `pkill -f` 永远配括号技巧（`[p]attern`）或用 pid 文件。
7. 验收通过：记录先行（清单结果+发现+环境备注）→ 终门禁 → `merge --no-ff`（保留特性提交结构）→ 删分支 → 状态速览更新。
8. 过程发现按归属分流：fleet 漏面→修或排期；能力元数据缺失→catalog 字段；对端 bug→上游反馈清单。

## 7. 工件索引

| 类 | 项 |
|---|---|
| commits | `19469d6` docs 批次 · `2f1c7d1` c4 修复 · `8435d35` 5B 记录 · `6a95bb0` merge（c1-c4，45 文件 +2689/-71） |
| 日志 | `/tmp/fleet-app.log`（壳+renderer）、`/tmp/dsh-bridge.log`（桥，重启即截断） |
| 进程 | 桥 pid 文件 `/tmp/dsh-bridge.pid`；壳启动 `nohup pnpm --filter @fleet/app start` |
| 关键文件 | `OnboardingGuard.tsx`（c4）、`ChatSessionsContainer.tsx:47`（F-2 触发点）、`sessions.ts:256`（开窗路径合成分支）、`acpConnection.ts:111`（recoverConnection） |
| 后续项 | F-2 catalog `reconnectPolicy`（dsh=fresh-session）；F-3 上游反馈（桥静默死亡）；chrome-sandbox sudo 根治 |

## 8. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-15 | 初稿：时间线 / P0-P4 问题的诊断与处置 / M1-M8 方法论 / L1-L10 教训 / 最佳实践 8 条 / 工件索引 |
