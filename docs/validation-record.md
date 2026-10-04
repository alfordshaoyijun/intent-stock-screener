# 验证记录

验证时间：2026-10-03

## 自动化测试

命令：

```bash
npm test
```

结果：

- 测试数：11
- 通过：11
- 失败：0

覆盖点：

- 模糊自然语言解析为可编辑条件。
- PE 异常阈值校验。
- iFinD Markdown 表格解析。
- 本地 AI 后端选择、Codex 路径配置、宽松 JSON 解析。
- 两层解析：AI 结构化意图命中注册指标；PEG 暂不支持时不替换为 PE。

## 100 条输入规则基线

命令：

```bash
node scripts/export-test-conditions.mjs /path/to/test_inputs.jsonl test_conditions_rules.json --rules
```

结果摘要：

```json
{
  "total_cases": 100,
  "cases_with_enabled_conditions": 32,
  "cases_without_candidates": 56,
  "enabled_condition_total": 69,
  "candidate_total": 153,
  "candidate_availability_counts": {
    "executable": 71,
    "missing": 51,
    "unverified": 31
  }
}
```

说明：上述 100 条数字是旧版规则解析 `parseIntent` 的基线，不是两层 AI 的验证结果。反馈中 99 条相同与此一致。导出脚本已改为默认调用 `parseIntentWithAi`；规则基线需显式传 `--rules`。此前测试不能证明 AI 的指标匹配正确率。

## 反馈后的解析回归

新增自动化回归覆盖：同一指标多个约束与冲突、修改后的阈值、区间上下界、模糊偏好不自动启用、OR/历史要求不自动作为当前 AND 执行、AI 测试失败不静默回落规则、AI 空输出不混入规则候选。反馈后 `npm test`：17 项通过，0 项失败。

注意：注入结构化输出的单元测试验证的是匹配和校验层，并不能证明真实模型能理解全部 100 条语句。真实 AI 输出另存 `test_conditions_ai_regression.json`，逐条保留调用状态和结构化意图。

本次真实 AI 抽查共 6 条，6 条调用成功，无规则回落。人工核对如下：

| 案例 | 指标匹配与增项 | 关系逻辑 | 澄清和能力边界 |
| --- | --- | --- | --- |
| T019 | PEG 未误匹配 PE，无增项 | 保留小于 1 和非预测增长率要求 | PEG 尚不支持，并询问增长率口径 |
| T024 | 仅 ROE、资产负债率，无无关增项 | ROE > 15、负债率 < 50 | 当前可执行 |
| T089 | 保留同一个 PE 的两条约束 | PE < 10 且 > 30，validation.ok=false | 服务端返回 422，先提示冲突 |
| T094 | 仅一个 PE 条件 | 修改为 PE < 30，未保留旧阈值 20 | 保留修改原文 |
| T097 | 无假造当前财报条件 | 保留历史时点和排除当前财报 | 请求明确日期/报告期；历史执行尚不支持 |
| T100 | 无假造筛选条件 | 单独保留明日涨停及保证收益请求 | 针对确定性涨停和保证 20% 收益说明无法支持 |

这 6 条核查不能外推为 100 条正确率。T003、T010、T013、T025、T035、T036、T044、T047、T059、T063、T067、T073 等本轮尚未做真实 AI 重跑；其指标、关系及数据能力仍待核验。旧 100 条文件应按规则基线使用。

## 开放股票池验证

接口：

```http
GET /api/pool
```

结果：

```json
{
  "size": 200,
  "discoveredSize": 5575,
  "limitedTo": 200,
  "fallback": false,
  "source": "iFinD MCP search_stocks 全部A股股票池（CSV完整结果）"
}
```

说明：iFinD 开放 A 股池发现 5575 只；当前运行用 `STOCK_POOL_LIMIT=200` 限制执行规模，避免全市场批量取数触发限流。

## API 解析抽查

输入：

```text
PEG小于1。
```

结果：

```json
{
  "used": true,
  "strategy": "筛选 PEG 小于 1 的股票",
  "conditions": 0,
  "candidates": 0,
  "ambiguities": "已理解为“PEG 小于 1”，但当前指标库还没有可执行映射。"
}
```

输入：

```text
ROE大于15，负债率低于60。
```

结果：

```json
{
  "used": true,
  "strategy": "筛选 ROE 高于15且资产负债率低于60的股票",
  "conditions": "roe > 15, debtAssetRatio < 60",
  "ambiguities": ""
}
```

## 真实筛选 Smoke Test

条件：

- `roe > 15`
- `debtAssetRatio < 60`

为避免测试消耗过大，单独进程设置 `STOCK_POOL_LIMIT=5`。

结果：

```json
{
  "poolSize": 5,
  "discoveredPoolSize": 5575,
  "selected": 0,
  "excluded": 5,
  "unknown": 0,
  "firstSelected": null,
  "firstExcluded": "[个股标识已省略]",
  "firstUnknown": null,
  "poolFallback": false
}
```
