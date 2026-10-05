import test from "node:test";
import assert from "node:assert/strict";
import { DigestState, LEASE_MS, RETRY_WINDOW_MS } from "../worker/state.js";
import { deliverFrozenEmail } from "../src/email/resendDelivery.js";
import { monitor } from "../worker/index.js";

class Storage {
  values = new Map(); tail = Promise.resolve(); alarm;
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  async setAlarm(value) { this.alarm = value; }
  async deleteAlarm() { this.alarm = undefined; }
  async transaction(fn) {
    const result = this.tail.then(async () => {
      const tx = new Storage(); tx.values = structuredClone(this.values); tx.alarm = this.alarm;
      const result = await fn(tx);
      this.values = tx.values; this.alarm = tx.alarm;
      return result;
    });
    this.tail = result.catch(() => {});
    return result;
  }
}
const payload = JSON.stringify({ from: "from@example.com", to: ["to@example.com"], subject: "Daily digest", html: "<p>Useful edition</p>", text: "Useful edition" });
const input = { key: "daily-digest/2026-10-05", owner: "first", window: { start: "2026-10-04T13:00:00Z", end: "2026-10-05T13:00:00Z" } };
function fixture() {
  const storage = new Storage();
  const service = new DigestState({ storage }, { RESEND_API_KEY: "fixture" });
  const call = async (action, body) => {
    const response = await service.fetch(new Request(`https://state/${action}`, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: response.status, ...await response.json() };
  };
  return { storage, service, call };
}
async function ready(f) { await f.call("claim", input); await f.call("ready", { owner: input.owner, payload }); }

test("atomic claims and concurrent delivery allow just one owner and one provider attempt", async t => {
  const f = fixture();
  const claims = await Promise.all([f.call("claim", input), f.call("claim", { ...input, owner: "second" })]);
  assert.equal(claims.filter(claim => claim.acquired).length, 1);
  await f.call("ready", { owner: "first", payload });
  let sent = 0;
  t.mock.method(globalThis, "fetch", async () => { sent++; return Response.json({ id: "receipt" }); });
  await Promise.all([f.service.deliver(), f.service.deliver()]);
  assert.equal(sent, 1);
  assert.equal((await f.storage.get("state")).providerId, "receipt");
  assert.equal((await f.call("claim", { ...input, owner: "third" })).acquired, false);
});

test("a crashed generator's saved headline edition is sent after its lease expires", async t => {
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const f = fixture();
  await f.call("claim", input);
  await f.call("checkpoint", { owner: "first", payload });
  let sent = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => { sent++; assert.equal(init.body, payload); return Response.json({ id: "draft-receipt" }); });
  await f.service.alarm(); assert.equal(sent, 0);
  now += LEASE_MS + 1;
  await f.service.alarm(); assert.equal(sent, 1);
  assert.equal((await f.storage.get("state")).status, "accepted");
  assert.equal((await f.call("ready", { owner: "first", payload: payload + " " })).status, 409);
});

test("ambiguous acceptance retries the identical frozen bytes and key across a service restart", async t => {
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const f = fixture(); await ready(f);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push({ body: init.body, key: init.headers["Idempotency-Key"] });
    if (requests.length === 1) throw new Error("connection lost after provider acceptance");
    return Response.json({ id: "same-receipt" });
  });
  const first = await f.service.deliver();
  assert.equal(first.status, "retry");
  assert.equal((await f.call("checkpoint", { owner: "first", payload: "changed" })).status, 400);
  const restarted = new DigestState({ storage: f.storage }, { RESEND_API_KEY: "fixture" });
  now = first.nextAttemptAt;
  const receipt = await restarted.deliver();
  assert.equal(receipt.status, "accepted");
  assert.deepEqual(requests, Array(2).fill({ body: payload, key: input.key }));
});

test("provider acceptance followed by a failed receipt write recovers the original ID", async t => {
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const f = fixture(); await ready(f);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(init.body);
    return Response.json({ id: "original-id" });
  });
  const transact = f.storage.transaction.bind(f.storage);
  let transactions = 0;
  f.storage.transaction = fn => ++transactions === 2 ? Promise.reject(new Error("Receipt write failed")) : transact(fn);
  await assert.rejects(f.service.deliver(), /Receipt write failed/);
  const state = await f.storage.get("state");
  assert.equal(state.status, "sending");
  assert.equal(state.attempts, 1);
  f.storage.transaction = transact;
  now += 60_001;
  const restarted = new DigestState({ storage: f.storage }, { RESEND_API_KEY: "fixture" });
  await restarted.alarm();
  assert.equal((await f.storage.get("state")).providerId, "original-id");
  assert.deepEqual(requests, [payload, payload]);
});

