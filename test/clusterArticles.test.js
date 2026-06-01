import test from "node:test";
import assert from "node:assert/strict";
import { clusterArticles } from "../src/cluster/clusterArticles.js";

function article(overrides) {
  return {
    id: overrides.id,
    title: overrides.title,
    summary: overrides.summary || "",
    text: overrides.text || "",
    canonicalUrl: overrides.canonicalUrl || `https://example.com/${overrides.id}`,
    topicHint: overrides.topicHint || "Tech",
    publishedAt: overrides.publishedAt || "2026-06-01T12:00:00.000Z",
    sourceName: overrides.sourceName || "Example",
    url: overrides.url || `https://example.com/${overrides.id}`,
    imageUrl: null
  };
}

test("clusters identical canonical URLs", () => {
  const clusters = clusterArticles([
    article({ id: "a", title: "Apple announces new iPhone", canonicalUrl: "https://example.com/apple" }),
    article({ id: "b", title: "Apple announces new iPhone today", canonicalUrl: "https://example.com/apple" })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 2);
});

test("keeps unrelated stories separate", () => {
  const clusters = clusterArticles([
    article({ id: "a", title: "Apple announces new iPhone", summary: "A phone launch in California" }),
    article({ id: "b", title: "Mets bullpen collapses late", summary: "A baseball game recap" })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not cluster same-source articles unless canonical URLs match", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "The Women in Security Documentary (2025) [1080p] [WEBRip] [YTS.BZ]",
      summary: "IMDB Rating: 0.0/10 Genre: Documentary Size: 672.25 MB Runtime: 1hr 13 min",
      sourceName: "YTS"
    }),
    article({
      id: "b",
      title: "Keloglan Aramizda (1972) [1080p] [WEBRip] [YTS.BZ]",
      summary: "IMDB Rating: 6.2/10 Genre: Comedy / History Size: 736.98 MB Runtime: 1hr 20 min",
      sourceName: "YTS"
    })
  ]);

  assert.equal(clusters.length, 2);
});
