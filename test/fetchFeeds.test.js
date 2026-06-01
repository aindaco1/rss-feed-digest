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

test("falls back to Substack archive API when a feed is forbidden", async () => {
  const requestedUrls = [];

  const xml = await fetchFeedXml("https://example.substack.com/feed", {
    attempts: 1,
    retryBaseDelayMs: 0,
    retryJitterMs: 0,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));

      if (String(url).includes("/api/v1/archive")) {
        return Response.json([
          {
            title: "Archive Post",
            slug: "archive-post",
            post_date: "2026-05-31T18:00:00.000Z",
            canonical_url: "https://example.substack.com/p/archive-post",
            subtitle: "Archive subtitle",
            body_html: "<p>Archive body</p>",
            cover_image: "https://substack-post-media.s3.amazonaws.com/image.jpg"
          }
        ]);
      }

      return new Response("Forbidden", { status: 403 });
    }
  });

  assert.equal(requestedUrls[0], "https://example.substack.com/feed");
  assert.match(requestedUrls[1], /^https:\/\/example\.substack\.com\/api\/v1\/archive\?/);
  assert.match(xml, /Archive Post/);
  assert.match(xml, /https:\/\/example\.substack\.com\/p\/archive-post/);
  assert.match(xml, /media:content/);
});