test("old uncertain sends require review instead of retrying after key expiry", async t => {
  const f = fixture(); await ready(f);
  await f.storage.put("state", { ...await f.storage.get("state"), attempts: 1, firstAttemptAt: Date.now() - RETRY_WINDOW_MS, status: "retry" });
  t.mock.method(globalThis, "fetch", () => assert.fail("Must not resend outside idempotency window"));
  assert.equal((await f.service.deliver()).status, "review");
});

test("permanent errors and payload conflicts stop; malformed success remains uncertain", async t => {
  for (const [status, body, expected] of [[401, { message: "bad auth" }, "review"], [409, { name: "invalid_idempotent_request" }, "review"], [200, {}, "retry"], [503, {}, "retry"]]) {
    const f = fixture(); await ready(f);
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json(body, { status }));
    assert.equal((await f.service.deliver()).status, expected);
    assert.equal((await f.storage.get("state")).providerId, undefined);
    mock.mock.restore();
  }
});

test("Retry-After delays retries and payload hash guards corruption", async t => {
  const f = fixture(); await ready(f);
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 429, headers: { "retry-after": "300" } }));
  const result = await f.service.deliver();
  assert.ok(result.nextAttemptAt >= result.lastAttemptAt + 300_000);
  assert.equal((await f.service.deliver()).attempts, 1);
  await f.storage.put("state", { ...result, nextAttemptAt: 0 });
  await f.storage.put("payload", payload + " ");
  await assert.rejects(f.service.deliver(), /changed/);
});

test("receipt checks distinguish acceptance from delivery and cleanup retains the duplicate barrier", async t => {
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const f = fixture(); await ready(f);
  t.mock.method(globalThis, "fetch", async (_url, init) => init.method === "POST" ? Response.json({ id: "receipt" }) : Response.json({ id: "receipt", last_event: "delivered" }));
  await f.service.deliver();
  assert.equal((await f.storage.get("state")).deliveryStatus, "accepted");
  await f.service.checkReceipt();
  assert.equal((await f.storage.get("state")).deliveryStatus, "delivered");
  now += 8 * 86_400_000;
  await f.service.checkReceipt();
  assert.equal(await f.storage.get("payload"), undefined);
  assert.equal((await f.call("claim", input)).acquired, false);
});

test("sender bounds hanging bodies and rejects missing receipt IDs", async () => {
  await assert.rejects(deliverFrozenEmail(payload, input.key, { apiKey: "fixture", timeoutMs: 10, fetchImpl: async (_url, init) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"id":'));
    init.signal.addEventListener("abort", () => controller.error(new Error("timeout")));
  } })) }), error => error.retryable && error.ambiguous);
});

test("independent monitor dispatches bounded recovery and deduplicates deadline alerts", async t => {
  const objects = new Map();
  const env = { START_DATE: "2026-10-05", GITHUB_REPOSITORY: "example/digest", GITHUB_DISPATCH_TOKEN: "fixture", RESEND_API_KEY: "fixture", DIGEST_FROM_EMAIL: "from@example.com", DIGEST_TO_EMAIL: "to@example.com", DIGEST_STATE: {
    idFromName: name => name,
    get: name => {
      if (!objects.has(name)) objects.set(name, new DigestState({ storage: new Storage() }, env));
      return objects.get(name);
    }
  } };
  let dispatches = 0; let alerts = 0;
  t.mock.method(globalThis, "fetch", async url => {
    if (String(url).includes("api.github.com")) { dispatches++; return new Response(null, { status: 204 }); }
    alerts++; return Response.json({ id: "alert-id" });
  });
  let now = Date.parse("2026-10-05T13:00:00Z"); t.mock.method(Date, "now", () => now);
  await monitor(env, new Date(now));
  assert.equal(dispatches, 1); assert.equal(alerts, 0);
  now += 15 * 60_000;
  await monitor(env, new Date(now));
  assert.equal(dispatches, 2); assert.equal(alerts, 1);
  now += 15 * 60_000;
  await monitor(env, new Date(now));
  now += 15 * 60_000;
  await monitor(env, new Date(now));
  assert.equal(dispatches, 3); assert.equal(alerts, 1);
});

test("reconciliation requires a matching provider email and never sends", async t => {
  const f = fixture(); await ready(f);
  await f.storage.put("state", { ...await f.storage.get("state"), status: "review", attempts: 1, firstAttemptAt: Date.now() - RETRY_WINDOW_MS });
  let mismatched = true;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.method, undefined);
    return Response.json({ ...JSON.parse(payload), subject: mismatched ? "Unrelated email" : "Daily digest", id: "verified-id", last_event: "delivered" });
  });
  await assert.rejects(f.service.reconcile("verified-id"), /does not match/);
  assert.equal((await f.storage.get("state")).status, "review");
  mismatched = false;
  const result = await f.service.reconcile("verified-id");
  assert.equal(result.status, "accepted");
  assert.equal(result.deliveryStatus, "delivered");
  assert.equal(result.attempts, 1);
});
