import { FIELD_DEFS } from "./metricRegistry.js";

export function providerDate(value) {
  const match = String(value || "").match(/^(\d{4})[-年/]?(\d{2})[-月/]?(\d{2})(?:日)?(?:[ T].*)?$/);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function dateCell(row, keys) {
  const key = Object.keys(row).find((header) => keys.includes(header));
  const raw = key ? String(row[key]) : "";
  return providerDate(raw) ? raw : null;
}

export function fieldProvenance(field, row = {}, source = {}) {
  const reportPeriod = dateCell(row, ["报告期", "财报报告期", "报告日期", "定期报告最新报告期"]);
  const publishedAt = dateCell(row, ["公告日期", "财报公告日期", "披露日期", "发布日期", "定期报告实际披露日期"]);
  const observedAt = dateCell(row, ["time", "行情时间", "行情日期", "交易日期", "时间", "日期"]);
  return {
    definition: FIELD_DEFS[field]?.help || "原始接口字段",
    unit: FIELD_DEFS[field]?.unit || "",
    source: FIELD_DEFS[field]?.source || source.tool || "iFinD",
    reportPeriod: reportPeriod ? providerDate(reportPeriod) : null,
    publishedAt: publishedAt ? providerDate(publishedAt) : null,
    observedAt,
    fetchedAt: source.fetchedAt || null,
    query: source.query || "",
    parameters: source.params || {},
    rawDateFields: Object.fromEntries(Object.entries(row).filter(([key]) => /日期|报告期|时间|^time$/.test(key))),
    unknownPolicy: "接口未返回的日期标为未知，不用取数日期代替",
    window: /近60日/.test(source.query || "") ? "接口近60日；是否按交易日及具体起止日以接口参数为准" : null
  };
}
