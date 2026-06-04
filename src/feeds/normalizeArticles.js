import crypto from "node:crypto";
import * as cheerio from "cheerio";
import {
  firstImageFromHtml,
  htmlToText,
  cleanWhitespace,
  decodeHtmlEntities,
  normalizeImageUrl,
  isLikelyNonArticleImageUrl
} from "../util/html.js";

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term"
]);

export function normalizeFeedItems(feedConfig, parsedFeed, window) {
  const sourceImageUrl = pickSourceImage(feedConfig, parsedFeed);

  return (parsedFeed.items || [])
    .filter((item) => shouldIncludeItem(feedConfig, item))
    .map((item) => normalizeItem(feedConfig, item, sourceImageUrl))
    .filter(Boolean)
    .filter((article) => {
      const publishedAt = new Date(article.publishedAt);
      return publishedAt >= window.start && publishedAt < window.end;
    });
}

function shouldIncludeItem(feedConfig, item) {
  const title = textFromMaybeHtml(item.title || "");

  if (feedConfig.excludeSingleIssues && isLikelySingleIssueComicTitle(title)) return false;
  if (!feedConfig.titleIncludes) return true;

  return title.toLowerCase().includes(String(feedConfig.titleIncludes).toLowerCase());
}

function normalizeItem(feedConfig, item, sourceImageUrl) {
  const rawTitle = textFromMaybeHtml(item.title || "");
  const title = normalizeDisplayTitle(feedConfig, rawTitle);
  const url = item.link || item.guid || item.id;
  const publishedAt = parsePublishedAt(item);

  if (!rawTitle || !url || !publishedAt) return null;

  const contentHtml = item.contentEncoded || item["content:encoded"] || item.content || item.description || "";
  const text = stripFeedBoilerplate(htmlToText(contentHtml), { title: rawTitle });
  const summarySource = item.contentSnippet || item.summary || item.description || text;
  const summary = (stripFeedBoilerplate(textFromMaybeHtml(summarySource), { title: rawTitle }) || text).slice(0, 1200);

  if (feedConfig.excludeSponsored && isLikelySponsoredPost({ title: rawTitle, summary, text, contentHtml })) return null;

  const canonicalUrl = canonicalizeUrl(url);
  const imageUrl = pickImageFromItem(item, contentHtml, canonicalUrl);

  return {
    id: hash(`${feedConfig.feedUrl}:${canonicalUrl}:${rawTitle}`),
    title,
    url,
    canonicalUrl,
    sourceName: feedConfig.title,
    siteUrl: feedConfig.siteUrl,
    feedUrl: feedConfig.feedUrl,
    sourceType: feedConfig.source,
    topicHint: feedConfig.topic,
    author: item.creator || item["dc:creator"] || item.author || null,
    publishedAt: publishedAt.toISOString(),
    summary,
    text: text.slice(0, 6000),
    imageUrl,
    sourceImageUrl
  };
}

function parsePublishedAt(item) {
  const raw = item.isoDate || item.pubDate || item.date || item.published;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function canonicalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const param of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(param.toLowerCase()) || param.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(param);
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function pickImageFromItem(item, contentHtml, baseUrl) {
  const candidates = [
    item.enclosure,
    item.enclosures,
    item.mediaContent,
    item["media:content"],
    item.mediaThumbnail,
    item["media:thumbnail"],
    item.itunesImage,
    item["itunes:image"],
    firstImageFromHtml(contentHtml)
  ];

  for (const candidate of candidates) {
    const url = extractImageUrl(candidate);
    if (url) return absolutize(url, baseUrl);
  }

  return null;
}

function pickSourceImage(feedConfig, parsedFeed) {
  const rawImage =
    feedConfig.fallbackImageUrl ||
    extractImageUrl(parsedFeed.image, { allowNonArticleImage: true }) ||
    extractImageUrl(parsedFeed.itunesImage, { allowNonArticleImage: true });
  return rawImage ? normalizeImageUrl(rawImage, feedConfig.siteUrl || parsedFeed.link || feedConfig.feedUrl) : null;
}

function extractImageUrl(value, options = {}) {
  if (!value) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractImageUrl(item, options);
      if (url) return url;
    }
    return null;
  }

  if (typeof value === "string") {
    return looksLikeImage(value) && isAllowedImage(value, options) ? value : null;
  }

  const type = value.type || value.$?.type || "";
  const url = value.url || value.href || value.$?.url || value.$?.href;

  if (!url) return null;
  if (String(type).startsWith("audio/")) return null;
  if ((String(type).startsWith("image/") || looksLikeImage(url)) && isAllowedImage(url, options)) return url;

  return null;
}

function isAllowedImage(url, options) {
  return options.allowNonArticleImage || !isLikelyNonArticleImageUrl(url);
}

function looksLikeImage(url) {
  return /\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(String(url)) || String(url).includes("substackcdn.com/image/");
}

function absolutize(url, baseUrl) {
  return normalizeImageUrl(url, baseUrl) || url;
}

function textFromMaybeHtml(value) {
  const text = String(value || "");
  return /<[^>]+>/.test(text) ? htmlToText(text) : cleanWhitespace(decodeHtmlEntities(text));
}

function normalizeDisplayTitle(feedConfig, title) {
  if (!isYtsFeed(feedConfig)) return title;
  return normalizeYtsTitle(title);
}

function isYtsFeed(feedConfig) {
  const feedSignature = [feedConfig.title, feedConfig.feedUrl, feedConfig.siteUrl].filter(Boolean).join(" ");
  return /\byts\b/i.test(feedSignature);
}

