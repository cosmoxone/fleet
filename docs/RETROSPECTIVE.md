# 复盘 — goose 多节点管理 UI（fleet）v0 阶段

**日期**: 2026-08-19
**文档链**: [FEASIBILITY.md](./FEASIBILITY.md)（可行性 v1.3）· [DESIGN.md](./DESIGN.md)（设计 v0.5）· 本文档（复盘）
**代码**: `goose/` 仓库，baseline `0e17bf7` → fleet `711a8b6`；交付物 `fleet/c0/`

---

## 1. 目标回顾

> 连接多个 goose serve 节点的自用 UI；最小投入换取最大产出；先自用，商业开源远期可选。

最终落地路线：**方案 C+**（desktop 轻量 fork，每窗口绑定节点），C-0/C-mini 作为里程碑。

## 2. 时间线与完成任务

### 阶段一：调研（~1.5h）
- [x] 下载上游代码（git clone 超时 → 改 tarball，302M/176M）
- [x] 深度分析：desktop 三层架构、ACP 协议、单例链（5 个模块全局 + 17 文件依赖）、serve 服务端形态（两个并行 delegate 完成）
- [x] 产出方案 A/B/C/D 对比

### 阶段二：设计（~1.5h）
- [x] DESIGN v0.1 初稿
- [x] 三视角并行评审（架构/商业/安全，3 个 delegate）：2+1+1 个 BLOCKER、3+3+4 个 MAJOR
- [x] v0.2 修订（部署矩阵、token 泄露面、upstream risk、公开发布、open-core）
- [x] 方案 E（提取式）提出 → FEASIBILITY.md 独立成文 → v1.2/v1.3 两轮事实核查修正（单实例锁、外部后端全局单例、官方原生支持远程连接）
- [x] DESIGN v0.5：v0 dogfood（C-0/C-mini/C+ 三档）+ E 有条件化

### 阶段三：开发（~2h）
- [x] fork 仓库 git baseline commit（便于 diff 与回移）
- [x] C-0 交付物：`fleet/c0/`（README 事实表 + fleet-node.ps1 + serve-node.sh + settings 样例）
- [x] C-mini：`GOOSE_USER_DATA_DIR`（9 行，置于 SETTINGS_FILE 计算前）
- [x] C+：`externalBackends[]` schema / `createChat(backendId)` 按窗口绑定 / fleet 错误隔离（不污染全局设置、不退出）/ 窗口标题节点标识 / CSP 多 origin（variadic）/ 菜单 "New Chat on Node…" + 中文
- [x] 渲染进程**零改动**（核心设计约束）
- [x] 验证：typecheck ✅ 单测 677/677 ✅ eslint/prettier ✅
- [x] UPSTREAM.md + PATCHES.md（回移流程与改动清单）

### 阶段四：冒烟（本机可执行部分，已完成 ✅）
| 冒烟项 | 结果 |
|---|---|
| `goose serve` 启动（secret，127.0.0.1:41999） | ✅ `/status` → 200 "ok" |
| ACP WS 握手 · 正确 token（官方 SDK，`?token=` query） | ✅ `agent: goose, protocol: 1` |
| ACP WS 握手 · 错误 token | ✅ 被拒（连接关闭，无 initialize 响应） |
| TLS 变体（--tls，42001） | ✅ 指纹打印 `GOOSED_CERT_FINGERPRINT=2B:EC:49:...`；https /status 200；wss+token 握手 OK |
| vite 三段构建（main/preload/renderer，含全部 C+/C-mini 改动） | ✅ `.vite/build/main.js` 中确认包含 `New Chat on Node…`/`GOOSE_USER_DATA_DIR`/`externalBackends` |
| electron-forge 完整打包（linux，headless） | ⚠️ 前台/后台两次均挂起（无显示环境所致）；vite 构建已通过，打包环节留给用户 Windows 侧 S5 |
| 真实 Electron GUI | ❌ 本机无显示环境（headless），留给用户 Windows 侧 |

## 3. 关键决策记录（ADR 摘要）

| # | 决策 | 依据 |
|---|---|---|
| 1 | 不改渲染进程，只改主进程 | 每窗口独立渲染进程 → 单例天然按窗口隔离；`window.electron` facade 集中（47 文件/177 处）但 C+ 根本不需要碰它 |
| 2 | fleet 节点错误只弹窗返回，不 `app.quit()`/不改全局设置 | 一个节点故障不应拖垮其他窗口（stock 行为是退出整个 app） |
| 3 | CSP 函数改 variadic 而非加第二参数 | 单参旧调用与 15 个既有测试零改动通过 |
| 4 | E（提取式 Web UI）从 v0.1 主路线降为有条件 | 自用目标 C+ 已满足；E 的 3–4 周投入等 P1 假设验证信号 |
| 5 | baseline commit + PATCHES.md | fork 与上游的可回移性、diff 可审计 |

## 4. 经验总结

