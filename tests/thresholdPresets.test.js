import test from "node:test";
import assert from "node:assert/strict";
import { parseIntent, validateConditions } from "../src/intent.js";

test("autofill presets disclose origin and reason and require explicit confirmation", () => {
  const context = parseIntent("");
  const preset = context.thresholdPresets.find((p) => p.field === "peTtm");
  assert.equal(preset.value, 25);
  assert.match(preset.reason, /产品建议/);
  assert.match(preset.reason, /跨行业/);
  const condition = { ...preset, threshold_reason: preset.reason, origin: "ai_proposed", requires_confirmation: true };
  assert.equal(validateConditions([condition]).ok, false);
  const confirmed = validateConditions([{ ...condition, requires_confirmation: false, origin: "user_confirmed" }]);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.conditions[0].threshold_reason, preset.reason);
  assert.equal(confirmed.conditions[0].value_origin, "product_preset");
  const main = context.thresholdPresets.find((p) => p.field === "mainNetInflow");
  const large = context.thresholdPresets.find((p) => p.field === "largeOrderNetInflow");
  assert.equal(main.value, 3000);
  assert.equal(large.value, 1000);
  assert.equal(main.unit, "万元");
  assert.match(main.reason, /缺少已核验数据/);
  assert.equal(context.fieldDefs.mainNetInflow.availability, "missing");
});
