# 自然语言智能选股与策略解释器

一个 24 小时范围内可运行的 Web 演示：用户输入一句模糊选股意图，系统识别歧义，从“指标注册表 + 意图映射表”召回候选指标，用户勾选确认后再编辑阈值，随后调用真实金融数据，由确定性程序执行筛选并解释入选、排除和无法判断。

## 运行方式

```bash
npm install
npm start
```

打开 `http://localhost:5173`。

源码仓库：[intent-stock-screener](https://github.com/alfordshaoyijun/intent-stock-screener)。临时演示入口：[Web 工作台](https://strip-subscription-robin-yoga.trycloudflare.com)，需要独立提供演示账号和密码；关闭开发者电脑或隧道进程即失效，不是长期部署。公网验证摘要见 `docs/public-demo-validation.md`，最终提交状态和发布检查见 `docs/submission-checklist.md`。AI 使用与修正记录见 `docs/ai-use-record.md`，测试范围和待验收项见 `docs/test-plan.md`。

临时评审演示可设置 `DEMO_ACCESS_USER` 和随机生成的 `DEMO_ACCESS_PASSWORD`，启用 HTTP Basic 访问保护；公网必须使用 HTTPS。保护模式下，行情/财务查询与 AI 解析串行执行，5 秒内重复调用返回 429。评审端共享单独的策略存储，不代表已有账号隔离；仅供受邀评审使用，不要输入个人持仓或隐私。正式长期部署仍需独立身份认证、授权数据使用及稳定服务器。

跨机器运行：Node.js 20+，`npm ci`；在服务端安装已授权的 iFinD Skill，用 `IFIND_CALL_MODULE` 指定其 `call-node.js` 绝对路径。凭证独立配置，不随源码发布。`.env.example` 仅为配置说明，`npm start` 不自动读取 `.env`，请通过宿主环境设置变量。应用源码和基础测试可在没有 Skill 的机器加载，实际取数仍需要合法授权。云端 AI 可选 OpenAI-compatible 后端，不能直接沿用开发者本机 CLI 登录。

## 数据来源

- 数据工具：iFinD MCP `ifind-finance-data` Skill
- 股票池：优先通过 iFinD MCP `search_stocks` 获取开放 A 股池；如接口限流或失败，回退到 `src/screener.js` 的 10 只本地示范池。可用 `STOCK_POOL_LIMIT` 临时限制执行规模，避免全市场批量取数耗时过长。
- 取数字段：
  - 最新一期营业收入同比增长率
  - 最新一期净利润同比增长率
  - 最新 TTM 市盈率
  - 实时最新价、涨跌幅、成交量、成交额、换手率、量比、总市值、市净率
  - 5 日均线、10 日均线、20 日均线、成交量/5 日均量
  - RSI(6)、KDJ K 值、MACD DIFF
  - ROE、销售毛利率、销售净利率、资产负债率、流动比率
  - 经营活动现金流量净额同比增长率、基本每股收益同比增长率
  - 近 60 日区间振幅
  - 近 60 日 N 日涨跌幅

密钥写在本机 Skill 配置 `D:\.codex\skills\ifind-finance-data\mcp_config.json`，不进入项目代码。

## 产品流程

1. 自然语言输入：例如“经营改善、估值不过高、走势比较稳定”。
2. AI 整理意图：本地 AI 先把原话整理成结构化意图，保留原文证据、关系、排名、排除、修改和暂不支持项。
3. 指标匹配：程序只根据 AI 输出的 `metric_id` 和指标注册表生成候选条件；找不到对应指标时标为暂不支持，不替换成相近指标。
4. 用户确认：用户勾选真正符合自己意图的条件。
5. 条件编辑：只展示已启用条件，支持修改阈值、操作符、删除条件。
6. 真实数据筛选：调用 iFinD MCP 取数，程序执行筛选。
7. 结果解释：展示入选、排除、无法判断，附来源、时点、单位和口径。

## 指标库结构

- 指标注册表：`src/metricRegistry.js` 记录每个指标的定义、单位、来源、可用状态、支持运算和缺失策略。当前 83 个指标分为 `executable`、`unverified`、`missing` 三类，其中 29 个已接入真实执行链路。
- 意图映射表：`src/intentMappings.js` 记录“经营改善”“尾盘强势”“板块共振”等说法可能召回哪些指标，以及需要提示用户澄清什么。
- 用户条件：运行时只保存用户确认后的 `metric_id`、参数、操作符、阈值、来源状态，不把阈值写回指标定义。

## 本地 AI 后端

`src/llmClient.js` 参考本地 `jobhunter/jobhunter/llm.py` 的做法，把模型调用抽象成统一入口：

- `complete(prompt)`：返回文本。
- `completeJson(prompt)` / `complete_json(prompt)`：剥离代码块和前后说明后解析 JSON。

后端选择顺序：

1. 显式配置 `AI_BACKEND`。
2. 自动寻找本机 Codex CLI。
3. 检测到 `AI_BASE_URL`、`AI_MODEL` 或 `AI_API_KEY` 时使用 OpenAI-compatible 接口。
4. 都不可用时进入 `none`，明确报错，不静默伪造 AI 结果。

支持的环境变量见 `.env.example`：

- `AI_BACKEND=codex-cli | openai-compatible | none`
- `CODEX_BIN=...`
- `CODEX_MODEL=...`
- `CODEX_REASONING_EFFORT=low`
- `AI_BASE_URL=http://localhost:11434/v1`
- `AI_MODEL=qwen2.5:7b`
- `AI_API_KEY=...`

Codex CLI 调用会使用临时目录、只读沙箱和 stdin 传入 prompt；Windows 下 `.cmd` / `.bat` 会自动通过 `cmd /c` 执行。服务端 `/api/parse` 已接入 `parseIntentWithAi`：本地 AI 可用时先输出结构化意图，再由程序匹配指标库；AI 不可用、超时或 JSON 解析失败时，会明确记录错误并回落到规则解析。筛选执行仍由指标注册表和程序引擎完成。

## 产品判断

- 歧义处理：关键歧义向用户展示，其他采用可见默认值，避免连续追问。
- AI 与程序分工：AI/意图映射负责理解表达和召回候选；指标注册表负责声明真实能力；用户负责确认；iFinD 负责真实字段取数；程序负责校验、执行筛选和解释结果。
- 失败呈现：字段缺失或接口失败标为“无法判断”，不算作满足；条件冲突先提示；没有入选结果时提示用户放宽条件。

## 合规边界

产品只展示条件筛选和数据解释，不输出确定性涨跌预测、收益承诺或直接买卖建议。结论可追溯到字段来源、取数时点、单位和统计口径。

## 已做与未做

已做：指标注册表、意图映射表、自然语言解析、歧义展示、候选条件确认、策略模板、条件编辑、真实数据筛选、入选/排除/无法判断解释、股票比较、策略保存。

未做：回测、自动交易、复杂多 Agent 编排、持仓画像、监控任务推送。

## 测试说明

```bash
npm test
```

覆盖：
- 主链路解析：模糊描述转结构化条件。
- 冲突/异常：不合理 PE 阈值会被拦截。
- 数据解析：iFinD Markdown 表格可被解析为结构化行。
- 本地 AI 后端：显式后端选择、Codex 路径配置、宽松 JSON 解析和未知配置报错。
- 两层解析：AI 结构化意图可生成注册表候选；PEG 等暂不支持条件不会被误替换成 PE。
- 迁移验证：83 个注册指标可返回到前端，候选条件带有可执行、待核验或缺数据状态。

手工验证建议：
- 输入“找一些经营改善、估值不过高、走势比较稳定的股票。”
- 修改 TTM 市盈率阈值并重新执行。
- 删除一个经营改善条件并观察入选结果变化。
- 设置 PE <= 0，确认系统先提示条件异常。
- 断网或移除密钥，确认结果进入“无法判断”。

本轮验证记录见 `docs/validation-record.md`。

数值标准化与确定性公式说明见 `docs/numeric-normalization.md`：中文金额、成数、倍数、百分点及区间由代码处理；产品预设需确认，空阈值拒绝执行。当前内置差值、比值和相对变化率，数据缺失标为无法判断。

待确认阈值支持“自动填写”：目前提供 14 个指标的产品预设，逐项说明建议值的理由和局限；填写后仍需勾选确认或采用阈值。主力、大单净流入虽有建议金额，仍标为缺数据，不因填写阈值升级为可执行。不会覆盖用户已明确的数字，不为公式比较或缺少比较对象的条件猜测阈值。建议来源与原因随策略保存，并在结果解释中保留。没有适用预设时显示说明，不硬填数字。

工作台界面及响应式检查见 `docs/ui-validation.md`。图标使用本地 Lucide 文件，许可证随附于 `public/vendor/`。

页面打开后不自动调用 AI 或执行筛选。用户点击“解析意图”后才解析，确认条件后点击“执行筛选”才查询行情和财务数据；初始化只读取股票池范围及保存记录。

解释、比较和保存的最新验证见 `docs/explanation-save-validation.md`。策略保存至服务端 `data/strategies.json`，可用 `STRATEGY_STORE_PATH` 指定持久文件路径；刷新和重启后可恢复，恢复后需重新执行筛选。当前为单用户本地存储，部署时需持久卷，不提供账号隔离。行情时间、报告期、披露日期与取数时间分开显示，未返回的指标日期不推断。后续操作提供比较、保存，未提供回测或监控。

导出自然语言测试集时，默认调用与服务端相同的 AI 入口。失败会记录为 `status: error`，不会回落规则后计作 AI 成功。每条结果包含结构化意图、原文证据、AI 状态和冲突校验。输出数量不代表正确率。

```bash
node scripts/export-test-conditions.mjs /path/to/test_inputs.jsonl test_conditions_ai.json
node scripts/export-test-conditions.mjs /path/to/test_inputs.jsonl test_conditions_ai_100.json --concurrency=4 --resume
node scripts/export-test-conditions.mjs /path/to/test_inputs.jsonl test_conditions_rules.json --rules
node scripts/export-test-conditions.mjs /path/to/test_inputs.jsonl test_conditions_ai_regression.json --ids=T019,T024,T089,T094,T097,T100
```

当前引擎尚未执行 OR 分组和历史时点筛选；解析保留要求并提示，相关候选不自动启用。复杂排名、交叉事件与字段比较需要独立数据和执行能力核验。

## AI 使用与验证记录

- 使用 Codex 生成项目骨架、前后端代码、测试和 README。
- 安装并自检 iFinD MCP Skill，验证 `listTools("stock")` 返回 `status_code: 200`。
- 通过实际调用 iFinD 验证字段返回形态，发现财务数据以 Markdown 表格包在 JSON 文本中，因此增加了表格解析和缺失值处理。
- 通过实际调用 iFinD 验证 ROE、毛利率、净利率、资产负债率、流动比率、经营现金流同比、EPS 同比、MA20、RSI、KDJ、MACD DIFF，并将对应指标升级为 `executable`。
- 保留程序筛选，避免直接把模糊自然语言结果当作最终策略。
- 参考同花顺问财公开资料，并直接读取 `Stock Analyzer`、`InStock`、`Stock Screener` 的源码/字段合同提取指标；最终采用“指标注册表 + 意图映射表”的可扩展结构，详见 `docs/research-notes.md` 和 `docs/open-source-indicator-audit.md`。
