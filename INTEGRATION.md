# INTEGRATION — fleet 的外部契约与治理

fleet 是多 Agent 调度壳项目。goose 以"拉取 + 引用"方式消费：**本仓库不维护 goose 源码**。
本文取代旧仓库的 `PATCHES.md` / `UPSTREAM.md` / `MERGE_FIXES.md`，是唯一的契约治理入口。

## 快照基线（出处证明）

| 对象 | 值 |
|---|---|
| 上游仓库 | https://github.com/aaif-goose/goose |
| 上游基线 commit | `0e17bf7`（fork 起点） |
| fleet 改动终态 commit | `f4066f1`（research fork HEAD，本地归档 `~/proj/remote-goose/goose`） |
| 快照范围 | 上游 `ui/desktop` + fork 的 30 文件 fleet 改动（+2456/-628，Rust 零改动） |
| 验证过的 goose 后端 | `goose serve` 1.46.0（本机冒烟）；打包目标 1.47.0 |

## 契约 1：壳 ↔ 节点（ACP over WebSocket）

- 协议：[Agent Client Protocol](https://agentclientprotocol.com)，HTTP 基址上 `GET /acp` 升级 WebSocket，`?token=<secret>` 鉴权
- goose 实现：`goose serve --host 0.0.0.0 --port <p> --tls` + `GOOSE_SERVER__SECRET_KEY=<secret>`（stock 二进制，零改动）
- 传输安全：TLS 自签证书 + SHA-256 指纹钉扎；**指纹校验在 Electron 传输层实施**（驱动层只携带 `certFingerprint` 字段）
- 契约测试：`runtime/acp-smoke/acp-smoke.mjs`（initialize 握手）+ `runtime/drivers/goose/driver.test.ts`（URL/能力面）
- 治理：ACP 是跨厂商公开协议，goose 面为其公开 CLI 契约 → 稳定性高；升级 = 改 `runtime/versions.json` + 冒烟通过

## 契约 2：壳 ↔ 后端二进制（goose 驱动专属）

- 分发物内注入 `resources/bin/goose(.exe)`，来源 = 官方 GitHub release zip，SHA256 校验后落位（P3 `fetch-goose.ts`）
- 版本三处对齐：壳 manifest = 注入二进制 = `@agentclientprotocol/sdk` / `@aaif/goose-sdk` 协议面
- 版本矩阵唯一事实源：`runtime/versions.json`

**P3 已落地（2026-08-29）**：`fetch-goose.ts` 下载官方 release 资产（win=zip、darwin/linux=tar.gz，命名矩阵内建于脚本并与 versions.json 交叉校验）→ schema 2 哈希钉扎 → 注入 `app/src/bin`（`--from-file` 供离线/开发注入）；`scripts/verify-package.mjs` 执行 W4 三重验证；CI `.github/workflows/release.yml`（4 目标矩阵 → verify → draft release 带 .sha256）。本地全链路已验：`Fleet-linux-x64-0.1.0.zip` 三重验证通过（注入为本地 1.46.0 开发二进制，CI 注入 1.48.0 官方哈希钉扎版）。

## 契约 3：壳内 main ↔ renderer（已内部化，非外部契约）

快照后这 36 个 `ipcMain.handle` 是**自有代码的内部接口**，仅作快照自检清单保留（P2 快照落位时核对齐全）：

```
open-external, directory-chooser, add-recent-dir, list-recent-dirs,
list-git-worktree-dirs, get-setting, set-setting, get-secret-key, get-acp-url,
set-menu-bar-icon, get-menu-bar-icon-state, set-dock-icon, get-dock-icon-state,
open-notifications-settings, set-wakelock, get-wakelock-state, set-spellcheck,
get-spellcheck-state, is-any-window-focused, get-is-fullscreen,
select-file-or-directory, select-recipe-file, read-goosehints, write-goosehints,
select-import-session-file, check-ollama, write-file, ensure-directory,
list-files, show-message-box, show-save-dialog, get-allowed-extensions,
open-directory-in-explorer, launch-app, refresh-app, close-app
```

治理：自有测试覆盖；吸收上游 UI 改进 = 择机重快照 + diff 审查，不构成义务。

## P2 快照边界清单（ui/desktop → app/）

**拷入**：`src/`、`public/`、`announcements/`、`index.html`、`package.json`、`tsconfig.json`、`tsconfig.node.json`、`vite.*.mts`、`vitest*.ts`、`forge.config.ts`、`forge.deb.desktop`、`forge.rpm.desktop`、`entitlements.plist`、`eslint.config.js`、`components.json`、`image.d.ts`、`scripts/`、`tests/`、`playwright.config.ts`

**丢弃/替换**：`node_modules/`、`out/`、上游 `README.md`（换 fleet 自有）、上游 CI/文档（不在 ui/desktop 层）；locale 子集裁剪（壳只承诺自选 locale，缺失降级英文）

**永不进入仓库**：Rust `crates/`（后端 = release 二进制注入）、上游 `documentation/` 视频

## P2 落位记录（2026-08-29，commit ff7ad73）

- 快照执行：`ui/desktop` → `app/`、`ui/sdk` → `vendor/goose-sdk`（workspace 成员）、`ui/goose-binary/*` 占位包 → `vendor/goose-binary/`；
- SDK 构建输入快照：`acp-schema.json` / `acp-meta.json` 自 goose `crates/goose/` vendored 进 `vendor/goose-sdk/`（原 .gitignore 忽略项改为跟踪）；
- 品牌改造范围 = OS 面（productName/exe/包 id、`fleet://`、菜单+zh 映射、标题、dialog、tray、更新源）；agent 面的 "goose" 字样按 nominative use 保留；
- locale 子集 = en / zh-CN / zh-TW；
- **设计偏差（有意）**：① `gooseServe.ts` 暂不经 `core/driver`（其含就绪等待/诊断/TLS 指纹捕获等富逻辑，driver.provision 仅薄 spawn；待第二后端接入时再评估抽象收口）② 应用图标沿用上游（P3 资产轮换）③ renderer 深度品牌（About 页文案等）未做；
- 验证：tsc ✓、693 app 测试 ✓、`electron-forge start`（Linux/无沙箱环境）✅——`fleet://` 注册、goosed spawn + TLS 指纹钉扎、healthCheck 绿、`GOOSE_USER_DATA_DIR` 隔离、版本 0.1.0；
- 遗留人工项：连接真实远程节点的「New Chat on Node…」全链路需在有远程节点的桌面环境手测（逻辑已由 fork v0.6 验证 + 单测覆盖）。

## 升级流程

1. 后端升级：改 `versions.json` → 拉新 release 二进制 → 契约 1/2 冒烟 → 出壳版本（低成本，可频繁）
2. UI 吸收上游：`git diff <旧tag>..<新tag> -- ui/desktop` 审查后选择性重快照（低频，机会主义）
3. 上游回馈：`GOOSE_USER_DATA_DIR`、zh-CN 菜单修复等通用改进走上游 PR（P5，不阻塞主线）
