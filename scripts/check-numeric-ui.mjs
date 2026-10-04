import fs from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { parseIntentWithAi } from "../src/intent.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const samples = JSON.parse(fs.readFileSync("numeric_intent_validation.json", "utf8")).results;
const responses = new Map();
for (const sample of samples) {
  responses.set(sample.query, await parseIntentWithAi(sample.query, {
    backend: { name: "captured-ai", complete: async () => JSON.stringify(sample.structured_intent) }
  }));
}
let current = responses.get(samples[4].query);
const browser = await chromium.launch({ headless: true, ...(process.env.UI_BROWSER_CHANNEL ? { channel: process.env.UI_BROWSER_CHANNEL } : {}) });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/pool", (route) => route.fulfill({ json: { size: 0, source: "界面验证样例" } }));
  await page.route("**/api/strategies", (route) => route.fulfill({ json: { strategies: [] } }));
  await page.route("**/api/parse", (route) => {
    const query = route.request().postDataJSON().text;
    current = responses.get(query) || current;
    return route.fulfill({ json: current });
  });
  await page.goto("http://localhost:5173/");
  await page.locator("#parseBtn").click();
  await page.locator("#candidates .candidate").first().waitFor();
  assert.equal(await page.locator("#conditions input[type=number]").count(), 0);
  assert.match(await page.locator("#candidates").innerText(), /产品建议，待确认/);
  assert.match(await page.locator("#candidates").innerText(), /阈值待确认/);
  await page.locator("#candidates .auto-threshold").first().click();
  assert.match(await page.locator("#candidates").innerText(), /填写原因/);
  assert.match(await page.locator("#candidates").innerText(), /不是金融标准/);
  assert.equal(await page.locator("#candidates input[type=checkbox]").first().isChecked(), false);
  const mainCard = page.locator("#candidates .candidate").filter({ hasText: "主力净流入" });
  await mainCard.locator(".auto-threshold").click();
  assert.match(await mainCard.innerText(), /3000万元/);
  assert.match(await mainCard.innerText(), /缺数据/);
  assert.match(await mainCard.innerText(), /填写原因/);
  await page.locator("#candidates input[type=checkbox]").first().check();
  await page.locator("#confirmBtn").click();
  assert.equal(await page.locator("#conditions input[type=number]").first().inputValue(), "25");
  assert.match(await page.locator("#conditions").innerText(), /填写原因/);
  await page.locator("#intent").fill(samples[0].query);
  await page.locator("#parseBtn").click();
  await page.waitForFunction(() => document.querySelectorAll("#conditions input[type=number]").length === 3);
  assert.deepEqual(await page.locator("#conditions input[type=number]").evaluateAll((nodes) => nodes.map((node) => node.value)), ["0.5", "30", "1.6"]);
  await page.locator("#conditions input[type=number]").first().fill("");
  assert.equal(await page.locator("#conditions input[type=number]").first().inputValue(), "");
  for (const [width, height, name] of [[1440, 1000, "desktop"], [390, 844, "mobile"]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `numeric-ui-${name}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("Numeric UI: preset confirmation, null display, numeric values and responsive screenshots passed (captured AI responses; no market execution).");
} finally {
  await browser.close();
}
