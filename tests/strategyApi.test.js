import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

test("save API persists across server restart and validates submitted conditions", async () => {
  const temp = await mkdtemp(join(tmpdir(), "strategy-api-"));
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(port), AI_BACKEND: "none", IFIND_CALL_MODULE: join(temp, "missing-ifind.cjs"), STRATEGY_STORE_PATH: join(temp, "strategies.json") }, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server startup timeout")), 10000);
      child.stdout.on("data", (chunk) => { if (String(chunk).includes("running")) { clearTimeout(timer); resolve(); } });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
    });
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
  };
  try {
    await start();
    const response = await fetch(`${url}/api/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "PE验证", text: "PE小于30", conditions: [{ field: "peTtm", metric_id: "peTtm", op: "<", value: 30, origin: "user_confirmed" }] }) });
    assert.equal(response.status, 201);
    const saved = await response.json();
    await stop(); await start();
    const list = await (await fetch(`${url}/api/strategies`)).json();
    assert.equal(list.strategies[0].id, saved.id);
    const restored = await (await fetch(`${url}/api/strategies/${saved.id}`)).json();
    assert.equal(restored.strategy.conditions[0].value, 30);
    assert.ok(restored.editingContext.fieldDefs.peTtm);
    const failedScreenResponse = await fetch(`${url}/api/screen`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conditions: saved.conditions }) });
    assert.equal(failedScreenResponse.status, 200);
    const failedScreen = await failedScreenResponse.json();
    assert.equal(failedScreen.selected.length, 0);
    assert.equal(failedScreen.unknown.length, failedScreen.poolSize);
    assert.match(failedScreen.unknown[0].explanation.checks[0].sentence, /模块不可用/);
    assert.equal((await fetch(`${url}/api/strategies/no-such-id`)).status, 404);
    assert.equal((await fetch(`${url}/api/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conditions: [] }) })).status, 422);
  } finally { await stop(); await rm(temp, { recursive: true, force: true }); }
});
