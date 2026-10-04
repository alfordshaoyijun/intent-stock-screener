import { FIELD_DEFS } from "./metricRegistry.js";

// Deliberately limited presets: no invented distributions or industry benchmarks.
const presets = [
  ["peTtm", "<=", 25, "用 25 倍作为估值上限的演示起点，便于排除较高 PE；不适合直接跨行业判断合理估值。"],
  ["pb", "<=", 3, "用 3 倍作为市净率上限的演示起点；资产结构和行业差异较大，需按目标行业调整。"],
  ["revenueGrowth", ">", 0, "以同比增长转正作为收入改善的最低起点，不代表已经持续改善。"],
  ["profitGrowth", ">", 0, "以利润同比增长转正作为盈利改善的最低起点，仍需留意低基数和非经常性损益。"],
  ["operatingCashflowYoy", ">", 0, "以经营现金流同比增长转正作为改善的最低起点，不等同于现金流金额为正。"],
  ["amplitude60d", "<=", 30, "用近 60 日区间振幅不超过 30% 作为低波动的产品预设；振幅不等于波动率或最大回撤。"],
  ["return60d", ">=", -20, "用近 60 日跌幅不超过 20% 作为走弱过滤的演示起点，不保证未来走势稳定。"],
  ["volumeRatio", ">", 1.6, "用量比超过 1.6 倍作为成交较活跃的产品预设，不等同于资金净流入。"],
  ["volumeToAvg5", ">", 1, "以当日成交量超过 5 日均量作为放量的起点，需结合盘中时点理解。"],
  ["roe", ">=", 10, "用 ROE 至少 10% 作为盈利能力的演示门槛；报告期及杠杆水平会影响可比性。"],
  ["debtAssetRatio", "<=", 70, "用资产负债率不超过 70% 作为杠杆过滤起点；金融企业不能与一般企业直接比较。"],
  ["currentRatio", ">=", 1, "流动资产与流动负债之比达到 1 是覆盖短期负债的基础起点，并不保证资产可及时变现。"],
  ["mainNetInflow", ">", 3000, "沿用条件库中主力净流入超过 3000 万元的演示预设，把模糊的显著流入暂时表达为金额门槛；未按市值、成交额或行业分布校准，不能认定为显著流入的标准。当前缺少已核验数据，填写后仍可能无法判断。"],
  ["largeOrderNetInflow", ">", 1000, "沿用条件库中大单净流入超过 1000 万元的演示预设，提供可编辑的金额起点；不同行情供应商对大单的定义可能不同，不能等同于主力净流入或统一的显著标准。当前缺少已核验数据，填写后仍可能无法判断。"]
];

export const THRESHOLD_PRESETS = presets.map(([field, op, value, reason]) => ({
  field, op, value, unit: FIELD_DEFS[field]?.unit || "", value_origin: "product_preset",
  reason: `${reason} 此数值是可编辑的产品建议，不是金融标准、用户原话或当期数据分位。`
}));
