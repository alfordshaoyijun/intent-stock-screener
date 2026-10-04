import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class StrategyStore {
  constructor(filename) { this.filename = filename; this.pending = Promise.resolve(); }

  async read() {
    try {
      const data = JSON.parse(await readFile(this.filename, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.strategies)) throw new Error("策略存储格式无效");
      return data.strategies;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new Error(`无法读取策略存储：${error.message}`);
    }
  }

  async list() { await this.pending; return this.read(); }
  async get(id) { return (await this.list()).find((item) => item.id === id) || null; }

  save({ name, text, conditions }) {
    const operation = this.pending.then(async () => {
      const strategies = await this.read();
      const strategy = { id: randomUUID(), name: String(name || "未命名策略").slice(0, 200), text: String(text || ""), conditions: structuredClone(conditions), savedAt: new Date().toISOString() };
      strategies.unshift(strategy);
      await mkdir(path.dirname(this.filename), { recursive: true });
      const temp = `${this.filename}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ version: 1, strategies }, null, 2), { encoding: "utf8", mode: 0o600 });
      await rename(temp, this.filename);
      return strategy;
    });
    this.pending = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
