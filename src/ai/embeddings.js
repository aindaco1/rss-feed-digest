import OpenAI from "openai";

export async function embedArticles(articles, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey || !articles.length) return new Map();

  const model = options.model || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const batchSize = Number(options.batchSize || 100);
  const client = new OpenAI({ apiKey });
  const vectorsById = new Map();

  for (let index = 0; index < articles.length; index += batchSize) {
    const batch = articles.slice(index, index + batchSize);
    const response = await client.embeddings.create({
      model,
      input: batch.map((article) => `${article.title}\n${article.summary}\n${article.text.slice(0, 1500)}`)
    });

    response.data.forEach((item, batchIndex) => {
      vectorsById.set(batch[batchIndex].id, item.embedding);
    });
  }

  return vectorsById;
}
