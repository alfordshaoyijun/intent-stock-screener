import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const CODEX_TIMEOUT_MS = 300000;
const OPENAI_TIMEOUT_MS = 180000;

export class NoneBackend {
  name = "none";

  async complete() {
    throw new Error("AI_BACKEND=none，未启用本地 AI。");
  }
}

export class CodexCliBackend {
  name = "codex-cli";

  constructor({ binary = codexBin(), model = process.env.CODEX_MODEL || process.env.AI_MODEL || "" } = {}) {
    if (!binary) throw new Error("找不到 Codex CLI，可用 CODEX_BIN 指定完整路径。");
    this.binary = binary;
    this.model = model || "";
  }

  async complete(prompt, { timeoutMs = CODEX_TIMEOUT_MS, effort = process.env.CODEX_REASONING_EFFORT || "" } = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-codex-"));
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "-s",
      "read-only"
    ];
    if (this.model) args.push("-m", this.model);
    if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
    args.push("-C", tempDir, "-");

    try {
      const result = await runProcess(this.binary, args, {
        input: prompt,
        cwd: tempDir,
        timeoutMs,
        env: this.env()
      });
      const output = result.stdout.trim();
      if (!output) throw new Error(`codex CLI 没输出最终回答，stderr: ${result.stderr.slice(-300)}`);
      return output;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  env() {
    const env = { ...process.env };
    const extra = [path.dirname(this.binary)];
    const node = findExecutable("node");
    if (node) extra.push(path.dirname(node));
    env.PATH = [...extra, env.PATH || ""].join(path.delimiter);
    return env;
  }
}

export class OpenAICompatibleBackend {
  name = "openai-compatible";

  constructor({
    baseUrl = process.env.AI_BASE_URL || "http://localhost:11434/v1",
    model = process.env.AI_MODEL || "qwen2.5:7b",
    apiKey = process.env.AI_API_KEY || "not-needed"
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.apiKey = apiKey;
  }

  async complete(prompt, { maxTokens = 4000, timeoutMs = OPENAI_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxTokens,
          temperature: 0,
          messages: [{ role: "user", content: prompt }]
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI-compatible 后端失败 ${response.status}: ${text.slice(0, 300)}`);
      }
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";
      if (!text.trim()) throw new Error("OpenAI-compatible 后端返回空内容。");
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function getBackend(env = process.env) {
  const choice = (env.AI_BACKEND || "").trim().toLowerCase();
  if (choice === "none") return new NoneBackend();
  if (choice === "codex" || choice === "codex-cli") {
    return new CodexCliBackend({ binary: codexBin(env), model: env.CODEX_MODEL || env.AI_MODEL || "" });
  }
  if (choice === "openai" || choice === "openai-compatible") {
    return new OpenAICompatibleBackend({
      baseUrl: env.AI_BASE_URL,
      model: env.AI_MODEL,
      apiKey: env.AI_API_KEY
    });
  }
  if (choice) throw new Error(`AI_BACKEND 只认 codex-cli / openai-compatible / none，收到: ${choice}`);

  const codex = codexBin(env);
  if (codex) return new CodexCliBackend({ binary: codex, model: env.CODEX_MODEL || env.AI_MODEL || "" });
  if (env.AI_BASE_URL || env.AI_API_KEY || env.AI_MODEL) {
    return new OpenAICompatibleBackend({
      baseUrl: env.AI_BASE_URL,
      model: env.AI_MODEL,
      apiKey: env.AI_API_KEY
    });
  }
  return new NoneBackend();
}

export async function complete(prompt, options = {}) {
  return getBackend().complete(prompt, options);
}

export async function completeJson(prompt, options = {}) {
  const backend = options.backend || getBackend();
  const raw = (await backend.complete(prompt, options)).trim();
  return parseJsonLoose(raw);
}

export const complete_json = completeJson;

export function parseJsonLoose(raw) {
  const candidates = [raw, ...extractFenced(raw), extractBraced(raw)].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // Try the next shape.
    }
  }
  throw new Error(`AI 没返回可解析的 JSON，前 300 字: ${raw.slice(0, 300)}`);
}

function extractFenced(raw) {
  const matches = [];
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = regex.exec(raw))) matches.push(match[1]);
  return matches;
}

function extractBraced(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : "";
}

function codexBin(env = process.env) {
  if (env.CODEX_BIN && fs.existsSync(expandPath(env.CODEX_BIN))) return expandPath(env.CODEX_BIN);
  return findExecutable("codex", env);
}

function findExecutable(name, env = process.env) {
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  const pathValue = env.PATH || env.Path || process.env.PATH || "";
  for (const dir of pathValue.split(path.delimiter)) {
    for (const suffix of suffixes) {
      const full = path.join(dir, `${name}${suffix}`);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

function expandPath(value) {
  let result = String(value);
  result = result.replace(/^~(?=$|[\\/])/, os.homedir());
  result = result.replace(/%([^%]+)%/g, (_, key) => process.env[key] || "");
  return result;
}

function commandFor(binary, args) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    return { command: "cmd", args: ["/c", binary, ...args] };
  }
  return { command: binary, args };
}

function runProcess(binary, args, { input, cwd, timeoutMs, env }) {
  return new Promise((resolve, reject) => {
    const cmd = commandFor(binary, args);
    const child = spawn(cmd.command, cmd.args, { cwd, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${binary} 调用超时`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${binary} 失败: ${(stderr || stdout).slice(-300)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}
