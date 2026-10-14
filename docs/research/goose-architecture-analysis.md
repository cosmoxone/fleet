# goose 代码架构分析文档

> 基于本地仓库 `/home/pc/proj/remote-goose/goose`（main @ `881f96c00`，workspace 版本 1.50.1）实际代码与 git 历史整理，分析日期 2026-09-16。
> 所有 LOC 统计为 `src/**/*.rs` 行数；UI 侧以 `ui/desktop` 为准。

---

## 第一章 项目全景与代码架构

### 1.1 顶层布局

```
goose/
├── crates/              # Rust workspace（members = ["crates/*"]，共 16 个 crate）
├── ui/desktop/          # Electron 桌面应用（React + TS + Tailwind + Vite + Forge）
├── ui/text/             # 已废弃的 ACP TUI（仅存 README）
├── documentation/       # Docusaurus 文档站（goose-docs.ai）
├── evals/               # 模型评测
├── services/            # 配套服务
├── scripts/ bin/        # hermit 工具链激活 + 各类脚本
├── workflow_recipes/    # 工作流 recipes
├── buzz/                # GitHub issue/PR 自动化机器人配置（见 2.2）
├── Justfile             # 任务入口（run-ui、release-binary、generate-acp-schema 等）
├── RELEASE.md / RELEASE_CHECKLIST.md / release-plz.toml   # 发布工程
└── GOVERNANCE.md / MAINTAINERS.md / AGENTS.md / CONTRIBUTING.md
```

goose 是 AAIF（Linux Foundation）旗下的开源 AI agent：**Rust 核心 + CLI + Electron 桌面 + API/SDK**，支持 15+ LLM provider 和 70+ MCP 扩展。

### 1.2 Rust Workspace 各 crate 职责（按 LOC 排序）

| Crate | LOC | 职责 |
|---|---|---|
| `goose` | 167,752 | **核心**：agent 循环、providers、权限、会话、MCP 客户端、recipe/hooks/skills、scheduler、ACP server 实现 |
| `goose-cli` | 28,571 | `goose` 命令行（binary `goose`），另含 `generate_manpages`、`mcp_conformance_driver` |
| `goose-providers` | 12,583 | Provider 体系拆分的新家（openrouter 等正逐步迁入，见 #11757） |
| `goose-local-inference` | 10,347 | 本地推理/本地模型管理（近期移除了 managed model registry，见 #11789） |
| `goose-mcp` | 6,277 | 内置 MCP server：`autovisualiser`、`computercontroller`、`memory`、`peekaboo`、`tutorial` |
| `goose-sdk` | 2,383 | goose SDK（embedding 场景） |
| `goose-roaming` | 2,197 | **基于 iroh 的 P2P roaming transport**——远程连接另一台机器上的 goose agent |
| `goose-agent` | 1,468 | "The GDK's Agent Loop"——GDK（goose development kit）内嵌的轻量 agent 循环，近期新增 tool calling（#11627） |
| `goose-context-management` | 1,156 | 上下文管理（压缩/裁剪） |
| `goose-download-manager` | 690 | 下载管理 |
| `goose-test` / `goose-test-support` | — | 测试基建 |
| `goose-provider-types` / `goose-sdk-types` / `goose-acp-macros` | — | 类型与过程宏 |

**重要架构事实（较旧资料已过时）**：`crates/goose-server`（goosed）**已在 #10224 删除**。仓库根 `AGENTS.md` 中"给桌面加 API 要改 goose-server/src/routes"的指引是**陈旧描述**——现在的架构是 **ACP-first**：桌面端直接与 goose 二进制内的 ACP server 通信。

### 1.3 核心数据流：三条产品路径

**① 桌面路径（当前架构）**

