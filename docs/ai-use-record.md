# AI 使用与修正记录

## 工具及角色

- Codex：协助编写前后端、注册表、数值标准化、测试、UI 和文档。
- 产品运行时：Codex CLI 或 OpenAI-compatible 后端，将用户原话整理为结构化意图。配置、调用和回落逻辑见 src/llmClient.js。
- iFinD MCP Skill：获取真实字段与股票池，不用生成模型输出替代实际取数。
- 程序：核验 metric_id、单位、阈值、冲突和可执行能力，执行确定性筛选，解释引用执行结果。

## 用户反馈与实现修正

| 反馈/不合理结果 | 修正方式 | 验证定位 |
| --- | --- | --- |
| 关键词触发固定指标套餐，误加无关条件 | 引入结构化意图层，保留原文证据；仅匹配注册表 ID，不把不支持指标替换成相近指标 | tests/intent.test.js |
| 中文金额、成数、倍数和百分点容易误算 | AI 绑定指标，代码做换算；差值、比值、相对变化用白名单公式 | tests/numeric.test.js |
| 模糊建议被当成用户明确要求 | 标记 product_preset，需确认；自动填写展示原因与局限 | tests/thresholdPresets.test.js |
| 取数时间被当成数据时间 | 分离行情时间、指标报告期、公告日期与取数时间，缺日期不推断 | tests/provenance.test.js |
| 保存接口只返回成功，没有持久保存 | 服务端文件存储，原子替换、并发队列、列表和恢复 | tests/strategyStore.test.js、strategyApi.test.js |
| 打开页面就自动解析，按钮长时间不可用 | 取消初始化解析和筛选，改为用户分别点击触发 | scripts/check-workspace-ui.mjs |
| 只有部分待确认指标出现自动填写 | 增加资金流建议，但不升级缺数据状态；无预设时明确说明 | tests/thresholdPresets.test.js、scripts/check-numeric-ui.mjs |

## 不夸大验证结论

单元测试中的 fake backend 和构造数值不等于真实模型准确率或真实市场覆盖率。历史 15 条复杂问题的真实 AI 调用仍存在关系、时点和否定语义缺口，详见 complex-test-15-review.md。自动启用数量不是正确率；executable 是接入状态，不保证每次调用都有值。代码和文档由 AI 协助生成，用户反馈推动修正，不把这些工作虚构成已由候选人独立人工完成的评审。
