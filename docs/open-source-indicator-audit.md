# 开源指标提取审计

## 读取的源码

本项目没有只参考 README，而是直接读取了三个开源项目的指标/筛选定义源：

- `erishen/stock-analyzer`
  - `.research/stock-analyzer/src/agent/schema.py`
  - `.research/stock-analyzer/src/scanner/signals.py`
  - `.research/stock-analyzer/src/scanner/screener.py`
- `ethqunzhong/InStock`
  - `.research/InStock/instock/core/kline/indicator_web_dic.py`
- `xang1234/stock-screener`
  - `.research/stock-screener/contracts/scan_filter_fields.json`

## 提取结果

### Stock Analyzer

`schema.py` 的 `COLUMN_HINTS` 说明了 Text2SQL 可用字段，包括：

- 行情基础：open、close、high、low、volume、amount、change_percent、turnover_rate。
- 均线与比例：ma5、ma10、ma20、ma60、ma5_ratio、ma20_ratio。
- 技术指标：macd、macd_signal、macd_hist、rsi、boll_upper、boll_lower、kdj_k、atr、obv、williams_r。
- 派生特征：momentum_5d、momentum_20d、volatility_20d、upper_shadow、lower_shadow、body_size。

`signals.py` 直接定义了 32 个交易信号，包括 MACD/KDJ 金叉死叉、RSI 超买超卖、布林突破、成交量异动、趋势多空、OBV 背离、威廉指标、CCI、ATR、K 线形态和量价背离。

`screener.py` 的关键实现是：前端条件为 `field + op + value`，后端先用字段白名单校验，再把每只股票最近一行技术字段与资产字段合并，用程序逐条 AND 筛选。这个实现方式和本项目的“AI 生成结构化条件，程序执行”一致。

### InStock

`indicator_web_dic.py` 提取到 31 组技术指标、76 个字段：

- 趋势/动量：MACD、PPO、TRIX、TEMA、ROC、DMA、DPO。
- 摆动/超买超卖：KDJ、RSI、STOCHRSI、W&R、CCI。
- 波动/通道：BOLL、ENE、ATR、SUPERTREND。
- 量能/资金：VR、OBV、MFI、VWMA、FI。
- 其他：DMI/ADX、VHF、SAR、PSY、BRAR、EMV、BIAS。

这些指标多数需要完整历史 K 线序列，当前 iFinD 演示数据层没有全部接入，所以在注册表中优先标为 `unverified` 或 `missing`。

### Stock Screener

`scan_filter_fields.json` 是最适合借鉴的筛选字段合同，共 96 个字段。它把字段分为：

- Scores：composite_score、minervini_score、canslim_score。
- Setups：se_setup_score、distance_to_pivot、VCP、pocket_pivot、power_trend。
- Ratings：rs_rating、rs_rating_1m、rs_rating_3m。
- Fundamentals：eps_growth、sales_growth、eps_rating、ibd_group_rank。
- Liquidity：price、market_cap_usd、adv_usd。
- Technicals：ADR、performance、stage、ma_alignment。
- Classification：industry、sector、market。

它还定义了表达式限制，例如最多 8 个条件组、100 个条件，说明真实筛选器需要支持分组和较大的条件库，但 UI 仍应分层展示。

## 已迁入本项目

本项目当前注册表已扩展为：

- iFinD 已执行字段：行情、量能、估值、近 60 日涨跌幅/振幅、5/10 日均线派生、营收/利润同比。
- 新增 iFinD 已执行字段：20 日均线派生、均线多头排列、RSI(6)、KDJ K、MACD DIFF、ROE、销售毛利率、销售净利率、资产负债率、流动比率、经营现金流同比、EPS 同比。
- Stock Analyzer 风格信号：MACD 金叉、KDJ、RSI、布林突破、威廉指标、CCI、ATR、OBV、K 线形态候选。
- InStock 技术指标：PPO、STOCHRSI、ADX、MFI、VWMA、SuperTrend、SAR、Force Index 等。
- Stock Screener 形态/评分：Minervini score、CANSLIM score、VCP、Pocket Pivot、Power Trend、RS 线新高、RS Blue Dot。

## 迁移原则

- 可以执行的指标才标为 `executable`。
- 源项目有定义、但当前 iFinD 字段尚未核验的标为 `unverified`。
- 需要额外数据源、行业映射、历史序列或评分模型的标为 `missing`。
- `unverified` 和 `missing` 默认不勾选，只作为候选展示，避免假装执行成功。

## iFinD 核验升级记录

2026-10-03 已用 iFinD MCP 实际调用核验并接入以下指标：

- `get_stock_financials`：ROE、销售毛利率、销售净利率、资产负债率、流动比率、经营活动现金流量净额同比增长率、基本每股收益同比增长率。
- `get_stock_performance`：最新 20 日均线、RSI 相对强弱指标 6 周期、KDJ 随机指标 K 值、MACD 指标 DIFF 值。
- 派生计算：价格高于 20 日均线、MA5 > MA10 > MA20。

执行 smoke test 使用 ROE、资产负债率、价格高于 20 日线、MACD DIFF 四个新增字段，10 只示范股票中结果为入选 1、排除 9、无法判断 0。
