# V1 核实：dsh-orchestra / dsh-fleet 的 ACP client 能力（fleetd 门 G2）

> 日期：2026-09-15 20:30 · 性质：**验证门记录**（hub-design-review §8 / roadmap F-12 前置）
> 方法：源码直读（dsh-orchestra 全仓 grep + dsh-fleet client/bridge/docs），
> 非文档转述。结论影响 F-12 的 M2/M2-alt 排序。

## 1. 逐项事实

| 对象 | 是否 ACP client | 证据 |
|---|---|---|
| **dsh-orchestra** | **否** | 全仓（含 packages/）零 `agentclientprotocol` 引用；它是 dsh web 的插件工作台（spawn dsh + cordis 插件运行时 + React 主壳），会话走 dsh kernel 自有协议（typert-protocol 等） |
| **dsh-fleet web** | **否（但备有 client 模板）** | 无 WS-ACP 面；`client/acp-client.mjs`（230 行，stdio/TCP 双传输）定位是"给第三方 fleet UI 项目嵌入的**模板**"——它期望 fleet 做客户端（已是），自己不做客户端 |
| **dsh web / dsh harness 本体** | **是——但走 stdio** | README"关键认知"：dsh 的开放被控接口 = **ACP v1 stdin/stdout**；`dsh-subagent-acp` = "DSH 自己实现的 ACP 客户端"；10 节点 SSH 级联实证；**无公开 HTTP API、无 MCP server 面**。且 `dsh plugin --profile web add @deepseek-ai/dsh-subagent-acp` 可把该能力装进 web profile |

## 2. 附带收获

- dsh-fleet 自带 **`docs/fleet-ui-driver-advisory.md`**（157 行建议稿）——dsh 侧基于**直读
  fleet 仓代码**写的接入建议（AcpDriver 抽象/WS 桥对齐），生态两侧互认的实证；
- `docs/acp-contract.json` + schema：契约驱动客户端的机器可读方法面（F-2 S6 转换脚本的
  现成数据源）。

## 3. 对 F-12 的影响（判定）

```text
面③ fleet serve（ACP-over-WS）：无近期第三方消费者
   —— dsh-orchestra ✗、dsh-fleet web ✗；唯一实证 WS client 是 goose desktop 自己
面⑥ fleet agent（stdio）+ acpx-export：有真实需求方
   —— dsh 本体即 stdio ACP 消费者（subagent-acp provider 实证，CLI 与 web profile 皆可装）
   —— openclaw acpx / omnigent `--from-openclaw` 等 spawn 型宿主同生态（HUB §4bis 矩阵）
```

**结论**：V1 门通过，但方向修正——

1. **M2-alt（面⑥ stdio agent + acpx-export）升为 fleetd 第一优先**（估 2–4 天，HUB v0.3
   已有设计；dsh 侧今天就能 `fleet agent --node X` 当 provider 用）；
2. **M2（面③ WS）后置**，等真实 WS-ACP-client UI 出现再排（P14 依据更新）；
3. **F-3（stdio 驱动）同步受益**：同一生态双向（消费外部 stdio agent ↔ 被消费为 stdio
   agent），spike 可与面⑥合并评估；
4. M1（fleetd 最小版 + 桥 attached）不受影响，仍按 M0 之后排。

## 4. 与既有文档的对齐

- 印证 HUB review E1 的谨慎（"面③ 消费者从未核实"——V1 就是来核实的，结论：不存在）；
- 印证 HUB v0.3 review 补的"M2-alt 轻于面③、可先行"排序直觉；
- 修正 roadmap F-12 行与 remote-node-notes §3-D 的措辞（"dsh-orchestra/dsh-fleet web
  当 ACP client 添加 fleet 节点"→ 实际路径是 dsh 经 subagent-acp 以 stdio 消费面⑥）。

## 5. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-15 | 初稿：三对象事实表；面③无消费者/面⑥有实证消费者的判定；F-12 排序修正（M2-alt 先行、M2 后置） |
