import { CONDITION_KNOWLEDGE, STRATEGY_TEMPLATES, metricLibraryConditions, suggestConditions } from "./conditionKnowledge.js";
import { FIELD_DEFS, METRIC_REGISTRY, METRIC_BY_ID } from "./metricRegistry.js";
import { normalizeThreshold } from "./numeric.js";
import { validateComputation, CALCULATION_REGISTRY } from "./calculations.js";
import { aiCandidatesToHints, frameIntentWithAi } from "./aiIntent.js";
import { THRESHOLD_PRESETS } from "./thresholdPresets.js";

export { FIELD_DEFS, METRIC_REGISTRY } from "./metricRegistry.js";

export const OPERATORS = [">", ">=", "<", "<=", "="];

export function parseIntent(text) {
  const normalized = text.trim();
  return buildParseResult(normalized, suggestConditions(normalized).map((candidate) => ({
    ...candidate,
    selected: false,
    unit: FIELD_DEFS[candidate.field]?.unit || "",
    value_origin: "product_preset",
    requires_confirmation: true
  })), null);
}

export async function parseIntentWithAi(text, options = {}) {
  const normalized = String(text || "").trim();
  if (options.enabled === false || process.env.AI_INTENT === "off" || process.env.AI_INTENT === "0") {
    if (options.requireAi) throw new Error("AI 解析已关闭，不能作为 AI 测试结果。");
    return parseIntent(normalized);
  }

  try {
    const aiFrame = await frameIntentWithAi(normalized, options);
    const hints = aiCandidatesToHints(aiFrame);
    const candidates = mergeAiCandidates([], hints);
    return buildParseResult(normalized, candidates, aiFrame);
  } catch (error) {
    if (options.requireAi) throw error;
    return {
      ...parseIntent(normalized),
      aiFrame: null,
      aiStatus: {
        used: false,
        fallback: true,
        error: error.message || "本地 AI 解析失败，已回落到规则解析。"
      }
    };
  }
}

