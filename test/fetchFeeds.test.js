import test from "node:test";
import assert from "node:assert/strict";
import { fetchArticles, fetchFeedXml } from "../src/feeds/fetchFeeds.js";

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

test("filters sponsored articles when disclosure only appears on article page", async () => {
  const window = {
    start: new Date("2026-05-30T13:00:00.000Z"),
    end: new Date("2026-06-01T13:00:00.000Z")
  };
  const requestedUrls = [];

  const { articles } = await fetchArticles(
    {
      feeds: [
        {
          title: "Boing Boing",
          feedUrl: "https://example.com/feed.xml",
          siteUrl: "https://example.com/",
          topic: "Projects",
          source: "feedbin",
          excludeSponsored: true
        }
      ]
    },
    window,
    {
      concurrency: 1,
      sponsoredCheckConcurrency: 1,
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));

        if (String(url) === "https://example.com/feed.xml") {
          return new Response(`<?xml version="1.0"?>
            <rss version="2.0">
              <channel>
                <item>
                  <title>Why choose between ChatGPT, Claude, and Gemini when one platform gives you all three?</title>
                  <link>https://example.com/sponsored</link>
                  <pubDate>Sun, 31 May 2026 18:00:00 GMT</pubDate>
                  <description>TL;DR: One platform includes several AI tools.</description>
                </item>
                <item>
                  <title>Is the AI apocalypse a religion in disguise?</title>
                  <link>https://example.com/editorial</link>
                  <pubDate>Sun, 31 May 2026 19:00:00 GMT</pubDate>
                  <description>An essay about AI culture.</description>
                </item>
              </channel>
            </rss>`);
        }

        if (String(url) === "https://example.com/sponsored") {
          return new Response(
            "<html><body><p>Disclosure: Boing Boing earns a commission on purchases made through links in this post.</p></body></html>",
            { headers: { "content-type": "text/html" } }
          );
        }

        if (String(url) === "https://example.com/editorial") {
          return new Response("<html><body><p>An editorial article without a sales disclosure.</p></body></html>", {
            headers: { "content-type": "text/html" }
          });
        }

        return new Response("Not found", { status: 404 });
      }
    }
  );

  assert.deepEqual(requestedUrls, [
    "https://example.com/feed.xml",
    "https://example.com/sponsored",
    "https://example.com/editorial"
  ]);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "Is the AI apocalypse a religion in disguise?");
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

test("falls back to Feedbin when direct and Substack archive fetches are forbidden", async () => {
  const requestedUrls = [];

  const xml = await fetchFeedXml("https://example.substack.com/feed", {
    attempts: 1,
    retryBaseDelayMs: 0,
    retryJitterMs: 0,
    env: {
      FEEDBIN_EMAIL: "reader@example.com",
      FEEDBIN_PASSWORD: "password",
      FEEDBIN_API_BASE: "https://api.feedbin.test/v2"
    },
    fetchImpl: async (url, options) => {
      requestedUrls.push(String(url));

      if (String(url).includes("/api/v1/archive")) {
        return new Response("Forbidden", { status: 403 });
      }

      if (String(url) === "https://api.feedbin.test/v2/subscriptions.json") {
        assert.match(options.headers.authorization, /^Basic /);

        return Response.json([
          {
            feed_id: 42,
            title: "Example Substack",
            feed_url: "https://example.substack.com/feed",
            site_url: "https://example.substack.com"
          }
        ]);
      }

      if (String(url).startsWith("https://api.feedbin.test/v2/feeds/42/entries.json")) {
        return Response.json([
          {
            id: 123,
            title: "Feedbin Post",
            url: "https://example.substack.com/p/feedbin-post",
            author: "Example Writer",
            summary: "Cached summary",
            content: "<p>Cached body</p>",
            published: "2026-05-31T18:00:00.000000Z",
            images: {
              original_url: "https://images.example.com/feedbin.jpg"
            }
          }
        ]);
      }

      return new Response("Forbidden", { status: 403 });
    }
  });

  assert.equal(requestedUrls[0], "https://example.substack.com/feed");
  assert.match(requestedUrls[1], /^https:\/\/example\.substack\.com\/api\/v1\/archive\?/);
  assert.equal(requestedUrls[2], "https://api.feedbin.test/v2/subscriptions.json");
  assert.match(requestedUrls[3], /^https:\/\/api\.feedbin\.test\/v2\/feeds\/42\/entries\.json\?/);
  assert.match(xml, /Feedbin Post/);
  assert.match(xml, /Cached body/);
  assert.match(xml, /images\.example\.com\/feedbin\.jpg/);
});

test("matches simple feed URLs to Feedbin root site subscriptions", async () => {
  const requestedUrls = [];

  const xml = await fetchFeedXml("https://www.joblo.com/feed/", {
    attempts: 1,
    retryBaseDelayMs: 0,
    retryJitterMs: 0,
    env: {
      FEEDBIN_EMAIL: "reader@example.com",
      FEEDBIN_PASSWORD: "password",
      FEEDBIN_API_BASE: "https://api.feedbin.test/v2"
    },
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));

      if (String(url) === "https://api.feedbin.test/v2/subscriptions.json") {
        return Response.json([
          {
            feed_id: 77,
            title: "Joblo",
            feed_url: "https://www.joblo.com/",
            site_url: "https://www.joblo.com/"
          }
        ]);
      }

      if (String(url).startsWith("https://api.feedbin.test/v2/feeds/77/entries.json")) {
        return Response.json([
          {
            id: 456,
            title: "JoBlo Cached Post",
            url: "https://www.joblo.com/cached-post/",
            summary: "Cached JoBlo summary",
            content: "<p>Cached JoBlo body</p>",
            published: "2026-05-31T18:00:00.000000Z"
          }
        ]);
      }

      return new Response("Too Many Requests", { status: 429 });
    }
  });

  assert.equal(requestedUrls[0], "https://www.joblo.com/feed/");
  assert.equal(requestedUrls[1], "https://api.feedbin.test/v2/subscriptions.json");
  assert.match(requestedUrls[2], /^https:\/\/api\.feedbin\.test\/v2\/feeds\/77\/entries\.json\?/);
  assert.match(xml, /JoBlo Cached Post/);
  assert.match(xml, /Cached JoBlo body/);
});
