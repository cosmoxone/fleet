# 发布流水线复盘：问题、教训与最佳实践

> 复盘自 fleet v0.1.0 发布（2026-08-30，9 轮 CI 迭代 + 发布收尾事故）。适用范围：`.github/workflows/release.yml`、`scripts/verify-package.mjs`、Electron Forge 跨平台打包。

## 0. TL;DR

1. **Electron Forge 的 `--targets` 必须与 maker 配置名精确匹配**（`@electron-forge/maker-zip`，不是 `zip`），否则静默降级为裸名解析，在 pnpm hoisted 布局下必挂。
2. **Windows runner 的默认 shell 是 pwsh**：`"$VAR"` 被当 PS 变量展开成空串。所有跨平台步骤显式 `shell: bash`。
3. **git-bash 里的 `tar` 是 GNU tar**：读不了 zip，且把 `D:\` 盘符冒号解析成 rsh 远程主机。解压 zip 用纯 JS 的 `extract-zip`。
4. **`@electron/asar` 的 `extractFile` 按当前 OS 的 `path.sep` 切分键**；Windows 上 forge-vite 存的是反斜杠条目、`listPackage` 输出带前导斜杠——三种形式都要试。
5. **`gh release create ... || true` 每次失败运行都留下空 draft**；删 tag 会把已发布 release 降为 draft 并清空资产。用 view-then-create + `--clobber`，发布后不要再动 tag。
6. **GitHub job 级 `if` 不能引用 `matrix` 上下文**：单平台过滤用 prep job 动态生成 matrix。
7. **本地到 GitHub artifacts 存储（Azure blob）可能不通**：大文件回收优先走 CI 内网（让 workflow 直传 release）。

## 1. 时间线与根因一览

| 轮次 | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | 三平台 Package(zip) 挂，darwin-x64 挂 i18n | ① `--targets zip` 不匹配 maker 名 → 裸名解析失败；② `@formatjs/cli` 无 darwin-x64 原生绑定 | ① 改 `--targets @electron-forge/maker-zip`；② 提交 compiled i18n + 编译失败回退 |
| 2 | linux ✓，其余挂 W4 验证 | ① W4 步骤无 `shell: bash`（pwsh 吞 `$ZIP_PATH`）；② 验证脚本不认 macOS bundle 布局 | 显式 bash；`Contents/Resources` 探测 |
| 3 | 仅 win32 挂 W4 | `tar: Cannot connect to D:`——GNU tar 把盘符当远程主机 | 拷入临时目录 + 相对路径 |
| 4 | 仅 win32 挂 W4 | `not a tar archive`——git-bash 的 tar 是 GNU tar，不读 zip | 改用 `extract-zip`（纯 JS） |
| 5 | 仅 win32 挂 W4 | win32 zip 根目录**平铺多条目**，"第一个子目录"抓到了 `locales/` | 扫描候选目录定位 `resources/app.asar` |
| 6 | 仅 win32 挂 W4 | asar 里没有 `.vite/build/main.js` 条目 | 规范化匹配 + 诊断信息列出候选条目 |
| 7 | 仅 win32 挂 W4 | `extractFile` 需要 OS `path.sep` 形式（`.vite\build\main.js`） | 三候选提取（正斜杠 / 本机 sep / 存储原样） |
| — | dispatch 触发失败 | job 级 `if` 引用 `matrix`，工作流解析直接 422 | prep job 动态 matrix（`fromJSON(needs.outputs)`） |
| 8 | 四平台全绿 ✓ | — | dispatch 单平台验证 win32 后重打 tag |
| 收尾 | release 资产消失 | 7 个失败运行留下的重复空 draft + 删 tag 降级已发布 release + 本地取 artifacts 网络不通 | 修 attach 步骤，CI 内网重传，重新 publish |

**规律**：9 个问题里 6 个是"跨平台路径/布局假设"，3 个是"工具链静默失败"。全部修复后总耗时约 40 分钟 CI + 收尾 15 分钟；若首发前做过本地多布局预演，可省掉 5 轮以上。

## 2. Electron Forge / pnpm workspace

- **maker 解析机制**：forge 用 `importSearch(dir, [name])`，只试 `name`、`dir/name`、`dir/node_modules/name` 三处，**不向上遍历**。fleet 的 `nodeLinker: hoisted` 把 maker 包放在仓库根，`app/node_modules` 下没有 → 只有"配置名精确匹配 + 裸包名从 forge 自身模块上下文向上解析"这条路可行。
- **教训**：改 `--targets` 前，先本地跑 `electron-forge make --targets <x>`（错误发生在 "Resolving make targets"，秒级失败，复现极快），配 `DEBUG=electron-forge:require-search` 看搜索路径。
- forge 的 `package`（打目录）不触发 maker 解析，`make` 才触发——本地只测过 `package` 会漏掉这类问题。

## 3. Windows runner 专项

| 坑 | 规则 |
|---|---|
| 默认 pwsh，`"$VAR"` 展开为空 | 每个步骤显式 `shell: bash`（git-bash 可用） |
| git-bash `tar` = GNU tar | 不读 zip；`D:\path` 触发 rsh 语法错误 |
| 无 `unzip` 二进制 | zip 解压一律纯 JS（`extract-zip` 是 electron-packager 传递依赖，hoisted 布局必在） |
| node 里 `os.tmpdir()` 在 `D:\a\_temp` | 传给外部 CLI 的路径避免盘符冒号 |
| forge-vite asar 条目用 `\` 分隔 | asar 查找统一"规范化匹配 + 三形式提取" |

## 4. @electron/asar 的三个坑

1. `listPackage()` 返回带**前导斜杠**（`/.vite/build/main.js`），`extractFile()` 却要无斜杠形式
2. Windows 构建的 asar 条目键是反斜杠（`.vite\build\main.js`）
3. `extractFile()` 用**当前进程**的 `path.sep` 切分键——同一段代码在不同平台 runner 上行为不同

最终实现（见 `verify-package.mjs`）：

```js
const entries = asar.listPackage(asarPath);
const normalize = (e) => e.replace(/\\/g, '/').replace(/^\//, '');
const mainEntry = entries.find((e) => normalize(e) === '.vite/build/main.js');
// 依次尝试: '.vite/build/main.js' / path.join('.vite','build','main.js') / mainEntry(存储原样)
```

## 5. 包内布局差异表（验证脚本必须全部覆盖）

| 平台 | zip 根 | resources 位置 |
|---|---|---|
| darwin | 单条目 `Fleet.app/` | `<app>/Contents/Resources/` |
| win32 | **平铺**：`Fleet.exe` + `locales/` + `resources/` … | `<root>/resources/` |
| linux | 包裹目录 `linux-unpacked/` | `<dir>/resources/` |

**实践**：按"扫描候选直到找到 `resources/app.asar`"定位，不做任何"取第一个目录"式假设。

## 6. GitHub Actions / Release 机制

- **job 级 `if` 不能用 `matrix`**（解析期 422）。单平台过滤的正确姿势：

```yaml
targets:            # prep job, bash case 语句输出 JSON
  outputs: { include: ... }
package:
  needs: [targets]
  strategy:
    matrix: { include: ${{ fromJSON(needs.targets.outputs.include) }} }
```

- **dispatch 单平台调试**是本轮回血最快的改动（免重打 tag、单轮 ~2.5 分钟）：`gh workflow run release.yml --ref main -f platform=win32`
- **release 唯一性**：`gh release create "$TAG" --draft || true` 会为每次失败运行留下空 draft，后续按 tag 名解析release 变得歧义（本轮 7 个重复 draft 直接导致资产"消失"的假象）。正确写法：

```bash
gh release view "$TAG" >/dev/null 2>&1 || gh release create "$TAG" --draft --title "$TAG"
gh release upload "$TAG" "$ZIP_PATH" "$ZIP_NAME.sha256" --clobber
```

- **删 tag 的连带效应**：已发布 release 关联的 tag 被删 → release 自动降为 draft、资产分离。发布过的版本**不要动 tag**；确需重打，收尾必须 `gh release edit --draft=false` 并核对资产数。
- 诊断优先：验证脚本失败时把候选条目/路径打出来（round 6 的 hint 一行日志直接定位了 round 7 的根因，省一整轮 CI）。

## 7. 网络与产物回收

- 本机到 `productionresultssa*.blob.core.windows.net`（GitHub artifacts 存储）TLS 握手超时——受限网络下 **~1GB 的 artifacts 本地回收不可行**。
- 替代路径：让 CI 自己修 release（attach 步骤已具备 view-then-create + clobber 能力，重跑一次 tag 流水线 = GitHub 内网完成产物重传）。
- 每个平台 job 同时 `upload-artifact`（90 天保留）+ release 附件，双保险。

## 8. 调试循环最佳实践（本篇方法论）

1. **本地快速复现优先**：forge maker 解析、verify 脚本都有秒级本地复现路径；能用本地复现的不烧 CI。
2. **合成包测试**：用 python zipfile + `@electron/asar` 合成三种布局的假包，本地跑验证脚本全绿再上 CI——本轮多轮返工都败在"只在 linux 布局上测过"。
3. **单变量实验**：魔数大小写翻转（图标）、把上游条目 size 改成我的值（ico）这类字节补丁，一次实验定位一个规则。
4. **字节级读日志**：CI 日志里的 stderr 字节数组直接解码（`tar: Cannot connect to D:` 就是从 `[116,97,114,...]` 解出来的）。
5. **每轮只修一类问题**：多修容易引入回归且无法归因。
6. **全绿 ≠ 发布完成**：发布后核对 release 数量、draft 状态、资产清单三项，才算闭环。

## 9. 发版 Runbook（v0.1.1+）

```bash
# 1. main 就绪后打 tag（发布后不可再动）
git tag -a vX.Y.Z -m "fleet vX.Y.Z" && git push origin vX.Y.Z
# 2. 等四平台绿（~5 分钟）
gh run watch $(gh run list --workflow=release --limit 1 --json databaseId -q '.[0].databaseId')
# 3. 写 notes 并发布
gh release edit vX.Y.Z --title "..." --notes-file notes.md --draft=false
# 4. 核对：单 release / draft=false / 资产 8 个
gh api repos/cosmoxone/fleet/releases --jq '.[] | {tag,draft,assets:(.assets|length)}'
```

单平台调试（不碰 tag）：`gh workflow run release.yml --ref main -f platform=win32|darwin|linux`