function buildParseResult(normalized, candidates, aiFrame = null) {
  const conditions = candidates
    .filter((item) => item.selected)
    .map(({ category, reason, aliases, confidence, selected, intent, clarification, ...condition }) => condition);
  const ambiguities = [];
  const defaults = [];

  const wantsImprovement = /经营|改善|增长|业绩|营收|利润|盈利/.test(normalized);
  const wantsValuation = /估值|便宜|不贵|不过高|市盈率|(^|[^a-z])pe([^a-z]|$)/i.test(normalized);
  const wantsStable = /稳定|波动|振幅|回撤|走势|涨跌幅/i.test(normalized);

  if (!aiFrame && (wantsImprovement || !normalized)) {
    ambiguities.push({
      phrase: "经营改善",
      decision: "召回收入增长、利润增长等候选指标；用户确认后才进入执行条件。",
      editable: true
    });
    defaults.push("经营改善没有唯一标准，系统先给出候选指标，不把模糊词固定成唯一策略。");
  }

  if (!aiFrame && (wantsValuation || !normalized)) {
    const peMatch = normalized.match(/(?:^|[^a-z])(?:pe|市盈率)[^\d]*(\d+(?:\.\d+)?)/i) || normalized.match(/(?:低于|小于|不超过|<=?)\s*(\d+(?:\.\d+)?)\s*(?:倍|x)?/i);
    if (peMatch) {
      const pe = conditions.find((condition) => condition.field === "peTtm");
      if (pe) pe.value = Number(peMatch[1]);
      const candidate = candidates.find((condition) => condition.field === "peTtm");
      if (candidate) candidate.value = Number(peMatch[1]);
    }
    ambiguities.push({
      phrase: "估值不过高",
      decision: `默认候选包含 TTM 市盈率 <= ${peMatch ? Number(peMatch[1]) : 25}，也可切换到 PB、分位数等口径。`,
      editable: true
    });
  }

  if (!aiFrame && (wantsStable || !normalized)) {
    ambiguities.push({
      phrase: "走势比较稳定",
      decision: "默认候选包含近 60 日振幅和近 60 日涨跌幅下限；均线、波动率等口径可继续扩展。",
      editable: true
    });
    defaults.push("稳定性采用可解释候选条件，用户可删除、替换或调整阈值。");
  }

  if (!aiFrame && /尾盘|分时|量比|均线|主力|大单|板块|ST|退市|当日涨幅|涨幅在|成交量|放量|缩量/.test(normalized)) {
    ambiguities.push({
      phrase: "尾盘/短线交易条件",
      decision: "召回涨幅区间、量比、成交量相对5日均量、均线、风险剔除等条件；资金流和板块条件按数据可用性标记。",
      editable: true
    });
    defaults.push("短线交易风格会混合行情、量能、趋势、资金流和板块指标，系统会区分可执行、待核验和缺数据。");
  }

  if (/冲突|高增长.*低波动|极低估值|都要/.test(normalized)) {
    ambiguities.push({
      phrase: "可能冲突的偏好",
      decision: "高成长、低估值、低波动同时出现时结果可能很少，系统会在执行后提示可放宽项。",
      editable: false
    });
  }

  if (aiFrame) {
    for (const item of aiFrame.intents.filter((intent) => intent.type === "time" || intent.type === "logic" && /OR|或|或者/i.test(intent.meaning + intent.evidence))) {
      ambiguities.push({ phrase: item.evidence || item.meaning, decision: `已保留“${item.meaning}”；当前执行引擎仅支持当前时点的 AND 筛选，请先调整此要求。相关候选未自动启用。`, editable: true });
    }
    const displayUnsupported = aiFrame.intents.filter((intent) =>
      intent.type === "unsupported" || (!intent.metric_ids.length && !["logic", "time", "scope"].includes(intent.type))
    );
    for (const item of displayUnsupported) {
      ambiguities.push({
        phrase: item.evidence || item.meaning || "暂不支持条件",
        decision: `已理解为“${item.meaning || item.evidence}”，但当前指标库还没有可执行映射。`,
        editable: false
      });
    }
    for (const question of aiFrame.clarifications) {
      ambiguities.push({
        phrase: "AI 澄清问题",
        decision: question,
        editable: true
      });
    }
    for (const candidate of candidates.filter((item) => item.numeric_error)) {
      ambiguities.push({ phrase: candidate.aiEvidence || candidate.field, decision: candidate.numeric_error, editable: true });
    }
  }

  return {
    text: normalized,
    aiFrame,
    aiStatus: aiFrame ? { used: true, fallback: false, backend: "local" } : { used: false, fallback: false },
    candidates,
    conditions,
    ambiguities,
    defaults,
    validation: validateConditions(conditions),
    fieldDefs: FIELD_DEFS,
    metricRegistry: METRIC_REGISTRY,
    templates: STRATEGY_TEMPLATES,
    conditionLibrary: metricLibraryConditions(),
    conditionKnowledgeCount: CONDITION_KNOWLEDGE.length,
    calculationRegistry: CALCULATION_REGISTRY,
    thresholdPresets: THRESHOLD_PRESETS,
    compliance: "结果仅为条件筛选与数据解释，不构成买卖建议、收益承诺或确定性涨跌预测。"
  };
}

function mergeAiCandidates(ruleCandidates, hints) {
  const candidates = [...ruleCandidates];
  const library = metricLibraryConditions();

  for (const hint of hints) {
    const base = library.find((condition) => condition.field === hint.metric_id);
    if (!base) continue;
    const candidate = {
      ...base,
      id: `c-${hint.metric_id}-${candidates.length}`,
      selected: false,
      confidence: 0.9,
      reason: hint.meaning || base.reason,
      aiEvidence: hint.evidence
    };
    applyHint(candidate, hint);
    candidate.selected = candidate.availability === "executable" && candidate.operator !== "unknown" && candidate.value !== null && !candidate.requires_confirmation && ["metric", "exclude", "modify", "comparison"].includes(hint.type) && !hint.executionBlocked;
    candidates.push(candidate);
    if (hint.operator === "between" && candidate.value2 !== null) {
      candidates.push({ ...candidate, id: `${candidate.id}-upper`, op: "<=", value: candidate.value2, raw_value: candidate.raw_value2 });
    }
  }

  return candidates;
}

