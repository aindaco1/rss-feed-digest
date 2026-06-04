import * as cheerio from "cheerio";

export function cleanWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

export function htmlToText(html = "") {
  if (!html) return "";
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, form").remove();
  return cleanWhitespace($.root().text());
}

export function firstImageFromHtml(html = "", options = {}) {
  if (!html) return null;
  const candidates = imageCandidatesFromHtml(html);
  if (!candidates.length) return null;

  const best = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreImageCandidate(candidate)
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];

  const src = best?.candidate.src || null;
  return options.baseUrl ? normalizeImageUrl(src, options.baseUrl) : src;
}

export function imageCandidatesFromHtml(html = "") {
  const $ = cheerio.load(html);
  return $("img[src]")
    .map((_, element) => {
      const node = $(element);
      const src = node.attr("src")?.trim();
      const contextClass = [
        node.attr("class"),
        node.parent().attr("class"),
        node.closest("figure, a, div, article").attr("class")
      ]
        .filter(Boolean)
        .join(" ");

      return {
        src,
        alt: node.attr("alt") || "",
        className: contextClass,
        width: toNumber(node.attr("width")),
        height: toNumber(node.attr("height"))
      };
    })
    .get()
    .filter((candidate) => candidate.src);
}

export function metaImageFromHtml(html = "", pageUrl) {
  const $ = cheerio.load(html);
  const image =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $('meta[property="twitter:image"]').attr("content");

  if (!image) return null;

  return normalizeImageUrl(image, pageUrl);
}

export function normalizeImageUrl(rawUrl, baseUrl) {
  if (!rawUrl) return null;
  let value = decodeHtmlEntities(String(rawUrl).trim());
  if (!value || /^(?:data|blob):/i.test(value)) return null;

  if (value.startsWith("//")) {
    value = `${protocolFor(baseUrl)}${value}`;
  } else if (isBareHostUrl(value)) {
    value = `https://${value}`;
  }

  try {
    const normalized = new URL(value, baseUrl);
    removeDuplicatedHostPath(normalized, baseUrl);
    return normalized.toString();
  } catch {
    return value;
  }
}

function scoreImageCandidate(candidate) {
  const haystack = `${candidate.src} ${candidate.alt} ${candidate.className}`.toLowerCase();
  if (
    isLikelyNonArticleImageUrl(candidate.src) ||
    /(?:avatar|author|headshot|staff|profile|logo|icon|pixel|tracking|spacer|blank)/i.test(haystack)
  ) {
    return -1;
  }

  let score = 0;
  if (candidate.width >= 900 || candidate.height >= 500) score += 5;
  else if (candidate.width >= 600 || candidate.height >= 350) score += 4;
  else if (candidate.width >= 300 || candidate.height >= 200) score += 2;

  if (/(?:wp-block-image|size-large|wp-image|article|entry-content|post-content|featured)/i.test(candidate.className)) {
    score += 2;
  }

  return score;
}

function toNumber(value) {
  const number = Number.parseInt(value || "", 10);
  return Number.isFinite(number) ? number : 0;
}

const NAMED_HTML_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["hellip", "..."],
  ["ldquo", "\u201c"],
  ["lsquo", "\u2018"],
  ["mdash", "\u2014"],
  ["nbsp", " "],
  ["ndash", "\u2013"],
  ["quot", '"'],
  ["rdquo", "\u201d"],
  ["rsquo", "\u2019"],
  ["lt", "<"]
]);

export function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&#(\d+);?/g, (match, codePoint) => decodeNumericEntity(match, Number.parseInt(codePoint, 10)))
    .replace(/&#x([0-9a-f]+);?/gi, (match, codePoint) => decodeNumericEntity(match, Number.parseInt(codePoint, 16)))
    .replace(/&([a-z][a-z0-9]+);/gi, (match, name) => NAMED_HTML_ENTITIES.get(name.toLowerCase()) || match);
}

function decodeNumericEntity(match, codePoint) {
  if (!Number.isFinite(codePoint) || codePoint < 0) return match;

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return match;
  }
}

function protocolFor(baseUrl) {
  try {
    return new URL(baseUrl).protocol || "https:";
  } catch {
    return "https:";
  }
}

function isBareHostUrl(value) {
  return (
    !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
    /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#]|$)/i.test(value)
  );
}

export function isLikelyNonArticleImageUrl(value = "") {
  return /(?:avatar|author|headshot|staff|profile|logo|icon|pixel|tracking|spacer|blank|cropped-cropped)/i.test(String(value));
}

function removeDuplicatedHostPath(url, baseUrl) {
  if (!baseUrl) return;

  try {
    const base = new URL(baseUrl);
    const duplicatePrefix = `/${base.hostname}/`;

    if (url.hostname === base.hostname && url.pathname.startsWith(duplicatePrefix)) {
      url.pathname = `/${url.pathname.slice(duplicatePrefix.length)}`;
    }
  } catch {
    // Keep the resolved URL when the base cannot be parsed.
  }
}
