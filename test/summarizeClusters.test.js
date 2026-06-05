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

test("adds Overcast app links for podcast digest articles", async () => {
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
            topicHint: "Podcasts"
          })
        ]
      }
    ],
    { topics: ["Podcasts"] },
    { disableAI: true }
  );

  const digestArticle = digest.topics[0].articles[0];
  assert.equal(
    digestArticle.appUrl,
    "overcast://x-callback-url/add?url=https%3A%2F%2Ffeeds.example.com%2Fshow.xml"
  );
  assert.equal(digestArticle.appLabel, "Subscribe in Overcast");
  assert.equal(digestArticle.sources[0].appLabel, "Subscribe in Overcast");
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
    topicHint: overrides.topicHint || "Tech",
    publishedAt: "2026-06-01T12:00:00.000Z",
    url: `https://example.com/${overrides.id}`,
    imageUrl: null
  };
}
