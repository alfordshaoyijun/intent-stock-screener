import fs from "node:fs";
import path from "node:path";
import { parseIntent, parseIntentWithAi } from "../src/intent.js";

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.resolve("test_conditions.json");
const mode = process.argv.includes("--rules") ? "rules" : "ai";
const idsArg = process.argv.find((arg) => arg.startsWith("--ids="));
const ids = idsArg ? new Set(idsArg.slice(6).split(",")) : null;
const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="));
const concurrency = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 1;
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) throw new Error("Concurrency must be an integer between 1 and 6.");

if (!inputPath) {
  console.error("Usage: node scripts/export-test-conditions.mjs <input.jsonl> [output.json]");
  process.exit(1);
}

const inputText = fs.readFileSync(inputPath, "utf8");
const document = path.extname(inputPath).toLowerCase() === ".json" ? JSON.parse(inputText) : null;
const lines = document ? [] : inputText.split(/\r?\n/).filter(Boolean);
const cases = document ? (Array.isArray(document) ? document : document.cases) : lines.map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
  }
});
if (!Array.isArray(cases)) throw new Error("JSON input must be an array or contain a cases array.");

const selectedCases = cases.filter((item) => !ids || ids.has(item.id));
const results = process.argv.includes("--resume") && fs.existsSync(`${outputPath}.partial`)
  ? JSON.parse(fs.readFileSync(`${outputPath}.partial`, "utf8")).results.filter((item) => item.status === "ok" && item.parser === mode && selectedCases.some((input) => input.id === item.id && input.query === item.query && JSON.stringify(input.context || {}) === JSON.stringify(item.context || {})))
  : [];
const pending = selectedCases.filter((item) => !results.some((result) => result.id === item.id));
let nextIndex = 0;
async function parseCase(item) {
  console.error(`Parsing ${item.id} (${mode})`);
  let parsed;
  try {
    parsed = mode === "rules" ? parseIntent(item.query || "") : await parseIntentWithAi(item.query || "", { requireAi: true, context: item.context || {} });
  } catch (error) {
    results.push({ id: item.id, query: item.query, context: item.context || {}, status: "error", parser: mode, error: error.message });
    fs.writeFileSync(`${outputPath}.partial`, JSON.stringify({ results }, null, 2), "utf8");
    return;
  }
  const candidates = parsed.candidates.map((condition) => ({
    metric_id: condition.metric_id || condition.field,
    field: condition.field,
    label: parsed.fieldDefs[condition.field]?.label || condition.field,
    group: condition.group,
    operator: condition.op,
    value: condition.value,
    availability: condition.availability,
    selected_by_default: condition.selected,
    reason: condition.reason,
    source: parsed.fieldDefs[condition.field]?.source || "",
    clarification: condition.clarification || "",
    evidence: condition.aiEvidence || "",
    relation: condition.relation || "metric",
    params: condition.params || {},
    unit: condition.unit,
    value_origin: condition.value_origin,
    raw_value: condition.raw_value,
    requires_confirmation: condition.requires_confirmation,
    numeric_error: condition.numeric_error,
    computation: condition.computation
  }));
  const enabled_conditions = parsed.conditions.map((condition) => ({
    metric_id: condition.metric_id || condition.field,
    field: condition.field,
    label: parsed.fieldDefs[condition.field]?.label || condition.field,
    group: condition.group,
    operator: condition.op,
    value: condition.value,
    availability: condition.availability,
    unit: condition.unit,
    value_origin: condition.value_origin,
    raw_value: condition.raw_value,
    evidence: condition.evidence,
    computation: condition.computation,
    source: parsed.fieldDefs[condition.field]?.source || ""
  }));
  const availability_counts = candidates.reduce((acc, condition) => {
    acc[condition.availability] = (acc[condition.availability] || 0) + 1;
    return acc;
  }, {});

  results.push({
    id: item.id,
    category: item.category,
    persona: item.persona,
    query: item.query,
    context: item.context || {},
    status: "ok",
    parser: mode,
    ai_status: parsed.aiStatus,
    structured_intent: parsed.aiFrame,
    validation: parsed.validation,
    enabled_count: enabled_conditions.length,
    candidate_count: candidates.length,
    availability_counts,
    ambiguities: parsed.ambiguities,
    enabled_conditions,
    candidates,
    compliance: parsed.compliance
  });
  fs.writeFileSync(`${outputPath}.partial`, JSON.stringify({ results }, null, 2), "utf8");
}
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (nextIndex < pending.length) {
    const item = pending[nextIndex++];
    await parseCase(item);
  }
}));
const order = new Map(selectedCases.map((item, index) => [item.id, index]));
results.sort((a, b) => order.get(a.id) - order.get(b.id));

const successful = results.filter((item) => item.status === "ok");

const summary = {
  generated_at: new Date().toISOString(),
  input_file: path.resolve(inputPath),
  total_cases: results.length,
  parser: mode,
  concurrency,
  failed_cases: results.length - successful.length,
  ai_used_cases: successful.filter((item) => item.ai_status.used).length,
  quality_note: "Output counts are not accuracy. Review metric identity, unwanted additions, relations and clarifications separately.",
  cases_with_enabled_conditions: successful.filter((item) => item.enabled_count > 0).length,
  cases_without_candidates: successful.filter((item) => item.candidate_count === 0).length,
  enabled_condition_total: successful.reduce((sum, item) => sum + item.enabled_count, 0),
  candidate_total: successful.reduce((sum, item) => sum + item.candidate_count, 0),
  candidate_availability_counts: successful.reduce((acc, item) => {
    for (const [key, value] of Object.entries(item.availability_counts)) {
      acc[key] = (acc[key] || 0) + value;
    }
    return acc;
  }, {})
};

fs.writeFileSync(outputPath, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));
if (summary.failed_cases) process.exitCode = 1;
