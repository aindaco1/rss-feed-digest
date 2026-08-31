import Parser from "rss-parser";
import { mapLimit } from "../util/concurrency.js";
import { discardResponseBody } from "../util/fetch.js";
import { firstImageFromHtml, metaImageFromHtml } from "../util/html.js";
import { isWebUrl } from "../util/urls.js";
import { isLikelySponsoredPost, normalizeFeedItems } from "./normalizeArticles.js";
import { feedbinApiUrl, feedbinAuthorization } from "./feedbin.js";
import { shouldSkipUnavailableGeneratedFeed } from "./generatedSubscriptions.js";

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
      ["media:group", "mediaGroup"],
      ["itunes:image", "itunesImage"]
    ]
  },
  timeout: 15000
});

export async function fetchArticles(config, window, options = {}) {
  const env = options.env || process.env;
  const concurrency = Number(options.concurrency || env.FEED_CONCURRENCY || 8);
  const activeFeeds = config.feeds.filter((feed) => !feed.disabled);
  const results = await mapLimit(activeFeeds, concurrency, async (feed) => {
    try {
      const xml = await fetchConfiguredFeedXml(feed, window, options);
      const parsed = await parser.parseString(xml);
      const normalizedArticles = normalizeFeedItems(feed, parsed, window);
      const articles = feed.excludeSponsored
        ? await filterSponsoredArticlePages(normalizedArticles, options)
        : normalizedArticles;
      return { feed, articles, error: null };
    } catch (error) {
      return { feed, articles: [], error };
    }
  });

  const articles = [];
  const failures = [];
  const skippedFeeds = config.feeds.filter((feed) => feed.disabled);

  for (const result of results) {
    if (result.error) {
      if (shouldSkipUnavailableGeneratedFeed(result.feed, result.error, options.env || process.env)) {
        skippedFeeds.push({
          ...result.feed,
          skipReason: result.error.message
        });
        continue;
      }

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
    skippedFeeds
  };
}

async function fetchConfiguredFeedXml(feed, window, options = {}) {
  if (shouldPreferFeedbinForWindow(feed, window, options)) {
    try {
      return await fetchFeedbinFeedAsRss(feed.feedUrl, options);
    } catch (error) {
      console.warn(`Feedbin preferred fetch failed for ${feed.title}, using direct feed: ${error.message}`);
    }
  }

  return fetchFeedXml(feed.feedUrl, options);
}

export async function fetchFeedXml(feedUrl, options = {}) {
  const env = options.env || process.env;
  const attempts = Number(options.attempts || env.FEED_FETCH_ATTEMPTS || 3);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchFeedXmlOnce(feedUrl, options, attempt);
    } catch (error) {
      lastError = error;

      if (attempt >= attempts || !isRetryableFetchError(error)) {
        let terminalError = error;

        if (isSubstackFeedUrl(feedUrl) && isRetryableFetchError(error)) {
          try {
            return await fetchSubstackArchiveAsRss(feedUrl, options);
          } catch (fallbackError) {
            terminalError = appendErrorMessage(
              terminalError,
              `Substack archive fallback failed: ${errorMessage(fallbackError)}`
            );
          }
        }

        if (hasFeedbinCredentials(options)) {
          try {
            return await fetchFeedbinFeedAsRss(feedUrl, options);
          } catch (fallbackError) {
            terminalError = appendErrorMessage(
              terminalError,
              `Feedbin fallback failed: ${errorMessage(fallbackError)}`
            );
          }
        } else if (isSubstackFeedUrl(feedUrl)) {
          terminalError = appendErrorMessage(terminalError, "Feedbin fallback not configured");
        }

        throw terminalError;
      }

      await sleep(retryDelayMs(attempt, options));
    }
  }

  throw lastError;
}

async function fetchFeedXmlOnce(feedUrl, options = {}, attempt = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs(options));
  const fetchImpl = options.fetchImpl || fetch;

  try {
    const response = await fetchImpl(feedUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: requestHeaders(options.headers, attempt, options.env)
    });

    if (!response.ok) {
      await discardResponseBody(response);
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
  const env = options.env || process.env;
  const concurrency = Number(options.concurrency || env.IMAGE_CONCURRENCY || 5);
  const missing = articles.filter((article) => !article.imageUrl || shouldHydrateFromPage(article.imageUrl));

  await mapLimit(missing, concurrency, async (article) => {
    const hydratedImageUrl = await fetchMetaImage(article.url, options);

    if (hydratedImageUrl) {
      article.imageUrl = hydratedImageUrl;
    } else if (!article.imageUrl) {
      article.imageUrl = article.sourceImageUrl || null;
    }
  });

  return articles;
}

