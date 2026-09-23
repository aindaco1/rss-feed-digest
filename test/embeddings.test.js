import test from "node:test";
import assert from "node:assert/strict";
import { embedArticles } from "../src/ai/embeddings.js";

const articles = ["a", "b"].map(id => ({ id, title: id, summary: "Summary", text: "Body", topicHint: "Tech" }));
const client = data => ({ embeddings: { create: async () => ({ data }) } });

test("maps embeddings by response index, including responses returned out of order", async () => {
  const vectors = await embedArticles(articles, { apiKey: "test", client: client([
    { index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }
  ]) });
  assert.deepEqual(vectors.get("a"), [1, 0]);
  assert.deepEqual(vectors.get("b"), [0, 1]);
});

test("skips requests for articles excluded from broad clustering", async () => {
  const rows = [...["Downloads", "Sports", "Local"].map(topicHint => ({ ...articles[0], topicHint })),
    { ...articles[0], sourceType: "youtube" }];
  const vectors = await embedArticles(rows, { apiKey: "test", client: { embeddings: { create: () => assert.fail("Unnecessary embedding call") } } });
  assert.equal(vectors.size, 0);
});

test("rejects missing, duplicate, invalid and inconsistent vectors instead of misclustering", async () => {
  const good = { index: 0, embedding: [1, 0] };
  for (const data of [[good], [good, good], [good, { index: 2, embedding: [0, 1] }],
    [good, { index: 1, embedding: [NaN, 1] }], [good, { index: 1, embedding: [0, 0] }],
    [good, { index: 1, embedding: [1] }]]) {
    await assert.rejects(embedArticles(articles, { apiKey: "test", client: client(data) }), /embedding/i);
  }
  for (const batchSize of [0, -1, 0.5, Infinity]) {
    await assert.rejects(embedArticles(articles, { apiKey: "test", batchSize }), /batch size/);
  }
});
