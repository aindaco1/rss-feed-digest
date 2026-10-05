import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assessCoverage } from "../src/digest/coverage.js";
import { resolveDigestWindow } from "../src/util/dates.js";
import { editionKey } from "../src/digest/stateClient.js";
import { runDigest } from "../src/digest/runDigest.js";
import { summarizeClusters } from "../src/ai/summarizeClusters.js";
import { embedArticles } from "../src/ai/embeddings.js";
import { fetchFeedXml, fetchArticles } from "../src/feeds/fetchFeeds.js";
import { syncFeedbinSubscriptions } from "../src/feeds/syncFeedbinSubscriptions.js";
import { fetchText } from "../src/util/network.js";
import { validSubscriptionCache, CACHE_MAX_AGE_MS } from "../src/feeds/prepareSubscriptions.js";

const config = { digest: { title: "Test digest", timezone: "America/Denver", sendTime: "07:00" }, topics: ["Tech"], feeds: [{ title: "Healthy", feedUrl: "https://healthy.test/rss", topic: "Tech" }, { title: "Unavailable", feedUrl: "https://unavailable.test/rss", topic: "Tech" }] };
const window = resolveDigestWindow({ start: "2026-10-04T07:00", end: "2026-10-05T07:00" }, config.digest);
const xml = '<rss version="2.0"><channel><title>Healthy</title><item><title>A useful story</title><link>https://healthy.test/story</link><pubDate>Mon, 05 Oct 2026 12:00:00 GMT</pubDate><description>Useful facts.</description></item></channel></rss>';

test("one broken source sends useful partial coverage; widespread failure holds; healthy empty is explicit", () => {
  const base = { successfulFeeds: 9, activeFeedCount: 10, failures: [{ title: "YTS" }], articles: [{}] };
  assert.equal(assessCoverage(base).canSend, true);
  assert.match(assessCoverage(base).messages.join(), /YTS.*missing/);
  assert.equal(assessCoverage({ ...base, allowPartial: false }).canSend, false);
  assert.equal(assessCoverage({ ...base, successfulFeeds: 4 }).canSend, false);
  assert.equal(assessCoverage({ ...base, articles: [] }).canSend, false);
  const quiet = assessCoverage({ ...base, successfulFeeds: 10, failures: [], articles: [] });
  assert.equal(quiet.canSend, true);
  assert.match(quiet.messages.join(), /No new articles/);
});

test("adjacent local cutoffs cover DST exactly once, including before 7 AM", () => {
  for (const [end, hours, start] of [["2026-11-01T14:00:00Z", 25, "2026-10-31T13:00:00.000Z"], ["2026-03-08T13:00:00Z", 23, "2026-03-07T14:00:00.000Z"]]) {
    const result = resolveDigestWindow({}, config.digest, new Date(end));
    assert.equal(result.start.toISOString(), start);
    assert.equal((result.end - result.start) / 3_600_000, hours);
    const previous = resolveDigestWindow({}, config.digest, new Date(+result.end - 1));
    assert.equal(+previous.end, +result.start);
    assert.equal(editionKey(result, config.digest), `daily-digest/${result.slug}`);
  }
  assert.notEqual(editionKey({ ...window, start: new Date(+window.start - 1) }, config.digest), editionKey(window, config.digest));
});