```
ui/desktop (Electron)
  ├─ main.ts (主进程) ──spawn──▶ goose serve (goose-cli 内的命令，起本地 HTTP server)
  │                                └─ /acp 端点：WebSocket + token 鉴权
  ├─ src/gooseServe.ts            # 负责 spawn goose、注入登录 shell PATH、健康探测(statusUrl)
  └─ src/acp/acpConnection.ts     # 用 @aaif/goose-acp-client (npm) 连接 /acp WebSocket
                                     ↕ agent-client-protocol(-http) 消息
crates/goose/src/acp/             # ACP server 实现
  ├─ server.rs / server/          # GooseAcpAgent：会话、permission、elicitation、sampling
  ├─ server_factory.rs            # AcpServerFactoryConfig（builtins、scheduler、source roots…）
  ├─ transport/ + templates/      # 传输层
  └─ mcp_app_proxy.rs             # MCP App 代理
```

UI 的 `src/acp/` 目录是渲染进程侧的完整 ACP 适配层：`chatSessionController/Store`、`permissionRequests`、`elicitationRequests`、`extensions`、`providers`、`recipe`、`schedules`、`local-inference`、`dictation` 等，按领域文件划分，几乎与 ACP 能力一一对应。

**② CLI 路径**：`goose-cli/src/main.rs` → `cli.rs` → `commands/`（`session`、`configure`、`recipe`、`schedule`、`doctor`、`skills`、`plugin`、`roam*`、`review`、`update`、`gateway`…）→ 调用 `goose` crate。

**③ GDK/SDK 路径**：`goose-agent`（嵌入用循环）+ `goose-sdk` + uniffi 绑定，产出 Kotlin（Maven）、Python（PyPI）、npm 包（`@aaif/goose-acp-client` 与 acp binary 已拆成独立 npm 包，#11846）。

### 1.4 核心 crate 深挖：`crates/goose/src`

顶层模块（按重要性）：

- **`agents/`** — agent 子系统（当前最大的双轨迁移现场，见 1.4.1）
- **`providers/`** — 30+ provider 文件，两大类：
  - 原生 API：`anthropic_def`、`openai` 系、`azure`、`bedrock`、`azure_foundry_def`、`avian`…
  - **ACP 包装型**：`claude_acp`、`codex_acp`、`amp_acp`、`copilot_acp`、`cursor_agent`、`chatgpt_codex`、`claude_code` —— 复用订阅类 CLI 工具作为后端
  - `base.rs` 定义 `Provider` trait；`canonical_cost.rs` 做统一计费
- **`permission/`** — 工具审批/权限系统（近期多处安全加固）
- **`session/`** — 会话持久化与 `SessionManager`
- **`recipe/` + `recipe_deeplink.rs`** — recipe 引擎与 deep link
- **`hooks/`、`skills/`、`slash_commands/`、`prompts/`** — 扩展机制
- **`scheduler.rs`（+ `scheduler_trait.rs`）** — 定时任务
- **`goose_apps/`、`plugins/`、`builtin_extension.rs`** — goose Apps（HTML/CSS/JS 沙盒应用）与插件
- **`security/`、`checks/`、`doctor.rs`** — 安全与诊断
- **`gateway/`、`oauth/`、`otel/`、`tracing/`** — 网关、OAuth、遥测
- **`bin/`** — 辅助二进制：`analyze_cli`、`build_canonical_models`、`generate_acp_schema`（ACP schema 代码生成的源头，`just generate-acp-types` 会消费它）

#### 1.4.1 Agent 循环双轨（最重要的架构迁移）

| | Legacy | New |
|---|---|---|
| 位置 | `agents/agent.rs` | `agents/state_machine/` |
| 启用 | 默认 | `GOOSE_STATE_MACHINE=1` |
| 形态 | 过程式大循环 | 显式状态机：`mod.rs`（`StateMachine::step / apply / run`）、`session.rs`（`MachineSession`）、`effects.rs`（`EffectHandler`）+ **按操作拆分的 `ops_*.rs`** |

`ops_*` 文件即状态机的操作集，覆盖：`llm`、`toolcalling`、`tool_approval`（工具审批已接入，#11685）、`compaction`、`tool_pair_compaction`、`retry`、`maxturns`、`exit_on_error`、`entry_hook`、`stop_hook`、`steer`、`bang_shell`、`slash_command`、`skills`、`recipe`、`doctor`、`project`、`status`、`unknown_tool`…另有 `tests/` 内嵌测试。

