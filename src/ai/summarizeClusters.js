import OpenAI from "openai";
import { mapLimit } from "../util/concurrency.js";
import { appLinkForArticle } from "../util/appLinks.js";

export async function summarizeClusters(clusters, config, options = {}) {
  const env = options.env || process.env;
  const topicOrder = config.topics;
  const useAI = Boolean(options.apiKey) && !options.disableAI;
  const model = options.model || env.OPENAI_MODEL || "gpt-4.1-mini";
  const aiMaxClusters = Number(env.AI_MAX_CLUSTERS || 80);
  const summarizeAll = env.AI_SUMMARIZE_SINGLE_ARTICLES === "true";
  const client = useAI ? options.client || new OpenAI({ apiKey: options.apiKey }) : null;
  let aiCalls = 0;

  const digestArticles = await mapLimit(clusters, Number(env.AI_CONCURRENCY || 2), async (cluster) => {
    const shouldUseAI = client && (summarizeAll || cluster.articles.length > 1) && aiCalls < aiMaxClusters;
    if (!shouldUseAI) return fallbackDigestArticle(cluster, env);

    aiCalls += 1;
    try {
      const aiArticle = await summarizeClusterWithAI(client, model, cluster, topicOrder);
      return {
        ...fallbackDigestArticle(cluster, env),
        headline: aiArticle.headline,
        summary: aiArticle.summary,
        topic: aiArticle.topic
      };
    } catch (error) {
      console.warn(`AI summary failed for cluster ${cluster.id}: ${error.message}`);
      return fallbackDigestArticle(cluster, env);
    }
  });

  const articlesByTopic = new Map(topicOrder.map((topicName) => [topicName, []]));
  for (const article of digestArticles) {
    articlesByTopic.get(article.topic)?.push(article);
  }

  const grouped = topicOrder.flatMap((topicName) => {
    const articles = articlesByTopic
      .get(topicName)
      .sort((a, b) => new Date(b.latestPublishedAt) - new Date(a.latestPublishedAt));
    return articles.length ? [{ name: topicName, articles }] : [];
  });

  return {
    topics: grouped,
    articles: digestArticles,
    aiCalls
  };
}

function fallbackDigestArticle(cluster, env) {
  const articles = [...cluster.articles].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const lead = articles[0];
  const sourceNames = [...new Set(articles.map((article) => article.sourceName))];
  const multiSourceLead = sourceNames.length > 1 ? `Coverage from ${sourceNames.join(", ")}. ` : "";
  const appLink = appLinkForArticle(lead, env);

  return {
    id: cluster.id,
    headline: lead.title,
    topic: cluster.topicHint,
    summary: `${multiSourceLead}${lead.summary || lead.text.slice(0, 300)}`.slice(0, 900),
    url: lead.url,
    appUrl: appLink?.url || null,
    appLabel: appLink?.label || null,
    imageUrl: articles.find((article) => article.imageUrl)?.imageUrl || null,
    imageAlt: lead.title,
    latestPublishedAt: cluster.latestPublishedAt,
    sources: articles.map((article) => {
      const sourceAppLink = appLinkForArticle(article, env);
      return {
        name: article.sourceName,
        title: article.title,
        url: article.url,
        appUrl: sourceAppLink?.url || null,
        appLabel: sourceAppLink?.label || null,
        publishedAt: article.publishedAt
      };
    })
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
      verbosity: "medium"
    }
  });

  return JSON.parse(response.output_text);
}
