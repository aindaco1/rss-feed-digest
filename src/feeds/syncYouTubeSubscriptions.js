import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SUBSCRIPTIONS_URL = "https://www.googleapis.com/youtube/v3/subscriptions";
const DEFAULT_OUTPUT_URL = new URL("../../config/youtube-subscriptions.json", import.meta.url);

export async function syncYouTubeSubscriptions(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const credentials = youtubeCredentials(env);
  const outputPath = options.outputPath || env.YOUTUBE_SUBSCRIPTIONS_PATH || DEFAULT_OUTPUT_URL;
  const topic = options.topic || env.YOUTUBE_TOPIC || "YouTube";
  const maxSubscriptions = Number(options.maxSubscriptions || env.YOUTUBE_MAX_SUBSCRIPTIONS || 0);

  const accessToken = await refreshAccessToken(credentials, fetchImpl);
  const subscriptions = await fetchAllSubscriptions(accessToken, {
    fetchImpl,
    maxSubscriptions
  });
  const feeds = youtubeSubscriptionItemsToFeeds(subscriptions, { topic });

  writeJson(outputPath, {
    generatedAt: new Date().toISOString(),
    source: "youtube-subscriptions",
    feeds
  });

  return {
    outputPath,
    subscriptionCount: subscriptions.length,
    feedCount: feeds.length
  };
}

export function youtubeSubscriptionItemsToFeeds(items, options = {}) {
  const topic = options.topic || "YouTube";
  const seen = new Set();
  const feeds = [];

  for (const item of items || []) {
    const channelId = item?.snippet?.resourceId?.channelId;
    if (!channelId || seen.has(channelId)) continue;
    seen.add(channelId);

    const title = item.snippet.title || item.snippet.channelTitle || channelId;
    feeds.push({
      title,
      feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
      siteUrl: `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`,
      topic,
      source: "youtube",
      fallbackImageUrl: bestThumbnailUrl(item.snippet.thumbnails)
    });
  }

  return feeds
    .map((feed) => removeEmptyValues(feed))
    .sort((left, right) => left.title.localeCompare(right.title));
}

async function refreshAccessToken(credentials, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: credentials.YOUTUBE_CLIENT_ID,
      client_secret: credentials.YOUTUBE_CLIENT_SECRET,
      refresh_token: credentials.YOUTUBE_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`YouTube token refresh failed: ${payload.error_description || payload.error || response.status}`);
  }

  if (!payload.access_token) {
    throw new Error("YouTube token refresh did not return an access token.");
  }

  return payload.access_token;
}

async function fetchAllSubscriptions(accessToken, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const maxSubscriptions = Number(options.maxSubscriptions || 0);
  const subscriptions = [];
  let pageToken = "";

  do {
    const url = new URL(SUBSCRIPTIONS_URL);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`
      }
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`YouTube subscriptions fetch failed: ${payload.error?.message || response.status}`);
    }

    if (!Array.isArray(payload.items)) {
      throw new Error("YouTube subscriptions response was not a subscription list.");
    }

    subscriptions.push(...payload.items);
    if (maxSubscriptions > 0 && subscriptions.length >= maxSubscriptions) {
      return subscriptions.slice(0, maxSubscriptions);
    }

    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return subscriptions;
}

function youtubeCredentials(env) {
  const credentials = {
    YOUTUBE_CLIENT_ID: env.YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET: env.YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REFRESH_TOKEN: env.YOUTUBE_REFRESH_TOKEN
  };
  const missing = Object.entries(credentials)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Missing YouTube OAuth value(s): ${missing.join(", ")}`);
  }

  return credentials;
}

function bestThumbnailUrl(thumbnails = {}) {
  for (const key of ["maxres", "high", "medium", "default"]) {
    if (thumbnails[key]?.url) return thumbnails[key].url;
  }

  return null;
}

function removeEmptyValues(value) {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined && fieldValue !== ""));
}

function writeJson(outputPath, payload) {
  const path = outputPath instanceof URL ? fileURLToPath(outputPath) : String(outputPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await syncYouTubeSubscriptions();
    console.log(`Wrote ${result.feedCount} YouTube subscription feed(s) to ${pathString(result.outputPath)}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

function pathString(value) {
  return value instanceof URL ? fileURLToPath(value) : String(value);
}
