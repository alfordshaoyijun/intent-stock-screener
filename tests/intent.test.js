import test from "node:test";
import assert from "node:assert/strict";
import { parseIntent, parseIntentWithAi, validateConditions } from "../src/intent.js";
import { parseMarkdownTables } from "../src/screener.js";

test("parseIntent turns vague request into editable backed conditions", () => {
  const parsed = parseIntent("找一些经营改善、估值不过高、走势比较稳定的股票。");
  assert.equal(parsed.conditions.length, 0);
  assert.ok(parsed.candidates.every((condition) => condition.value_origin === "product_preset" && condition.requires_confirmation));
  assert.equal(parsed.candidates.length, 9);
  assert.equal(parsed.metricRegistry.length, 83);
  assert.ok(parsed.candidates.some((condition) => condition.field === "operatingCashflowYoy" && condition.selected === false));
  assert.equal(parsed.ambiguities.length, 3);
  assert.match(parsed.compliance, /不构成买卖建议/);
});

test("validateConditions catches impossible valuation threshold", () => {
  const validation = validateConditions([{ field: "peTtm", op: "<=", value: 0 }]);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /PE/);
});

test("parseIntentWithAi uses structured metric hints without skipping registry checks", async () => {
  const parsed = await parseIntentWithAi("ROE大于15，负债率低于60。", {
    backend: fakeBackend({
      strategy: "盈利质量和财务风险筛选",
      intents: [
        { type: "metric", meaning: "ROE 大于 15%", evidence: "ROE大于15", metric_ids: ["roe"], operator: "gt", value: 15, value2: null, unit: "%" },
        { type: "metric", meaning: "资产负债率低于 60%", evidence: "负债率低于60", metric_ids: ["debtAssetRatio"], operator: "lt", value: 60, value2: null, unit: "%" }
      ],
      clarifications: [],
      unsupported: []
    })
  });

  assert.equal(parsed.aiStatus.used, true);
  assert.deepEqual(parsed.conditions.map((condition) => condition.field), ["roe", "debtAssetRatio"]);
  assert.equal(parsed.conditions.find((condition) => condition.field === "roe").value, 15);
  assert.equal(parsed.conditions.find((condition) => condition.field === "debtAssetRatio").op, "<");
});

test("parseIntentWithAi preserves unsupported intent instead of substituting a nearby metric", async () => {
  const parsed = await parseIntentWithAi("PEG小于1。", {
    backend: fakeBackend({
      strategy: "PEG 估值筛选",
      intents: [
        { type: "unsupported", meaning: "PEG 小于 1", evidence: "PEG小于1", metric_ids: [], operator: "lt", value: 1, value2: null, unit: "" }
      ],
      clarifications: [],
      unsupported: [{ meaning: "PEG 小于 1", evidence: "PEG小于1" }]
    })
  });

  assert.equal(parsed.aiStatus.used, true);
  assert.equal(parsed.conditions.some((condition) => condition.field === "peTtm"), false);
  assert.ok(parsed.ambiguities.some((item) => /PEG/.test(item.decision)));
});

test("parseMarkdownTables extracts iFinD markdown table rows", () => {
  const tables = parseMarkdownTables("|证券代码|证券简称|市盈率(PE,TTM)|\n|---|---|---|\n|TEST001|构造样例|24.5|");
  assert.equal(tables.length, 1);
  assert.equal(tables[0][0]["证券代码"], "TEST001");
  assert.equal(tables[0][0]["市盈率(PE,TTM)"], "24.5");
});

function fakeBackend(data) {
  return {
    name: "fake",
    async complete() {
      return JSON.stringify(data);
    }
  };
}

test("AI preserves both bounds and reports PE conflict", async () => {
  const parsed = await parseIntentWithAi("PE小于10且大于30", { backend: fakeBackend({ intents: [
    { type: "metric", metric_ids: ["peTtm"], operator: "lt", value: 10, evidence: "PE小于10" },
    { type: "metric", metric_ids: ["peTtm"], operator: "gt", value: 30, evidence: "且大于30" }
  ] }) });
  assert.deepEqual(parsed.conditions.map((item) => [item.op, item.value]), [["<", 10], [">", 30]]);
  assert.equal(parsed.validation.ok, false);
});

test("AI modification threshold is not overwritten by old text", async () => {
  const parsed = await parseIntentWithAi("PE从低于20改成低于30", { backend: fakeBackend({ intents: [
    { type: "modify", metric_ids: ["peTtm"], operator: "lt", value: 30, evidence: "PE从低于20改成低于30" }
  ] }) });
  assert.equal(parsed.conditions.length, 1);
  assert.equal(parsed.conditions[0].value, 30);
});

test("AI range keeps upper bound and vague preference remains a candidate", async () => {
  const parsed = await parseIntentWithAi("股价5到20，估值便宜", { backend: fakeBackend({ intents: [
    { type: "metric", metric_ids: ["latestPrice"], operator: "between", value: 5, value2: 20, evidence: "股价5到20" },
    { type: "metric", metric_ids: ["peTtm"], operator: "unknown", value: null, evidence: "估值便宜" }
  ] }) });
  assert.deepEqual(parsed.conditions.map((item) => [item.field, item.op, item.value]), [["latestPrice", ">=", 5], ["latestPrice", "<=", 20]]);
  assert.ok(parsed.candidates.some((item) => item.field === "peTtm" && !item.selected));
});

test("OR and historical requirements do not silently execute as current AND", async () => {
  for (const type of ["logic", "time"]) {
    const parsed = await parseIntentWithAi("历史时点或条件", { backend: fakeBackend({ intents: [
      { type: "metric", metric_ids: ["peTtm"], operator: "lt", value: 10, evidence: "PE小于10" },
      { type, meaning: type === "logic" ? "OR" : "2020-01-01", evidence: "历史时点或条件" }
    ] }) });
    assert.equal(parsed.conditions.length, 0);
    assert.equal(parsed.aiFrame.intents[1].type, type);
  }
});

test("strict AI evaluation never falls back to rules", async () => {
  await assert.rejects(parseIntentWithAi("PE小于10", { requireAi: true, backend: { name: "broken", complete() { throw new Error("test failure"); } } }), /test failure/);
});

test("empty AI interpretation never hides keyword rule output behind AI status", async () => {
  const parsed = await parseIntentWithAi("经营改善估值便宜", { requireAi: true, backend: fakeBackend({ intents: [], unsupported: [], clarifications: ["请明确指标"] }) });
  assert.equal(parsed.candidates.length, 0);
  assert.equal(parsed.conditions.length, 0);
  assert.equal(parsed.aiStatus.used, true);
});
