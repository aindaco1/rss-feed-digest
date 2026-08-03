import test from "node:test";
import assert from "node:assert/strict";
import { syncFeedbinSubscriptions } from "../src/feeds/syncFeedbinSubscriptions.js";

const config = {
  feeds: [
    {
      title: "Example Newsletter",
      feedUrl: "https://newsletter.example.com/feed",
      siteUrl: "https://newsletter.example.com",
      source: "substack"
    }
  ]
};

const env = {
  FEEDBIN_EMAIL: "reader@example.com",
  FEEDBIN_PASSWORD: "password",
  FEEDBIN_API_BASE: "https://api.feedbin.test/v2"
};

const logger = {
  log() {},
  warn() {}
};

test("retries a transient Feedbin connection failure", async () => {
  let calls = 0;

  const result = await syncFeedbinSubscriptions({
    config,
    env,
    logger,
    attempts: 2,
    retryBaseDelayMs: 0,
    retryJitterMs: 0,
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        throw new TypeError("fetch failed", {
          cause: new Error("Connect Timeout Error")
        });
      }

      return Response.json([
        {
          feed_url: "https://newsletter.example.com/feed",
          site_url: "https://newsletter.example.com"
        }
      ]);
    }
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, {
    existing: 1,
    created: 0,
    skipped: 0,
    failed: 0
  });
});

test("retries a temporary Feedbin server error", async () => {
  let calls = 0;
  let discarded = false;

  const result = await syncFeedbinSubscriptions({
    config,
    env,
    logger,
    attempts: 2,
    retryBaseDelayMs: 0,
    retryJitterMs: 0,
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        return {
          status: 503,
          bodyUsed: false,
          body: {
            cancel: async () => {
              discarded = true;
            }
          }
        };
      }

      return Response.json([
        {
          feed_url: "https://newsletter.example.com/feed",
          site_url: "https://newsletter.example.com"
        }
      ]);
    }
  });

  assert.equal(calls, 2);
  assert.equal(discarded, true);
  assert.equal(result.existing, 1);
});

test("does not retry a permanent Feedbin authentication error", async () => {
  let calls = 0;

  await assert.rejects(
    syncFeedbinSubscriptions({
      config,
      env,
      logger,
      attempts: 4,
      retryBaseDelayMs: 0,
      retryJitterMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 401 });
      }
    }),
    /Feedbin subscriptions failed: 401/
  );

  assert.equal(calls, 1);
});