**贡献规则（AGENTS.md 明文）**：迁移完成前，任何 agent 循环行为改动必须**双路径实现并测试**；review 时要检查另一条路径是否缺 parity。

`agents/` 下其他值得注意的成员：`extension_manager.rs` / `extension_malware_check.rs` / `validate_extensions.rs`（扩展安全）、`platform_extensions/`（内置平台工具）、`subagent_execution_tool/` + `subagent_handler.rs`（子代理，即 summon 体系）、`tool_confirmation_coordinator/router`（审批协调）、`snapshots/`、`moim.rs`。

### 1.5 UI Desktop 架构（`ui/desktop`）

- **进程模型**：`main.ts`（主进程：窗口/托盘/IPC/更新）→ `preload.ts`（安全桥）→ `renderer.tsx` → `App.tsx`（view 状态机：chat / settings / …，无路由库）
- **关键目录**：
  - `src/acp/` — ACP 客户端适配层（1.3 已述），核心是 `acpConnection.ts` + `gooseAcpClient.ts`
  - `src/gooseServe.ts` — 负责 spawn `goose serve`、环境 PATH 处理（`loginShellPath.ts`）、就绪探测、证书校验（`backendCertificateVerifier.ts`）
  - `src/components/` — 页面与组件（`BaseChat`、`ChatSessionsContainer`、`GooseSidebar`、`Hub`、`extensions`、`McpApps`、settings…），`ConfigContext.tsx` / `ModelContext` 等全局状态用 Context API
  - `src/i18n/` — 20+ 语言（en/zh-CN/zh-TW/ja/ko/fr/de/es/…）
  - `src/api/` — OpenAPI 生成的客户端（**规则：永不重建、永不 import 其类型**，UI 用 ACP SDK 类型或 `src/types/*`）
- **打包（forge.config.ts）**：maker = **zip（三平台）/ deb / rpm / flatpak**，无 AppImage（第四章的关键伏笔）；publisher = GitHub Releases；`@electron/fuses` 加固；macOS 签名公证、Windows RFC3161 时间戳签名；Linux 有 vulkan 变体（`GOOSE_DESKTOP_LINUX_VARIANT`）
- **测试**：vitest（单元+integration 配置分开）+ Playwright e2e；CI 中还有专门的 desktop-updater-install 矩阵（ubuntu/windows）

### 1.6 构建与工程化

- **工具链**：hermit（`source bin/activate-hermit`）锁版本；Rust 1.94 / edition 2021；pnpm + Node 24
- **Justfile 主要目标**：`release-binary`、`run-ui`（/ `run-ui-only` / `run-ui-playwright`）、`package-ui`、`make-ui[-windows|-intel]`、`run-docs`、`run-server`、`generate-acp-schema/types/docs`、`build-acp-client`、`generate-manpages`、`lint-ui`、发布版本计算与 tag 系列
- **CI（.github/workflows，60+ 个）**分五类：构建（build-cli/bundle-macos/bundle-windows）、发布（release、minor/patch-release、gdk-release*、create-release-branch、release-branches、goose-release-notes、check-release-pr）、质量（ci、pr-smoke-test、cargo-deny、cargo-machete、mcp-conformance、model-toolcall-conformance、scorecard、quarantine）、文档（deploy-docs-and-extensions、docs-update-*、pr-website-preview）、自动化机器人（goose-issue-solver、goose-pr-reviewer、buzz-automation）
- **发布工程**：release-plz 自动 bump 版本并开 release 分支/PR；GDK 走独立 tag（`gdk-v0.1.0-alpha.9`）

---

## 第二章 最新进展（2026-08 ~ 09）

### 2.1 版本与节奏

- workspace `1.50.1`（补丁版，含一次 revert：回滚 MCP 默认版本选择 #11827）；GDK `v0.1.0-alpha.9`；近 90 天 **887 个 commit**，节奏非常快
- 发版已完全工程化：`create-release-branch` → 版本 bump PR → `goose-release-notes` 自动生成发布说明 → tag