function applyHint(candidate, hint) {
  const opMap = { gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "=", between: ">=" };
  const vague = hint.operator === "unknown" && /显著|合理|偏低|波动小|稳定/.test(hint.evidence || "") && hint.type === "metric";
  const normalized = normalizeThreshold(hint, METRIC_BY_ID[hint.metric_id], { allowPreset: vague, presetValue: candidate.value });
  Object.assign(candidate, normalized);
  candidate.op = opMap[normalized.operator] || (vague ? candidate.op : "=");
  candidate.computation = hint.computation;
  candidate.evidence = hint.evidence;
  const formulaErrors = validateComputation(hint.computation);
  if (formulaErrors.length || hint.relationshipBlocked) {
    candidate.numeric_error = formulaErrors.join("；") || "该关系需要比较对象或计算公式，不能当作单字段阈值";
    candidate.value = null;
    candidate.requires_confirmation = true;
  }
  if (hint.computation && !formulaErrors.length) {
    candidate.availability = hint.computation.operands.every((id) => METRIC_BY_ID[id].availability === "executable") ? "executable" : "missing";
  }
  if (Object.keys(hint.params || {}).length) {
    candidate.requires_confirmation = true;
    candidate.numeric_error ||= "指标参数已保留，需要核验数据窗口与当前执行口径是否一致";
  }
  candidate.params = hint.params || {};
  candidate.relation = hint.type;
  candidate.origin = candidate.value_origin === "user_explicit" ? "ai_explicit" : "ai_proposed";
}

export function validateConditions(input) {
  const errors = [];
  if (!input.length) errors.push("请先确认至少一个筛选条件。");
  const conditions = input.map((condition, index) => ({
    id: String(condition.id || `c-${index}`),
    field: String(condition.field || condition.metric_id || ""),
    metric_id: String(condition.metric_id || condition.field || ""),
    params: condition.params || {},
    op: String(condition.op || ""),
    value: condition.value === null || condition.value === undefined || condition.value === "" ? NaN : Number(condition.value),
    unit: String(condition.unit ?? FIELD_DEFS[condition.field || condition.metric_id]?.unit ?? ""),
    value_origin: condition.value_origin || "user_explicit",
    evidence: condition.evidence || condition.aiEvidence || "",
    raw_value: condition.raw_value ?? null,
    threshold_reason: String(condition.threshold_reason || ""),
    requires_confirmation: condition.requires_confirmation === true,
    numeric_error: condition.numeric_error || null,
    computation: condition.computation || null,
    group: String(condition.group || FIELD_DEFS[condition.field]?.label || "自定义"),
    origin: String(condition.origin || "user_confirmed"),
    availability: String(condition.availability || FIELD_DEFS[condition.field]?.availability || "missing")
  }));

  for (const condition of conditions) {
    if (!FIELD_DEFS[condition.field]) errors.push(`未知字段：${condition.field}`);
    if (!OPERATORS.includes(condition.op)) errors.push(`字段 ${condition.field} 的操作符无效：${condition.op}`);
    if (!Number.isFinite(condition.value)) errors.push(`字段 ${condition.field} 的阈值必须是数字`);
    if (condition.requires_confirmation) errors.push(`字段 ${condition.field} 的数值或口径尚未确认`);
    if (condition.numeric_error && condition.value_origin !== "product_preset") errors.push(condition.numeric_error);
    errors.push(...validateComputation(condition.computation));
    if (condition.computation && condition.unit !== condition.computation.unit) errors.push("公式阈值与计算结果单位不一致");
    if (Object.keys(condition.params).length) errors.push(`字段 ${condition.field} 的自定义参数尚未接入执行，不能按默认口径筛选`);
    if (!condition.computation && FIELD_DEFS[condition.field] && condition.unit !== FIELD_DEFS[condition.field].unit) errors.push(`字段 ${condition.field} 的阈值单位不一致`);
  }

  if (conditions.some((c) => c.field === "peTtm" && c.op.includes("<") && c.value <= 0)) {
    errors.push("估值条件要求 PE 小于等于 0，通常会排除所有正常盈利公司。");
  }
  const impossibleReturnRange = conditions.some((a) =>
    a.field === "return60d" && a.op.includes(">") &&
    conditions.some((b) => b.field === "return60d" && b.op.includes("<") && a.value > b.value)
  );
  if (impossibleReturnRange) errors.push("近 60 日涨跌幅上下限冲突，请调整阈值。");
  for (const field of new Set(conditions.map((condition) => condition.field))) {
    const bounds = conditions.filter((condition) => condition.field === field && !condition.computation);
    const lower = bounds.filter((condition) => [">", ">=", "="].includes(condition.op));
    const upper = bounds.filter((condition) => ["<", "<=", "="].includes(condition.op));
    if (lower.some((a) => upper.some((b) => a.value > b.value || (a.value === b.value && (a.op === ">" || b.op === "<"))))) {
      errors.push(`${FIELD_DEFS[field]?.label || field} 上下限冲突，请调整阈值。`);
    }
  }

  return { ok: errors.length === 0, errors, conditions };
}
