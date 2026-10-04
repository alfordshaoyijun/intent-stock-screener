import { METRIC_BY_ID } from "./metricRegistry.js";

export const CALCULATION_REGISTRY = {
  difference: { name: "差值", inputs: 2, definition: "左值减右值" },
  ratio: { name: "比值", inputs: 2, definition: "左值除以右值；分母为零时无法判断" },
  percent_change: { name: "相对变化率", inputs: 2, definition: "(本期值 - 基期值) / 基期值 * 100；基期必须为正" }
};

export function validateComputation(computation) {
  if (!computation) return [];
  const errors = [];
  const rule = CALCULATION_REGISTRY[computation.kind];
  if (!rule) return ["计算关系暂不支持，不能替换成单字段阈值"];
  if (!Array.isArray(computation.operands) || computation.operands.length !== rule.inputs || computation.operands.some((id) => !METRIC_BY_ID[id])) return ["计算需要两个已注册指标作为操作数"];
  const units = computation.operands.map((id) => METRIC_BY_ID[id].unit);
  const currency = (unit) => ["元", "万元", "亿元"].includes(unit);
  if (units[0] !== units[1] && !(currency(units[0]) && currency(units[1]))) errors.push("计算操作数的单位不兼容");
  const expected = computation.kind === "difference" ? (units[0] === "%" ? "pp" : units[0]) : computation.kind === "percent_change" ? "%" : ["%", "倍"].includes(computation.unit) ? computation.unit : "倍";
  if (computation.unit !== expected) errors.push(`计算结果单位应为 ${expected}`);
  return errors;
}

export function calculate(computation, values) {
  if (validateComputation(computation).length) return null;
  const [aId, bId] = computation.operands;
  let a = values[aId];
  let b = values[bId];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const scale = { 元: 1, 万元: 1e4, 亿元: 1e8 };
  const aUnit = METRIC_BY_ID[aId].unit;
  const bUnit = METRIC_BY_ID[bId].unit;
  if (scale[aUnit] && scale[bUnit]) b *= scale[bUnit] / scale[aUnit];
  let result;
  if (computation.kind === "difference") result = a - b;
  else if (computation.kind === "ratio") result = b === 0 ? null : a / b * (computation.unit === "%" ? 100 : 1);
  else result = b <= 0 ? null : (a - b) / b * 100;
  return Number.isFinite(result) ? result : null;
}
