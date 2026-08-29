# fleet

多 Agent 调度壳（multi-agent ACP orchestrator shell）。fleet 编排多个 ACP 兼容后端节点；
**goose 是首个驱动**，以官方 release 二进制 + `goose serve` 公开 CLI 契约方式引用，
不维护 goose 源码。后续规划支持 deepseek harness 等 ACP 兼容后端（见 `INTEGRATION.md`）。

## 仓库结构

```
core/      多 Agent 调度核心（纯 TS，零 Electron 依赖，后端无关）
  node.ts      节点模型 + 校验
  registry.ts  节点注册表：增删改查 + settings.json 持久化
  router.ts    window/session → node 绑定解析
  policy.ts    调度策略接口（v1：静态绑定）
  driver.ts    ACP 驱动接口（v1 最小面，goose 单实现）
app/       Electron 壳（快照自 goose ui/desktop @ f4066f1，品牌 Fleet，locale 子集 en/zh-CN/zh-TW）
vendor/    快照依赖：goose-sdk（ACP SDK 源码）+ goose-binary 平台占位包
runtime/   后端引用层：versions.json、drivers/goose/、acp-smoke/ 契约测试
docs/      设计文档（P4 迁入脱敏版）
```

## 开发

```bash
pnpm install
pnpm test              # core + runtime 单测
pnpm node-cli -- --help

# 桌面壳（app/）
pnpm --filter @fleet/app typecheck
pnpm --filter @fleet/app test:run
GOOSE_BINARY=$(command -v goose) pnpm --filter @fleet/app start   # 本地跑通需 goose 二进制
```

许可：Apache-2.0（`LICENSE`）；归属声明见 `NOTICE.md`；契约治理见 `INTEGRATION.md`。
