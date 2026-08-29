# PACKAGING — fleet fork 桌面包打包经验（Windows 篇 + macOS 篇）

**日期**: 2026-08-27 · **对象**: fork `cbd8342`（fleet C+/C-mini + 设置页/菜单热刷新）
**产物**: Windows zip 已交付；macOS 见 §3。

---

## 0. 打包模型（从上游代码逆向出的关键认知）

Electron Forge 打包 = **应用壳 + 平台二进制注入**，两部分解耦：

```
应用壳（与平台无关）                平台二进制（随目标平台变）
├─ vite 构建 main/preload/renderer   ├─ src/bin/goose(.exe)     ← 核心，必须自备
├─ app.asar（含 fleet 全部改动）     ├─ src/bin/uv(u).exe|uvx   ← 仅 win32 需要（prepare 脚本下载）
└─ forge 配置（extraResource:src/bin）└─ 图标 icon.ico/.icns
```

三条铁律（全部来自源码验证，出处见 RETROSPECTIVE/工作记录）：

1. **`resources/bin/goose(.exe)` 由 `src/bin` 经 `extraResource` 注入**，运行时 `findGooseBinaryPath()`（gooseServe.ts）在打包模式下只找 `resources/bin`——没有 goose 二进制的包能打开 UI 但起不了本地后端。
2. **maker-zip 官方支持跨平台目标**（`--platform=win32` 在 Linux 可跑）；maker-deb/rpm/flatpak 仅本机；maker-squirrel（win 安装器）仅真 Windows。
3. **上游 CI 的做法就是"标准答案"**：GitHub Actions = 构建目标平台 rust 二进制 → 放 `src/bin` → `prepare-platform-binaries.js`（清跨平台文件/校验 uv 哈希）→ `electron-forge make`。自建打包 = 手工复刻这条链。

## 1. Windows 打包实录（✅ 已成功交付）

### 产物
`out/make/zip/win32/x64/Goose-win32-x64-1.47.0.zip`（250MB）
SHA256 `05d5c718e548ae56ea58c35c0b0cfd12b902ce820a1bb8435812e10dd5c4c9fd`（Green 免安装：解压即用 Goose.exe）

### 完整流程（Linux 交叉打包）
```bash
cd ui/desktop
# ① goose.exe：官方 release goose-x86_64-pc-windows-msvc.zip(83MB) 解出 → src/bin/goose.exe
# ② uv/uvx：https://github.com/astral-sh/uv/releases/download/0.11.11/uv-x86_64-pc-windows-msvc.zip
#    解出 → src/bin/（prepare 脚本只下载+校验，也可手动放好跳过其下载）
ELECTRON_PLATFORM=win32 node scripts/prepare-platform-binaries.js   # 清 sh wrapper、校验 uv 哈希
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx electron-forge package --platform=win32
npx electron-forge make --platform=win32 --targets=@electron-forge/maker-zip
```

### 经验教训（win32 篇）

| # | 教训 | 细节 → 对策 |
|---|---|---|
| W1 | **"forge 挂起"真相是下载慢** | headless 机上 forge 卡住并非无显示环境之罪，而是它要从 github.com 拉 win32 electron zip（~105MB，直连 ~70KB/s 要 25 分钟，看起来像死机）。对策：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 一次通过。此前"vite 构建通过但 forge 挂起"的结论要修正 |
| W2 | **断点续传会制造坏 zip** | `curl -C -` 续传 GitHub zip 一次后 `unzip` 报 "700416 extra bytes / overlapped components"，deflate 流错位无法修复（`zip -FF` 只救出元数据）。对策：下载器必须"卡死即**删文件重下** + 完整性校验（`unzip -tqq`）通过才算 OK"（robust-dl.sh，--speed-limit 5120 --speed-time 25 判卡） |
| W3 | **慢链路要并行+自动化接力** | 83MB 单线程 20 分钟。对策：两包并行 nohup 下载 + `pack-chain.sh` 守望（校验通过自动触发 ①放置②prepare③package④make），全程无人值守 |
| W4 | **产物必须拆包验证** | 伪验证=只看 zip 生成。真验证三件事：`unzip -l` 确认 `resources/bin/goose.exe` 存在；`@electron/asar` 抽 `.vite/build/main.js` grep fleet 标记（`New Chat on Node`/`GOOSE_USER_DATA_DIR`/`externalBackends`）；SHA256 记录供传输后核对。注意压缩器会改函数名（`installFleetMenuItems` MISSING 但字符串标记全在=正常） |
| W5 | **prepare 脚本会动 git 跟踪文件** | `ELECTRON_PLATFORM=win32` 会删 `src/bin/{jbang,node,npx,uvx}`（sh wrapper，git 跟踪中）。对策：打包后 `git checkout -- ui/desktop/src/bin/` 还原；二进制本体已被上游 .gitignore（`/src/bin/*.exe`）覆盖不会误提交 |
| W6 | **npm 上无新版 win32 二进制** | `@aaif/goose-binary-win32-x64` 停在 0.20.1（老）；正确来源=GitHub release `goose-x86_64-pc-windows-msvc.zip`（裸二进制）或 `Goose-win32-x64.zip`（完整旧版 app，不适合摘取） |
| W7 | **版本要三处对齐** | app 版本(package.json 1.47.0) = goose.exe 版本(1.47.0) = electron 二进制版本(forge 自动)。上游 release 同时出两 zip 正是这个原因 |

