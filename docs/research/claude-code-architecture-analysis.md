# Claude Code 源码泄漏架构分析汇总

> 日期：2026-09-16
> 性质：二手资料汇总（基于泄漏源码的社区分析），非本地仓库实测
> 版本基线：**v2.1.88**（泄漏快照：~1,900 个 TypeScript 文件，~512K 行）
> 用途：为 [comparison-with-harness-analyses.md](comparison-with-harness-analyses.md) 提供 Claude Code 对比项的事实源

---

## 1. 泄漏事件与资料版图

**事件**：2026-03-31，安全研究员 Chaofan Shou（@Fried_rice）发现 Anthropic 的 npm 包中遗留了 `.map`（source map）文件，可完整还原 Claude Code CLI 的 TypeScript 源码。源码被迅速归档至多个 GitHub 仓库（如 instruct-bradley 归档、catyans 逐模块解读仓）。

**分析生态**（本文事实来源）：

| 来源 | 性质 | 价值 |
|---|---|---|
| yanchuk gist《CLAUDE_CODE_ARCHITECTURE.md》 | 全子系统深潜（循环/记忆/编排/权限/UI/MCP/skills） | 最全面的单篇，本文主体事实源 |
| arXiv:2604.14228《Dive into Claude Code》+ VILA-Lab/Dive-into-Claude-Code | 学术设计空间分析（UCL/MBZUAI 团队，与 OpenClaw、Hermes Agent 横向对比） | 价值→原则→实现的系统化框架 |
| catyans/claude-code-source-analysis | 中文逐模块架构解读 | 中文社区代表 |
| ThreeFish-AI（原 shareAI-lab）/jackyrx analysis_claude_code | v1.0.33 混淆代码逆向（泄漏**前**的旧路线） | 早期逆向方法论的源头 |
| bits-bytes-nn 博客 | "8 层安全 + 4 级消息压缩"视角 | 安全/压缩维度补充 |
| dev.to（brooks wilson） | 社区 Rust 重写将 51 万行浓缩为 ~2 万行 | 核心复杂度估算 |

**口径差异注记**：压缩策略层数各源口径不一（gist 4 层 / arXiv 5 层 / 博客 4-tier）；权限模式数（gist 5 种符号模式 / arXiv 7 modes，后者含 dontAsk 等）。本文取并集说明。

## 2. 技术栈与总体架构

- **运行时**：Bun（快速 JS/TS 运行时）；**语言**：TypeScript（strict）
- **UI**：Ink（React 终端渲染器）+ 定制扩展：React Fiber → Yoga flexbox → 屏幕缓冲 → ANSI diff 输出（60fps 帧循环，带 FpsMetrics 监控）
- **形态**：终端原生 CLI 产品；事件驱动、流式、generator 化的 agent 循环
- **模型通道**：Claude API 1P / Bedrock / Vertex 多通道；prompt caching 断点管理
- **特性实验**：GrowthBook 特性门控（带死代码消除）+ Statsig 实时门控——产品实验文化贯穿

arXiv 的总括判断：**"核心是一个简单的 while 循环（调模型→跑工具→重复），绝大部分代码在循环周围的系统里"**——权限系统（7 模式 + ML 分类器）、五层压缩管道、四套扩展机制（MCP/plugins/skills/hooks）、子代理委派编排、append 型会话存储。

## 3. 核心执行循环

- `query()` 为**流式 async generator**：逐事件 yield（text/thinking delta、tool_use 块），天然具备暂停/恢复、背压、取消语义
- `QueryEngine`（每会话一个）：持有可变消息历史、abort controller、用量追踪、文件缓存；`submitMessage()` 是每轮入口
- 工具执行编排：按 `isConcurrencySafe` **分区批处理**——并发安全工具并行（≤10 并发），独占工具串行；并行批次内 sibling 错误联动取消
- 健壮性：max_tokens 恢复重试（≤3 次）；每轮 API 回合后检查压缩阈值
- 启动序列：init（安全环境变量→优雅关停→代理预连接）→ 认证 → 特性门控 → 配额 → git/CLAUDE.md 上下文 → 工具注册 → REPL