**做得好的**
1. **事实核查先行**：三个"想当然"都被数据推翻——desktop 原生支持远程后端（TOFU 证书+CSP）、有单实例锁、外部后端是全局单例。每个方案级结论都落到代码行号。
2. **delegate 并行分析/评审**：架构+UI 两路分析、三视角评审、依赖安装与开发并行——上下文隔离且省时。
3. **最小改动面纪律**：C+ 全部改动 +165/−32 行、3 个文件；复用 lease/get-acp-url/TOFU 等现成机制。
4. **降级路径设计**：每档（C-0→C-mini→C+）独立可用，随时可止步。

**教训**
1. **git clone 大仓库超时**（300s 不够）→ 应第一时间换 tarball/cgit。
2. **npm registry 网络问题**：`pnpm-workspace.yaml` 显式 registry 覆盖了全局配置 → 用 `npm_config_registry` env 才生效；electron 二进制需 `ELECTRON_MIRROR`。已记录，未来 install 命令要带 env。
3. **文档联动不全**：实现策略切换后 §2/§3.3/验收标准漏改（用户指出）；附录出现重复行 → 大改后应全文 grep 旧关键词复查。
4. **首版设计丢了方案对比**：A–D 对比只存在于对话中 → 结论性内容必须落盘成文档。
5. 冒烟脚本放 /tmp 导致 workspace 依赖解析失败 → 脚本要放在 workspace 内运行。

### 4.x 2026-08-27 晚：Linux dev GUI 实机冒烟（v0.6 修复驱动）

| # | 教训 | 细节 → 对策 |
|---|---|---|
| L9 | **交叉打包残留目标平台二进制** | mac 交叉打包把 darwin arm64 二进制留在 `src/bin/goose` → 本机 dev 启动 serve exit 2（Mach-O 被 sh 当脚本解释，stderr 可见 `__PAGEZERO`）。对策：打包链收尾必须立即恢复本机平台二进制（W5 的平台扩展版） |
| L10 | **forge start 的 REPL 会因 stdin EOF 提前退出** | 非交互环境 `npx electron-forge start < /dev/null` → forge 立即退出并连带杀掉 vite dev server → 渲染窗加载 localhost:5173 得 ERR_CONNECTION_REFUSED → **白屏**。对策：`tail -f /dev/null \| npx electron-forge start` 挂住 stdin；进程要用 setsid 脱离工具的进程组回收 |
| L11 | **chrome-sandbox 无 SUID** | 本机 electron 报 sandbox 权限错误。对策（dev 冒烟）：`ELECTRON_DISABLE_SANDBOX=1`；正式安装包不需要（打包产物走 SUID 或系统安装） |
| L12 | **set-setting 白名单静默拒绝** | `validSettingKeys` 漏 `externalBackends` → 保存只在主进程 console.error，UI 零反馈 → "可添加但无法保存"。对策：新增设置键必须同步进白名单；后续可让 IPC 对拒绝返回值给 UI 提示 |
| L13 | **菜单三连环 bug（zh-CN 暴露）** | ① 启动安装被后续 setApplicationMenu 覆盖（全语言）；② 热重建按字面 'File' 匹配不到已翻译父菜单（非英文）；③ 插入位置正则不匹配译文。英文环境 ② 可救回 ①，测试不暴露。对策：安装移到最终 setApplicationMenu 之后；父菜单/锚点匹配一律"英文原文 + menuT 译文"双匹配 |

## 5. 待用户执行的冒烟步骤（细化）

> 前置：Windows 机器 + 已装 node 24/pnpm + goose（`goose version`）。所有命令在 `goose/ui/desktop` 下执行。
> ⚠️ 本机网络注意：install/package 若下载卡住，加 env：`$env:npm_config_registry="https://registry.npmmirror.com"; $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`

### S1 — 构建并跑起来（开发模式，最快验证）
```powershell
cd goose\ui\desktop
pnpm install        # 首次需要；已装可跳过
pnpm run start-gui  # build-goose-sdk + i18n + electron-forge start
```
✅ 通过标准：窗口正常打开、本地 goose serve 自动拉起、能聊天（证明 fork 无基础回归）。

### S2 — C+ 多节点窗口（核心验收）
1. 找 userData：`%APPDATA%\Goose\settings.json`（开发模式为 `%APPDATA%\Electron\` 或看启动日志）
2. 合并 `fleet/c0/settings-fleet-example.json` 的 `externalBackends` 字段（改成本机可达节点）
3. 节点侧（任一 Linux/WSL 机器）：`GOOSE_SERVER__SECRET_KEY=<secret> ./serve-node.sh`（或 Windows 上 `goose serve --host 0.0.0.0 --port 3284 --tls`，secret 用环境变量传）
4. 菜单 **File → New Chat on Node… / 在节点上新开聊天…** → 选节点
✅ 通过标准：窗口标题显示 `<节点名> — Goose`；该窗口连远程节点；**同时**另开本地窗口（File → New Chat）互不干扰；两个不同节点窗口并存各自对话。
❗若报 "Fleet Node Unreachable"：核对节点 secret 一致、端口防火墙、URL 带 `https://`（配了 certFingerprint 时）。

