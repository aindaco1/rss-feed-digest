import OpenAI from "openai";
import { isEmbeddingCandidate } from "../cluster/clusterArticles.js";

export async function embedArticles(articles, options = {}) {
  const env = options.env || process.env;
  const apiKey = options.apiKey || env.OPENAI_API_KEY;
  if (!apiKey || !articles.length) return new Map();

  const model = options.model || env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const batchSize = Number(options.batchSize ?? 100);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new RangeError("Invalid embedding batch size");
  const candidates = articles.filter((article) => isEmbeddingCandidate(article, options));
  const client = options.client || new OpenAI({ apiKey });
  const vectorsById = new Map();

  let dimensions;
  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    const response = await client.embeddings.create({
      model,
      input: batch.map((article) => `${article.title}\n${article.summary}\n${article.text.slice(0, 1500)}`)
    });

    if (!Array.isArray(response.data) || response.data.length !== batch.length) throw new Error("Incomplete embedding response");
    const seen = new Set();
    response.data.forEach((item) => {
      if (!Number.isSafeInteger(item.index) || item.index < 0 || item.index >= batch.length || seen.has(item.index) ||
          !Array.isArray(item.embedding) || !item.embedding.length ||
          !item.embedding.every(Number.isFinite) || !item.embedding.some(n => n !== 0)) {
        throw new Error("Invalid embedding response");
      }
      dimensions ??= item.embedding.length;
      if (item.embedding.length !== dimensions) throw new Error("Inconsistent embedding dimensions");
      seen.add(item.index);
      vectorsById.set(batch[item.index].id, item.embedding);
    });
  }

  return vectorsById;
}
