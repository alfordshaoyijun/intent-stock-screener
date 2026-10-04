import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { parseIntent, parseIntentWithAi, validateConditions } from "./src/intent.js";
import { StrategyStore } from "./src/strategyStore.js";
import { executeScreen, getPool } from "./src/screener.js";
import { createDemoAccess } from "./src/demoAccess.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 5173);
const strategyStore = new StrategyStore(process.env.STRATEGY_STORE_PATH || join(root, "data", "strategies.json"));
const demoAccess = createDemoAccess();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error("请求内容过长，最多允许 128 KB。");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalized);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  let release = null;
  try {
    if (!demoAccess.authorize(req, res)) return;
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (["/api/parse", "/api/screen", "/api/pool"].includes(url.pathname)) {
      release = demoAccess.acquire(res);
      if (!release) return;
    }
    if (req.method === "GET" && url.pathname === "/api/pool") {
      const pool = await getPool();
      sendJson(res, 200, {
        pool: pool.pool,
        size: pool.pool.length,
        discoveredSize: pool.discoveredSize,
        source: pool.source,
        csvUrl: pool.csvUrl,
        fetchedAt: pool.fetchedAt,
        fallback: pool.fallback,
        limitedTo: pool.limitedTo || null
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/parse") {
      const { text } = await readBody(req);
      sendJson(res, 200, await parseIntentWithAi(String(text || "")));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/screen") {
      const { conditions } = await readBody(req);
      const validation = validateConditions(Array.isArray(conditions) ? conditions : []);
      if (!validation.ok) {
        sendJson(res, 422, validation);
        return;
      }
      sendJson(res, 200, await executeScreen(validation.conditions));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/save") {
      const { name, text, conditions } = await readBody(req);
      const validation = validateConditions(Array.isArray(conditions) ? conditions : []);
      if (!validation.ok) { sendJson(res, 422, validation); return; }
      sendJson(res, 201, await strategyStore.save({ name, text, conditions: validation.conditions }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/strategies") {
      sendJson(res, 200, { strategies: await strategyStore.list() });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/strategies/")) {
      const strategy = await strategyStore.get(decodeURIComponent(url.pathname.slice("/api/strategies/".length)));
      if (!strategy) { sendJson(res, 404, { error: "策略不存在" }); return; }
      sendJson(res, 200, { strategy, editingContext: parseIntent("") });
      return;
    }
    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }
    res.writeHead(405);
    res.end("Method not allowed");
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  } finally {
    release?.();
  }
});

server.listen(port, () => {
  console.log(`Intent stock screener running at http://localhost:${port}`);
});