### 2.2 近期主题分组（git log 实证）

**安全加固系列（明显的一条主线）**
- `fix(security)`: Snowflake 强制 HTTPS（#11745）、CLI session 命名绑定可信路径（#11787）、subagent 平台守卫（#11604）、工具审批展示权威详情（#11743）、execute shell 提取锚定（#11492）、Telegram 语音临时文件隔离（#11442）、audio recorder 隔离（#11456）、fuse 命令扫描信号（#11440，注意：这里的 fuse 指文件系统操作扫描，与 libfuse2 无关）
- `fix(tracing)`: 尊重内容捕获 opt-out（#11782）
- `fix(config)`: 权限吊销跨 manager 保留（#11383）

**GDK / SDK 生态扩张**
- `goose-agent` 加入 tool calling（#11627）；GDK 文档内容一等支持（#11629）
- release-plz 管理 GDK 发布（#11820）；Kotlin 可配置 Databricks AI Gateway（#11631）；PyPI 直接发布修复、Maven smoke test
- **ACP npm 包拆分**：client 与 acp binary 分包发布（#11846）；ACP 参考文档从 release schema 生成（#11770）

**模型与 Provider**
- GPT-6 Astra 支持（#11869）；zai 默认模型修正 + glm-5.3-flash（#11674）；openrouter 迁到 `goose-providers` crate（#11757）；移除 fast model routing（#11469）；移除 managed model registry（#11789）；AIML API 集成（#11758）

**状态机迁移推进**
- 状态机支持 tool approval（#11685）——ops 覆盖面持续补齐 legacy 循环能力

**桌面修复**
- 会话重命名后 UI 冻结（#11759）；未发送输入跨导航保留（#11494）；node launcher 保留 cwd 与子进程状态（#11753）

**性能/正确性**
- chat-payload 缓存断点锚定在 agentic tail（#11429）；keyring 超时移除（#11798）

**8 月的两笔大重构（结构性）**
- **#10614（8/25）重写桌面 auto-updater**：zip 载荷 + 目录交换安装器（第四章详述）
- **#10224 删除 `crates/goose-server`**、#10124 本地推理管理迁 ACP、#10087 移除 MCP sampling —— 完成"ACP-first"收口

### 2.3 从 `buzz/` 看到的方向

`buzz/` 存放 issue/PR 自动化机器人配置（`github_issue_manager.yaml`、`create_github_manager`、`core-team.json`），配合 `goose-issue-solver.yml`、`goose-pr-reviewer.yml`、`code-review.yml`——**"issues are the new PRs"**（2026-07 blog）：用 goose 自动处理 issue、审 PR，且 AGENTS.md 规定 issue 是上游 PR 的唯一事实来源。

---

## 第三章 Roadmap 与快速上手

### 3.1 Roadmap 的事实来源（重要澄清）

仓库**没有 ROADMAP.md**。规划分散在四个地方：

1. **GitHub Project board（Goose Issues board）**——唯一权威状态源。Issue 状态为 **Ready** 才允许实现（Inbox / Needs info / Accepted-design 状态只参与讨论）；外部 PR 必须链接对应 Ready issue 并说明验证计划的执行情况
2. **`RELEASE.md` / `RELEASE_CHECKLIST.md` / release-* workflows**——发布节奏本身反映工程优先级
3. **blog（documentation/blog）**——方向性信号：2026-01 移动 App、2026-05 hooks 与 officeqa、2026-07 "issues are the new PRs"
4. **代码内的显式迁移**——最可靠的 roadmap：state machine 双轨（AGENTS.md 要求 parity，即"完成迁移"是进行中的目标）、GDK alpha 序列、roaming（iroh P2P）

### 3.2 从代码可推断的主线方向

