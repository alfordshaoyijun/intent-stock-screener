import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { completeJson, getBackend, parseJsonLoose } from "../src/llmClient.js";

test("getBackend honors explicit none backend", () => {
  const backend = getBackend({ AI_BACKEND: "none" });
  assert.equal(backend.name, "none");
});

test("getBackend honors openai-compatible backend", () => {
  const backend = getBackend({
    AI_BACKEND: "openai-compatible",
    AI_BASE_URL: "http://localhost:11434/v1",
    AI_MODEL: "qwen"
  });
  assert.equal(backend.name, "openai-compatible");
  assert.equal(backend.baseUrl, "http://localhost:11434/v1");
  assert.equal(backend.model, "qwen");
});

test("getBackend honors codex backend with CODEX_BIN", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-test-"));
  const fakeCodex = path.join(tempDir, process.platform === "win32" ? "codex.exe" : "codex");
  fs.writeFileSync(fakeCodex, "");
  try {
    const backend = getBackend({ AI_BACKEND: "codex-cli", CODEX_BIN: fakeCodex });
    assert.equal(backend.name, "codex-cli");
    assert.equal(backend.binary, fakeCodex);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getBackend rejects unknown explicit backend", () => {
  assert.throws(() => getBackend({ AI_BACKEND: "magic" }), /只认/);
});

test("parseJsonLoose handles fenced JSON and surrounding text", () => {
  assert.deepEqual(parseJsonLoose("```json\n{\"ok\":true}\n```"), { ok: true });
  assert.deepEqual(parseJsonLoose("前言 {\"items\":[1,2]} 后记"), { items: [1, 2] });
});

test("completeJson parses backend output", async () => {
  const backend = {
    name: "fake",
    async complete() {
      return "```json\n{\"strategy\":\"ok\",\"clauses\":[]}\n```";
    }
  };
  const data = await completeJson("x", { backend });
  assert.deepEqual(data, { strategy: "ok", clauses: [] });
});
