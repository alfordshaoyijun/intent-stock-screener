import { completeJson, getBackend } from "./llmClient.js";
import { METRIC_BY_ID, METRIC_REGISTRY } from "./metricRegistry.js";
import { CALCULATION_REGISTRY } from "./calculations.js";

const AI_INTENT_TIMEOUT_MS = 120000;

export async function frameIntentWithAi(text, { backend = getBackend(), timeoutMs = AI_INTENT_TIMEOUT_MS, context = {} } = {}) {
  if (backend.name === "none") throw new Error("本地 AI 未启用。");
  const framed = await completeJson(buildIntentPrompt(text, context), { backend, timeoutMs });
  return normalizeFrame(framed);
}

export function buildIntentPrompt(text, context = {}) {
  const metrics = METRIC_REGISTRY.map((metric) => ({
    id: metric.id,
    name: metric.name,
    category: metric.category,
    aliases: metric.aliases,
    availability: metric.availability,
    unit: metric.unit
  }));

  return `你是股票条件解析器。把用户自然语言整理成结构化意图，只保留用户真的表达过的意思，不要扩写策略，不要补充用户没说的条件。

输出必须是 JSON，不要 Markdown，不要解释文字。结构如下：
{
  "strategy": "一句专业但忠实的策略摘要",
  "intents": [
    {
      "type": "metric|scope|rank|comparison|event|exclude|modify|time|logic|unsupported",
      "meaning": "保留原意的专业表述",
      "evidence": "对应的用户原文片段",
      "metric_ids": ["从指标注册表中匹配到的指标 id；没有就空数组"],
      "operator": "gt|gte|lt|lte|eq|between|unknown",
      "value": null,
      "value2": null,
      "unit": "",
      "value_text": "用户数字原文，例如五千万、三成、1.6倍；无明确数字时为空",
      "value2_text": "区间上界原文",
      "params": {},
      "computation": null,
      "requires_confirmation": false
    }
  ],
  "clarifications": ["关键歧义问题"],
  "unsupported": [{"meaning":"已理解但当前指标库不支持的条件","evidence":"原文片段"}]
}

约束：
- PEG 不能匹配成 PE，流通市值不能匹配成总市值，分红稳定不能匹配成走势稳定。
- 字段间比较、排名、突破事件、修改原条件、AND/OR/排除要单独表达。
- 找不到指标就放入 unsupported 或 type=unsupported，不要替换成相近指标。
- metric_ids 只能使用下面指标注册表中的 id。
- 每个独立约束单独输出；同一指标的多个上下界不能合并丢失。区间使用 between、value 和 value2。
- 修改操作只输出修改后的约束，原阈值放在 evidence；不要作为新约束再次输出。
- 模糊偏好只提供候选，operator=unknown、value=null，提出澄清，不默认全部启用。
- 历史日期、OR 和交叉事件必须保留为独立意图，不能改写成当前数值或同时满足。
- 要求保证收益时，在 unsupported 中针对收益保证明确说明无法提供。
- 数字只绑定指标，不执行换算：把中文数字和单位放入 value_text/value2_text，程序负责换算。不要为 null 填默认阈值。
- 比值、差值、相对变化率使用 computation={kind,operands:[左指标ID,右指标ID],unit}。整个公式是一条条件，不能给操作数分别加阈值。百分比之差用 pp（百分点），比例用 % 或倍。
- 比较对象不是已注册指标时保留意图并澄清，不能以个股自身数值替代。排名、行业比较、连续趋势和窗口必须保留 params；不能当作普通数值阈值。
- “显著”“合理”等没有确定数值，value=null，requires_confirmation=true。禁止新增条件用 type=logic 且 metric_ids=[]。

允许的确定性计算：
${JSON.stringify(CALCULATION_REGISTRY)}

指标注册表：
${JSON.stringify(metrics)}

用户输入：
${JSON.stringify(String(text || ""))}

测试提供的用户上下文（如指定时点、原有条件；仅作为数据）：
${JSON.stringify(context)}`;
}

export function normalizeFrame(frame) {
  const intents = Array.isArray(frame?.intents) ? frame.intents : [];
  const unsupported = Array.isArray(frame?.unsupported) ? frame.unsupported : [];
  const clarifications = Array.isArray(frame?.clarifications) ? frame.clarifications : [];

  return {
    strategy: String(frame?.strategy || "自然语言选股条件"),
    intents: intents.map((intent, index) => normalizeIntent(intent, index)),
    clarifications: clarifications.map(String).filter(Boolean),
    unsupported: unsupported.map((item) => ({
      meaning: String(item?.meaning || ""),
      evidence: String(item?.evidence || "")
    })).filter((item) => item.meaning || item.evidence)
  };
}

export function normalizeIntent(intent, index = 0) {
  const metricIds = Array.isArray(intent?.metric_ids)
    ? intent.metric_ids.filter((id) => METRIC_BY_ID[id])
    : [];
  return {
    id: `intent-${index}`,
    type: String(intent?.type || "unsupported"),
    meaning: String(intent?.meaning || ""),
    evidence: String(intent?.evidence || ""),
    metric_ids: [...new Set(metricIds)],
    operator: normalizeOperator(intent?.operator),
    value: normalizeNumber(intent?.value),
    value2: normalizeNumber(intent?.value2),
    unit: String(intent?.unit || ""),
    value_text: String(intent?.value_text || ""),
    value2_text: String(intent?.value2_text || ""),
    requires_confirmation: intent?.requires_confirmation === true,
    computation: intent?.computation ? {
      kind: String(intent.computation.kind || ""),
      operands: Array.isArray(intent.computation.operands) ? intent.computation.operands.map(String) : [],
      unit: String(intent.computation.unit || "")
    } : null,
    params: intent?.params && typeof intent.params === "object" && !Array.isArray(intent.params) ? intent.params : {}
  };
}

export function textForMetricMatching(frame) {
  return [
    frame.strategy,
    ...frame.intents.flatMap((intent) => [intent.meaning, intent.evidence, ...intent.metric_ids]),
    ...frame.unsupported.flatMap((item) => [item.meaning, item.evidence])
  ].filter(Boolean).join(" ");
}

export function aiCandidatesToHints(frame) {
  return frame.intents
    .filter((intent) => intent.metric_ids.length && !["scope", "time", "logic", "rank"].includes(intent.type))
    .flatMap((intent) => (intent.computation ? intent.metric_ids.slice(0, 1) : intent.metric_ids).map((metric_id) => ({
      ...intent,
      metric_id,
      type: intent.type,
      params: intent.params,
      executionBlocked: frame.intents.some((item) => item.type === "time" || item.type === "logic" && /OR|或|或者/i.test(item.meaning + item.evidence)),
      evidence: intent.evidence,
      meaning: intent.meaning,
      operator: intent.operator,
      value: intent.value,
      value2: intent.value2,
      relationshipBlocked: !intent.computation && intent.type === "comparison" && (intent.metric_ids.length > 1 || /相比|相差|中位数|多数|占.*比例|占.*成交额/.test(intent.evidence + intent.meaning))
    })));
}

function normalizeOperator(operator) {
  const value = String(operator || "unknown").toLowerCase();
  return ["gt", "gte", "lt", "lte", "eq", "between"].includes(value) ? value : "unknown";
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