- **状态机迁移收口**：`ops_*` 已基本铺满（含 tool_approval），待默认切换 `GOOSE_STATE_MACHINE`
- **GDK 1.0**：goose-agent 循环 + 多语言绑定（Kotlin/Python/npm）+ release-plz 发布链就绪
- **ACP 生态化**：schema 生成（`generate_acp_schema`）→ 类型 → 文档 → npm 包全链路自动化；provider 端 ACP 包装型持续增加（claude/codex/copilot/cursor/amp…）
- **远程与移动**：`goose-roaming`（P2P）、`docs/guides/remote-goose-server.md`、移动 App blog
- **自动化协作**：buzz 机器人 + issue-driven 开发流程
- **安全加固**为持续主题（近 30 天安全修复密度很高）

### 3.3 快速上手手册

**环境与构建**

```bash
source bin/activate-hermit
cargo build                        # Rust 全量
just run-ui                        # 启动桌面（会先构建 goose）
cd ui/desktop && pnpm install      # UI 依赖（Node 24 + pnpm）
```

**验证（AGENTS.md：仅在用户要求时运行构建/测试）**

```bash
cargo test -p goose                # 单 crate 测试（规则：测试放 crates/*/tests/）
cargo test --package goose --test mcp_integration_test
cargo fmt && cargo clippy --all-targets -- -D warnings   # 提交前必做
cd ui/desktop && pnpm run typecheck && pnpm test
goose run --recipe goose-self-test.yaml   # 新增功能后的自测 recipe（需更新 yaml 重建）
```

**代码阅读路线（建议顺序）**
1. `documentation/docs/goose-architecture/goose-architecture.md` + `extensions-design.md` + `error-handling.md`——官方架构三篇
2. Rust：`crates/goose/src/agents/mod.rs` → `agent.rs` vs `state_machine/mod.rs`（对照读，理解双轨）→ `providers/base.rs`（Provider trait）→ `permission/` → `session/`
3. CLI：`goose-cli/src/main.rs` → `cli.rs` → `commands/session.rs`
4. 桌面：`main.ts` → `preload.ts` → `gooseServe.ts`（spawn goose）→ `acp/acpConnection.ts` → `App.tsx` → `components/BaseChat.tsx`
5. ACP 协议：`crates/goose/src/acp/server.rs` 与 UI 侧 `src/acp/*` 一一对照

**贡献规则速记（AGENTS.md / CLAUDE.md 提炼）**
- 功能放 `goose` crate，CLI 只是调用方；**桌面功能如今走 ACP**（goose-server 路由方案已废弃，AGENTS.md 该段过时）
- 错误统一 `anyhow::Result`；新 provider 实现 `Provider` trait；MCP 扩展放 `goose-mcp`
- agent 循环改动必须双路径（legacy + state_machine）实现并测试
- `ui/desktop/src/api` 永不重建/不 import 其类型；用 ACP SDK 或 `src/types/*`
- 代码质量：自文档化命名、少注释、布尔默认 false、不过度防御、不加无信息量错误上下文、日志只留 error/安全事件
- 文档目录中 **goose 永远小写 g**

**常见坑**
- 不 `source bin/activate-hermit` 会用错工具链版本
- 主进程代码改动需重启，渲染进程热重载
- 不要手改 Cargo.toml 依赖（用 `cargo add`）；`Cargo.lock` 保持一致
- 永不原地覆盖正在运行的二进制（macOS 代码签名会导致 SIGKILL），先 unlink/原子改名

---

## 第四章 桌面 Update 实现与 libfuse2 应对

### 4.1 双通道架构

`ui/desktop/src/utils/autoUpdater.ts`（编排）+ `githubUpdater.ts`（自研安装器）：

```
启动 5s 后自动检查 / Settings→Update 手动检查（IPC: check-for-updates / download-update / install-update）
   │
   ├─ 通道 A：electron-updater（GitHub provider: aaif-goose/goose，app-update.yml）
   │            └─ 报 HttpError 404 / ERR_CONNECTION_REFUSED / ENOTFOUND / No published versions
   ▼
   └─ 通道 B：自研 GitHubUpdater ★ 事实主通道（forge 打包不产 latest*..yml，A 通道必然 404）
```

