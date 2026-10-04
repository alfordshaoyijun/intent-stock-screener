import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest();

export function createDemoAccess({ password = process.env.DEMO_ACCESS_PASSWORD, user = process.env.DEMO_ACCESS_USER || "demo" } = {}) {
  let active = false;
  let nextAllowed = 0;
  return {
    authorize(req, res) {
      if (!password) return true;
      const expected = `${user}:${password}`;
      const header = req.headers.authorization || "";
      const credentials = header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64").toString("utf8") : "";
      if (timingSafeEqual(digest(credentials), digest(expected))) return true;
      res.writeHead(401, { "www-authenticate": 'Basic realm="Stock demo", charset="UTF-8"', "cache-control": "no-store" });
      res.end("Demo access requires authorization.");
      return false;
    },
    acquire(res) {
      if (!password) return () => {};
      if (active || Date.now() < nextAllowed) {
        res.writeHead(429, { "content-type": "application/json; charset=utf-8", "retry-after": "5" });
        res.end(JSON.stringify({ error: "演示服务忙，请稍后再试。" }));
        return null;
      }
      active = true;
      nextAllowed = Date.now() + 5000;
      return () => { active = false; };
    }
  };
}
