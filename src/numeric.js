const DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const SMALL = { 十: 10, 百: 100, 千: 1000 };
const NUMBER = "[+-]?(?:[0-9]+(?:\\.[0-9]+)?|[零〇一二两三四五六七八九十百千万亿点]+)(?:[万亿])?";
const QUANTITY = `(?:百分之|千分之)?${NUMBER}(?:个百分点|百分比|亿元|万元|元|CNY|%|％|成|倍|年|天|日|股|家|名)?`;
const UNITS = { 元: ["CNY", 1], CNY: ["CNY", 1], 万元: ["CNY", 1e4], 亿元: ["CNY", 1e8], "%": ["%", 1], 百分比: ["%", 1], 个百分点: ["pp", 1], pp: ["pp", 1], 成: ["%", 10], 倍: ["ratio", 1], x: ["ratio", 1], 年: ["year", 1], 天: ["day", 1], 日: ["day", 1], 股: ["share", 1], 家: ["count", 1], 名: ["rank", 1] };

export function parseChineseNumber(input) {
  const text = String(input).replace(/,/g, "").trim();
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const scaled = text.match(/^([+-]?\d+(?:\.\d+)?)(万|亿)$/);
  if (scaled) return Number(scaled[1]) * (scaled[2] === "万" ? 1e4 : 1e8);
  if (text.startsWith("负")) {
    const number = parseChineseNumber(text.slice(1));
    return number === null ? null : -number;
  }
  if (text.includes("点") && /[万亿]$/.test(text)) {
    const number = parseChineseNumber(text.slice(0, -1));
    return number === null ? null : number * (text.endsWith("万") ? 1e4 : 1e8);
  }
  if (text.includes("点")) {
    const parts = text.split("点");
    if (parts.length !== 2 || !parts[1] || ![...parts[1]].every((char) => char in DIGITS)) return null;
    const whole = parseChineseNumber(parts[0]);
    return whole === null ? null : whole + Number(`0.${[...parts[1]].map((char) => DIGITS[char]).join("")}`);
  }
  if (!text || ![...text].every((char) => char in DIGITS || char in SMALL || "万亿".includes(char))) return null;
  if ([...text].every((char) => char in DIGITS)) return Number([...text].map((char) => DIGITS[char]).join(""));
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const char of text) {
    if (char in DIGITS) digit = DIGITS[char];
    else if (char in SMALL) { section += (digit || 1) * SMALL[char]; digit = 0; }
    else if (char === "万") { section = (section + digit) * 1e4; digit = 0; }
    else { total = (total + section + digit) * 1e8; section = 0; digit = 0; }
  }
  return total + section + digit;
}

export function parseQuantity(raw, targetUnit = "", sourceUnit = "") {
  if (raw === null || raw === undefined || raw === "") return { value: null, unit: targetUnit, raw, error: "缺少明确数值" };
  let text = String(raw).trim().replace(/％/g, "%").replace(/,/g, "");
  let unit = sourceUnit;
  let factor = 1;
  if (/^(百分之|千分之)/.test(text)) {
    factor = text.startsWith("千分之") ? 0.1 : 1;
    text = text.replace(/^(百分之|千分之)/, "");
    unit = "%";
  } else {
    const suffix = Object.keys(UNITS).sort((a, b) => b.length - a.length).find((key) => text.endsWith(key));
    if (suffix) { unit = suffix; text = text.slice(0, -suffix.length); }
  }
  const number = parseChineseNumber(text);
  if (number === null || !Number.isFinite(number)) return { value: null, unit: targetUnit, raw, error: "数值格式无法确定" };
  // Magnitude words without a currency suffix still denote base yuan for monetary fields.
  if (/[万亿]$/.test(text) && ["元", "万元", "亿元", "CNY"].includes(targetUnit)) unit = "元";
  const source = UNITS[unit] || [unit || targetUnit, 1];
  const target = UNITS[targetUnit] || [targetUnit === "" && source[0] === "ratio" ? "ratio" : targetUnit, 1];
  if (!unit) return { value: number * factor, unit: targetUnit, raw, error: null };
  if (source[0] !== target[0]) return { value: null, unit: targetUnit, raw, error: `单位 ${unit} 不能直接换算为 ${targetUnit || "无单位"}` };
  return { value: number * factor * source[1] / target[1], unit: targetUnit, raw, error: null };
}

