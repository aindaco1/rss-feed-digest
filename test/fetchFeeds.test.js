import test from "node:test";
import assert from "node:assert/strict";
import { fetchFeedXml } from "../src/feeds/fetchFeeds.js";

test("retries retryable feed failures", async () => {
  let calls = 0;

  const xml = await fetchFeedXml("https://example.com/feed", {
    attempts: 2,
    retryBaseDelayMs: 0,
    retryJitterMs: 0,
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        return new Response("Forbidden", { status: 403 });
      }

      return new Response("<?xml version=\"1.0\"?><rss></rss>", { status: 200 });
    }
  });

  assert.equal(calls, 2);
  assert.match(xml, /<rss>/);
});

test("sends CDN-friendly feed request headers", async () => {
  let headers;

  await fetchFeedXml("https://example.com/feed", {
    attempts: 1,
    fetchImpl: async (_url, options) => {
      headers = options.headers;
      return new Response("<?xml version=\"1.0\"?><rss></rss>", { status: 200 });
    }
  });

  assert.match(headers["user-agent"], /Mozilla/);
  assert.equal(headers["accept-language"], "en-US,en;q=0.9");
});
