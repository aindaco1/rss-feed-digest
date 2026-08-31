import { existsSync, readFileSync } from "node:fs";
import * as cheerio from "cheerio/slim";
import { isDirectRun } from "../util/modules.js";
import {
  filterUnavailableGeneratedFeeds,
  pathString,
  removeEmptyValues,
  writeJson
} from "./generatedSubscriptions.js";

const DEFAULT_OUTPUT_URL = new URL("../../config/podcast-subscriptions.json", import.meta.url);
const DEFAULT_MAX_EPISODES_PER_FEED = 0;

export async function syncOvercastSubscriptions(options = {}) {
  const env = options.env || process.env;
  const outputPath = options.outputPath || env.OVERCAST_SUBSCRIPTIONS_PATH || DEFAULT_OUTPUT_URL;
  const topic = options.topic || env.OVERCAST_TOPIC || "Podcasts";
  const maxSubscriptions = Number(options.maxSubscriptions || env.OVERCAST_MAX_SUBSCRIPTIONS || 0);
  const maxEpisodesPerFeed = Number(
    options.maxEpisodesPerFeed ?? env.OVERCAST_MAX_EPISODES_PER_FEED ?? DEFAULT_MAX_EPISODES_PER_FEED
  );
  const opml = options.opml || readOvercastOpml(env);
  const feeds = opmlToPodcastFeeds(opml, { topic, maxSubscriptions, maxEpisodesPerFeed });
  const { activeFeeds, skippedFeeds } =
    options.skipUnavailable === false || env.OVERCAST_SKIP_UNAVAILABLE === "false"
      ? { activeFeeds: feeds, skippedFeeds: [] }
      : await filterUnavailableGeneratedFeeds(feeds, {
          fetchImpl: options.fetchImpl || fetch,
          env,
          concurrency: Number(options.checkConcurrency || env.OVERCAST_CHECK_CONCURRENCY || 5),
          timeoutMs: Number(options.timeoutMs || env.OVERCAST_CHECK_TIMEOUT_MS || 8000)
        });

  writeJson(outputPath, {
    generatedAt: new Date().toISOString(),
    source: "overcast-opml",
    feeds: activeFeeds,
    skippedFeeds
  });

  return {
    outputPath,
    feedCount: activeFeeds.length,
    skippedCount: skippedFeeds.length
  };
}

export function opmlToPodcastFeeds(opml, options = {}) {
  const topic = options.topic || "Podcasts";
  const maxSubscriptions = Number(options.maxSubscriptions || 0);
  const maxEpisodesPerFeed = Number(options.maxEpisodesPerFeed ?? DEFAULT_MAX_EPISODES_PER_FEED);
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
    const overcastEpisodes = overcastEpisodesFromOutline($, outline, { maxEpisodesPerFeed });

    feeds.push(
      removeEmptyValues({
        title,
        feedUrl,
        siteUrl,
        topic,
        source: "podcast",
        overcastEpisodes: overcastEpisodes.length ? overcastEpisodes : null
      })
    );

    if (maxSubscriptions > 0 && feeds.length >= maxSubscriptions) return false;
  });

  return feeds.sort((left, right) => left.title.localeCompare(right.title));
}

export function readOvercastOpml(env = process.env) {
  if (env.OVERCAST_OPML_PATH) {
    if (!existsSync(env.OVERCAST_OPML_PATH)) {
      throw new Error(`OVERCAST_OPML_PATH does not exist: ${env.OVERCAST_OPML_PATH}`);
    }
    return readFileSync(env.OVERCAST_OPML_PATH, "utf8");
  }

  if (env.OVERCAST_OPML_BASE64) {
    return Buffer.from(env.OVERCAST_OPML_BASE64, "base64").toString("utf8");
  }

  if (env.OVERCAST_OPML) {
    return env.OVERCAST_OPML;
  }

  throw new Error("Set OVERCAST_OPML_BASE64, OVERCAST_OPML, or OVERCAST_OPML_PATH before running Overcast sync.");
}

function cleanAttribute(value) {
  return String(value || "").trim();
}

function overcastEpisodesFromOutline($, feedOutline, options = {}) {
  const maxEpisodesPerFeed = Number(options.maxEpisodesPerFeed ?? DEFAULT_MAX_EPISODES_PER_FEED);

  const episodes = [];
  const seen = new Set();

  feedOutline.find("outline").each((_, element) => {
    if (maxEpisodesPerFeed > 0 && episodes.length >= maxEpisodesPerFeed) return false;

    const outline = $(element);
    const overcastUrl = overcastEpisodeUrl(outline);
    if (!overcastUrl) return;

    const title =
      cleanAttribute(outline.attr("title")) ||
      cleanAttribute(outline.attr("text")) ||
      cleanAttribute(outline.attr("name"));
    const url = cleanAttribute(outline.attr("url") || outline.attr("htmlUrl") || outline.attr("htmlurl"));
    const guid = cleanAttribute(outline.attr("guid") || outline.attr("episodeGuid") || outline.attr("episodeguid"));
    const enclosureUrl = cleanAttribute(outline.attr("enclosureUrl") || outline.attr("enclosureurl"));
    const publishedAt = cleanAttribute(
      outline.attr("pubDate") || outline.attr("pubdate") || outline.attr("published") || outline.attr("date")
    );

    if (seen.has(overcastUrl)) return;
    seen.add(overcastUrl);

    episodes.push(
      removeEmptyValues({
        title,
        url,
        guid,
        enclosureUrl,
        publishedAt,
        overcastUrl
      })
    );
  });

  return episodes;
}

function overcastEpisodeUrl(outline) {
  const value = cleanAttribute(outline.attr("overcastUrl") || outline.attr("overcasturl"));
  if (!value) return null;

  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname === "overcast.fm") {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
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

if (isDirectRun(import.meta.url)) {
  try {
    const result = await syncOvercastSubscriptions();
    if (result.skippedCount) {
      console.log(`Skipped ${result.skippedCount} unavailable podcast subscription feed(s).`);
    }
    console.log(`Wrote ${result.feedCount} podcast subscription feed(s) to ${pathString(result.outputPath)}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
