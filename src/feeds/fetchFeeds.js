import Parser from "rss-parser";
import { mapLimit } from "../util/concurrency.js";
import { firstImageFromHtml, metaImageFromHtml } from "../util/html.js";
import { normalizeFeedItems } from "./normalizeArticles.js";

const parser = new Parser({
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["dc:creator", "creator"],
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["itunes:image", "itunesImage"]
    ]
  },
  timeout: 15000
});

export async function fetchArticles(config, window, options = {}) {
  const concurrency = Number(options.concurrency || process.env.FEED_CONCURRENCY || 8);
  const activeFeeds = config.feeds.filter((feed) => !feed.disabled);
  const results = await mapLimit(activeFeeds, concurrency, async (feed) => {
    try {
      const xml = await fetchFeedXml(feed.feedUrl);
      const parsed = await parser.parseString(xml);
      const articles = normalizeFeedItems(feed, parsed, window);
      return { feed, articles, error: null };
    } catch (error) {
      return { feed, articles: [], error };
    }
  });

  const articles = [];
  const failures = [];

  for (const result of results) {
    if (result.error) {
      failures.push({
        title: result.feed.title,
        feedUrl: result.feed.feedUrl,
        message: result.error.message
      });
      continue;
    }

    articles.push(...result.articles);
  }

  return {
    articles: dedupeArticles(articles),
    failures,
    skippedFeeds: config.feeds.filter((feed) => feed.disabled)
  };
}

export async function fetchFeedXml(feedUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(feedUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "user-agent": "AlonsoDailyDigest/0.1 (+https://github.com/)"
      }
    });

    if (!response.ok) {
      throw new Error(`Status code ${response.status}`);
    }

    const text = await response.text();
    const firstChunk = text.slice(0, 500).toLowerCase();

    if (firstChunk.includes("<!doctype html") || firstChunk.includes("<html")) {
      throw new Error("Feed returned HTML instead of RSS/Atom");
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function hydrateMissingImages(articles, options = {}) {
  const concurrency = Number(options.concurrency || process.env.IMAGE_CONCURRENCY || 5);
  const missing = articles.filter((article) => !article.imageUrl || shouldHydrateFromPage(article.imageUrl));

  await mapLimit(missing, concurrency, async (article) => {
    const hydratedImageUrl = await fetchMetaImage(article.url);

    if (hydratedImageUrl) {
      article.imageUrl = hydratedImageUrl;
    } else if (!article.imageUrl) {
      article.imageUrl = article.sourceImageUrl || null;
    }
  });

  return articles;
}

function shouldHydrateFromPage(imageUrl) {
  try {
    return /^i[0-2]\.wp\.com$/i.test(new URL(imageUrl).hostname);
  } catch {
    return false;
  }
}

function dedupeArticles(articles) {
  const seen = new Set();
  const deduped = [];

  for (const article of articles) {
    const key = `${article.feedUrl}:${article.canonicalUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(article);
  }

  return deduped;
}

async function fetchMetaImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "AlonsoDailyDigest/0.1 (+https://github.com/)"
      }
    });

    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;

    const html = (await response.text()).slice(0, 500000);
    const pageUrl = response.url || url;
    return metaImageFromHtml(html, pageUrl) || firstImageFromHtml(html, { baseUrl: pageUrl });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