export function extractThreshold(intent) {
  const evidence = String(intent.evidence || "");
  const range = evidence.match(new RegExp(`(${QUANTITY})\\s*(?:到|至|~|～)\\s*(${QUANTITY})`));
  if (intent.operator === "between" && range) {
    const suffix = range[2].match(/(亿元|万元|元|%|％|成|倍|年|天|日)$/)?.[1];
    const firstHasUnit = /(元|%|％|成|倍|年|天|日)$/.test(range[1]);
    return { raw: firstHasUnit || !suffix ? range[1] : `${range[1]}${suffix}`, raw2: range[2], operator: "between" };
  }
  const matches = [...evidence.matchAll(new RegExp(`(不超过|不低于|不少于|不高于|至少|至多|大于等于|小于等于|超过|大于|高于|低于|小于|等于|>=|<=|>|<|≥|≤|=)\\s*(${QUANTITY})`, "g"))];
  const match = intent.type === "modify" ? matches.at(-1) : matches[0];
  const operators = { 不超过: "lte", 不高于: "lte", 至多: "lte", 小于等于: "lte", "<=": "lte", "≤": "lte", 至少: "gte", 不低于: "gte", 不少于: "gte", 大于等于: "gte", ">=": "gte", "≥": "gte", 超过: "gt", 大于: "gt", 高于: "gt", ">": "gt", 低于: "lt", 小于: "lt", "<": "lt", 等于: "eq", "=": "eq" };
  return match ? { raw: match[2], operator: operators[match[1]] } : null;
}

export function normalizeThreshold(intent, metric, { allowPreset = false, presetValue = null } = {}) {
  const extracted = extractThreshold(intent);
  const raw = intent.value_text || extracted?.raw;
  const raw2 = intent.value2_text || extracted?.raw2;
  const unit = intent.computation?.unit || metric.unit;
  const ambiguous = /两个百分比|[一二两三四五六七八九\d]+个百分比/.test(intent.evidence || "");
  let quantity;
  if (raw) {
    if (intent.value_text && !String(intent.evidence).includes(intent.value_text)) quantity = { value: null, error: "数字原文不在证据片段中" };
    else quantity = parseQuantity(raw, unit, intent.unit);
  } else if (intent.value !== null && intent.value !== undefined && (String(intent.evidence || "").includes(String(intent.value)) || metric.unit === "" && [0, 1].includes(intent.value))) {
    quantity = parseQuantity(intent.value, unit, intent.unit);
  } else quantity = { value: null, error: "没有用户明确数值，请确认阈值" };
  let origin = "user_explicit";
  if (quantity.value === null && allowPreset && presetValue !== null) {
    quantity = { value: presetValue, error: "这是产品建议阈值，请确认或修改" };
    origin = "product_preset";
  }
  const upper = intent.value2_text && !String(intent.evidence).includes(intent.value2_text)
    ? { value: null, error: "上界数字原文不在证据片段中" }
    : raw2 ? parseQuantity(raw2, unit, intent.unit) : intent.value2 !== null && intent.value2 !== undefined ? parseQuantity(intent.value2, unit, intent.unit) : null;
  const error = ambiguous ? "请确认是百分点差，还是相对百分比变化，以及比较对象" : quantity.error || upper?.error || (intent.operator === "between" && !upper ? "区间缺少上界，请确认" : null);
  return {
    operator: extracted?.operator || intent.operator,
    value: quantity.value,
    value2: upper?.value ?? null,
    unit,
    value_origin: quantity.value === null ? null : origin,
    raw_value: raw || null,
    raw_value2: raw2 || null,
    requires_confirmation: Boolean(error || intent.requires_confirmation),
    numeric_error: error
  };
}
