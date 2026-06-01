import OpenAI from "openai";
import { mapLimit } from "../util/concurrency.js";

export async function summarizeClusters(clusters, config, options = {}) {
  const topicOrder = config.topics;
  const useAI = Boolean(options.apiKey) && !options.disableAI;
  const model = options.model || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const aiMaxClusters = Number(process.env.AI_MAX_CLUSTERS || 80);
  const summarizeAll = process.env.AI_SUMMARIZE_SINGLE_ARTICLES === "true";
  const client = useAI ? new OpenAI({ apiKey: options.apiKey }) : null;
  let aiCalls = 0;

  const digestArticles = await mapLimit(clusters, Number(process.env.AI_CONCURRENCY || 2), async (cluster) => {
    const shouldUseAI = client && (summarizeAll || cluster.articles.length > 1) && aiCalls < aiMaxClusters;
    if (!shouldUseAI) return fallbackDigestArticle(cluster);

    aiCalls += 1;
    try {
      const aiArticle = await summarizeClusterWithAI(client, model, cluster, topicOrder);
      return {
        ...fallbackDigestArticle(cluster),
        headline: aiArticle.headline,
        summary: aiArticle.summary,
        topic: aiArticle.topic
      };
    } catch (error) {
      console.warn(`AI summary failed for cluster ${cluster.id}: ${error.message}`);
      return fallbackDigestArticle(cluster);
    }
  });

  const grouped = topicOrder
    .map((topicName) => ({
      name: topicName,
      articles: digestArticles
        .filter((article) => article.topic === topicName)
        .sort((a, b) => new Date(b.latestPublishedAt) - new Date(a.latestPublishedAt))
    }))
    .filter((topic) => topic.articles.length > 0);

  return {
    topics: grouped,
    articles: digestArticles,
    aiCalls
  };
}

function fallbackDigestArticle(cluster) {
  const articles = [...cluster.articles].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const lead = articles[0];
  const sourceNames = [...new Set(articles.map((article) => article.sourceName))];
  const multiSourceLead = sourceNames.length > 1 ? `Coverage from ${sourceNames.join(", ")}. ` : "";

  return {
    id: cluster.id,
    headline: lead.title,
    topic: cluster.topicHint,
    summary: `${multiSourceLead}${lead.summary || lead.text.slice(0, 300)}`.slice(0, 900),
    url: lead.url,
    imageUrl: articles.find((article) => article.imageUrl)?.imageUrl || null,
    imageAlt: lead.title,
    latestPublishedAt: cluster.latestPublishedAt,
    sources: articles.map((article) => ({
      name: article.sourceName,
      title: article.title,
      url: article.url,
      publishedAt: article.publishedAt
    }))
  };
}

async function summarizeClusterWithAI(client, model, cluster, topics) {
  const payload = {
    allowedTopics: topics,
    articles: cluster.articles.map((article) => ({
      title: article.title,
      source: article.sourceName,
      topicHint: article.topicHint,
      publishedAt: article.publishedAt,
      url: article.url,
      summary: article.summary,
      text: article.text.slice(0, 1800)
    }))
  };

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["headline", "summary", "topic"],
    properties: {
      headline: {
        type: "string",
        description: "A concise digest headline for the merged story."
      },
      summary: {
        type: "string",
        description: "A comprehensive 2-4 sentence summary that combines the useful details without inventing facts."
      },
      topic: {
        type: "string",
        enum: topics
      }
    }
  };

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "You write a daily RSS digest. Combine overlapping coverage into one useful item. Do not add facts that are not present in the supplied articles. Keep the voice clear and direct."
      },
      {
        role: "user",
        content: JSON.stringify(payload)
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "digest_article",
        schema,
        strict: true
      },
      verbosity: "low"
    }
  });

  return JSON.parse(response.output_text);
}
