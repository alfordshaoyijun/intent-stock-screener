import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
import { parseIntent, parseIntentWithAi } from "../src/intent.js";
import { explain } from "../src/screener.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const captured = JSON.parse(fs.readFileSync("numeric_intent_validation.json", "utf8")).results[0];
const parsed = await parseIntentWithAi(captured.query, { backend: { name: "captured", complete: async () => JSON.stringify(captured.structured_intent) } });
const records = [
  { symbol: "TEST001", name: "验证样例甲", values: { amountBillion: 1, debtAssetRatio: 20, volumeRatio: 2 } },
  { symbol: "TEST002", name: "验证样例乙", values: { amountBillion: 2, debtAssetRatio: 25, volumeRatio: 1.8 } },
  { symbol: "TEST003", name: "验证样例丙", values: { amountBillion: 0.1, debtAssetRatio: 80, volumeRatio: 1 } },
  { symbol: "TEST004", name: "验证样例丁", values: {} }
].map((stock) => ({ ...stock, fetchedAt: "2026-10-03T15:00:00Z", sourceName: "构造数据 · UI 验证", explanation: explain(stock, parsed.conditions) }));
const result = { selected: records.filter((s) => s.explanation.status === "selected"), excluded: records.filter((s) => s.explanation.status === "excluded"), unknown: records.filter((s) => s.explanation.status === "unknown"), poolSize: 4 };
const browser = await chromium.launch({ headless: true, channel: process.env.UI_BROWSER_CHANNEL || "msedge" });
try {
  const page = await browser.newPage();
  const errors = [];
  let parseRequests = 0;
  let screenRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/pool", (route) => route.fulfill({ json: { size: 4, source: "构造股票池 · UI 验证" } }));
  await page.route("**/api/parse", (route) => { ++parseRequests; return route.fulfill({ json: parsed }); });
  await page.route("**/api/screen", (route) => { ++screenRequests; return route.fulfill({ json: result }); });
  const strategies = [];
  await page.route("**/api/strategies", (route) => route.fulfill({ json: { strategies } }));
  await page.route("**/api/strategies/ui-test", (route) => route.fulfill({ json: { strategy: strategies[0], editingContext: parseIntent("") } }));
  await page.route("**/api/save", (route) => {
    strategies.push({ ...route.request().postDataJSON(), id: "ui-test", name: "验证策略", savedAt: "2026-10-03T15:00:00Z" });
    return route.fulfill({ status: 201, json: strategies[0] });
  });
  await page.goto("http://localhost:5173/");
  await page.waitForFunction(() => document.querySelector("#poolMeta").textContent.includes("构造股票池"));
  assert.equal(parseRequests, 0, "initial load must not call AI");
  assert.equal(screenRequests, 0, "initial load must not screen");
  assert.equal(await page.locator("#parseBtn").isEnabled(), true);
  assert.match(await page.locator("#candidates").innerText(), /暂无候选/);
  await page.locator("#parseBtn").click();
  await page.waitForFunction(() => document.querySelector("#conditionCount").textContent === "3");
  assert.equal(parseRequests, 1);
  assert.equal(screenRequests, 0, "parsing must not start market execution");
  await page.locator("#runBtn").click();
  await page.locator(".stock").first().waitFor();
  assert.equal(screenRequests, 1);
  assert.equal(await page.locator("#conditionCount").innerText(), "3");
  assert.equal(await page.locator("#results .stock").count(), 2);
  assert.equal(await page.locator("#parseBtn svg").count(), 1);
  assert.equal(await page.locator("#conditions .remove svg").count(), 3);
  await page.locator("#results .stock-detail summary").first().click();
  assert.equal(await page.locator("#results .stock-detail").first().getAttribute("open"), "");
  assert.match(await page.locator("#results .check").first().innerText(), /成交额/);
  assert.match(await page.locator("#results .check").first().innerText(), /指标报告期：接口未返回/);
  await page.locator(".pick").first().check();
  await page.locator("#compareBtn").click();
  assert.match(await page.locator("#compare").innerText(), /验证样例甲/);
  await page.locator("#saveBtn").click();
  await page.waitForFunction(() => document.querySelector("#saved").textContent.includes("已保存于"));
  await page.locator('[data-tab="excluded"]').click();
  assert.match(await page.locator("#results").innerText(), /不满足/);
  await page.locator('[data-tab="unknown"]').click();
  assert.match(await page.locator("#results").innerText(), /无法判断/);
  await page.locator('[data-tab="selected"]').click();
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 740], [768, 1024], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
    const overlap = await page.locator(".condition").evaluateAll((rows) => rows.some((row) => {
      const nodes = [...row.querySelectorAll("select,input,button")].map((el) => el.getBoundingClientRect());
      return nodes.some((a, index) => nodes.slice(index + 1).some((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
    }));
    assert.equal(overlap, false, `control overlap at ${width}`);
    if ([1440, 390].includes(width)) await page.screenshot({ path: `workspace-ui-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  await page.locator("#conditions input").first().fill("999");
  await page.locator("#saved button").click();
  await page.waitForFunction(() => document.querySelector("#requestStatus").textContent.includes("已恢复"));
  assert.equal(Number(await page.locator("#conditions input").first().inputValue()), strategies[0].conditions[0].value);
  assert.match(await page.locator("#results").innerText(), /尚未执行/);
  assert.match(await page.locator("#validation").innerText(), /重新执行/);
  console.log("Workspace UI passed: five widths; condition editing, result disclosure, comparison, save, tabs, local icons. Constructed data only.");
} finally { await browser.close(); }