function normalizeYtsTitle(title) {
  const bracketRun = title.match(/\s*(?:\[[^\]]+\]\s*)+$/);
  if (!bracketRun) return title;

  const base = title.slice(0, bracketRun.index).trim();
  const tags = [...bracketRun[0].matchAll(/\[([^\]]+)\]/g)]
    .map(([, tag]) => cleanWhitespace(tag))
    .filter(Boolean)
    .filter((tag) => !isYtsSourceTag(tag));

  if (!base || !tags.length) return base || title;

  const detailTags = tags.filter((tag) => !isYtsBaselineReleaseTag(tag));
  const displayTags = detailTags.length ? detailTags : tags;

  return displayTags.length ? `${base} -- (${displayTags.join(", ")})` : base;
}

function isYtsSourceTag(tag) {
  return /^YTS(?:[.\s-].*)?$/i.test(tag);
}

function isYtsBaselineReleaseTag(tag) {
  return /^(?:\d{3,4}p|WEBRip|WEB-DL|BluRay|BRRip|HDRip|DVDRip)$/i.test(tag);
}

function isLikelySingleIssueComicTitle(title) {
  return /(?:^|[\s([{:;,-])#\d+[a-z]?(?=$|[\s)\],.:;–—-])/i.test(title);
}

export function isLikelySponsoredPost({
  title = "",
  summary = "",
  text = "",
  contentHtml = "",
  scopeContentToTitle = false
} = {}) {
  const scopedContentText = scopeContentToTitle ? htmlTextForCurrentArticle(contentHtml, title) : htmlToText(contentHtml);
  const haystack = cleanWhitespace(`${title} ${summary} ${text} ${scopedContentText}`);
  return SPONSORED_POST_PATTERNS.some((pattern) => pattern.test(haystack));
}

function htmlTextForCurrentArticle(html, title) {
  if (!html) return "";

  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, form").remove();

  const normalizedTitle = normalizeForMatch(title);
  if (normalizedTitle) {
    const heading = $("h1, h2")
      .filter((_, element) => normalizeForMatch($(element).text()).includes(normalizedTitle))
      .first();

    if (heading.length) {
      const articleContainer = heading.closest("article, main, [role='main'], .post, .entry");
      const body = articleContainer
        .find(".entry-content, .post-content, .article-content, .post-body, .article-body")
        .first();
      if (body.length) return cleanWhitespace(body.text());
      if (articleContainer.length) return cleanWhitespace(articleContainer.text());
    }
  }

  return cleanWhitespace($.root().text()).slice(0, 3000);
}

function normalizeForMatch(value) {
  return cleanWhitespace(decodeHtmlEntities(value))
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

const SPONSORED_POST_PATTERNS = [
  /\bDisclosure:\s*.{0,260}\b(?:earns?|may\s+earn|receives?)\s+(?:a\s+)?commission\b/i,
  /\b(?:we|boing\s+boing)\s+(?:may\s+)?(?:earn|receive)s?\s+(?:a\s+)?commission\s+(?:on|from|when|if|through)\b/i,
  /\bpurchases?\s+made\s+through\s+links?\s+in\s+this\s+post\b/i,
  /\bthis\s+(?:is\s+)?(?:a\s+)?sponsored\s+(?:post|content|article)\b/i,
  /\bpaid\s+(?:post|content|placement)\b/i,
  /\bthis\s+(?:post|article)\s+contains\s+affiliate\s+links\b/i
];

export function stripFeedBoilerplate(value, options = {}) {
  let cleaned = cleanWhitespace(value);
  if (!cleaned) return "";

  const title = cleanWhitespace(options.title || "");
  if (title) {
    const escapedTitle = escapeRegExp(title);
    const titleFooterPatterns = [
      new RegExp(`\\s*(?:The\\s+post\\s+)?${escapedTitle}\\s+appeared\\s+first\\s+on\\s+[\\s\\S]{1,180}$`, "i"),
      new RegExp(`\\s*(?:The\\s+post\\s+)?${escapedTitle}\\s+first\\s+appeared\\s+on\\s+[\\s\\S]{1,180}$`, "i"),
      new RegExp(`\\s*The\\s+post\\s+${escapedTitle}\\s+appear(?:ed)?(?:\\s+first\\s+on\\s+[\\s\\S]{0,180})?$`, "i"),
      new RegExp(`\\s*This\\s+article,?\\s+["“]?${escapedTitle}["”]?\\s+first\\s+appeared\\s+on\\s+[\\s\\S]{1,180}$`, "i")
    ];

    for (const pattern of titleFooterPatterns) {
      cleaned = cleaned.replace(pattern, "");
    }
  }

  const genericFooterPatterns = [
    /\s*The\s+post\s+[\s\S]{0,900}?\s+appeared\s+first\s+on\s+[\s\S]{1,180}$/i,
    /\s*The\s+post\s+[\s\S]{0,900}?\s+first\s+appeared\s+on\s+[\s\S]{1,180}$/i,
    /\s*The\s+post\s+[\s\S]{0,900}?\s+appear(?:ed)?(?:\s+first\s+on\s+[\s\S]{0,180})?$/i,
    /\s*This\s+article,?\s+[\s\S]{0,900}?\s+first\s+appeared\s+on\s+[\s\S]{1,180}$/i
  ];

  for (const pattern of genericFooterPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned.replace(/\s*[—-]\s*Read the rest\s*$/i, "").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}
