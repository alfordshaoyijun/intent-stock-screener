import { METRIC_BY_ID, METRIC_REGISTRY } from "./metricRegistry.js";
import { INTENT_MAPPINGS, STRATEGY_TEMPLATES } from "./intentMappings.js";

const OP_TO_SYMBOL = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=" };

export { STRATEGY_TEMPLATES };

export const CONDITION_KNOWLEDGE = INTENT_MAPPINGS.flatMap((mapping) =>
  mapping.candidates.map((candidate) => {
    const metric = METRIC_BY_ID[candidate.metric_id];
    return {
      field: candidate.metric_id,
      metric_id: candidate.metric_id,
      params: candidate.params || {},
      category: metric?.category || "custom",
      aliases: [...(metric?.aliases || []), ...mapping.phrases],
      defaultOp: OP_TO_SYMBOL[candidate.operator] || candidate.operator,
      defaultValue: candidate.value,
      reason: candidate.reason,
      intent: mapping.intent,
      availability: metric?.availability || "missing",
      clarification: mapping.clarification
    };
  })
);

export function buildCondition(item, index = 0) {
  return {
    id: `c-${item.field}-${index}`,
    field: item.field,
    metric_id: item.metric_id || item.field,
    params: item.params || {},
    op: item.defaultOp,
    value: item.defaultValue,
    group: item.category,
    origin: "ai_suggested",
    availability: item.availability || METRIC_BY_ID[item.field]?.availability || "missing"
  };
}

export function suggestConditions(text) {
  const normalized = text.trim().toLowerCase();
  const suggestions = [];
  const seen = new Set();

  for (const mapping of INTENT_MAPPINGS) {
    const matchedIntent = !normalized || mapping.phrases.some((phrase) => normalized.includes(phrase.toLowerCase()));
    const matchedMetricIds = new Set();
    const matchedMetric = mapping.candidates.some((candidate) => {
      const metric = METRIC_BY_ID[candidate.metric_id];
      const matched = metric?.aliases?.some((alias) => normalized.includes(alias.toLowerCase()));
      if (matched) matchedMetricIds.add(candidate.metric_id);
      return matched;
    });
    if (!matchedIntent && !matchedMetric) continue;

    for (const candidate of mapping.candidates) {
      if (!matchedIntent && !matchedMetricIds.has(candidate.metric_id)) continue;
      const metric = METRIC_BY_ID[candidate.metric_id];
      const op = OP_TO_SYMBOL[candidate.operator] || candidate.operator;
      const key = `${candidate.metric_id}:${op}:${candidate.value}:${JSON.stringify(candidate.params || {})}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const availability = metric?.availability || "missing";
      suggestions.push({
        ...buildCondition({
          field: candidate.metric_id,
          metric_id: candidate.metric_id,
          params: candidate.params || {},
          category: metric?.category || "custom",
          defaultOp: op,
          defaultValue: candidate.value,
          reason: candidate.reason,
          aliases: [...(metric?.aliases || []), ...mapping.phrases],
          availability
        }, suggestions.length),
        category: metric?.category || "custom",
        reason: candidate.reason,
        aliases: [...(metric?.aliases || []), ...mapping.phrases],
        confidence: normalized ? 0.86 : 0.62,
        selected: candidate.selectedDefault ?? availability === "executable",
        availability,
        intent: mapping.intent,
        clarification: mapping.clarification
      });
    }
  }

  return suggestions;
}

export function metricLibraryConditions() {
  return METRIC_REGISTRY.map((metric, index) => ({
    ...buildCondition({
      field: metric.id,
      metric_id: metric.id,
      category: metric.category,
      defaultOp: defaultOperatorFor(metric),
      defaultValue: defaultValueFor(metric),
      reason: metric.definition,
      aliases: metric.aliases,
      availability: metric.availability
    }, index),
    category: metric.category,
    reason: metric.definition,
    aliases: metric.aliases,
    confidence: 0.5,
    selected: false,
    availability: metric.availability
  }));
}

function defaultOperatorFor(metric) {
  if (metric.id.includes("Above") || metric.id.includes("Trend") || metric.id === "notSpecialTreatment") return "=";
  if (metric.id === "newHigh60d" || metric.id === "bollBreakUpper" || metric.id === "macdGoldenCross" || metric.id.includes("Detected") || metric.id.includes("Ready") || metric.id.includes("Pivot") || metric.id.includes("Bullish") || metric.id.includes("NewHigh") || metric.id.includes("BlueDot")) return "=";
  if (metric.category === "valuation" || metric.id === "amplitude60d" || metric.id === "debtAssetRatio" || metric.id.includes("Rank") || metric.id.includes("Percentile") || metric.id === "atr14" || metric.id === "closeNearHighPct") return "<=";
  return ">=";
}

function defaultValueFor(metric) {
  const defaults = {
    revenueGrowth: 0,
    profitGrowth: 0,
    operatingCashflowYoy: 0,
    revenueQoq: 0,
    profitQoq: 0,
    epsYoy: 0,
    peTtm: 25,
    pb: 3,
    psTtm: 5,
    pcfTtm: 20,
    peIndustryRank: 40,
    peHistoryPercentile: 40,
    marketCapBillion: 300,
    listingAgeDays: 250,
    industryName: 0,
    latestPrice: 5,
    intradayChangePct: 3.5,
    openGapPct: 0,
    closeNearHighPct: 2,
    volume: 10000000,
    volumeRatio: 1.6,
    volumeToAvg5: 1,
    volumeToAvg20: 1,
    turnoverRate: 1,
    amountBillion: 5,
    amountRank: 100,
    priceAboveMa5: 1,
    priceAboveMa10: 1,
    amplitude60d: 30,
    return60d: -20,
    relativeStrength60d: 70,
    newHigh60d: 1,
    notSpecialTreatment: 1,
    ma5TrendUp: 1,
    ma10TrendUp: 1,
    priceAboveMa20: 1,
    maBullishAlignment: 1,
    ema20TrendUp: 1,
    bollBreakUpper: 1,
    bollWidthPercentile252: 20,
    atr14: 8,
    rsi6: 70,
    stochRsiK: 20,
    williamsR14: -20,
    cci20: -100,
    adx14: 20,
    macdDiff: 0,
    macdGoldenCross: 1,
    kdjK: 20,
    obvTrendUp: 1,
    mfi14: 50,
    vwmaDistance: 0,
    supertrendBullish: 1,
    ppoDiff: 0,
    sarBullish: 1,
    forceIndex13: 0,
    minerviniScore: 70,
    canslimScore: 70,
    compositeScore: 70,
    vcpDetected: 1,
    vcpReady: 1,
    pocketPivot: 1,
    powerTrend: 1,
    distanceToPivotPct: 5,
    baseDepthPct: 35,
    upDownVolumeRatio10d: 1.2,
    rsLineNewHigh: 1,
    rsLineBlueDotRecent: 1,
    roe: 10,
    grossMargin: 20,
    netMargin: 5,
    roic: 8,
    debtAssetRatio: 70,
    currentRatio: 1,
    dividendYield: 3,
    mainNetInflow: 3000,
    largeOrderNetInflow: 1000,
    northboundNetBuy: 1000,
    sectorRisingCount: 18,
    sectorChangePct: 0,
    sectorRisingRatio: 60,
    sectorRankByChange: 10,
    conceptHotnessRank: 20
  };
  return defaults[metric.id] ?? 0;
}