async function filterSponsoredArticlePages(articles, options = {}) {
  const env = options.env || process.env;
  if (env.FETCH_SPONSORED_CHECKS === "false") return articles;

  const concurrency = Number(options.sponsoredCheckConcurrency || env.SPONSORED_CHECK_CONCURRENCY || 3);
  const checks = await mapLimit(articles, concurrency, async (article) => ({
    article,
    sponsored: await isSponsoredArticlePage(article, options)
  }));

  return checks.filter((check) => !check.sponsored).map((check) => check.article);
}

async function isSponsoredArticlePage(article, options = {}) {
  const html = await fetchArticleHtml(article.url, options);
  if (!html) return false;
  return isLikelySponsoredPost({
    title: article.title,
    summary: article.summary,
    text: article.text,
    contentHtml: html,
    scopeContentToTitle: true
  });
}

async function fetchArticleHtml(url, options = {}) {
  const page = await fetchHtmlPage(url, {
    ...options,
    timeoutMs: Number(options.sponsoredCheckTimeoutMs || 8000)
  });
  return page?.html || null;
}

async function fetchHtmlPage(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 8000));
  const fetchImpl = options.fetchImpl || fetch;

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: requestHeaders(
        { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        1,
        options.env
      )
    });

    if (!response.ok) {
      await discardResponseBody(response);
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      await discardResponseBody(response);
      return null;
    }

    return {
      html: (await response.text()).slice(0, 500000),
      url: response.url || url
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

async function fetchMetaImage(url, options = {}) {
  const page = await fetchHtmlPage(url, {
    ...options,
    timeoutMs: Number(options.metaImageTimeoutMs || 8000)
  });
  if (!page) return null;

  return metaImageFromHtml(page.html, page.url) || firstImageFromHtml(page.html, { baseUrl: page.url });
}

async function fetchSubstackArchiveAsRss(feedUrl, options = {}) {
  const feed = new URL(feedUrl);
  const archiveUrl = new URL("/api/v1/archive", feed.origin);
  archiveUrl.searchParams.set("sort", "new");
  archiveUrl.searchParams.set("search", "");
  archiveUrl.searchParams.set("offset", "0");
  const env = options.env || process.env;
  archiveUrl.searchParams.set("limit", String(options.substackArchiveLimit || env.SUBSTACK_ARCHIVE_LIMIT || 30));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs(options));
  const fetchImpl = options.fetchImpl || fetch;

  try {
    const response = await fetchImpl(archiveUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: requestHeaders({ accept: "application/json, text/plain, */*" }, 2, env)
    });

    if (!response.ok) {
      await discardResponseBody(response);
      throw statusError(response.status);
    }

    const posts = await response.json();
    if (!Array.isArray(posts)) {
      throw new Error("Archive response was not a post list");
    }

    return substackPostsToRssXml(feed, posts);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFeedbinFeedAsRss(feedUrl, options = {}) {
  const env = options.env || process.env;
  const subscriptions = await fetchFeedbinSubscriptions(options);
  const subscription = findMatchingFeedbinSubscription(feedUrl, subscriptions);

  if (!subscription) {
    throw new Error("No matching subscription");
  }

  const entriesUrl = feedbinApiUrl(`/feeds/${subscription.feed_id}/entries.json`, options);
  entriesUrl.searchParams.set("per_page", String(options.feedbinPerPage || env.FEEDBIN_PER_PAGE || 100));
  entriesUrl.searchParams.set("mode", "extended");
  entriesUrl.searchParams.set("include_enclosure", "true");
  entriesUrl.searchParams.set("include_original", "true");

  const entries = await fetchFeedbinJson(entriesUrl, options);
  if (!Array.isArray(entries)) {
    throw new Error("Entries response was not a list");
  }

  return feedbinEntriesToRssXml(subscription, entries);
}

async function fetchFeedbinSubscriptions(options = {}) {
  const subscriptionsUrl = feedbinApiUrl("/subscriptions.json", options);
  const subscriptions = await fetchFeedbinJson(subscriptionsUrl, options);

  if (!Array.isArray(subscriptions)) {
    throw new Error("Subscriptions response was not a list");
  }

  return subscriptions;
}

async function fetchFeedbinJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs(options));
  const fetchImpl = options.fetchImpl || fetch;

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "application/json",
        authorization: feedbinAuthorization(options.env || process.env)
      }
    });

    if (!response.ok) {
      await discardResponseBody(response);
      throw statusError(response.status);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function requestHeaders(overrides = {}, attempt = 1, env = process.env) {
  return {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent": env?.FEED_USER_AGENT || (attempt > 1 ? BROWSER_FALLBACK_USER_AGENT : DEFAULT_USER_AGENT),
    ...overrides
  };
}

function statusError(status) {
  const error = new Error(`Status code ${status}`);
  error.status = status;
  return error;
}

function appendErrorMessage(error, detail) {
  const wrapped = new Error(`${errorMessage(error)}; ${detail}`, { cause: error });

  if (error?.name && error.name !== "Error") wrapped.name = error.name;
  if (error?.status !== undefined) wrapped.status = error.status;

  return wrapped;
}

function errorMessage(error) {
  return error?.message || String(error);
}

function fetchTimeoutMs(options = {}) {
  const env = options.env || process.env;
  return Number(options.timeoutMs ?? env.FEED_FETCH_TIMEOUT_MS ?? 30000);
}

function isRetryableFetchError(error) {
  if (RETRYABLE_STATUSES.has(error?.status)) return true;
  return error?.name === "AbortError" || /fetch failed|network|timeout/i.test(errorMessage(error));
}

function retryDelayMs(attempt, options) {
  const env = options.env || process.env;
  const base = Number(options.retryBaseDelayMs ?? env.FEED_RETRY_BASE_DELAY_MS ?? 750);
  const jitter = Number(options.retryJitterMs ?? env.FEED_RETRY_JITTER_MS ?? 250);
  return base * 2 ** (attempt - 1) + Math.floor(Math.random() * jitter);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSubstackFeedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname.endsWith(".substack.com") && url.pathname.replace(/\/+$/, "") === "/feed";
  } catch {
    return false;
  }
}

