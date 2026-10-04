import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FIELD_DEFS } from "./intent.js";
import { calculate, CALCULATION_REGISTRY } from "./calculations.js";
import { fieldProvenance, providerDate } from "./provenance.js";

const require = createRequire(import.meta.url);
let financeCall;
async function call(...args) {
  if (!financeCall) {
    const candidates = [
      process.env.IFIND_CALL_MODULE,
      join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills", "ifind-finance-data", "call-node.js"),
      "D:/.codex/skills/ifind-finance-data/call-node.js"
    ].filter(Boolean);
    const modulePath = process.env.IFIND_CALL_MODULE || candidates.find((filename) => existsSync(filename));
    if (!modulePath || !existsSync(modulePath)) throw new Error("iFinD 调用模块不可用，请在服务端配置 IFIND_CALL_MODULE 并安装、配置授权 Skill。");
    financeCall = require(modulePath).call;
    if (typeof financeCall !== "function") throw new Error("iFinD 调用模块必须导出 call 函数。");
  }
  return financeCall(...args);
}

export const POOL = [
  { symbol: "600519.SH", name: "贵州茅台" },
  { symbol: "600036.SH", name: "招商银行" },
  { symbol: "300750.SZ", name: "宁德时代" },
  { symbol: "002594.SZ", name: "比亚迪" },
  { symbol: "002415.SZ", name: "海康威视" },
  { symbol: "600276.SH", name: "恒瑞医药" },
  { symbol: "000333.SZ", name: "美的集团" },
  { symbol: "601318.SH", name: "中国平安" },
  { symbol: "600309.SH", name: "万华化学" },
  { symbol: "300059.SZ", name: "东方财富" }
];

const BATCH_SIZE = 5;
const cache = new Map();
const TTL_MS = 1000 * 60 * 15;
let poolCache = null;

function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function names(items) {
  return items.map((item) => item.name).join("、");
}

function extractAnswer(response) {
  const text = response?.data?.result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return { answer: "", params: {}, raw: response };
  try {
    const parsed = JSON.parse(text);
    return {
      answer: parsed?.data?.answer || "",
      params: parsed?.data?.indicators_params || {},
      raw: parsed
    };
  } catch {
    return { answer: text, params: {}, raw: response };
  }
}

function extractSearchStockPayload(response) {
  const text = response?.data?.result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return { answer: "", selectedSecuritiesCount: 0, dataTotalVolume: 0 };
  try {
    const parsed = JSON.parse(text);
    const data = parsed?.data || {};
    return {
      answer: data.answer || "",
      selectedSecuritiesCount: Number(data.selectedSecuritiesCount || 0),
      dataTotalVolume: Number(data.dataTotalVolume || 0)
    };
  } catch {
    return { answer: text, selectedSecuritiesCount: 0, dataTotalVolume: 0 };
  }
}

function extractRealtimeTable(response) {
  const text = response?.data?.result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const table = parsed?.data?.tables || [];
    const [headers, ...rows] = table;
    if (!headers) return [];
    return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
  } catch {
    return [];
  }
}

export function parseMarkdownTables(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const tables = [];
  let current = [];
  for (const line of lines) {
    if (/^\|.*\|$/.test(line.trim())) {
      current.push(line.trim());
    } else if (current.length) {
      tables.push(current);
      current = [];
    }
  }
  if (current.length) tables.push(current);

  return tables.map((table) => {
    const headers = table[0].split("|").slice(1, -1).map((cell) => cell.trim());
    return table.slice(2).map((line) => {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/\\t|\t/g, ""));
      return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    });
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\ufeff/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      i += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function parseStockRows(rows) {
  const seen = new Set();
  const stocks = [];
  for (const row of rows) {
    const symbol = (row["股票代码"] || row["证券代码"] || "").trim();
    const name = (row["股票简称"] || row["证券简称"] || "").trim();
    if (!/^\d{6}\.(SH|SZ|BJ)$/.test(symbol) || !name || seen.has(symbol)) continue;
    seen.add(symbol);
    stocks.push({ symbol, name });
  }
  return stocks;
}

function csvUrlFromAnswer(answer) {
  return String(answer || "").match(/https?:\/\/[^\s)]+\.csv/)?.[0] || "";
}

