import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StrategyStore } from "../src/strategyStore.js";

test("strategies persist across instances and concurrent saves retain all records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strategy-store-"));
  try {
    const filename = join(directory, "strategies.json");
    const store = new StrategyStore(filename);
    assert.deepEqual(await store.list(), []);
    const conditions = [{ metric_id: "peTtm", field: "peTtm", op: "<", value: 30, params: {}, origin: "user_confirmed" }];
    const saved = await Promise.all([store.save({ name: "A", text: "PE低于30", conditions }), store.save({ name: "B", conditions })]);
    conditions[0].value = 99;
    const reopened = new StrategyStore(filename);
    assert.equal((await reopened.list()).length, 2);
    assert.equal((await reopened.get(saved[0].id)).conditions[0].value, 30);
    assert.equal(await reopened.get("missing"), null);
    await writeFile(filename, "broken");
    await assert.rejects(reopened.save({ name: "C", conditions }), /无法读取/);
    assert.equal(await readFile(filename, "utf8"), "broken");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
