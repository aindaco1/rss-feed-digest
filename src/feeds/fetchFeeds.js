import Parser from "rss-parser";
import { mapLimit } from "../util/concurrency.js";
import { firstImageFromHtml, metaImageFromHtml } from "../util/html.js";
import { normalizeFeedItems } from "./normalizeArticles.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; AlonsoDailyDigest/0.1; +https://dustwave.xyz/)";
const BROWSER_FALLBACK_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const RETRYABLE_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

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

export async function fetchFeedXml(feedUrl, options = {}) {
  const attempts = Number(options.attempts || process.env.FEED_FETCH_ATTEMPTS || 3);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchFeedXmlOnce(feedUrl, options, attempt);
    } catch (error) {
      lastError = error;

      if (attempt >= attempts || !isRetryableFetchError(error)) {
        throw error;
      }

      await sleep(retryDelayMs(attempt, options));
    }
  }

  throw lastError;
}

async function fetchFeedXmlOnce(feedUrl, options = {}, attempt = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15000));
  const fetchImpl = options.fetchImpl || fetch;

  try {
    const response = await fetchImpl(feedUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: requestHeaders(options.headers, attempt)
    });

    if (!response.ok) {
      throw statusError(response.status);
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
      headers: requestHeaders({ accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" })
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

function requestHeaders(overrides = {}, attempt = 1) {
  return {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent": process.env.FEED_USER_AGENT || (attempt > 1 ? BROWSER_FALLBACK_USER_AGENT : DEFAULT_USER_AGENT),
    ...overrides
  };
}

function statusError(status) {
  const error = new Error(`Status code ${status}`);
  error.status = status;
  return error;
}

function isRetryableFetchError(error) {
  if (RETRYABLE_STATUSES.has(error.status)) return true;
  return error.name === "AbortError" || /fetch failed|network|timeout/i.test(error.message);
}

function retryDelayMs(attempt, options) {
  const base = Number(options.retryBaseDelayMs ?? process.env.FEED_RETRY_BASE_DELAY_MS ?? 750);
  const jitter = Number(options.retryJitterMs ?? process.env.FEED_RETRY_JITTER_MS ?? 250);
  return base * 2 ** (attempt - 1) + Math.floor(Math.random() * jitter);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