### S3 — C-mini 多实例
```powershell
$env:GOOSE_USER_DATA_DIR="$env:USERPROFILE\goose-fleet\inst1"; pnpm run start-gui
# 另开终端
$env:GOOSE_USER_DATA_DIR="$env:USERPROFILE\goose-fleet\inst2"; pnpm run start-goose
```
✅ 通过标准：两个实例同时运行（单实例锁被 userData 隔离绕开）、设置互不影响。

### S4 — C-0 零代码（官方安装版验证，可选）
```powershell
.\fleet\c0\fleet-node.ps1 -Name n1 -Url https://<node1>:3284 -Secret <s1>
.\fleet\c0\fleet-node.ps1 -Name n2 -Url https://<node2>:3284 -Secret <s2>
```
✅ 通过标准：两个独立 Goose 实例分别连各自节点（首次自签证书 TOFU 信任）。

### S5 — 完整打包（可选，发布自用安装包）
```powershell
pnpm run package   # 产物 out/Goose-win32-x64/
```
> **2026-08-27 更新**：已在 Linux 开发机完成**交叉打包**，产物可直接拷到 Windows 测试：
> `goose/ui/desktop/out/make/zip/win32/x64/Goose-win32-x64-1.47.0.zip`（250MB）
> SHA256 `05d5c718e548ae56ea58c35c0b0cfd12b902ce820a1bb8435812e10dd5c4c9fd`
> 已验证：zip 含 Goose.exe + resources/bin/goose.exe(v1.47.0 官方 release)；app.asar 内 main.js 含全部 fleet 标记（New Chat on Node…/GOOSE_USER_DATA_DIR/externalBackends/中文菜单）。
> Windows 侧：解压 → 运行 `Goose.exe`（免安装，绿色版）→ userData 在 `%APPDATA%\Goose`（与 node-cli 默认路径一致）。
> 交叉打包流程（复现用）：`scripts/prepare-platform-binaries.js` 的 uv 二进制 + GitHub release `goose-x86_64-pc-windows-msvc.zip` 的 goose.exe 放入 `src/bin` → `ELECTRON_PLATFORM=win32 node scripts/prepare-platform-binaries.js` → `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx electron-forge package --platform=win32` → `npx electron-forge make --platform=win32 --targets=@electron-forge/maker-zip`（脚本化于 `/tmp/fleet-win-bin/pack-chain.sh`，慢链路用了防卡断点重传下载器）。

### 故障速查
| 症状 | 原因/处理 |
|---|---|
| 菜单里没有 New Chat on Node… | settings.json 无 `externalBackends` 或格式错（对照样例）；JSON 需合法 |
| 连接被拒/401 | secret 不一致；`GOOSE_SERVER__SECRET_KEY` 未传给 serve |
| 证书错误弹窗 | 首次自签需 TOFU 信任；之后改证书需更新 certFingerprint 或删该 host 信任 |
| http 节点连不上（https UI） | 混合内容限制：UI 与节点协议安全级需一致（DESIGN §3.2） |
| `goose serve` 远程访问不通 | 未加 `--host 0.0.0.0`；或防火墙 |

## 6. 遗留问题

| # | 问题 | 影响 | 计划 |
|---|---|---|---|
| ~~2~~ | ~~无 React 节点管理页~~ | ✅ **已解决**（8-19 晚）：新增 `FleetNodesSection` 设置页（Sharing 标签），增删改+校验，菜单实时刷新（set-setting → installFleetMenuItems 整模板重建），i18n 15 语言 |
| ~~3~~ | ~~deeplink 未带 backendId~~ | ⬇ 优先级降低：现在有设置页+菜单热刷新，入口痛点已缓解 | 仍按需做 `goose://node/<id>/new-session` |
| 4 | C+ 无 e2e 自动化（playwright 需 GUI） | 冒烟靠手工 | 上游 e2e 基建可用时补；2026-08-27 Linux 实机冒烟已覆盖菜单/保存/错误弹窗路径 |
| 5 | `NODE_TLS_REJECT_UNAUTHORIZED=0` 仅冒烟用 | — | 文档已警示，勿用于生产 |
| 6 | 错误 token 的失败原因信息为空（连接即关） | 排障体验 | UI 已有 generic 错误弹窗；后续可从 WS close code 细化 |
| 7 | P1 商业假设未验证 | v0.1 E 路线 gate | C+ 自用 2–4 周后社区调研 |
| 8 | node-cli / 设置页写入的 secret 明文存 settings.json（与上游 externalGoosed 一致） | 与上游行为一致，属已知边界 | 文档明示；v0.2 companion 计划移 OS keychain |

## 7. 下一步建议

1. **本周**：用户按 §5 S1–S3 冒烟 → 回填结果（通过/问题）到本文档
2. **2–4 周自用期**：记录痛点（节点管理体验、内存实测值回填 DESIGN 内存表）
3. **之后**：决定是否启动 v0.1（E 提取式 Web UI，gate：≥10 外部真实用户）或止步 C+