test("the real pipeline checkpoints before enrichment and sends with a broken feed and no optional credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "digest-pipeline-"));
  const calls = [];
  const payloads = [];
  try {
    const result = await runDigest({ send: true, start: "2026-10-04T07:00", end: "2026-10-05T07:00" }, {
      config, outDir: pathToFileURL(`${dir}/`), env: { DIGEST_FROM_EMAIL: "from@example.com", DIGEST_TO_EMAIL: "to@example.com", FEED_FETCH_ATTEMPTS: "1", FETCH_OG_IMAGES: "false" },
      fetchImpl: async url => new Response(String(url).includes("unavailable") ? "gone" : xml, { status: String(url).includes("unavailable") ? 521 : 200 }),
      state: async (key, action, data) => {
        calls.push(action);
        assert.equal(key, "daily-digest/2026-10-05");
        if (action === "claim") return { acquired: true };
        if (data.payload) payloads.push(JSON.parse(data.payload));
        if (action === "deliver") return { status: "accepted", providerId: "receipt" };
        return {};
      }
    });
    assert.equal(result.providerId, "receipt");
    assert.deepEqual(calls, ["claim", "checkpoint", "ready", "deliver"]);
    assert.match(payloads[0].html, /Unavailable.*could not be loaded/);
    assert.match(payloads[0].html, /A useful story/);
    assert.equal(JSON.parse(readFileSync(join(dir, "digest-2026-10-05.json"))).coverage.canSend, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the pipeline does not fetch again for an accepted edition", async () => {
  let fetched = false;
  const result = await runDigest({ send: true }, { config, env: {}, now: window.end, state: async () => ({ acquired: false, state: { status: "accepted", providerId: "known" } }), fetchImpl: async () => { fetched = true; } });
  assert.equal(result.providerId, "known");
  assert.equal(fetched, false);
});

test("all feeds failing never submits a checkpoint or normal empty email", async () => {
  const dir = mkdtempSync(join(tmpdir(), "digest-blocked-"));
  const actions = [];
  try {
    await assert.rejects(runDigest({ send: true }, { config, now: window.end, outDir: pathToFileURL(`${dir}/`), env: { FEED_FETCH_ATTEMPTS: "1" }, fetchImpl: async () => new Response("down", { status: 503 }), state: async (_key, action) => { actions.push(action); return { acquired: true }; } }), /coverage/);
    assert.deepEqual(actions, ["claim", "blocked"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const cluster = { id: "fixture", topicHint: "Tech", latestPublishedAt: "2026-10-05T12:00:00Z", articles: [{ id: "a", title: "A story", text: "Source facts", summary: "Source facts", sourceName: "Source", url: "https://example.com/story", publishedAt: "2026-10-05T12:00:00Z" }] };

test("systemic AI failures open a circuit while retaining every headline and source", async () => {
  let calls = 0;
  const digest = await summarizeClusters(Array.from({ length: 100 }, (_, i) => ({ ...cluster, id: `${i}` })), { topics: ["Tech"] }, { apiKey: "fixture", env: { AI_CONCURRENCY: "2" }, client: { responses: { create: async () => { calls++; throw Object.assign(new Error("unavailable"), { status: 503 }); } } } });
  assert.ok(calls <= 4);
  assert.equal(digest.articles.length, 100);
  assert.ok(digest.summaryCounts.provider_unavailable >= 96);
  assert.ok(digest.articles.every(card => card.sources.length === 1));
});

test("exhausted AI and embedding budgets start no requests", async () => {
  const digest = await summarizeClusters([cluster], { topics: ["Tech"] }, { apiKey: "fixture", deadline: Date.now() - 1, env: {}, client: { responses: { create: () => assert.fail("AI called") } } });
  assert.equal(digest.summaryCounts.deadline, 1);
  await assert.rejects(embedArticles([{ ...cluster.articles[0], topicHint: "Tech" }], { apiKey: "fixture", deadline: Date.now() - 1, client: { embeddings: { create: () => assert.fail("Embeddings called") } } }), /deadline/);
});

function stalledResponse(signal) {
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode("["));
    signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
  } }));
}

test("network deadline and size caps include response bodies", async () => {
  await assert.rejects(fetchText("https://example.com", {}, { timeoutMs: 15, fetchImpl: async (_url, init) => stalledResponse(init.signal) }), /Aborted/);
  await assert.rejects(fetchText("https://example.com", {}, { maxBytes: 2, fetchImpl: async () => new Response("123") }), /byte cap/);
});

test("Feedbin fallback and subscription sync keep their timeout through body reads", async () => {
  const env = { FEEDBIN_EMAIL: "test", FEEDBIN_PASSWORD: "test" };
  await assert.rejects(fetchFeedXml("https://example.com/rss", { env, attempts: 1, timeoutMs: 15, fetchImpl: async (url, init) => String(url).includes("feedbin") ? stalledResponse(init.signal) : new Response("down", { status: 503 }) }), /fallback failed/);
  await assert.rejects(syncFeedbinSubscriptions({ env, config: { feeds: [] }, attempts: 1, timeoutMs: 15, fetchImpl: async (_url, init) => stalledResponse(init.signal) }), /Aborted/);
});

test("collection stops requesting feeds after the stage deadline; all temporary 5xx statuses retry", async () => {
  let calls = 0;
  const result = await fetchArticles(config, window, { deadline: Date.now() - 1, env: {}, fetchImpl: () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal(result.failures.length, 2);
  for (const status of [522, 524]) {
    let attempts = 0;
    assert.equal(await fetchFeedXml("https://example.com/rss", { attempts: 2, retryBaseDelayMs: 0, retryJitterMs: 0, env: {}, fetchImpl: async () => ++attempts === 1 ? new Response("down", { status }) : new Response(xml) }), xml);
    assert.equal(attempts, 2);
  }
});

test("subscription caches reject empty, malformed, expired and future data", () => {
  const now = Date.now();
  const cache = { generatedAt: new Date(now).toISOString(), feeds: config.feeds };
  assert.equal(validSubscriptionCache(cache, now), true);
  for (const invalid of [{}, { ...cache, feeds: [] }, { ...cache, generatedAt: new Date(now - CACHE_MAX_AGE_MS - 1).toISOString() }, { ...cache, generatedAt: new Date(now + 600_000).toISOString() }, { ...cache, feeds: [{ title: "X", topic: "Tech", feedUrl: "not-a-url" }] }]) assert.equal(validSubscriptionCache(invalid, now), false);
});

test("optional refresh failures use only a validated recent cache; strict YouTube failures block", async () => {
  const { prepareSubscriptions } = await import("../src/feeds/prepareSubscriptions.js");
  const dir = mkdtempSync(join(tmpdir(), "digest-cache-"));
  const outputDirectory = pathToFileURL(`${dir}/`);
  const cache = { generatedAt: new Date().toISOString(), feeds: config.feeds };
  const options = { env: { YOUTUBE_SYNC_SUBSCRIPTIONS: "true" }, outputDirectory, state: async (_key, _action, data) => { assert.equal(data, undefined, "Failed refresh must not overwrite cache"); return cache; }, refresh: async () => { throw new Error("OAuth unavailable"); }, logger: { warn() {} } };
  try {
    const result = await prepareSubscriptions(options);
    assert.equal(result.generatedFeedPaths.length, 1);
    assert.match(result.notices.join(), /using subscriptions saved/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "youtube-subscriptions.json"))), cache);
    const expired = await prepareSubscriptions({ ...options, state: async () => ({ ...cache, generatedAt: "2020-01-01" }) });
    assert.equal(expired.generatedFeedPaths.length, 0);
    assert.match(expired.notices.join(), /subscriptions are missing/);
    await assert.rejects(prepareSubscriptions({ ...options, env: { ...options.env, YOUTUBE_SYNC_REQUIRED: "true" } }), /Required YouTube refresh failed/);
    const malformed = await prepareSubscriptions({ ...options, refresh: async () => ({ generatedAt: new Date().toISOString(), feeds: [] }) });
    assert.equal(malformed.generatedFeedPaths.length, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "youtube-subscriptions.json"))), cache);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the monitor uses 7 AM local time in winter and recovers missed adjacent windows", async t => {
  const { monitor } = await import("../worker/index.js");
  const dispatched = [];
  const inspected = [];
  const env = { START_DATE: "2026-10-31", GITHUB_REPOSITORY: "example/digest", DIGEST_STATE: { idFromName: key => key, get: key => ({ fetch: async request => {
    const action = new URL(request.url).pathname.split("/").at(-1);
    if (action === "deliver") { inspected.push(key); return Response.json(null); }
    const body = await request.json();
    return Response.json({ dispatch: true, state: { window: body.window } });
  } }) } };
  t.mock.method(globalThis, "fetch", async (_url, init) => { dispatched.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); });
  await monitor(env, new Date("2026-11-01T13:00:00Z"));
  assert.equal(dispatched.length, 0);
  // Mark the older day accepted to isolate the DST dispatch without an alert.
  const get = env.DIGEST_STATE.get;
  env.DIGEST_STATE.get = key => key.endsWith("2026-10-31") ? { fetch: async () => Response.json({ status: "accepted", deliveryStatus: "delivered" }) } : get(key);
  await monitor(env, new Date("2026-11-01T14:00:00Z"));
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].inputs.start, "2026-10-31T13:00:00.000Z");
  assert.equal(dispatched[0].inputs.end, "2026-11-01T14:00:00.000Z");
});

test("an actual OpenAI SDK response cannot hold the summary stage open with a stalled body", { timeout: 2000 }, async t => {
  const { default: OpenAI } = await import("openai");
  const { createServer } = await import("node:http");
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write("{");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new OpenAI({ apiKey: "fixture", baseURL: `http://127.0.0.1:${server.address().port}` });
  const started = Date.now();
  const result = await summarizeClusters([cluster, { ...cluster, id: "second" }], { topics: ["Tech"] }, { apiKey: "fixture", client, env: { AI_CONCURRENCY: "1" }, deadline: Date.now() + 50 });
  assert.ok(Date.now() - started < 1000);
  assert.equal(result.articles.length, 2);
  assert.equal(result.summaryCounts.deadline, 1);
});
