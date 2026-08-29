# 应用图标资产：经验教训与最佳实践

> 复盘自 fleet 桌面图标资产轮换（2026-08-30，五轮迭代）。生成脚本：`scripts/make-app-icons.py`（纯 Pillow，Linux CI 可复现）。

## 0. TL;DR

1. **icns 魔数是小写 `icns`**，不是规范写的大写 `ICNS`——结构合法 ≠ 工具认得。
2. **ico 首条目必须 <64KB**——老式 16 位 size 字段的校验至今仍生效。
3. 托盘图标**先查 `setTemplateImage` 是否启用**再决定黑白剪影还是彩色。
4. 无法目检图像时，用**元数据统计 + 容器解析 + 独立解码器**三重验证。
5. 所有变体从**单一 master 管线**派生，保证确定性与一致性。

## 1. 先盘点，再动手

- 产物清单由引用决定：`forge.config.ts` 的 `packagerConfig.icon`（macOS 自动补 `.icns`）、`win32.icon`、deb/rpm 的 `icon.png`、flatpak 的 `icon.svg` + `icon-512.png`。
- 用 `rg` 区分活资产/死资产：`iconTemplate*.png` 被 `main.ts` / `autoUpdater.ts` 引用（活），`loading-goose/*.svg` 无引用（按需保留）。
- 分叉仓库里，上游同名文件的**设计意图用像素统计推断**：如 `icon-light.png` 实测 0% 彩色、主体灰度 128–148 → 是"低对比浅灰暗色 dock 变体"，不是主图拷贝。

## 2. 无目检条件下的图像分析（元数据驱动）

```
尺寸/mode → alpha 覆盖率 → 角落/中心采样色 → 边框亮度分位数 → 色度差分布
```

本例推断链：全图 100% 不透明 + 角落浅灰 (209–241) + 中心深紫 (116,109,177)
→ 结论：浅色低饱和背景 + 彩色主体，可用边框泛洪抠除。

## 3. 背景抠除（knockout）

- 谓词：亮度 ≥ **边框亮度 P5 − 20** 且色度差 (max−min 通道) ≤ 30，从四边种子**连通泛洪**。
  - 用 P5 而非中位数：背景有渐变时最暗角落低于"中位数−容差"会漏抠（实测右下角漏了一块）。
  - 只删与边框连通的区域：图案内部的浅色细节自然保留。
- 抠完高斯羽化 1px，边缘平滑。
- **合理性断言**：删除比例必须落在 (5%, 95%)，否则报错终止——防止源图特征变化导致整图被删/纹丝不动。
- 抠除后验证"边框全透明"时注意：图案本体可能贴边（本例右缘 y201–262 是图案不是漏抠），用颜色判据区分，不要盲目要求四边 alpha=0。

## 4. icns 格式坑（本轮最大教训）

| 坑 | 正解 |
|---|---|
| 魔数大写 `ICNS`（规范写法）→ `file(1)` 及部分工具报 "data" | 用 iconutil 惯例的**小写 `icns`** |
| 首块用 `icp4`/`icp6` 等老式小图标块 | iconutil 条目集：`ic12, ic07, ic13, ic08, ic14, ic09, ic10, ic11`（全 PNG payload） |
| 依赖 Pillow/系统工具（Linux 无 `iconutil`） | 手写容器：`magic + u32 总长` + 每块 `type + u32 块长(含头) + PNG`，约 10 行 |

- **定位魔数规则的方法**：字节翻转实验——把我方文件首 4 字节小写化后 `file` 立即识别、上游大写化后变 "data"，单变量定位根因。
- 容器自校验：逐条目校验 PNG 魔数与声明尺寸、长度链 `off == total == len(file)`。

## 5. ico 格式坑

- **首条目 size 字段 <64KB**：`file`/老式校验按 16 位读；256px 真彩 PNG 动辄 120KB+ 会整文件被判成 Targa。实测把上游文件的条目 size 改成 121786 它也立刻失识别。
  - 解法：256px 条目量化 256 色调色板 PNG（约 34KB）。代价：渐变处轻微色带。
- **混合编码**：256px = PNG（Vista+ 惯例）+ 128/64/48/32/16 = **BMP-32bpp DIB**（40 字节 BITMAPINFOHEADER、`biHeight = 2×h`、底朝上 BGRA、AND mask 全零）。Pillow 默认全 PNG 条目，需手写容器。
- 256px 的宽高目录字节写 `0x00`（256 编码约定）。

## 6. 托盘/模板图标

- **先查用法**：`new Tray(iconPath)` 未调用 `setTemplateImage(true)` → 三平台按文件原样渲染 → 黑剪影会直接显示为黑块，**保留彩色**才对。
- 若未来启用 template 模式：macOS 只用 alpha 通道自动重着色，此时 RGB 内容无所谓。
- Update 徽标：橙色 `#FF9F0A` + 白描边，深/浅背景都可见。

## 7. 变体派生管线（单一 master）

```
源图 → cover 居中裁方 → 抠背景
  ├─ 全彩不透明方形 → icns / ico / icon.png / icon@2x / icon-512 / icon.svg
  ├─ 灰度 + 亮度线性映射 [140,235] → icon-light.png / icon-light.icns（暗色 dock 变体）
  ├─ 彩色抠除图 → iconTemplate*（22/44）+ loading-goose 7 帧动画（45×39，正弦 bob+旋转）
  └─ 剪影（备选 --glyph-silhouette）→ #101010 单色
```

- light 变体映射参数用上游已知文件的灰度分位数拟合（p5/p95 两点线性），而非拍脑袋。
- loading 帧保持上游画布尺寸与文件名（`1..7.svg`），动画用 transform 参数逐帧相位错开，循环即动。
- 确定性输出：同输入同产物，可重复构建、可 diff。

## 8. 验证清单（无目检时）

1. `file` 输出与上游已知文件**措辞一致**（"Mac OS X icon" / "MS Windows icon resource - 6 icons"）。
2. 自写解析器过容器（块长链、PNG 魔数、目录字段）。
3. **独立解码器**交叉验证：gdk-pixbuf 能解码 ico；BMP 条目像素回读与源图逐点比对。
4. 统计校验：彩色/透明/黑色像素覆盖率、边框 alpha、徽标色存在性。
5. 最终仍需人工目检一轮——本轮 5 次返工有 4 次是人眼发现机器统计没覆盖的问题（黑白相间、彩色变黑等）。

## 9. 工程化

- 只依赖 Pillow：CI（Linux）无 `iconutil`/ImageMagick，`prepare.sh` 已改为委托本脚本。
- 脚本支持 `--source/--out-dir/--fit/--glyph-silhouette`，`--out-dir` 允许仓库外路径（临时验证用）。
- 量化/抠除等有损步骤集中在最小尺寸产物（ico 256px），全彩版本保留在 icns/png。