### 4.2 GitHubUpdater 流程（PR #10614，2026-08-25）

1. **Check**：`fetch` GitHub `releases/latest` API；`compareVersions` 比较；按平台选 asset——macOS `Goose.zip`/`Goose_intel_mac.zip`、Windows `Goose-win32-x64.zip`、**Linux `Goose-linux-<arch>.zip`**
2. **Download**：流式下载到 `tmpdir/goose-update-<ver>-<ts>/`，进度节流上报（UI 在 `UpdateSection.tsx` 显示百分比，支持 i18n）
3. **Install = 目录交换**：
   - `resolveInstallTarget` 安全校验：目标必须是 Electron 安装根（存在 `locales/` + `resources/app.asar`）；拒绝共享目录（`/opt`、`/usr`、`/home`、`/tmp` 等黑名单 + 根目录本身）；拒绝目录中混有非 Electron 运行时文件
   - 解压（mac `ditto` / win `Expand-Archive` / **linux `unzip`**）→ 定位 payload（.app 或唯一目录）→ `assertPayloadIsRunnable` 校验可执行文件存在
   - 生成 `swap-and-relaunch.sh`（win 为 `.ps1`）：轮询等待旧进程退出（≤60s，卡住即 abort）→ 旧目录 `mv` 为 `<target>.goose-previous` 备份 → `cp -a` 新载荷 → 验证可执行文件 → 成功删备份 / **失败自动回滚** → relaunch（mac 额外 `xattr -dr com.apple.quarantine`）→ 清理 staging
   - `app.quit()`，脚本完成替换并拉起新版本
4. **测试**：`githubUpdater.install.test.ts`（交换/回滚/缺可执行文件拒绝）+ `githubUpdater.target.test.ts`（目标校验 8 个场景），CI 在 ubuntu/windows 矩阵跑安装测试

开关与辅助：`GOOSE_DISABLE_AUTO_DOWNLOAD` 环境变量 > 用户设置（只提醒不下载）；`ENABLE_DEV_UPDATES` 开发调试；`GOOSE_VERSION` 存在时隐藏托盘更新角标（自定义发行版场景）；全流程埋点（analytics）。

### 4.3 libfuse2 问题：绕开而非修复

**背景**：electron-updater 在 Linux 官方只支持 **AppImage** 目标；AppImage 运行时靠 FUSE2（`libfuse.so.2`）自我挂载，而 Ubuntu 22.04+ / Debian 12 / Fedora 36+ 默认不带 libfuse2 → 经典报错 `dlopen(): error loading libfuse.so.2`。

**goose 的三层应对**：

1. **根本不发布 AppImage**：`forge.config.ts` makers 仅 zip/deb/rpm/flatpak。Linux 主推解压即用的 zip 便携版 + 系统包格式，运行时不碰 FUSE——问题从产品形态上消灭
2. **自研更新器走 zip + 目录交换**：更新是纯文件系统操作（`unzip` + `mv` + `cp -a`），无 AppImage 挂载。这也是自研 `GitHubUpdater` 的核心动机——electron-updater 的 Linux 路径是 AppImage-only，与 goose 的分发形态不兼容；放弃 AppImage 换来了无 FUSE 依赖、三平台逻辑统一的 zip swap 方案
3. **包管理器安装交给包管理器**：exe 位于 `/opt`、`/usr` 等系统目录时 updater 主动拒绝替换并报错（宁可失败也不做危险覆盖或提权操作）

---

### 附：与旧资料/文档的差异修正

- `goose-server`（goosed）crate **已删除**（#10224），桌面改为 spawn `goose serve` 走 ACP over WebSocket；AGENTS.md 中相关指引已过时
- 内置 MCP server 现仅 5 个（autovisualiser/computercontroller/memory/peekaboo/tutorial），developer 子系统已并入 `goose` crate 的 `agents/platform_extensions`
- 新增了 `goose-providers`、`goose-provider-types` 等 crate——provider 体系正在从 `goose` 中拆出
