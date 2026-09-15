# 复盘：FLEET-ORCH-001 M0 桥试点——从设计到 goose CLI 真机闭环

> 日期：2026-09-15（19:35–20:15）· 性质：**过程复盘 + 可复用方法论（供其他 agent 学习加载）**
> 范围：M0 试点切片全流程——`bridge/` 实现、单测、真节点 E2E、goose CLI 消费闭环、
> 合并推送。**前序**：`2026-09-15_5b-acceptance-retrospective.md`（同日早间，dsh 验收）。
> 结果：**全链路 `goose CLI → fleet-bridge → dsh 节点 → GOOSE-TO-FLEET-OK`**；
> 单测 7/7；合并 `b9bbc42` 并推送 origin。
> 关联：设计 `features/acp-mcp-bridge-design.md` v0.4；roadmap F-11。

## 1. 任务与目标

- **M0 是精益验证门**（hub-design-review §8 定的）：用最小实现回答"FLEET-ORCH-001/
  FLEET-HUB-001 的前提是否成立"——fleet 内核（core 注册表）能否脱离 Electron 壳被
  agent 消费？通过则 F-11/F-12 转正有据；不通过则整条多前端线重估。
- **判定判据**（设计 §10）：桥进程 + goose CLI 加载扩展 + 人对 goose 说"把 X 送到节点"
  → goose 调 dispatch → 拿到节点回复。

## 2. 时间线

| 时刻 | 事件 | 结果 |
|---|---|---|
| 19:35 | push main（F-1/F-2 成果上 origin） | `41284d2` |
| 19:36–19:40 | 环境侦察：MCP SDK 在锁文件、acp-smoke 参照、SDK API 面排查 | 根仓 `pnpm add` MCP SDK（超时但实际成功，P0） |
| 19:40–19:52 | `bridge/` 三件套实现 + 单测，**4 轮 SDK API 真名修正**（P1） | 7/7 绿 |
| 19:52–19:55 | MCP probe 直打真 dsh 节点：URL 双拼 bug（P5）暴露并修复 | `BRIDGE-M0-OK` ✓ |
| 19:55–20:10 | goose CLI 消费攻坚：扩展不被加载 → 三次盲试失败 → **读 goose-docs** 定位字段名（P6） | `GOOSE-TO-FLEET-OK` ✓ |
| 20:12–20:15 | 文档落账（ORCH v0.4/roadmap/速览）→ 分支合并 → push | `b9bbc42` |

## 3. 问题清单（现象→诊断→根因→处置）

### P0 `pnpm add` 输出超时
- **现象**：120s 输出流超时，疑似失败。
- **诊断**：直接查 side effect——`package.json` 已更新 + `node_modules` 已落位。
- **教训**：**超时 ≠ 失败**；先验证副作用再决定重试（重试 `pnpm add` 有锁文件风险）。

### P1 ACP SDK 客户端 API 面的 4 轮试错（最大时间黑洞）
| 轮 | 猜测 | 真相 | 来源 |
|---|---|---|---|
| 1 | `app.sessionUpdate(cb)` 流式注册 | `onNotification(methods.client.session.update, cb)` 泛型注册 | d.ts ClientApp 全量方法枚举 |
| 2 | `methods.agent.newSession` | `methods.agent.session.new`（命名空间嵌套） | `methods` 常量结构 |
| 3 | handler 拿 `ctx.connection.client` | handler 上下文直接挂 `ctx.client`（AgentContext） | d.ts AgentRequestContext |
| 4 | `connection.agent.newSession()` 类型化便捷方法 | 该版本 ClientContext 无便捷方法，统一 `.request(method, params)` | 运行时报错 |
- **根因**：SDK 文档薄、接口名与直觉偏差大；且**typecheck 没拦住**（部分是运行时才炸的
  any 式误用）。
- **方法论修正**：**读 SDK 自家测试文件**（`dist/acp.test.js`）找正宗用法——一次定位
  `client.notify(methods.client.session.update, …)` 正确姿势，比猜快一个数量级。

### P2 update 判别键双轨
- `sessionUpdate`（SDK 1.x schema）vs `updateKind`（v2 schema）——桥要聚合两代节点的流。
- 处置：`collectTurnText` 兼容两键 + 单测锁定。**这是"异构节点"命题的具体化**：fleet 的
  价值就在这种缝隙里，catalog（F-2）管"有没有"，这类胶水管"怎么读"。

### P3 content 是单块对象不是数组
- `agent_message_chunk.content` 为单个 ContentBlock；首版 `textFromContent` 只处理数组 →
  聚合恒空。修正为兼容两形。

### P4 RequestPermissionRequest 必填 `toolCall`
- 假 agent 发权限请求被 schema 拒（Invalid params）。用 `python3` 直读 SDK `schema.json`
  的 required 列表定位——**schema.json 是最终事实源**，比猜 kind 字段快。

### P5 URL 双拼（单测全绿仍翻车）
- `acpWebSocketUrlFromHttpBase(url, token)` 本就返回完整 `ws://…/acp?token=…`，我又拼了
  `/acp` → 真节点 E2E 报 ErrorEvent。
- **关键教训**：单测的 connect 注入 seam **绕过了 URL 构造**，7/7 绿掩盖了它——
  **注入 seam 的测试不覆盖被注入的部分**；真环境 E2E 不可替代（与 5B 复盘 L1 同源）。

