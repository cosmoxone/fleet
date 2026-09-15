# dsh 驱动接入：会话进展报告与人工交接单

> 生成：2026-08-30 09:47（会话总结）
> 范围：从"加载文档、准备开发"到"自动化验收完成、桌面点击待人工"的完整任务弧
> 关联文档：`docs/features/dsh-harness-driver.md`（设计 v1.1 + 实施/冒烟记录，本报告不重复其细节）
> 服务端仓库：`../harness/dsh-dir/dsh-fleet`

---

## 1. 一页概览

| 维度 | 状态 |
|---|---|
| fleet 侧 | **已实施完毕**，分支 `feature/dsh-driver`（4 commits），等桌面人工验收后合并 main |
| dsh-fleet 侧 | 桥修复 + 文档同步**已合入其 main**（`75c2d75` + `dc1aa37`，verify 9/9） |
| 自动化验证 | 单测 42+699 全绿；契约冒烟 + **真实 LLM（MiniMax-M3）stdio/WS 全链路** ✓ |
| 待人工 | **仅桌面点击验收（约 5 分钟）** + 合并决策 + 3 个可选项（见 §5） |

**本次会话干了什么**：设计（v1.1，含 review 修正）→ 实施（c1 契约层 / c2 壳穿透与会话分流 / c3 UI+文档）→ 冒烟（抓出桥的真 bug 并修复）→ 遗留项自动化（minimax 替代 deepseek 完成真实 LLM E2E，预置好桌面验收环境）。

## 2. 交付清单

### fleet（分支 `feature/dsh-driver`，基于 main `e5554d4`）

| Commit | 内容 |
|---|---|
| `945467f` | 设计文档 v1.1（D1–D7） |
| `73e3a75` | c1：`runtime/drivers/dsh/`（AcpDriver + 注册表 + 测试）、versions.json dsh 条目 |
| `9f01e49` | c2：driver 全链路穿透、`get-acp-driver` IPC、initialize/session-new 按驱动自适应、`acpNewSession` dsh 分流、-32601 降级 |
| `d0d80fa` | c3：设置页 Driver 下拉、i18n 三 locale、INTEGRATION（契约 1 补 dsh=对方 M5、契约 3 →37 handler）、README |

代码面：新增 `runtime/drivers/dsh/driver.ts`、`runtime/drivers/index.ts`；改动 `core/node.ts`（effectiveDriverId 放宽）、app 的 settings/fleet/leaseRegistry/main/preload/acpConnection/sessions/errors/ConfigContext/FleetNodesSection。

### dsh-fleet（其 main）

| Commit | 内容 |
|---|---|
| `75c2d75` | **桥修复**：`makeWsTextSink` 行导向 → 兼容标准 ACP-over-WS 客户端 |
| `dc1aa37` | docs：R10 已知问题记录、M5 状态置完成 |

### 本机环境资产（不入库）

| 资产 | 位置/状态 |
|---|---|
| dsh 运行时 | `~/.dsh-acp/`（项目式 pnpm，21 包，含原生构建 koffi/node-pty/subprocess-local） |
| 凭据 | `~/.dsh-acp/.env`（600；`MINIMAX_API_KEY`/`MINIMAX_BASE_URL`，源自 `/home/pc/proj/benchmark/platform/secrets/minimax.env`）**key 从未进入任何仓库/日志/文档** |
| WS 桥（常驻） | pid `2387797`，`0.0.0.0:3284`，token `fleet-local-dsh-e2e`，日志 `/tmp/dsh-bridge.log` |
| Fleet 预置节点 | `~/.config/Fleet/settings.json` → `dsh-local (minimax M3)`（driver: dsh） |

## 3. 关键发现（按重要度）