### 最佳实践清单（win32，直接抄）
1. `ELECTRON_MIRROR` 必设（慢链路救命）；npm 侧 `npm_config_registry=npmmirror` 同理
2. 下载一律 robust-dl.sh（新鲜重试+校验），禁用 `-C -` 于 zip
3. pack-chain.sh 自动接力（下载→放置→prepare→package→make），人只看最终 `[chain] DONE`
4. 产物三重验证 + SHA256 写进交付文档
5. 打包后 `git checkout -- ui/desktop/src/bin/` 恢复仓库
6. 交付：zip + SHA256 + 解压即用说明（userData 在 `%APPDATA%\Goose`，与 fleet/node-cli.mjs 默认路径一致）

## 2. 跨平台可行性矩阵（实测/源码结论）

| 目标 | Linux 上打包 | 依据 |
|---|---|---|
| win32 zip（绿色版） | ✅ 实测成功 | maker-zip 支持跨平台目标 |
| win32 Squirrel 安装器 | ❌ 需真 Windows | maker-squirrel 依赖 Windows 工具链 |
| mac arm64/x64 zip | ✅ 可行（进行中） | maker-zip 同上；.app 结构 zip 化 |
| mac dmg | ❌ 需真 macOS | maker-dmg 需要 hdiutil |
| mac 签名/公证 | ❌ 需 Apple 证书+macOS | APPLE_TEAM_ID 流程（上游 CI 有完整样例） |
| deb/rpm/flatpak | 仅本机 Linux | maker 限制 |

## 3. macOS 打包（进行中 → 结果回填见 §3.4）

### 3.1 与 Windows 的差异
| 维度 | Windows | macOS |
|---|---|---|
| goose 二进制来源 | release `goose-x86_64-pc-windows-msvc.zip` | release `goose-{aarch64,x86_64}-apple-darwin.tar.gz`（**tar.gz 非 zip**，W6 同款坑） |
| 附加二进制 | uv.exe/uvx.exe（校验哈希） | 无 uv 依赖 |
| 注入位置 | `src/bin/goose.exe` | `src/bin/goose`（chmod +x） |
| 图标 | icon.ico（已有） | icon.icns（已有，src/images/） |
| 运行门槛 | 双击 exe | **Gatekeeper**：未签名 → 右键打开/`xattr -cr`；自签也行（ad-hoc） |
| 输出 | zip（绿） | zip（.app 内嵌，maker-zip）或 dmg（需 mac） |

### 3.2 上游 CI 关键参数（bundle-macos.yml 逆向）
- 目标：`aarch64-apple-darwin`（默认）与 `x86_64-apple-darwin`（跑在 macos-15-intel runner）
- `MACOSX_DEPLOYMENT_TARGET=12.0`（rust 构建侧）；electron 侧 forge 默认目标 arm64
- 注入同 Windows：`mv internal-goose-<target> src/bin/goose && chmod +x`
- Intel 版特殊处理：`jq '.build.mac.target[0].arch="x64"'` 改 package.json（forge packagerConfig arch）
- 签名：`APPLE_TEAM_ID` 环境变量触发 osxSign/osxNotarize（fork 自用可跳过）