async function fetchCsvStocks(answer) {
  const url = csvUrlFromAnswer(answer);
  if (!url) return [];
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载股票池 CSV 失败：${response.status}`);
  return parseStockRows(parseCsv(await response.text()));
}

export async function getPool({ refresh = false } = {}) {
  const limit = Number(process.env.STOCK_POOL_LIMIT || 0);
  if (poolCache && !refresh && Date.now() - poolCache.at < TTL_MS) {
    return limit > 0 ? { ...poolCache.data, pool: poolCache.data.pool.slice(0, limit), limitedTo: limit } : poolCache.data;
  }

  try {
    const response = await call("stock", "search_stocks", {
      query: "全部A股股票，返回股票代码和股票简称"
    });
    if (!response.ok) throw new Error(response.error?.message || "search_stocks failed");
    const payload = extractSearchStockPayload(response);
    const markdownStocks = parseStockRows(parseMarkdownTables(payload.answer).flat());
    const csvStocks = await fetchCsvStocks(payload.answer).catch(() => []);
    const pool = csvStocks.length ? csvStocks : markdownStocks;
    if (!pool.length) throw new Error("search_stocks 未返回可解析的股票池。");

    const data = {
      pool,
      size: pool.length,
      discoveredSize: payload.selectedSecuritiesCount || pool.length,
      source: csvStocks.length
        ? "iFinD MCP search_stocks 全部A股股票池（CSV完整结果）"
        : "iFinD MCP search_stocks 全部A股股票池（接口截断样例）",
      csvUrl: csvUrlFromAnswer(payload.answer),
      fetchedAt: new Date().toISOString(),
      fallback: false
    };
    poolCache = { at: Date.now(), data };
    return limit > 0 ? { ...data, pool: data.pool.slice(0, limit), limitedTo: limit } : data;
  } catch (error) {
    const data = {
      pool: POOL,
      size: POOL.length,
      discoveredSize: POOL.length,
      source: `iFinD 股票池获取失败，回退到本地示范池：${error.message}`,
      csvUrl: "",
      fetchedAt: new Date().toISOString(),
      fallback: true
    };
    poolCache = { at: Date.now(), data };
    return data;
  }
}

function toNumber(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/,/g, "").replace(/%/g, "").trim();
  if (!cleaned || cleaned === "--") return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function toShares(value) {
  if (value == null) return null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text || text === "--") return null;
  const number = Number(text.replace(/[万亿股]/g, ""));
  if (!Number.isFinite(number)) return null;
  if (text.includes("亿")) return number * 100000000;
  if (text.includes("万")) return number * 10000;
  return number;
}

function firstNumber(row, includes) {
  const key = Object.keys(row).find((header) => includes.every((part) => header.includes(part)));
  return key ? toNumber(row[key]) : null;
}

function mergeRows(stocks, rows, mapper) {
  for (const row of rows) {
    const symbol = row["证券代码"];
    const stock = stocks.get(symbol);
    if (!stock) continue;
    Object.assign(stock.values, mapper(row));
  }
}

async function callBatch(tool, query) {
  const response = await call("stock", tool, { query });
  if (!response.ok) throw new Error(response.error?.message || `${tool} failed`);
  return { ...extractAnswer(response), fetchedAt: new Date().toISOString() };
}

async function callRealtime(batch) {
  const response = await call("stock", "stock_highfreq_quotes", {
    symbols: batch.map((item) => item.symbol).join(","),
    indicators: "最新价,涨跌幅,成交量,成交额,换手率,量比,总市值,市净率,市盈率TTM",
    data_mode: "real_time"
  });
  if (!response.ok) throw new Error(response.error?.message || "stock_highfreq_quotes failed");
  return { rows: extractRealtimeTable(response), fetchedAt: new Date().toISOString() };
}

async function fetchBatch(batch) {
  const key = batch.map((item) => item.symbol).join(",");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  const stocks = new Map(batch.map((item) => [item.symbol, {
    ...item,
    values: {},
    fetchedAt: new Date().toISOString(),
    sourceUrl: "https://mcp.51ifind.com",
    sourceName: "iFinD MCP 股票服务"
  }]));

  const subject = names(batch);
  const financialQuery = `${subject}的最新一期营业收入同比增长率、净利润同比增长率`;
  const cashflowGrowthQuery = `${subject}的最新一期经营活动现金流量净额同比增长率、每股收益同比增长率`;
  const qualityQuery = `${subject}的最新一期ROE、毛利率、净利率、资产负债率、流动比率`;
  const valuationQuery = `${subject}的最新市盈率TTM`;
  const performanceQuery = `${subject}近60日涨跌幅、近60日振幅`;
  const volumeMaQuery = `${subject}的5日均线、今日成交量、5日平均成交量`;
  const ma10Query = `${subject}的10日均线`;
  const ma20Query = `${subject}的最新20日均线`;
  const technicalQuery = `${subject}的最新KDJ随机指标K值、MACD指标DIFF值、RSI相对强弱指标6周期`;
  const financials = await callBatch("get_stock_financials", financialQuery);
  const financialDateQuery = `${subject}的定期报告最新报告期、定期报告最新公告日期`;
  let financialDates;
  try { financialDates = await callBatch("get_stock_financials", financialDateQuery); }
  catch (error) { financialDates = { answer: "", params: {}, fetchedAt: new Date().toISOString(), error: error.message }; }
  const cashflowGrowth = await callBatch("get_stock_financials", cashflowGrowthQuery);
  const quality = await callBatch("get_stock_financials", qualityQuery);
  const valuation = await callBatch("get_stock_performance", valuationQuery);
  const performance = await callBatch("get_stock_performance", performanceQuery);
  const volumeMa = await callBatch("get_stock_performance", volumeMaQuery);
  const ma10 = await callBatch("get_stock_performance", ma10Query);
  const ma20 = await callBatch("get_stock_performance", ma20Query);
  const technical = await callBatch("get_stock_performance", technicalQuery);
  const { rows: realtimeRows, fetchedAt: realtimeFetchedAt } = await callRealtime(batch);

  mergeRows(stocks, parseMarkdownTables(financials.answer).flat(), (row) => ({
    revenueGrowth: firstNumber(row, ["营业", "同比增长率"]),
    profitGrowth: firstNumber(row, ["净利润", "同比增长率"])
  }));
  mergeRows(stocks, parseMarkdownTables(cashflowGrowth.answer).flat(), (row) => ({
    operatingCashflowYoy: firstNumber(row, ["经营活动", "同比增长率"]),
    epsYoy: firstNumber(row, ["每股收益", "同比增长率"])
  }));
  mergeRows(stocks, parseMarkdownTables(quality.answer).flat(), (row) => ({
    roe: firstNumber(row, ["ROE"]),
    grossMargin: firstNumber(row, ["毛利率"]),
    netMargin: firstNumber(row, ["净利率"]),
    debtAssetRatio: firstNumber(row, ["资产负债率"]),
    currentRatio: firstNumber(row, ["流动比率"])
  }));
  mergeRows(stocks, parseMarkdownTables(valuation.answer).flat(), (row) => ({
    peTtm: firstNumber(row, ["市盈率"])
  }));
  const performanceTables = parseMarkdownTables(performance.answer);
  mergeRows(stocks, performanceTables[0] || [], (row) => ({
    amplitude60d: firstNumber(row, ["区间振幅"])
  }));
  mergeRows(stocks, performanceTables[1] || [], (row) => ({
    return60d: firstNumber(row, ["N日涨跌幅"])
  }));
  mergeRows(stocks, parseMarkdownTables(volumeMa.answer).flat(), (row) => {
    const ma5 = firstNumber(row, ["MA"]);
    const volume = toShares(row["成交量"]);
    const avg5 = toShares(row["N日日均成交量"]);
    return {
      ma5,
      volumeToAvg5: volume != null && avg5 ? volume / avg5 : null
    };
  });
  mergeRows(stocks, parseMarkdownTables(ma10.answer).flat(), (row) => ({
    ma10: firstNumber(row, ["MA"])
  }));
  mergeRows(stocks, parseMarkdownTables(ma20.answer).flat(), (row) => ({
    ma20: firstNumber(row, ["MA"])
  }));
  mergeRows(stocks, parseMarkdownTables(technical.answer).flat(), (row) => ({
    rsi6: firstNumber(row, ["RSI"]),
    kdjK: firstNumber(row, ["KDJ"]),
    macdDiff: firstNumber(row, ["MACD", "DIFF"])
  }));
  mergeRows(stocks, realtimeRows, (row) => {
    const latestPrice = toNumber(row["最新价"]);
    const amount = toNumber(row["成交额"]);
    const marketCap = toNumber(row["总市值"]);
    const ma5 = stocks.get(row["证券代码"])?.values?.ma5;
    const ma10 = stocks.get(row["证券代码"])?.values?.ma10;
    const ma20 = stocks.get(row["证券代码"])?.values?.ma20;
    return {
      latestPrice,
      intradayChangePct: toNumber(row["涨跌幅"]),
      volume: toNumber(row["成交量"]),
      amountBillion: amount == null ? null : amount / 100000000,
      turnoverRate: toNumber(row["换手率"]),
      volumeRatio: toNumber(row["量比"]),
      marketCapBillion: marketCap == null ? null : marketCap / 100000000,
      pb: toNumber(row["市净率"]),
      peTtm: toNumber(row["市盈率TTM"]) ?? stocks.get(row["证券代码"])?.values?.peTtm,
      priceAboveMa5: latestPrice != null && ma5 != null ? Number(latestPrice > ma5) : null,
      priceAboveMa10: latestPrice != null && ma10 != null ? Number(latestPrice > ma10) : null,
      priceAboveMa20: latestPrice != null && ma20 != null ? Number(latestPrice > ma20) : null,
      maBullishAlignment: ma5 != null && ma10 != null && ma20 != null ? Number(ma5 > ma10 && ma10 > ma20) : null,
      notSpecialTreatment: /(^|\*)ST|退/.test(row["证券简称"] || "") ? 0 : 1
    };
  });

  const groups = [
    [financials, financialQuery, ["revenueGrowth", "profitGrowth"]],
    [cashflowGrowth, cashflowGrowthQuery, ["operatingCashflowYoy", "epsYoy"]],
    [quality, qualityQuery, ["roe", "grossMargin", "netMargin", "debtAssetRatio", "currentRatio"]],
    [valuation, valuationQuery, ["peTtm"]],
    [performance, performanceQuery, ["amplitude60d", "return60d"]],
    [volumeMa, volumeMaQuery, ["volumeToAvg5", "priceAboveMa5"]],
    [ma10, ma10Query, ["priceAboveMa10"]],
    [ma20, ma20Query, ["priceAboveMa20", "maBullishAlignment"]],
    [technical, technicalQuery, ["rsi6", "kdjK", "macdDiff"]]
  ];
  for (const [payload, query, fields] of groups) {
    for (const row of parseMarkdownTables(payload.answer).flat()) {
      const stock = stocks.get(row["证券代码"]);
      if (!stock) continue;
      stock.provenance ||= {};
      for (const field of fields) stock.provenance[field] = fieldProvenance(field, row, { query, params: payload.params, fetchedAt: payload.fetchedAt });
    }
  }
  for (const row of realtimeRows) {
    const stock = stocks.get(row["证券代码"]);
    if (!stock) continue;
    stock.provenance ||= {};
    for (const field of ["latestPrice", "intradayChangePct", "volume", "amountBillion", "turnoverRate", "volumeRatio", "marketCapBillion", "pb", "peTtm", "notSpecialTreatment"]) {
      if (field === "peTtm" && toNumber(row["市盈率TTM"]) === null) continue;
      stock.provenance[field] = fieldProvenance(field, row, { query: "stock_highfreq_quotes 实时快照", params: { data_mode: "real_time" }, fetchedAt: realtimeFetchedAt });
    }
    stock.quoteTime = stock.provenance.latestPrice?.observedAt || null;
  }
  for (const row of parseMarkdownTables(financialDates.answer).flat()) {
    const stock = stocks.get(row["证券代码"]);
    if (!stock) continue;
    stock.latestFinancialReportPeriod = providerDate(row["定期报告最新报告期"] || row["报告期"]);
    stock.latestFinancialPublicationDate = providerDate(row["定期报告最新公告日期"] || row["公告日期"] || row["定期报告实际披露日期"]);
  }
  for (const stock of stocks.values()) {
    stock.fetchedAt = new Date().toISOString();
    stock.financialDateError = financialDates.error || null;
  }

  const data = {
    stocks: [...stocks.values()],
    sourceDetails: {
      financials: { query: financialQuery, params: financials.params },
      financialDates: { query: financialDateQuery, params: financialDates.params, error: financialDates.error || null },
      cashflowGrowth: { query: cashflowGrowthQuery, params: cashflowGrowth.params },
      quality: { query: qualityQuery, params: quality.params },
      valuation: { query: valuationQuery, params: valuation.params },
      performance: { query: performanceQuery, params: performance.params }
      ,
      volumeMa: { query: volumeMaQuery, params: volumeMa.params },
      ma10: { query: ma10Query, params: ma10.params },
      ma20: { query: ma20Query, params: ma20.params },
      technical: { query: technicalQuery, params: technical.params },
      realtime: { query: "stock_highfreq_quotes 实时快照：最新价、涨跌幅、成交量、成交额、换手率、量比、总市值、市净率、市盈率TTM", params: { data_mode: "real_time" } }
    }
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

function compare(actual, op, expected) {
  if (actual == null || Number.isNaN(actual)) return null;
  if (op === ">") return actual > expected;
  if (op === ">=") return actual >= expected;
  if (op === "<") return actual < expected;
  if (op === "<=") return actual <= expected;
  if (op === "=") return actual === expected;
  return false;
}

function formatValue(value, field, outputUnit) {
  if (value == null || Number.isNaN(value)) return "缺失";
  const unit = outputUnit ?? FIELD_DEFS[field]?.unit ?? "";
  const fixed = field === "peTtm" ? 2 : 1;
  return `${Number(value).toFixed(fixed)}${unit}`;
}

export function explain(stock, conditions) {
  const checks = conditions.map((condition) => {
    const actual = condition.computation ? calculate(condition.computation, stock.values) : stock.values[condition.field];
    const label = condition.computation ? `${CALCULATION_REGISTRY[condition.computation.kind]?.name}（${condition.computation.operands.map((id) => FIELD_DEFS[id]?.label || id).join("、")}）` : FIELD_DEFS[condition.field].label;
    const actualText = formatValue(actual, condition.field, condition.unit);
    const thresholdText = formatValue(condition.value, condition.field, condition.unit);
    const passed = compare(actual, condition.op, condition.value);
    return {
      ...condition,
      label,
      actual,
      actualText,
      thresholdText,
      definition: condition.computation ? CALCULATION_REGISTRY[condition.computation.kind]?.definition : FIELD_DEFS[condition.field].help,
      unit: condition.unit ?? FIELD_DEFS[condition.field].unit,
      provenance: (condition.computation ? condition.computation.operands : [condition.field]).map((field) => ({ field, ...(stock.provenance?.[field] || fieldProvenance(field, {}, { fetchedAt: stock.fetchedAt })) })),
      status: passed === null ? "unknown" : passed ? "pass" : "fail",
      source: condition.computation ? condition.computation.operands.map((id) => FIELD_DEFS[id].source).join("；") : FIELD_DEFS[condition.field].source,
      sentence: passed === null
        ? `${label}缺少有效输入或分母无效，标为无法判断，不算作满足。`
        : `${label}为 ${actualText}，条件为 ${condition.op} ${thresholdText}。`
    };
  });
  const unknown = checks.filter((check) => check.status === "unknown");
  const failed = checks.filter((check) => check.status === "fail");
  const status = failed.length ? "excluded" : unknown.length ? "unknown" : "selected";
  return { status, checks, failedCount: failed.length, unknownCount: unknown.length };
}

export async function executeScreen(conditions) {
  const startedAt = new Date().toISOString();
  const results = [];
  const sourceDetails = [];
  const poolInfo = await getPool();
  const pool = poolInfo.pool;

  for (const batch of chunks(pool, BATCH_SIZE)) {
    try {
      const data = await fetchBatch(batch);
      sourceDetails.push(data.sourceDetails);
      results.push(...data.stocks.map((stock) => ({ ...stock, explanation: explain(stock, conditions) })));
    } catch (error) {
      results.push(...batch.map((item) => ({
        ...item,
        values: {},
        fetchedAt: new Date().toISOString(),
        sourceUrl: "https://mcp.51ifind.com",
        sourceName: "iFinD MCP 股票服务",
        explanation: {
          status: "unknown",
          checks: conditions.map((condition) => ({
            ...explain({ values: {}, fetchedAt: new Date().toISOString() }, [condition]).checks[0],
            ...condition,
            actual: null,
            actualText: "缺失",
            thresholdText: formatValue(condition.value, condition.field, condition.unit),
            status: "unknown",
            source: FIELD_DEFS[condition.field].source,
            sentence: `数据接口返回失败：${error.message}`
          })),
          failedCount: 0,
          unknownCount: conditions.length
        }
      })));
    }
  }

  return {
    pool: poolInfo.source,
    poolSize: pool.length,
    discoveredPoolSize: poolInfo.discoveredSize,
    poolFetchedAt: poolInfo.fetchedAt,
    poolCsvUrl: poolInfo.csvUrl,
    poolFallback: poolInfo.fallback,
    poolLimitedTo: poolInfo.limitedTo || null,
    startedAt,
    finishedAt: new Date().toISOString(),
    source: "iFinD MCP 股票服务：get_stock_financials + get_stock_performance",
    sourceDetails,
    conditions,
    fieldDefs: FIELD_DEFS,
    selected: results.filter((stock) => stock.explanation.status === "selected"),
    excluded: results.filter((stock) => stock.explanation.status === "excluded"),
    unknown: results.filter((stock) => stock.explanation.status === "unknown")
  };
}
