import test from "node:test";
import assert from "node:assert/strict";
import { parseSummaryResponse, summarizeClusters } from "../src/ai/summarizeClusters.js";

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

test("disabled synthesis keeps headlines and every source link without copied excerpts", async () => {
  const cluster = { ...coverageCluster, articles: [...coverageCluster.articles, coverageCluster.articles[0]] };
  const digest = await summarizeClusters([cluster], { topics: ["Tech"] }, { env: {}, disableAI: true });
  assert.equal(digest.articles[0].summary, "");
  assert.equal(digest.articles[0].summaryReason, "disabled");
  assert.equal(digest.articles[0].sources.length, 3);
});

test("invalid or incomplete output retries once then retains headline and all source links", async () => {
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
    assert.equal(digest.articles[0].summary, "");
    assert.equal(digest.articles[0].summaryReason, "error");
    assert.equal(digest.articles[0].sources.length, 2);
    assert.equal(digest.aiFailures, 1);
    assert.equal(digest.aiCalls, 2);
    assert.equal(digest.aiRetries, 1);
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

function response(summary = "The beta expands to invited users. Shared workspaces remain excluded.") {
  return { status: "completed", output_text: JSON.stringify({ headline: "Aster beta expands", summary, topic: "Tech" }) };
}

function singleClusters(count) {
  return Array.from({ length: count }, (_, i) => ({ ...coverageCluster, id: `single-${i}`, articles: [
    article({ id: `source-${i}`, title: `Article ${i}`, sourceName: "Example", summary: "Copied introduction.", text: "The beta expands to invited users. Shared workspaces remain excluded." })
  ] }));
}

test("summarizes single articles throughout editions larger than the old 80-card limit", async () => {
  const digest = await summarizeClusters(singleClusters(203), { topics: ["Tech"] }, {
    env: {}, apiKey: "test", client: { responses: { create: async () => response() } }
  });
  assert.equal(digest.aiCalls, 203);
  assert.deepEqual(digest.summaryCounts, { ai: 203 });
  assert.ok(digest.articles.every(a => a.summaryKind === "ai" && !a.summary.includes("Copied introduction")));
});

test("explicit cluster limits and disabled singles report each missing summary", async () => {
  for (const [env, calls, counts] of [
    [{ AI_MAX_CLUSTERS: "2", AI_CONCURRENCY: "5" }, 2, { ai: 2, limit: 3 }],
    [{ AI_SUMMARIZE_SINGLE_ARTICLES: "false" }, 0, { single_disabled: 5 }]
  ]) {
    const digest = await summarizeClusters(singleClusters(5), { topics: ["Tech"] }, {
      env, apiKey: "test", client: { responses: { create: async () => response() } }
    });
    assert.equal(digest.aiCalls, calls);
    assert.deepEqual(digest.summaryCounts, counts);
    assert.ok(digest.articles.filter(a => a.summaryKind === "unavailable").every(a => a.summary === "" && a.sources.length === 1));
  }
});

test("rejects invalid capacity settings before making summary requests", async () => {
  for (const limit of ["-1", "NaN", "1.5", "Infinity"]) {
    await assert.rejects(summarizeClusters(singleClusters(1), { topics: ["Tech"] }, {
      env: { AI_MAX_CLUSTERS: limit }, apiKey: "test", client: { responses: { create: () => assert.fail("Unexpected request") } }
    }), /Invalid AI_MAX_CLUSTERS/);
  }
});

test("enforces a 100-word single paragraph without truncating generated prose", () => {
  assert.equal(parseSummaryResponse(response(Array(100).fill("word").join(" ")), ["Tech"]).summary.split(" ").length, 100);
  for (const invalid of [Array(101).fill("word").join(" "), "One paragraph.\n\nAnother paragraph.", "A line.\u2028Another line."]) {
    assert.throws(() => parseSummaryResponse(response(invalid), ["Tech"]), /one paragraph/);
  }
});

test("retries rejected summaries once and uses the complete corrected response", async () => {
  let calls = 0;
  const digest = await summarizeClusters(singleClusters(1), { topics: ["Tech"] }, {
    env: {}, apiKey: "test", client: { responses: { create: async (request, settings) => {
      assert.equal(settings.maxRetries, 0);
      assert.equal(settings.timeout, 45_000);
      assert.match(request.input[0].content, /at most 35 words/);
      calls++;
      return calls === 1 ? response(Array(101).fill("word").join(" ")) : response();
    } } }
  });
  assert.equal(digest.aiCalls, 2);
  assert.equal(digest.aiRetries, 1);
  assert.equal(digest.aiFailures, 0);
  assert.equal(digest.articles[0].summary, JSON.parse(response().output_text).summary);
});

test("an exhausted transport retry shows no copied text and preserves the headline", async () => {
  const digest = await summarizeClusters(singleClusters(1), { topics: ["Tech"] }, {
    env: {}, apiKey: "test", client: { responses: { create: async () => { throw new Error("Unavailable"); } } }
  });
  assert.equal(digest.aiCalls, 2);
  assert.equal(digest.aiFailures, 1);
  assert.equal(digest.articles[0].headline, "Article 0");
  assert.equal(digest.articles[0].summary, "");
  assert.deepEqual(digest.summaryCounts, { error: 1 });
});

test("oversized input preserves source links without attempting inference", async () => {
  const cluster = { ...coverageCluster, articles: coverageCluster.articles.map(a => ({ ...a, text: "x".repeat(40_000) })) };
  const digest = await summarizeClusters([cluster], { topics: ["Tech"] }, {
    env: {}, apiKey: "test", client: { responses: { create: () => assert.fail("Oversized request") } }
  });
  assert.equal(digest.aiCalls, 0);
  assert.equal(digest.aiFailures, 1);
  assert.equal(digest.articles[0].summary, "");
  assert.equal(digest.articles[0].sources.length, 2);
});

test("short teasers get a stricter word limit without restricting full article bodies", async () => {
  const small = singleClusters(1)[0];
  const full = { ...small, id: "full", articles: small.articles.map(a => ({ ...a, text: "Available source detail. ".repeat(40) })) };
  const budgets = [];
  const digest = await summarizeClusters([small, full], { topics: ["Tech"] }, {
    env: { AI_CONCURRENCY: "1" }, apiKey: "test", retry: false,
    client: { responses: { create: async request => {
      budgets.push(request.input[0].content.match(/at most (\d+) words/)[1]);
      return response(Array(36).fill("word").join(" "));
    } } }
  });
  assert.deepEqual(budgets, ["35", "100"]);
  assert.equal(digest.articles[0].summary, "");
  assert.equal(digest.articles[1].summary.split(" ").length, 36);
});