function hasFeedbinCredentials(options = {}) {
  const env = options.env || process.env;
  return Boolean(env.FEEDBIN_EMAIL && env.FEEDBIN_PASSWORD);
}

function shouldPreferFeedbinForWindow(feed, window, options = {}) {
  const env = options.env || process.env;
  if (env.FEEDBIN_PREFER_FOR_BACKFILLS === "false") return false;
  if (feed.source !== "feedbin" || !hasFeedbinCredentials(options)) return false;
  if (feed.preferFeedbinBackfill === false) return false;
  if (options.preferFeedbin) return true;

  const backfillAfterHours = Number(options.feedbinBackfillAfterHours ?? env.FEEDBIN_BACKFILL_AFTER_HOURS ?? 6);
  if (!Number.isFinite(backfillAfterHours) || backfillAfterHours < 0) return false;

  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) return false;
  return now.getTime() - window.end.getTime() >= backfillAfterHours * 60 * 60 * 1000;
}

function findMatchingFeedbinSubscription(feedUrl, subscriptions) {
  return subscriptions.find((subscription) => {
    return (
      urlsMatch(feedUrl, subscription.feed_url) ||
      urlsMatch(feedUrl, subscription.site_url) ||
      rootSiteMatchesSimpleFeed(feedUrl, subscription.site_url) ||
      substackHostsMatch(feedUrl, subscription.feed_url) ||
      substackHostsMatch(feedUrl, subscription.site_url)
    );
  });
}

function urlsMatch(left, right) {
  const normalizedLeft = normalizeComparableUrl(left);
  const normalizedRight = normalizeComparableUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function substackHostsMatch(left, right) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.hostname.endsWith(".substack.com") && leftUrl.hostname === rightUrl.hostname;
  } catch {
    return false;
  }
}

function rootSiteMatchesSimpleFeed(feedUrl, siteUrl) {
  try {
    const feed = new URL(feedUrl);
    const site = new URL(siteUrl);

    return (
      comparableHost(feed.hostname) === comparableHost(site.hostname) &&
      isSimpleFeedPath(feed.pathname) &&
      isRootPath(site.pathname)
    );
  } catch {
    return false;
  }
}

function comparableHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

function isRootPath(pathname) {
  return !pathname || pathname === "/";
}