1. **F1（review 最大发现，改变了工作量结构）**：renderer 运行时调用 **30+ 个 `goose.*_unstable` 专有扩展方法**；`acpNewSession` 在 session/new 后必调 `goose.sessionInfo_unstable`——对 dsh 是**阻断项**（-32601，首个会话即失败）。原 advisory 把差异归结为"三处"不成立 → 引入 **D7 能力降级模型**：会话分流 + 合成 SessionInfo + 统一 -32601 软化 + 降级矩阵。**dsh 接入的主要工作量在壳的降级，而非传输契约**。
2. **R10（冒烟抓出的桥真 bug）**：`makeWsTextSink` 行导向等待帧内 `\n`，而标准 WS 客户端（SDK/undici，即 goose serve 模型）每条 JSON-RPC 一整帧、**帧尾无换行** → initialize 永远无响应。对方自有客户端发 `json+"\n"` 故从未暴露。已修复并回归。**教训：契约测试必须用与生产同构的客户端——这正是 acp-smoke 的存在意义。**
3. **LLM 适配器兼容性**：`dsh-llm-deepseek` **要求 SSE `data: [DONE]` 哨兵**，MiniMax 端点不发（curl 实证）→ 切换 `dsh-llm-pi-ai`（通用多 provider，OpenAI 兼容网关是"配置而非代码"），手写 minimax 路由。**未来接任何非 deepseek 的 OpenAI 兼容后端，用 pi-ai，不要用 llm-deepseek。**
4. **cordis.yml 与 rc.2 schema 有 drift**：`sessionTitle`（fallbackMaxWords/fallbackMaxBytes/maxTitleBytes 三必填）、`tool-todo.allowParallelInProgress` 必填缺失；`dsh-bash-sandbox` 不在其安装清单。**dsh-fleet 的 remote/ 部署脚本照抄会起不来**（候选上游反馈）。
5. **pnpm 全局隔离陷阱**：`pnpm add -g` 各包互相不可见（叶子包 loader 解析失败）；正解是 Dockerfile 的**项目目录统一安装**配方 + pnpm 11 的 `allowBuilds`（koffi/node-pty/subprocess-local）。
6. 次要：`session/cancel` 在壳里走 `notify`（无响应无报错面，dsh 上静默无效，仅文档说明）；steer 已有 catch 兜底无需改；**MiniMax-M3 的 `<think>` 内联在 content 透传**、pi-ai 将回复聚合为**单 chunk**（非逐 token 流）——形态已知，不阻塞。

设计决策速查：D1 驱动 id=`'dsh'`；D2 initialize/session-new 按驱动去 goose `_meta`；D3 驱动清单双落点（runtime + app 镜像，快照边界）；D4 dsh 无本地 provision；D5 老节点零迁移；D6 versions.json 差异字段；D7 能力降级模型。

## 4. 自动化验证矩阵（已完成，无需重做）

| 层 | 项 | 结果 |
|---|---|---|
| 单测 | root 42 / app 699 + typecheck ×2 | 全绿 |
| 契约 | `/status` 401·200、`/acp` 非升级 406 | ✓（真桥） |
| 冒烟 | `acp-smoke` 对真桥 | `SMOKE-OK agent: deepseek-harness-acp protocol: 1` |
| 真实 LLM | stdio：initialize/new/prompt→end_turn | 答案 `HELLO-FROM-MINIMAX` ✓ |
| 真实工具链 | stdio：bash（bwrap 沙箱） | agent 执行并复述 `FLEET-E2E-TOOL-CALL` ✓ |
| WS 全链路 | 经桥 prompt | `WS-E2E-OK` ✓ |

## 5. 人工部分

### 5A. 需要人工**理解与决策**

| # | 事项 | 建议 |
|---|---|---|
| A1 | **D7 降级模型的产品接受度**：dsh 节点窗口 v1 表现=聊天主链路完整；模型显示合成值（`remote (cordis.yml)` 字样——注意本地实测后端实为 minimax，**文案与实际后端可能不符**，可考虑改为中性文案如 "remote (node-configured)"）；Recipes/Schedules/MCP/会话历史入口降级说明；取消按钮静默无效（R8） | 过目 `dsh-harness-driver.md` §5.5 矩阵；接受则合并，不接受列出需收紧的面 |
| A2 | **M3 `<think>` 内联 + 单 chunk 形态**：思考文本会出现在 agent 消息里 | 可接受则记录；介意则后续试 pi-ai `compat.thinkingFormat` 或换 `MiniMax-M2.7-highspeed` |
| A3 | **cordis.yml drift 上游反馈**（发现 4） | 建议回馈 dsh-fleet（其 remote/ 部署脚本在 rc.2 下起不来） |
| A4 | 合并策略：`--no-ff` 保留 4 commits 结构 | 见 §6 命令 |

### 5B. 需要人工**测试**（桌面 ⑤，逐条可勾选；前置：桥在跑）

```bash
# 前置检查（桥死掉时重启：）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3284/status -H "X-Secret-Key: fleet-local-dsh-e2e"   # 期望 200
# 若非 200：
nohup node /home/pc/proj/harness/dsh-dir/dsh-fleet/bridge/acp-ws.mjs --port 3284 --token fleet-local-dsh-e2e \
  --cmd "cd ~/.dsh-acp && ~/.dsh-acp/node_modules/.bin/dsh-acp-demo -c ~/.dsh-acp/cordis.yml" \
  > /tmp/dsh-bridge.log 2>&1 &

# 启动壳（DISPLAY=:0）：
cd /home/pc/proj/fleet && pnpm --filter @fleet/app start
```

