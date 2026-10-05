import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// Real workerd + SQLite storage, with every outbound request intercepted. These
// tests exercise runtime bindings, transactions, alarms, and restart persistence.
test("worker authenticates requests and preserves one accepted edition across a real runtime restart", { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "digest-worker-"));
  const requests = [];
  const config = convertV4MiniflareOptions({
    modules: true, scriptPath: "out/worker-build/index.js", compatibilityDate: "2026-10-05",
    durableObjects: { DIGEST_STATE: { className: "DigestState", useSQLite: true } },
    bindings: { DIGEST_STATE_TOKEN: "fixture", RESEND_API_KEY: "fixture" },
    outboundService: async request => {
      assert.equal(new URL(request.url).hostname, "api.resend.com");
      requests.push({ body: await request.text(), key: request.headers.get("Idempotency-Key") });
      return Response.json({ id: "runtime-receipt" });
    }
  });
  config.resourcePersistencePath = dir;
  let worker = new Miniflare(config);
  const url = "https://state/state/daily-digest%2F2026-10-05/";
  async function call(action, body) {
    const response = await worker.dispatchFetch(url + action, { method: body === undefined ? "GET" : "POST", headers: { Authorization: "Bearer fixture" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  try {
    assert.equal((await worker.dispatchFetch(url + "status")).status, 401);
    assert.equal(await call("deliver", {}), null);
    const claim = { key: "daily-digest/2026-10-05", window: { start: "2026-10-04T13:00:00Z", end: "2026-10-05T13:00:00Z" } };
    const claims = await Promise.all([call("claim", { ...claim, owner: "a" }), call("claim", { ...claim, owner: "b" })]);
    assert.equal(claims.filter(result => result.acquired).length, 1);
    const owner = claims.find(result => result.acquired).state.owner;
    const payload = JSON.stringify({ from: "from@example.com", to: ["to@example.com"], subject: "Runtime test", html: "<p>Frozen email</p>" });
    await call("ready", { owner, payload });
    // Explicit delivery and any recovery alarm share the same durable lease.
    for (let attempt = 0; attempt < 20; attempt++) {
      await call("deliver", {});
      if ((await call("status"))?.status === "accepted") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal((await call("status")).providerId, "runtime-receipt");
    assert.deepEqual(requests, [{ body: payload, key: claim.key }]);
    await worker.dispose();
    worker = new Miniflare(config);
    const result = await call("claim", { ...claim, owner: "restart" });
    assert.equal(result.acquired, false);
    assert.equal(result.state.providerId, "runtime-receipt");
    await call("deliver", {});
    assert.equal(requests.length, 1);
    // Private cache persists in a separate named object and never appears in status.
    const cacheUrl = "https://state/state/subscriptions%2Fyoutube/cache";
    const cache = { generatedAt: new Date().toISOString(), feeds: [{ title: "Example", topic: "YouTube", feedUrl: "https://example.com/feed" }] };
    const response = await worker.dispatchFetch(cacheUrl, { method: "POST", headers: { Authorization: "Bearer fixture" }, body: JSON.stringify(cache) });
    assert.equal(response.status, 200);
    assert.deepEqual(await (await worker.dispatchFetch(cacheUrl, { headers: { Authorization: "Bearer fixture" } })).json(), cache);
  } finally { await worker.dispose(); rmSync(dir, { recursive: true, force: true }); }
});