### P6 goose 扩展配置字段名（消费闭环卡点）
- **现象**：扩展写入 config.yaml 后，新 goose 会话的工具集里没有 fleet-bridge（agent 自查
  "No such extension"）。
- **三次盲试**（都失败）：精简字段去 type；`GOOSE_CONFIGDIR` 隔离重跑；删 description。
- **修正动作**：**按纪律加载 goose-doc-guide skill → 读官方文档**——正确 schema 是
  `cmd`（非 `command`）+ 必填 `name`。一次修正即通。
- **教训**：本会话系统提示明写"MUST read goose docs before goose-specific config"——
  第一次就该读。**三次盲试的成本 > 一次读文档**，且盲试制造了"是不是常驻 router 缓存"的
  错误假设（P7）。

### P7 常驻 goose 进程不可乱杀
- 排查 P6 时发现 5 个 9 月初起的 goose 进程（其一可能是**当前会话自身**）。
- **纪律**：无法识别归属的进程不杀；改走配置/文档路径解决。最终 P6 与 router 无关，
  证明该谨慎避免了误杀事故。

## 4. 方法论（可复用，按序）

| # | 模式 | 应用 |
|---|---|---|
| M1' | **SDK 自家测试 = 正宗用法**：d.ts 猜不动时读 `dist/*.test.js` | P1 第 4 轮后一击定位 |
| M2' | **schema.json 直读**：用脚本抽 required/enum | P4 权限必填字段 |
| M3' | **一次性 probe 脚本**：`tsx probe.mts` 最小复现，栈直接见底 | P1/P5 排查提速 |
| M4' | **注入 seam + in-process 对连**：SDK `app.connect(fakeAgent)` 零端口测试 | 7 个单测 2 秒跑完 |
| M5' | **side-effect 验证优于输出判断**：超时先查落盘 | P0 |
| M6' | **官方文档优先于盲试**（尤其有 doc skill 时） | P6 |
| M7' | **真环境 E2E 收尾**：单测绿 ≠ 链路通（seam 盲区） | P5 |
| M8' | **进程安全**：不识别不杀 | P7 |

## 5. 经验教训

- **L1 设计前提被验证**：standalone 桥直接消费 core 注册表跑通——"内核独立于 Electron"
  成立，F-12 fleetd 的地基是真的（这正是 M0 作为验证门的意义）。
- **L2 SDK 猜 API 是最大时间黑洞**（4 轮 × 修正 > 全部其他工作之和的一半）；
  M1'/M2' 两招可把这类成本压掉 80%。
- **L3 文档纪律不是官僚**：goose-doc-guide 的存在就是为了 P6 这类坑；"先读再配"
  应作为 agent 硬规则。
- **L4 测试 seam 的盲区要自知**：注入点绕过的路径（URL 构造）必须由真 E2E 兜底——
  "单测+真链路"双门缺一不可。
- **L5 异构即产品**：判别键双轨（P2）这类"丑活"正是 fleet 的差异化所在，值得沉淀成
  公共胶水（F-8 共享包候选）。
- **L6 精益门有效**：M0 用 ~0.5 天 + ~350 行，验证了 F-11/F-12 两张牌的前提——
  比"直接做 fleetd M1"省了一个量级。

## 6. 最佳实践清单（未来 agent 直接加载）

1. 接新 SDK：先 `ls dist/*.test.js` 读用法，再写代码；schema 疑问用脚本抽 schema.json。
2. 测协议交互：优先找 SDK 的 in-process 对连能力（`app.connect(agentApp)` 式），
   免端口免 mock 框架。
3. 协议网关类代码：**兼容多代 schema 判别键**并单测锁定（生态处于 1.x→v2 过渡期）。
4. URL/路径构造：用 core 现成构造器时**读一遍它的返回值形状**，别按名字猜。
5. goose 配置：任何字段疑问 → goose-doc-guide → docs map → 对应页面（字段：`cmd`/
   `name`/`args`/`enabled`/`type: stdio`/`timeout`/`envs`）。
6. 命令超时：查副作用（文件/进程/git 状态）再定成败。
7. 长寿进程处置：`ps -o lstart` 看年龄，识别不了归属就不动，走配置面解决。
8. 试点收口三件套：真链路证据（终端原文）进 commit message；设计文档 changelog 落账
   （含踩坑字段名）；roadmap/状态速览同步。

## 7. 工件索引

| 类 | 项 |
|---|---|
| commits | `2af5ac7` 桥实现 · `518938f` 文档落账 · `b9bbc42` merge（已 push） |
| 代码 | `bridge/src/{nodes,dispatch,main}.ts`（~350 行）· `bridge/__tests__` ×2 |
| 证据 | MCP probe 输出 `BRIDGE-M0-OK`；goose run 输出 `GOOSE-TO-FLEET-OK`（/tmp/goose-m0-final.txt） |
| 配置 | `~/.config/goose/config.yaml` 的 `fleet-bridge` 扩展（备份 `/tmp/goose-config-backup.yaml`） |
| 关键事实 | goose 扩展字段 `cmd`/`name`（goose-docs 核实）；SDK update 判别键 `sessionUpdate`(1.x)/`updateKind`(v2)；`acpWebSocketUrlFromHttpBase` 返回全量 URL |

## 8. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-15 | 初稿：时间线 / P0–P7 / M1'–M8' 方法论 / L1–L6 教训 / 最佳实践 8 条 / 工件索引 |
