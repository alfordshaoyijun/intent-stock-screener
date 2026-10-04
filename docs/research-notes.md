# 条件库与 UI 调研记录

## 目标

产品不应只支持一套固定条件，而要把用户的自然语言映射到一个可扩展的指标能力底座。用户先确认候选条件，再编辑阈值并执行筛选。

## 问财参考

公开资料显示，问财的核心交互是自然语言输入，系统将语义拆解为多维选股条件，并在金融指标与标签中动态组合筛选。它还支持在结果上继续叠加涨跌幅、板块、资金等约束。

我们不照搬“直接给结果”的黑盒方式，而是在问财式入口后增加“候选条件确认”：

1. 输入自然语言。
2. AI/知识库召回候选条件。
3. 用户勾选确认。
4. 只编辑已启用条件。
5. 程序执行筛选并解释入选/排除/无法判断。

参考来源：

- https://search.10jqka.com.cn/yike/hdetail/id/cbbafb47e7685c1d_6198041_3349337
- https://download.10jqka.com.cn/free/wcjqr/
- https://pcths.ijinshan.com/wencai/index.html
- https://quant.10jqka.com.cn/view/dataplatform/detail/399

## 开源工具源码读取

除 README 外，已直接读取以下源码/合同文件提取指标：

- Stock Analyzer：`src/agent/schema.py`、`src/scanner/signals.py`、`src/scanner/screener.py`。
- InStock：`instock/core/kline/indicator_web_dic.py`。
- Stock Screener：`contracts/scan_filter_fields.json`。

提取明细见 `docs/open-source-indicator-audit.md`。

## 开源工具参考

### xang1234/stock-screener

特点：

- 有 80+ filter fields。
- 用 Minervini、CANSLIM、IPO、Volume Breakthrough 等 screener/preset 组织策略。
- 条件字段分为 Scores、Setups、Ratings、Fundamentals、Liquidity、Technicals、Classification 等类别。
- 有市场宽度、行业分组、相对强弱、setup ready、VCP、pocket pivot 等交易者语言。

对我们的启发：

- 条件库要按类别组织，而不是平铺。
- 要有策略模板。
- 结果解释可以用 factor chips，而不是只给长文本。

### erishen/stock-analyzer

特点：

- A 股方向，含技术指标 ETL、信号扫描、Text2SQL AI 筛选、Web dashboard。
- 指标包括 MA、EMA、MACD、RSI、BOLL、KDJ、ATR、OBV、动量、波动率、K 线实体/影线等。
- 自带中文 schema hints，帮助 AI 将自然语言映射到标准字段。

对我们的启发：

- 条件知识库需要中文别名和解释。
- A 股用户常用“金叉、超买、超卖、站上均线、放量、缩量”等语言，需要映射到标准指标。
- 后续可扩展技术形态条件，但当前先保留可真实取数的字段。

### laanito/OpenTerminalUI

特点：

- 有 query builder、custom formula engine、multi-factor composite scoring。
- 因子分为 Value、Momentum、Quality、Low-Volatility。
- 强调 why-ranked explanations、factor chips 和 degraded 数据提示。
- 数据源缺失时返回 degraded marker，UI 明确提示，不伪造数据。

对我们的启发：

- 结果解释应显示“为什么入选/排除”。
- 字段缺失或未接入时必须标为无法判断。
- 条件库可以保留未接入字段，但必须以缺字段状态展示。

## 当前条件库分类与数据状态

当前采用两层结构：

- `src/metricRegistry.js`：指标注册表，只回答“系统实际能算什么”。字段包含 id、名称、别名、分类、定义、单位、参数、来源、支持运算、可用状态和缺失策略。
- `src/intentMappings.js`：意图映射表，只回答“一句话可能对应哪些指标”。例如“经营改善”会召回营收同比增长、净利润同比增长，但不会把它们写死成必须同时满足。
- 运行时用户条件：只保存用户确认后的 metric_id、参数、操作符、阈值和 origin，和指标定义分开。

数据状态：

- 已接入 iFinD 实时/日频字段：最新价、当日涨跌幅、成交量、成交额、换手率、量比、总市值、市净率、TTM 市盈率、5 日均线、10 日均线、成交量/5 日均量、近 60 日涨跌幅、近 60 日振幅。
- 已接入 iFinD 财务字段：最新一期营收同比增长、净利润同比增长。
- 本地确定性计算：价格高于 5 日均线、价格高于 10 日均线、成交量/5 日均量、非 ST/退市预警。
- 可调用但当前筛选层未接入：ROE、毛利率、资产负债率、股息率、RSI、MACD、KDJ、20 日均线、均线多头排列、均线向上。
- 需要板块映射后接入：所属行业涨跌幅、行业上涨家数、行业上涨比例。
- 需要资金流接口后接入：主力净流入/大单净流入。
- 口语策略扩展：五日线、十日线、跌破十日线、均线往上、放量、缩量、板块共振、低负债、高毛利、高 ROE 等同义表达。

## UI 决策

不展示“全部条件”。页面只显示：

1. AI 候选条件：用户勾选确认。
2. 已启用条件：只编辑参与筛选的条件。
3. 筛选结果：入选、排除、无法判断。
4. 解释：每个条件的真实值、阈值、来源和时点。

这样既能体现条件库丰富，又不会让表单无限变长。

## 迁移验证

- 注册指标数：83。
- 口语句“看五日线和十日线，两个都往上走再买，跌破十日线就考虑出来。”可召回站上 5 日线、站上 10 日线、5 日均线向上、10 日均线向上，其中前两项可执行，后两项待核验。
- 口语句“尾盘量比大于1.6，板块上涨家数超过18家”可召回涨幅、量比、放量、风险剔除和板块共振指标，其中板块条件明确标为缺数据。
