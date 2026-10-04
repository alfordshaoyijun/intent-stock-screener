export const INTENT_MAPPINGS = [
  mapping("经营改善", ["经营改善", "经营变好了", "业绩有起色", "公司越来越赚钱", "业绩改善"], [
    candidate("revenueGrowth", "gt", 0, "收入端恢复增长是经营改善的基础候选。"),
    candidate("profitGrowth", "gt", 0, "利润增长用于确认盈利端也在改善。"),
    candidate("operatingCashflowYoy", "gt", 0, "现金流改善可避免只看账面利润。", {}, false)
  ], "你更关注收入增长、利润增长，还是现金流改善？"),
  mapping("估值不过高", ["估值不过高", "估值合理", "不贵", "便宜", "低估"], [
    candidate("peTtm", "lte", 25, "PE 是估值筛选的基础口径。"),
    candidate("pb", "lte", 3, "PB 可补充资产类和周期类公司的估值判断。"),
    candidate("peIndustryRank", "lte", 40, "行业内 PE 分位能表达“比同行便宜”。"),
    candidate("peHistoryPercentile", "lte", 40, "历史 PE 分位能表达“处在历史低位”。")
  ], "你想用 PE、PB，还是行业/历史分位来判断估值？"),
  mapping("走势稳定", ["走势稳定", "波动小", "比较稳", "回撤小"], [
    candidate("amplitude60d", "lte", 30, "近 60 日振幅可衡量波动程度。"),
    candidate("return60d", "gte", -20, "近 60 日跌幅下限可排除明显走弱。")
  ], "稳定是指低波动、低回撤，还是均线趋势平稳？"),
  mapping("尾盘强势", ["尾盘", "尾盘强势", "当日涨幅", "涨幅在", "冲高"], [
    candidate("intradayChangePct", "gte", 3.5, "短线强势通常要求当日涨幅达到下限。"),
    candidate("intradayChangePct", "lte", 8, "设置涨幅上限避免过度追高。"),
    candidate("volumeRatio", "gt", 1.6, "量比用于确认当日成交活跃。"),
    candidate("volumeToAvg5", "gt", 1, "成交量超过 5 日均量用于确认放量。"),
    candidate("notSpecialTreatment", "eq", 1, "短线策略通常先排除 ST 和退市风险。")
  ], "尾盘强势还可以加入分时均价线、资金流或板块共振。"),
  mapping("均线趋势", ["均线", "五日线", "5日线", "十日线", "10日线", "跌破十日线", "多头排列", "往上走"], [
    candidate("priceAboveMa5", "eq", 1, "当前价高于 5 日均线是短线趋势的基础条件。"),
    candidate("priceAboveMa10", "eq", 1, "未跌破 10 日均线可作为风险过滤。"),
    candidate("ma5TrendUp", "eq", 1, "均线往上需要比较今日和昨日均线。"),
    candidate("ma10TrendUp", "eq", 1, "十日线向上是更慢一档的趋势确认。"),
    candidate("maBullishAlignment", "eq", 1, "均线多头排列适合表达趋势确认。")
  ], "你说的均线趋势是站上均线、均线向上，还是多头排列？"),
  mapping("突破形态", ["突破", "新高", "平台突破", "收在高位", "布林", "BOLL"], [
    candidate("newHigh60d", "eq", 1, "创 60 日新高可表达突破前高。"),
    candidate("closeNearHighPct", "lte", 2, "收盘接近最高价可表达尾盘承接强。"),
    candidate("bollBreakUpper", "eq", 1, "突破布林上轨是常见技术突破条件。")
  ], "突破是看新高、平台突破、布林上轨，还是收盘位置？"),
  mapping("技术指标", ["MACD", "金叉", "RSI", "KDJ", "OBV", "ATR", "超买", "超卖"], [
    candidate("macdGoldenCross", "eq", 1, "MACD 金叉是常见趋势动能信号。"),
    candidate("macdDiff", "gt", 0, "MACD DIFF 大于 0 可作为当前动能偏强的可执行替代口径。"),
    candidate("rsi6", "lte", 70, "RSI 可用于过滤过热或寻找超卖。"),
    candidate("kdjK", "gte", 20, "KDJ 可用于短线摆动条件。"),
    candidate("obvTrendUp", "eq", 1, "OBV 向上用于观察量价配合。"),
    candidate("atr14", "lte", 8, "ATR 可用于约束波动风险。"),
    candidate("williamsR14", "lte", -20, "威廉指标可作为超买超卖候选。"),
    candidate("cci20", "gte", -100, "CCI 可用于趋势强弱或超买超卖过滤。")
  ], "你更想用趋势动能、超买超卖，还是波动率过滤？"),
  mapping("开源形态策略", ["Minervini", "米勒维尼", "CANSLIM", "欧奈尔", "VCP", "口袋支点", "Pocket Pivot", "蓝点", "RS线"], [
    candidate("minerviniScore", "gte", 70, "Stock Screener 用 Minervini score 表达趋势模板匹配程度。"),
    candidate("canslimScore", "gte", 70, "Stock Screener 用 CANSLIM score 表达成长/相对强弱等综合条件。"),
    candidate("vcpDetected", "eq", 1, "VCP 是 Stock Screener 条件合同中的 setup 字段。"),
    candidate("pocketPivot", "eq", 1, "Pocket Pivot 是 Stock Screener 条件合同中的 setup 字段。"),
    candidate("rsLineNewHigh", "eq", 1, "RS 线新高用于表达相对强势先于价格突破。"),
    candidate("rsLineBlueDotRecent", "eq", 1, "RS 蓝点是 Stock Screener 暴露的近期强势信号。")
  ], "你想复刻 Minervini/CANSLIM 评分，还是只取其中某些形态信号？"),
  mapping("成长质量", ["ROE", "毛利率", "高毛利", "质量", "负债率", "低负债"], [
    candidate("roe", "gte", 10, "ROE 是质量策略的核心候选。"),
    candidate("grossMargin", "gte", 20, "毛利率用于判断盈利质量。"),
    candidate("netMargin", "gte", 5, "净利率用于观察最终盈利能力。"),
    candidate("debtAssetRatio", "lte", 70, "资产负债率用于排除杠杆风险。"),
    candidate("currentRatio", "gte", 1, "流动比率可补充短期偿债能力。")
  ], "质量是指 ROE、毛利率、现金流，还是低负债？"),
  mapping("资金流", ["主力", "大单", "资金流", "净流入", "北向", "外资"], [
    candidate("mainNetInflow", "gt", 3000, "主力净流入是短线交易者常用资金条件。"),
    candidate("largeOrderNetInflow", "gt", 1000, "大单净流入可补充观察主动买盘。"),
    candidate("northboundNetBuy", "gt", 1000, "北向资金净买入常用于观察外资偏好。")
  ], "资金流是看主力、大单，还是北向资金？"),
  mapping("板块共振", ["板块", "行业", "共振", "上涨家数", "板块涨幅", "行业上涨比例"], [
    candidate("sectorChangePct", "gt", 0, "行业涨幅为正表示板块顺势。"),
    candidate("sectorRisingCount", "gt", 18, "上涨家数用于衡量板块内部扩散。"),
    candidate("sectorRisingRatio", "gte", 60, "上涨比例比绝对家数更适合跨行业比较。"),
    candidate("sectorRankByChange", "lte", 10, "行业涨幅排名可表达板块强度靠前。"),
    candidate("conceptHotnessRank", "lte", 20, "概念热度排名可表达题材活跃。")
  ], "板块共振是看板块涨幅、上涨家数，还是行业内排名？")
];

