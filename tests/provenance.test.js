import test from "node:test";
import assert from "node:assert/strict";
import { fieldProvenance, providerDate } from "../src/provenance.js";
import { explain } from "../src/screener.js";

test("dates are validated and never inferred from fetch time", () => {
  assert.equal(providerDate("20260630"), "2026-06-30");
  assert.equal(providerDate("20260230"), null);
  const p = fieldProvenance("revenueGrowth", {}, { fetchedAt: "2026-10-04T00:00:00Z" });
  assert.equal(p.reportPeriod, null);
  assert.equal(p.observedAt, null);
  assert.equal(p.publishedAt, null);
  const reported = fieldProvenance("revenueGrowth", { 报告期: "20260630", 公告日期: "20260828", time: "2026-09-30 16:01:17" });
  assert.equal(reported.reportPeriod, "2026-06-30");
  assert.equal(reported.publishedAt, "2026-08-28");
  assert.equal(reported.observedAt, "2026-09-30 16:01:17");
});

test("missing values remain unknown and explanation carries definition and provenance", () => {
  const output = explain({ values: {}, fetchedAt: "2026-10-04T00:00:00Z" }, [{ field: "peTtm", op: "<", value: 25 }]);
  assert.equal(output.status, "unknown");
  assert.ok(output.checks[0].definition);
  assert.equal(output.checks[0].provenance[0].observedAt, null);
  assert.equal(output.checks[0].provenance[0].fetchedAt, "2026-10-04T00:00:00Z");
});