### 3.3 Linux 交叉打 macOS 的流程（照 win32 模式）
```bash
# ① robust-dl 下载 goose-aarch64-apple-darwin.tar.gz（85MB）→ 解出 goose → src/bin/goose（chmod +x）
# ② x64 版：先 jq 改 arch 再跑（见 W7/上游 Intel 步骤），或保持 arm64 默认
# ③ ELECTRON_MIRROR=... npx electron-forge package --platform=darwin [--arch=arm64]
# ④ npx electron-forge make --platform=darwin --targets=@electron-forge/maker-zip
#    产物 out/make/zip/darwin/arm64/Goose-darwin-arm64-1.47.0.zip
```

### 3.4 实录与结果

> 2026-08-27 执行完毕（Linux 交叉打包，双架构）。

| 架构 | 产物 | 大小 | SHA256 | 验证 |
|---|---|---|---|---|
| **x64 (Intel)** | `out/make/zip/darwin/x64/Goose-darwin-x64-1.47.0.zip` | 214MB | `8da02645d01895b471f47b0f00f146152679166c3e67d67001e8ac86acdaa72d` | ✅ .app 结构/asar 四标记/`Resources/bin/goose` = Mach-O x86_64 |
| **arm64 (Apple Silicon)** | `out/make/zip/darwin/arm64/Goose-darwin-arm64-1.47.0.zip` | 210MB | `27af41c7c38ab278608d9dd30e68dba86fec9544f68da9f2c928634d63cb47b2` | ✅ 同上（goose = Mach-O arm64） |

**关键增量教训（mac 篇）**：
| # | 教训 | 对策 |
|---|---|---|
| M1 | darwin 二进制是 **tar.gz**（release 无 zip；第一次按 zip 名拉取 404） | 认准 `goose-{aarch64,x86_64}-apple-darwin.tar.gz`；robust-dl 校验方式要换 `tar tzf` |
| M2 | tar.gz 同样会"截断但可解"（arm64 首次 10.7MB 解出却 EOF） | 完整性判据 = `tar tzf` 成功（本仓库 robust-dl 的 zip 检查不适配 tar，需链式校验） |
| M3 | mac 包 asar 路径是 `Goose.app/Contents/Resources/app.asar`（非 win 的平铺） | 验证脚本按 .app 结构取路径 |
| M4 | darwin 包**不需要 uv.exe**（那仅 win32），prepare 步骤照跑无害 | — |
| M5 | 双架构 = 两次独立打包（arch 参数不同），electron darwin zip 缓存后第二次仅 ~90s | 全程 pack-chain 自动化 |
| M6 | **arm64 交叉打包在 fuses 阶段崩**：`FusesPlugin` 对 darwin+arm64+未签名 会 spawn `codesign` 重置 ad-hoc 签名——Linux 无此命令，`spawnSync` 返回 undefined 直接 TypeError | fork 补丁：`resetAdHocDarwinSignature: process.platform !== 'linux'`（mac 保留上游行为）；目标 Mac 上补 `codesign --force --deep -s - Goose.app`（ad-hoc，免 Apple ID）。未签名的 arm64 二进制在 Apple Silicon 上会被内核拒绝执行，这一步**必须做** |

**macOS 侧使用说明（随包交付）**：解压得 `Goose.app` → 拖入"应用程序"或直接运行。**未签名 Gatekeeper 拦截**：首次运行右键 Goose.app → 打开 → 确认；或 `xattr -cr /Applications/Goose.app`。settings 在 `~/Library/Application Support/Goose/settings.json`（fleet/node-cli.mjs 默认路径已对齐）。

**arm64 包额外必做**（Linux 跳过 ad-hoc 签名的补偿，一次性两条命令）：
```bash
xattr -cr /Applications/Goose.app                      # 去 quarantine
codesign --force --deep -s - /Applications/Goose.app   # 补 ad-hoc 签名（需 Xcode Command Line Tools: xcode-select --install）
```
x64 (Intel) 包无此要求（x86_64 不强制签名），右键打开即可。
