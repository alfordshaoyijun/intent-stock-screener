import test from "node:test";
import assert from "node:assert/strict";
import { createDemoAccess } from "../src/demoAccess.js";

const response = () => ({ status: 0, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } });

test("protected demo rejects anonymous and wrong credentials and accepts valid ones", () => {
  const access = createDemoAccess({ user: "demo", password: "constructed-test-password" });
  const denied = response();
  assert.equal(access.authorize({ headers: {} }, denied), false);
  assert.equal(denied.status, 401);
  for (const [value, expected] of [["demo:wrong", false], ["demo:constructed-test-password", true]]) {
    assert.equal(access.authorize({ headers: { authorization: `Basic ${Buffer.from(value).toString("base64")}` } }, response()), expected);
  }
});

test("protected demo serializes expensive requests and throttles rapid repeats", () => {
  const access = createDemoAccess({ password: "constructed-test-password" });
  const release = access.acquire(response());
  const busy = response();
  assert.equal(access.acquire(busy), null);
  assert.equal(busy.status, 429);
  release();
  assert.equal(access.acquire(response()), null);
  assert.equal(typeof createDemoAccess({ password: "" }).acquire(response()), "function");
});