- [ ] 菜单 **File → New Chat on Node… → dsh-local (minimax M3)** 能开窗，无健康检查报错
- [ ] 窗内发一句 "Reply with exactly: DESKTOP-OK" → 收到回复（end_turn；`<think>` 内联属已知形态）
- [ ] 发 "Use the bash tool to run: echo DESKTOP-TOOL, then report its output" → agent 执行工具并复述（注意：本地 cordis `approval.policy: never` 为自动化配置，**不会弹权限框**；如需测权限弹窗路径，把 `~/.dsh-acp/cordis.yml` 的 approval 段 policy 改 `ask` 后重启桥）
- [ ] **断线重连**：`kill 2387797`（或新桥 pid）→ 窗内应有恢复态提示 → 按上面命令重启桥 → 恢复对话
- [ ] **降级巡查**：dsh 窗口打开 设置/模型选择 → 预期"不崩溃、有说明或空态"（providers/config 走 -32601 软化）；会话历史空态；取消按钮点击无硬错误
- [ ] **zh-CN 巡查**（retrospective 教训）：切中文界面，设置 → 共享 → Fleet Nodes 的"驱动"下拉、占位符、描述文案正确
- [ ] **回归**：添加一个 driver 缺省的节点（如本地 goose，`~/.local/bin/goose` 在 PATH）→ 行为与改造前一致

### 5B 验收记录（2026-09-15 17:51，**通过 7/7**）

| # | 项 | 结果 |
|---|---|---|
| 1 | dsh 开窗 | ✓（经 c4 修复后直达聊天） |
| 2 | DESKTOP-OK 对话 | ✓ |
| 3 | bash 工具调用（DESKTOP-TOOL） | ✓ |
| 4 | 断线重连 | ✓ 重连横幅正常；桥重启后 RECONNECTED-OK（经"返回首页→新会话"，见 F-2） |
| 5 | 降级巡查 | ✓ 模型选择空态/设置页/会话侧栏不崩溃；取消按钮静默无硬错误（R8 文档化行为） |
| 6 | zh-CN 巡查 | ✓ |
| 7 | goose 回归 | ✓ |

**过程发现（真实 UI 首跑，§7 预言风险的兑现）**：
- **F-1（已修，c4 `2f1c7d1`）**：OnboardingGuard 对 dsh 调 `goose.defaultsRead_unstable` 得 -32601，重试 3 次后误报"无法连接到 Goose 服务器"错误屏——D7 漏面；修法=非 goose 驱动跳过引导守卫 + catch 中 `isMethodNotSupportedError` 放行；
- **F-2（记录，转 F-2 catalog）**：断线重连后 `ChatSessionsContainer.restoreSession` 按 goose 语义恢复旧会话 → dsh 无 `session/load` 面 → "加载会话失败"错误屏（"重试"死路，"返回首页"一键可恢复，无崩溃）；**正确修法=per-driver 重连策略**，建议 F-2 catalog 增加 `reconnectPolicy` 字段（dsh=`fresh-session`，goose=`resume`），随 catalog 实施而非现场硬编码；
- **F-3（上游反馈项）**：dsh-fleet 桥在异常客户端断开序列后**静默退出**（无栈无日志），两次复现——建议回馈 dsh-fleet（同 A3 渠道）。

环境备注：Electron 43.3.0 dev（`ELECTRON_DISABLE_SANDBOX=1`，SUID 未配置的权宜）；Electron 二进制经 npmmirror 镜像；桥经交接单命令多次重启（验收时 pid 586528）。



| 输入 | 用途 | 影响范围 |
|---|---|---|
| 验收结论（通过/问题清单） | 触发 §6 合并或返工 | 本特性收口 |
| （可选）`DEEPSEEK_API_KEY` | 回归 deepseek 官方链路：把 `~/.dsh-acp/cordis.yml` 的 `llm` 段换回 `dsh-llm-deepseek`（apiKeyEnv: DEEPSEEK_API_KEY）+ spine `provider: deepseek-official` + model `deepseek-v4-pro`，`.env` 换 key | 仅本地验收环境，不涉代码 |

## 6. 验收通过后的收口命令

```bash
cd /home/pc/proj/fleet
pnpm test && pnpm --filter @fleet/app test:run && pnpm --filter @fleet/app typecheck   # 终门禁
git checkout main && git merge --no-ff feature/dsh-driver -m "merge: dsh driver (c1-c3)"
git branch -d feature/dsh-driver
```

清理（可选，验收后）：
```bash
kill $(cat /tmp/dsh-bridge.pid 2>/dev/null) 2>/dev/null       # 停桥
# ~/.dsh-acp（含 .env 密钥）与 ~/.config/Fleet/settings.json 按需保留/删除
```

## 7. 风险与未覆盖面（透明清单）

- 桌面 ⑤ 未执行：Electron 渲染层的 dsh 路径（自适应 initialize、会话分流、降级）仅有单测覆盖，**未在真实 UI 上运行过**——这正是 5B 存在的原因。
- TLS 路径未实测（本地用 http）：桥的 `--tls` + 指纹钉扎（`sha256/<base64>` 格式兼容已由代码审查确认）未跑真证书；如需，桥加 `--tls --cert --key`，节点填指纹。
- 多窗并发对同一 dsh 节点：桥为每连接 spawn 独立 dsh 进程（设计如此），未压测。
- rc.2 能力面（无 session/list|resume|close）在 UI 的长期体验（历史侧栏永远空）未收集用户反馈。