## 4. 上下文与记忆管理（四引擎对照中最精细的一档）

**分层内存**：系统提示（基座+工具描述+MCP 指令+模式指引）→ 用户上下文（CLAUDE.md 六级层级：/etc → ~/.claude → ./CLAUDE.md → ./.claude → rules/*.md → CLAUDE.local.md，git 状态、日期）→ 对话消息（含压缩边界）→ 输出预留（~20K）。

**渐进式压缩管道**（按 token 用量逐级触发）：

| 层 | 触发 | 手段 | 特点 |
|---|---|---|---|
| Micro-compact | ~80% | 清除旧工具结果（Read/Bash/Grep/Edit…按时间阈值） | 外科手术式，信息损失最小 |
| Auto-compact | ~167K（200K−20K 预留−13K 缓冲） | 旧消息送模型摘要 + 压缩边界标记 + 关键上下文重注入 | 前后压缩钩子；连续失败 ≤3 次断路器 |
| Session-memory compact | 实验特性 | 提取关键信息入持久会话记忆（10K~40K） | 维护 tool_use/tool_result 配对不变量 |
| Reactive compact | API `prompt_too_long` | 截断最旧消息组后重试 | 最后手段 |

**持久记忆（memdir）**：`~/.claude/projects/<slug>/memory/` 下 MEMORY.md 索引（≤200 行）+ 分类记忆文件（user_role/feedback/project/reference），frontmatter 元数据。

**其它机制**：token 计量分级（API 精确 / chars÷4 / JSON chars÷2 / 图片固定 2000）；文件状态 LRU 缓存（100 文件/25MB，供去重与 Edit 校验）；**Dream task**——用户空闲时后台"做梦"复盘会话、更新记忆文件（带回滚保护）。

## 5. 多 Agent 编排（三级结构）

| 级 | 机制 | 要点 |
|---|---|---|
| L1 Sub-agent | AgentTool | 隔离文件缓存（克隆）、独立/共享 abort、独立 JSONL 转录（sidechain）、按定义过滤工具池、fresh 或 fork 消息 |
| L2 Coordinator | `CLAUDE_CODE_COORDINATOR_MODE=1` | 系统提示改写为编排者；受限工具的 worker；XML task-notification 协议 |
| L3 Team | TeamCreateTool | 持久团队（~/.claude/teams/*.json）；SendMessageTool 路由；共享 scratchpad 文件系统；结构化关停（request→approve） |

**Fork 子代理（亮点优化）**：同上下文派生多个子代理时共享消息前缀，最大化 prompt cache 命中（100K 缓存 vs 3×100K 未缓存）。

**通信**：进程内队列 / 文件 mailbox（tmux/remote）/ 广播 / shutdown 协议。**任务类型**：local_bash、local_agent、remote_agent、in_process_teammate、local_workflow、monitor_mcp、dream。

## 6. 工具系统

- **四层注册表**：核心常驻（Bash/Read/Edit/Write/Glob/Grep/Agent/Skill/Task 族/PlanMode/Web…）→ 特性门控（KAIROS/MONITOR/COORDINATOR/WORKFLOW/WEB_BROWSER…）→ **延迟加载**（ToolSearchTool）→ 动态 MCP（`mcp__{server}__{tool}` 命名规范化）
- **延迟加载**：100+ MCP 工具只在系统提示中列名不列 schema；模型经 ToolSearch（select:+/关键词打分）按需取 schema——省 token 的关键设计
- **Tool 接口**：`isConcurrencySafe` / `isReadOnly` / `shouldDefer` / `checkPermissions` 等一等字段

## 7. 权限与安全（per-action 安全的代表）

**权限管道**（每次工具调用）：模式短路（bypass→ALLOW 全放行 / dontAsk→DENY）→ 规则匹配（deny/allow/ask）→ auto 模式 LLM 分类器（白名单工具直放 + 分类器裁决 + 拒绝追踪熔断：>3 连续或 >20 累计回退 ASK）→ 模式默认（acceptEdits 只放 cwd 内文件编辑 / plan 暂停展示）。

**七层安全机制**：危险文件保护（.gitconfig/.bashrc/.mcp.json 阻断+大小写归一防绕过）、危险命令检测（rm -rf / git push --force / DROP TABLE）、bypass 权限远端熔断开关（GrowthBook）、auto 模式实时熔断（Statsig，熔断后不可再入）、拒绝追踪、skill 范围收窄（编辑 skills 目录时收窄授权面）、**MCP 来源 skill 永不执行 shell**（防远程代码执行）。

## 8. 扩展机制四件套（行业概念源头）

1. **Hooks**：16 类事件（会话/输入/工具/子代理/任务/其它）× 5 种类型（command/prompt（Haiku 评估）/agent/http/function）× 8 层配置源（user/project/local/GrowthBook flag/企业 MDM policy/plugin/session/builtin）——exit code 2 即 BLOCK 的拦截语义
2. **Skills**：三来源（内置/文件系统/MCP 暴露）；frontmatter 声明 allowed-tools、`context: fork`（子代理执行）、`paths:` 条件激活（模型触到匹配文件才可见）；inline 注入 vs forked 独立执行两种模式
3. **Plugins**：marketplace 清单（skills+hooks+mcpServers+lspServers 打包）；managed/project/local/user 四作用域
4. **MCP**：client 架构 + 7 种配置作用域（local/user/project/dynamic/enterprise/claudeai 云代理/managed）

## 9. 会话存储与状态

- **append-oriented** JSONL 转录（arXiv 口径）；子代理独立 sidechain 转录文件
- AppState：DeepImmutable 主体 + 任务表可变区（性能考虑）；React Context 分层 Provider

## 10. 设计模式提炼（对 agent 构建者的启示）

1. **generator 化 agent 循环**：yield 即检查点——流式/取消/暂停恢复/组合免费获得
2. **渐进式压缩管道**：多层阈值 + 每层保不同信息 + 断路器，而非单一大压缩
3. **fork 缓存共享**：多子代理构造共享前缀，prompt cache 命中率即成本
4. **延迟工具加载**：名字先行、schema 按需——工具数量与 token 成本解耦
5. 并发分区执行 + sibling 联动取消
6. 特性门控 + 死代码消除的实验文化（GrowthBook/Statsig）

## 11. 与其他引擎的对照定位（供 comparison 文档引用）

- **哲学**：产品即内核（单 CLI 产品本体）；arXiv 横比结论——CC 强调 **per-action safety**，OpenClaw 强调 perimeter 级访问，Hermes 强调多表面审批渲染
- **宿主接入面**：**无官方开放协议面**（对比 codex app-server 33 域 / goose ACP / opencode serve）——嵌入走 claude-agent-sdk 或外部 ACP 适配器；CC 是"终端产品"而非"可嵌入引擎"
- **概念输出**：skills/hooks/CLAUDE.md/权限模式是全行业事实标准的源头——dsh 的"CC hooks 桥"、goose 的 skills/hooks、opencode 的 markdown agent 均为同源演化
- **闭源属性**：泄漏 ≠ 开源；作为对比项仅具架构参考价值，不可作为可嵌入引擎依赖（除官方 SDK）

## 来源清单

- gist: https://gist.github.com/yanchuk/0c47dd351c2805236e44ec3935e9095d
- 论文: arXiv:2604.14228（v2, 2026-07-02）；仓库: github.com/VILA-Lab/Dive-into-Claude-Code
- 仓库: github.com/catyans/claude-code-source-analysis、ThreeFish-AI/analysis_claude_code
- 博客: bits-bytes-nn.github.io（8 层安全视角）、dev.to Rust rewrite 系、liushengli.tech、zhihu/juejin 中文解读若干
