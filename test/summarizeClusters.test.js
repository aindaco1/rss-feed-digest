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

const coverageCluster = {
  id: "coverage", topicHint: "Tech", latestPublishedAt: "2026-06-01T12:00:00.000Z",
  articles: [
    article({ id: "new", title: "Aster beta expands", sourceName: "A", summary: "Aster is expanding its beta." }),
    article({ id: "old", title: "Aster beta restrictions", sourceName: "B", summary: "Only invited desktop users are eligible; mobile support is not confirmed." })
  ]
};

test("fallback keeps unique details from every source and removes exact repeated excerpts", async () => {
  const cluster = { ...coverageCluster, articles: [...coverageCluster.articles, coverageCluster.articles[0]] };
  const digest = await summarizeClusters([cluster], { topics: ["Tech"] }, { env: {}, disableAI: true });
  assert.match(digest.articles[0].summary, /Only invited desktop users/);
  assert.equal(digest.articles[0].summary.split("Aster is expanding its beta.").length, 2);
  assert.equal(digest.articles[0].sources.length, 3);
});

test("invalid and incomplete AI output cannot hide a story or replace its useful fallback", async () => {
  for (const response of [
    { output_text: '{"headline":"Hi","summary":"Body","topic":"Unknown"}' },
    { output_text: '{"headline":"Hi","summary":"  ","topic":"Tech"}' },
    { output_text: '{"headline":null,"summary":"Body","topic":"Tech"}' },
    { status: "incomplete", output_text: '{"headline":"Hi","summary":"Body","topic":"Tech"}' },
    { output_text: 'not JSON' }
  ]) {
    const client = { responses: { create: async () => response } };
    const digest = await summarizeClusters([coverageCluster], { topics: ["Tech"] }, { env: {}, apiKey: "test", client });
    assert.equal(digest.topics[0].articles.length, 1);
    assert.match(digest.articles[0].summary, /Only invited desktop users/);
    assert.equal(digest.aiFailures, 1);
  }
});

test("summary input retains late source qualifications and instructs attribution of disagreements", async () => {
  let request;
  const cluster = { ...coverageCluster, articles: coverageCluster.articles.map(a => ({ ...a,
    text: "Context. ".repeat(250) + "Registration is provisional until inspection."
  })) };
  await summarizeClusters([cluster], { topics: ["Tech"] }, { env: {}, apiKey: "test",
    client: { responses: { create: async payload => {
      request = payload;
      return { status: "completed", output_text: '{"headline":"Beta","summary":"Invited users only.","topic":"Tech"}' };
    } } }
  });
  assert.match(request.input[1].content, /Registration is provisional until inspection/);
  assert.match(request.input[0].content, /disagree/i);
});
