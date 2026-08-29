# TESTPLAN — fleet C-mini/C+ 改动的测试方案与执行记录

**日期**: 2026-08-19 · **对象**: fork `7a59eb7`（C-mini/C+/强化轮） · **上游基线**: `0e17bf7`
**原则**: 继承上游测试体系（vitest 单测 colocated + jsdom electron mock + 静态门禁 + playwright e2e），不另造轮子。

---

## 1. 上游测试体系盘点（继承对象）

| 层级 | 工具/命令 | 上游惯例 | 本机可跑 |
|---|---|---|---|
| L1 单元测试 | `vitest`（jsdom，`src/**/*.test.{ts,tsx}` colocated） | 纯逻辑放 `utils/`/`acp/` + `__tests__/`；`test/setup.ts` 全局 mock `window.electron`（getSetting/setSetting 有内存实现）；组件测试用 `i18n/test-utils` 的 `IntlTestWrapper`；electron 依赖用 `vi.doMock('electron')`（见 `preload.fileAccess.test.ts`） | ✅ |
| L2 静态门禁 | `typecheck` / `lint:check` / `format:check` / `i18n:check` | en.json 抽取一致性 + 15 语言镜像校验 | ✅ |
| L3 集成 | `vitest.integration.config.ts`（node env，`tests/integration/`） | provider 等集成 | ✅（不涉及 fleet） |
| L4 e2e | `playwright` + `_electron`（`tests/e2e/*.spec.ts`） | 启真实 app 点击 | ❌ 本机 headless 无显示（无 Xvfb）→ 用户侧 |

## 2. fleet 改动 → 测试映射

| # | 改动 | 可测性 | 方案 |
|---|---|---|---|
| F1 | csp.ts variadic（多后端 origin / upgrade 判定） | 纯函数 | ✅ L1 `csp.test.ts`（上轮已 +3，本轮复核） |
| F2 | settings 合并（externalBackends 持久化/默认值） | main.ts 内，不可直测 | 以 F6 组件测试间接覆盖（getSetting/setSetting 真路径） |
| F3 | `getFleetNodeBackend`（id→后端解析） | 提取到纯模块 | ✅ **重构**：抽 `src/utils/fleet.ts` → L1 |
| F4 | `getFleetCspBackends`（节点→CSP 配置映射） | 同上 | ✅ 同 F3 |
| F5 | 菜单子菜单构建（label 回退 name‖url、click 路由） | 同上 | ✅ `buildFleetNodeSubmenu(nodes, onOpen)` 注入回调 → L1 直接调 click 断言 |
| F6 | FleetNodesSection（增删改/校验/保存） | jsdom 组件 | ✅ L1 `*.test.tsx`（IntlTestWrapper + setup mock） |
| F7 | 节点校验规则（4 类 URL 错误/名称必填/指纹需 https） | 提取 `validateFleetNode`（返回错误码，不耦合 i18n） | ✅ L1 纯函数全覆盖（组件层仅测 1 条错误展示通路） |
| F8 | `set-setting`→菜单热刷新、createChat backendId 分支、GOOSE_USER_DATA_DIR | Electron 主进程运行时 | ❌ L1 无法（main.ts 不可导入）；**重构已使核心逻辑纯化（F3–F5）**，残壳 = 接线；由 L4 e2e + 用户冒烟 S1–S3 覆盖 |
| F9 | `fleet/node-cli.mjs` | 独立脚本 | ✅ 脚本级冒烟（临时 settings 文件全流程） |
| F10 | i18n 18 键 | — | ✅ L2 `i18n:check` |

## 3. 执行计划（本机）

1. **重构提纯**（对齐上游"纯逻辑入 utils"惯例）：新建 `src/utils/fleet.ts`（ExternalBackend 类型 + F3/F4/F5/F7 四函数 + FLEET_MENU_LABEL）；`main.ts` 改为导入；`FleetNodesSection` 改用 `validateFleetNode`（错误码→i18n 映射留在组件）
2. **新增 L1**：`src/utils/__tests__/fleet.test.ts`（约 15 断言组）；`src/components/__tests__/FleetNodesSection.test.tsx`（渲染/增/删/校验展示）
3. **全门禁**：`format:check`(改动文件) → `lint:check` → `typecheck` → `vitest run`（全量）→ `i18n:check`
4. **F9 脚本冒烟**：node-cli add→list→rename→secret→remove
5. **记录**：结果回填 §4；PATCHES.md 补记重构；双仓提交
6. **用户侧（L4 替代）**：RETROSPECTIVE §5 S1–S3（GUI 不可自动化部分）

## 4. 执行结果（回填）

> 2026-08-19 23:42 执行完毕。

| 项 | 结果 | 备注 |
|---|---|---|
| `utils/__tests__/fleet.test.ts` | ✅ 15/15 | F3/F4/F5/F7 全覆盖：解析（含指纹/workdir/未知 id）、CSP 映射、子菜单（label 回退 url、click 路由回调）、校验 8 分支（协议/query/fragment//acp/畸形/名称/指纹+http） |
| `components/__tests__/FleetNodesSection.test.tsx` | ✅ 6/6 | F6/F2（间接）：设置加载渲染、空态、Add 持久化、Delete 持久化、畸形 URL 报错且不保存、指纹+http 报错 |
| 全量 vitest | ✅ **701/701**（+21） | 无回归 |
| 静态门禁 | ✅ prettier / eslint / typecheck / i18n:check（1574 msgs ×15 locale） | |
| node-cli 冒烟 | ✅ add→list→rename→secret(轮换)→remove | |
| 重构提纯 | ✅ `src/utils/fleet.ts`（104 行纯模块） | main.ts 残壳仅剩 electron 接线；对齐上游"纯逻辑入 utils"惯例 |

**结论**：F1–F7、F9、F10 已自动化覆盖；F8（主进程运行时：菜单热刷新/createChat 分支/userData 重定向）留 L4 e2e 与用户冒烟 S1–S3——其核心逻辑已通过重构收敛进 `fleet.ts` 并被单测覆盖，接线层风险显著缩小。
