import test from "node:test";
import assert from "node:assert/strict";
import { parseChineseNumber, parseQuantity, normalizeThreshold } from "../src/numeric.js";
import { calculate } from "../src/calculations.js";
import { METRIC_BY_ID } from "../src/metricRegistry.js";
import { parseIntentWithAi, validateConditions } from "../src/intent.js";
import { explain } from "../src/screener.js";

const backend = (intents) => ({ name: "test", complete: async () => JSON.stringify({ intents }) });

test("Chinese quantities normalize money, fractions and multipliers", () => {
  assert.equal(parseChineseNumber("五千万"), 50000000);
  assert.equal(parseChineseNumber("一亿五千万"), 150000000);
  assert.equal(parseChineseNumber("三点五万"), 35000);
  assert.equal(parseQuantity("五千万", "万元").value, 5000);
  assert.equal(parseQuantity("五千万", "亿元", "亿元").value, 0.5);
  assert.equal(parseQuantity("50000000元", "亿元").value, 0.5);
  assert.equal(parseQuantity("三成", "%").value, 30);
  assert.equal(parseQuantity("百分之三点五", "%").value, 3.5);
  assert.equal(parseQuantity("千分之八", "%").value, 0.8);
  assert.equal(parseQuantity("1.6倍", "").value, 1.6);
  assert.equal(parseQuantity("两个百分点", "pp").value, 2);
  assert.equal(parseQuantity("两个百分点", "%").value, null);
  assert.equal(parseQuantity("五年", "天").value, null);
});

test("program corrects model arithmetic and comparison boundary from evidence", async () => {
  const parsed = await parseIntentWithAi("成交额超过五千万，负债率不超过三成，量比至少1.6倍", { backend: backend([
    { type: "metric", metric_ids: ["amountBillion"], operator: "gte", value: 5000, evidence: "成交额超过五千万", value_text: "五千万" },
    { type: "metric", metric_ids: ["debtAssetRatio"], operator: "lte", value: 0.3, evidence: "负债率不超过三成", value_text: "三成" },
    { type: "metric", metric_ids: ["volumeRatio"], operator: "gt", value: 1.6, evidence: "量比至少1.6倍", value_text: "1.6倍" }
  ]) });
  assert.deepEqual(parsed.conditions.map((c) => [c.field, c.op, c.value]), [["amountBillion", ">", 0.5], ["debtAssetRatio", "<=", 30], ["volumeRatio", ">=", 1.6]]);
  assert.ok(parsed.conditions.every((c) => c.value_origin === "user_explicit"));
});

test("range propagates shared money unit to both bounds", () => {
  const result = normalizeThreshold({ evidence: "总市值50到200亿元", operator: "between", value: null, value2: null }, METRIC_BY_ID.marketCapBillion);
  assert.equal(result.value, 50);
  assert.equal(result.value2, 200);
});

test("vague presets wait for confirmation and missing comparisons stay null", async () => {
  const parsed = await parseIntentWithAi("估值合理，PB低于行业中位数", { backend: backend([
    { type: "metric", metric_ids: ["peTtm"], operator: "unknown", value: null, evidence: "估值合理" },
    { type: "comparison", metric_ids: ["pb"], operator: "lt", value: null, evidence: "PB低于行业中位数" }
  ]) });
  assert.equal(parsed.conditions.length, 0);
  assert.equal(parsed.candidates[0].value_origin, "product_preset");
  assert.equal(parsed.candidates[0].requires_confirmation, true);
  assert.equal(parsed.candidates[1].value, null);
  assert.equal(validateConditions([parsed.candidates[0]]).ok, false);
  assert.equal(validateConditions([{ field: "pb", op: "<", value: null }]).ok, false);
  assert.equal(validateConditions([]).ok, false);
});

test("formula remains one condition and converts money operand units", async () => {
  const computation = { kind: "ratio", operands: ["largeOrderNetInflow", "amountBillion"], unit: "%" };
  const parsed = await parseIntentWithAi("大单净流入占成交额超过百分之三", { backend: backend([
    { type: "comparison", metric_ids: computation.operands, computation, operator: "gt", value_text: "百分之三", evidence: "大单净流入占成交额超过百分之三" }
  ]) });
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].value, 3);
  assert.equal(parsed.candidates[0].availability, "missing");
  assert.equal(calculate(computation, { largeOrderNetInflow: 600, amountBillion: 1 }), 6);
  assert.equal(calculate(computation, { largeOrderNetInflow: 600, amountBillion: 0 }), null);
  assert.equal(calculate(computation, {}), null);
});

test("percentage point difference and relative percent change are distinct", () => {
  const values = { intradayChangePct: 7, sectorChangePct: 5 };
  assert.equal(calculate({ kind: "difference", operands: Object.keys(values), unit: "pp" }, values), 2);
  assert.equal(calculate({ kind: "percent_change", operands: Object.keys(values), unit: "%" }, values), 40);
  assert.equal(calculate({ kind: "percent_change", operands: Object.keys(values), unit: "%" }, { intradayChangePct: 7, sectorChangePct: 0 }), null);
});

test("formula explanation cites both sources and missing input remains unknown", () => {
  const condition = { field: "intradayChangePct", op: ">=", value: 2, unit: "pp", computation: { kind: "difference", operands: ["intradayChangePct", "sectorChangePct"], unit: "pp" } };
  const stock = { values: { intradayChangePct: 7, sectorChangePct: 5 } };
  const result = explain(stock, [condition]);
  assert.equal(result.status, "selected");
  assert.equal(result.checks[0].actual, 2);
  assert.match(result.checks[0].source, /板块行情/);
  assert.equal(explain({ values: {} }, [condition]).status, "unknown");
});

test("unsupported calendar conversion and ambiguous percent phrasing need confirmation", () => {
  const age = normalizeThreshold({ evidence: "上市至少五年", operator: "gte", value_text: "五年" }, METRIC_BY_ID.listingAgeDays);
  assert.equal(age.value, null);
  assert.equal(age.requires_confirmation, true);
  const percent = normalizeThreshold({ evidence: "涨幅多两个百分比", operator: "gte", value: 2 }, METRIC_BY_ID.intradayChangePct);
  assert.equal(percent.requires_confirmation, true);
});
