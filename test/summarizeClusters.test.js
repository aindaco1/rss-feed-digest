import test from "node:test";
import assert from "node:assert/strict";
import { summarizeClusters } from "../src/ai/summarizeClusters.js";

test("uses medium text verbosity for gpt-4.1-mini AI summaries", async () => {
  let request = null;
  const client = {
    responses: {
      create: async (payload) => {
        request = payload;
        return {
          output_text: JSON.stringify({
            headline: "Merged headline",
            summary: "Merged summary.",
            topic: "Tech"
          })
        };
      }
    }
  };

  const digest = await summarizeClusters(
    [
      {
        id: "cluster-a",
        topicHint: "Tech",
        latestPublishedAt: "2026-06-01T12:00:00.000Z",
        articles: [
          article({ id: "a", title: "First article", sourceName: "Source A" }),
          article({ id: "b", title: "Second article", sourceName: "Source B" })
        ]
      }
    ],
    { topics: ["Tech"] },
    {
      apiKey: "test-key",
      client,
      model: "gpt-4.1-mini"
    }
  );

  assert.equal(request.model, "gpt-4.1-mini");
  assert.equal(request.text.verbosity, "medium");
  assert.equal(digest.aiCalls, 1);
  assert.equal(digest.topics[0].articles[0].headline, "Merged headline");
});

test("omits special app links for podcast digest articles", async () => {
  const digest = await summarizeClusters(
    [
      {
        id: "cluster-podcast",
        topicHint: "Podcasts",
        latestPublishedAt: "2026-06-01T12:00:00.000Z",
        articles: [
          article({
            id: "podcast",
            title: "Podcast episode",
            sourceName: "Podcast Show",
            sourceType: "podcast",
            feedUrl: "https://feeds.example.com/show.xml",
            overcastUrl: "https://overcast.fm/+ABC123",
            topicHint: "Podcasts"
          })
        ]
      }
    ],
    { topics: ["Podcasts"] },
    { disableAI: true }
  );

  const digestArticle = digest.topics[0].articles[0];
  assert.equal(digestArticle.url, "https://example.com/podcast");
  assert.equal(digestArticle.appUrl, null);
  assert.equal(digestArticle.appLabel, null);
  assert.equal(digestArticle.sources[0].appUrl, null);
  assert.equal(digestArticle.sources[0].appLabel, null);
});

function article(overrides) {
  return {
    id: overrides.id,
    title: overrides.title,
    summary: overrides.summary || "Summary",
    text: overrides.text || "Article text",
    sourceName: overrides.sourceName,
    sourceType: overrides.sourceType,
    feedUrl: overrides.feedUrl,
    overcastUrl: overrides.overcastUrl,
    topicHint: overrides.topicHint || "Tech",
    publishedAt: "2026-06-01T12:00:00.000Z",
    url: `https://example.com/${overrides.id}`,
    imageUrl: null
  };
}