export const STRATEGY_TEMPLATES = [
  { id: "quality_value", name: "稳健低估值", description: "经营改善、估值不过高、走势不过度走弱。", fields: ["revenueGrowth", "profitGrowth", "peTtm", "amplitude60d", "return60d"] },
  { id: "tail_strength", name: "尾盘强势", description: "涨幅区间、量比、放量、均线与风险剔除。", fields: ["intradayChangePct", "volumeRatio", "volumeToAvg5", "priceAboveMa5", "notSpecialTreatment", "mainNetInflow", "sectorRisingCount"] },
  { id: "liquidity_momentum", name: "流动性动量", description: "成交额、换手率、涨跌幅和短期趋势。", fields: ["amountBillion", "turnoverRate", "intradayChangePct", "priceAboveMa5", "return60d"] },
  { id: "quality_growth", name: "成长质量", description: "增长、ROE、毛利率和负债风险。", fields: ["revenueGrowth", "profitGrowth", "roe", "grossMargin", "debtAssetRatio"] },
  { id: "sector_breadth", name: "板块共振", description: "行业涨幅、上涨家数、上涨比例和个股量价确认。", fields: ["sectorChangePct", "sectorRisingCount", "sectorRisingRatio", "volumeRatio", "intradayChangePct"] },
  { id: "breakout_momentum", name: "突破动量", description: "新高、收盘强度、量能和技术动能。", fields: ["newHigh60d", "closeNearHighPct", "volumeRatio", "macdGoldenCross", "obvTrendUp"] },
  { id: "cashflow_value", name: "现金流价值", description: "现金流改善、估值分位、分红和负债风险。", fields: ["operatingCashflowYoy", "peHistoryPercentile", "dividendYield", "debtAssetRatio", "currentRatio"] }
];

function mapping(intent, phrases, candidates, clarification) {
  return { intent, phrases, candidates, clarification };
}

function candidate(metric_id, operator, value, reason, params = {}, selectedDefault = undefined) {
  return { metric_id, params, operator, value, reason, selectedDefault };
}