function isSimpleFeedPath(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "").toLowerCase();
  return path === "/feed" || path === "/rss" || path === "/atom.xml" || path === "/feed.xml" || path === "/rss.xml";
}

function normalizeComparableUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.search = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function feedbinEntriesToRssXml(subscription, entries) {
  const items = entries.map(feedbinEntryToRssItem).join("");
  const title = subscription.title || subscription.feed_url || "Feedbin Feed";
  const siteUrl = subscription.site_url || subscription.feed_url || "";

  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${escapeXml(title)}</title><link>${escapeXml(siteUrl)}</link><description>${escapeXml(title)}</description>${items}</channel></rss>`;
}

function feedbinEntryToRssItem(entry) {
  const link = feedbinEntryUrl(entry);
  const title = entry.title || link || entry.url || "Untitled";
  const publishedAt = new Date(entry.published || entry.created_at || Date.now());
  const imageUrl = imageFromFeedbinEntry(entry);
  const imageTags = imageUrl
    ? `<enclosure url="${escapeXml(imageUrl)}" type="${guessImageType(imageUrl)}" /><media:content url="${escapeXml(imageUrl)}" medium="image" type="${guessImageType(imageUrl)}" />`
    : "";
  const author = entry.author ? `<author>${escapeXml(entry.author)}</author>` : "";

  return `<item><title>${escapeXml(title)}</title><link>${escapeXml(link)}</link><guid isPermaLink="false">${escapeXml(String(entry.id || link))}</guid>${author}<pubDate>${escapeXml(publishedAt.toUTCString())}</pubDate><description>${cdata(entry.summary || "")}</description><content:encoded>${cdata(entry.content || entry.summary || "")}</content:encoded>${imageTags}</item>`;
}

function feedbinEntryUrl(entry) {
  return (
    [
      entry.url,
      entry.original?.url,
      entry.original?.entry_id,
      entry.json_feed?.url,
      entry.extracted_articles?.[0]?.url
    ].find(isWebUrl) || ""
  );
}

function imageFromFeedbinEntry(entry) {
  if (entry.enclosure?.enclosure_type?.startsWith("image/") && entry.enclosure.enclosure_url) {
    return entry.enclosure.enclosure_url;
  }

  const images = entry.images || {};
  if (images.original_url) return images.original_url;

  for (const value of Object.values(images)) {
    if (value?.cdn_url) return value.cdn_url;
  }

  return null;
}

function substackPostsToRssXml(feed, posts) {
  const publicationTitle = feed.hostname.replace(/\.substack\.com$/i, "").replace(/[-_]/g, " ");
  const items = posts.map((post) => substackPostToRssItem(feed, post)).join("");

  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${escapeXml(publicationTitle)}</title><link>${escapeXml(feed.origin)}</link><description>${escapeXml(publicationTitle)}</description>${items}</channel></rss>`;
}

function substackPostToRssItem(feed, post) {
  const title = post.title || post.social_title || post.slug || "Untitled";
  const link = post.canonical_url || new URL(`/p/${post.slug}`, feed.origin).toString();
  const publishedAt = new Date(post.post_date || post.published_at || post.updated_at || Date.now());
  const description = post.subtitle || post.description || post.truncated_body_text || "";
  const content = post.body_html || post.description || post.subtitle || post.truncated_body_text || "";
  const imageUrl = post.cover_image || post.podcast_episode_image_url || post.podcast_episode_image_info?.url || "";
  const imageTags = imageUrl
    ? `<enclosure url="${escapeXml(imageUrl)}" type="${guessImageType(imageUrl)}" /><media:content url="${escapeXml(imageUrl)}" medium="image" type="${guessImageType(imageUrl)}" />`
    : "";

  return `<item><title>${escapeXml(title)}</title><link>${escapeXml(link)}</link><guid isPermaLink="true">${escapeXml(link)}</guid><pubDate>${escapeXml(publishedAt.toUTCString())}</pubDate><description>${cdata(description)}</description><content:encoded>${cdata(content)}</content:encoded>${imageTags}</item>`;
}

function guessImageType(imageUrl) {
  const pathname = safePathname(imageUrl);
  if (/\.png$/i.test(pathname)) return "image/png";
  if (/\.gif$/i.test(pathname)) return "image/gif";
  if (/\.webp$/i.test(pathname)) return "image/webp";
  return "image/jpeg";
}

function safePathname(rawUrl) {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return "";
  }
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cdata(value) {
  return `<![CDATA[${String(value ?? "").replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}
