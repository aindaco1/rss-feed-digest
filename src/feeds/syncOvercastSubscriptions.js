import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as cheerio from "cheerio";

const DEFAULT_OUTPUT_URL = new URL("../../config/podcast-subscriptions.json", import.meta.url);

export async function syncOvercastSubscriptions(options = {}) {
  const env = options.env || process.env;
  const outputPath = options.outputPath || env.OVERCAST_SUBSCRIPTIONS_PATH || DEFAULT_OUTPUT_URL;
  const topic = options.topic || env.OVERCAST_TOPIC || "Podcasts";
  const maxSubscriptions = Number(options.maxSubscriptions || env.OVERCAST_MAX_SUBSCRIPTIONS || 0);
  const opml = options.opml || readOvercastOpml(env);
  const feeds = opmlToPodcastFeeds(opml, { topic, maxSubscriptions });

  writeJson(outputPath, {
    generatedAt: new Date().toISOString(),
    source: "overcast-opml",
    feeds
  });

  return {
    outputPath,
    feedCount: feeds.length
  };
}

export function opmlToPodcastFeeds(opml, options = {}) {
  const topic = options.topic || "Podcasts";
  const maxSubscriptions = Number(options.maxSubscriptions || 0);
  const $ = cheerio.load(opml, { xmlMode: true });
  const seen = new Set();
  const feeds = [];

  $("outline[xmlUrl], outline[xmlurl]").each((_, element) => {
    const outline = $(element);
    const feedUrl = cleanAttribute(outline.attr("xmlUrl") || outline.attr("xmlurl"));
    if (!feedUrl) return;

    const normalizedFeedUrl = normalizeComparableUrl(feedUrl);
    if (!normalizedFeedUrl || seen.has(normalizedFeedUrl)) return;
    seen.add(normalizedFeedUrl);

    const title =
      cleanAttribute(outline.attr("title")) ||
      cleanAttribute(outline.attr("text")) ||
      cleanAttribute(outline.attr("name")) ||
      hostnameTitle(feedUrl);
    const siteUrl = cleanAttribute(outline.attr("htmlUrl") || outline.attr("htmlurl")) || siteUrlFromFeedUrl(feedUrl);

    feeds.push(
      removeEmptyValues({
        title,
        feedUrl,
        siteUrl,
        topic,
        source: "podcast"
      })
    );

    if (maxSubscriptions > 0 && feeds.length >= maxSubscriptions) return false;
  });

  return feeds.sort((left, right) => left.title.localeCompare(right.title));
}

export function readOvercastOpml(env = process.env) {
  if (env.OVERCAST_OPML_BASE64) {
    return Buffer.from(env.OVERCAST_OPML_BASE64, "base64").toString("utf8");
  }

  if (env.OVERCAST_OPML) {
    return env.OVERCAST_OPML;
  }

  if (env.OVERCAST_OPML_PATH) {
    if (!existsSync(env.OVERCAST_OPML_PATH)) {
      throw new Error(`OVERCAST_OPML_PATH does not exist: ${env.OVERCAST_OPML_PATH}`);
    }
    return readFileSync(env.OVERCAST_OPML_PATH, "utf8");
  }

  throw new Error("Set OVERCAST_OPML_BASE64, OVERCAST_OPML, or OVERCAST_OPML_PATH before running Overcast sync.");
}

function cleanAttribute(value) {
  return String(value || "").trim();
}

function normalizeComparableUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function siteUrlFromFeedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.hostname}/`;
  } catch {
    return "";
  }
}

function hostnameTitle(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Podcast";
  }
}

function removeEmptyValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined && fieldValue !== "")
  );
}

function writeJson(outputPath, payload) {
  const path = outputPath instanceof URL ? fileURLToPath(outputPath) : String(outputPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await syncOvercastSubscriptions();
    console.log(`Wrote ${result.feedCount} podcast subscription feed(s) to ${pathString(result.outputPath)}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

function pathString(value) {
  return value instanceof URL ? fileURLToPath(value) : String(value);
}
