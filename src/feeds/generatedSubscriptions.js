import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapLimit } from "../util/concurrency.js";
import { discardResponseBody } from "../util/fetch.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; AlonsoDailyDigest/0.1; +https://dustwave.xyz/)";
const UNAVAILABLE_STATUSES = new Set([404, 410]);

export function shouldSkipUnavailableGeneratedFeed(feed, error, env = process.env) {
  if (!UNAVAILABLE_STATUSES.has(error?.status)) return false;
  if (feed.source === "podcast") return env.OVERCAST_SKIP_UNAVAILABLE !== "false";
  if (feed.source === "youtube") return env.YOUTUBE_SKIP_UNAVAILABLE !== "false";
  return false;
}

export async function filterUnavailableGeneratedFeeds(feeds, options = {}) {
  const checks = await mapLimit(feeds, options.concurrency ?? 5, async (feed) => ({
    feed,
    unavailable: await unavailableFeedReason(feed, options)
  }));

  return {
    activeFeeds: checks.filter((check) => !check.unavailable).map((check) => check.feed),
    skippedFeeds: checks
      .filter((check) => check.unavailable)
      .map((check) => ({
        title: check.feed.title,
        feedUrl: check.feed.feedUrl,
        reason: check.unavailable
      }))
  };
}

async function unavailableFeedReason(feed, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  const fetchImpl = options.fetchImpl || fetch;
  const env = options.env || process.env;

  try {
    const response = await fetchImpl(feed.feedUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "user-agent": env.FEED_USER_AGENT || DEFAULT_USER_AGENT
      }
    });

    await discardResponseBody(response);
    return UNAVAILABLE_STATUSES.has(response.status) ? `Status code ${response.status}` : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function removeEmptyValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined && fieldValue !== "")
  );
}

export function writeJson(outputPath, payload) {
  const path = pathString(outputPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

export function pathString(value) {
  return value instanceof URL ? fileURLToPath(value) : String(value);
}
