import { loadConfig } from "../config/loadConfig.js";
import { discardResponseBody } from "../util/fetch.js";
import { isDirectRun } from "../util/modules.js";
import { feedbinApiUrl, feedbinAuthorization } from "./feedbin.js";

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 30000;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function syncFeedbinSubscriptions(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;
  const config = options.config || loadConfig();
  const extraSyncTitles = extraSyncTitlesFromEnv(env);
  const syncFeeds = config.feeds.filter(
    (feed) => !feed.disabled && shouldSyncFeed(feed, extraSyncTitles)
  );

  if (!env.FEEDBIN_EMAIL || !env.FEEDBIN_PASSWORD) {
    throw new Error("Missing FEEDBIN_EMAIL or FEEDBIN_PASSWORD.");
  }

  const requestOptions = { ...options, env, logger };
  const existing = await fetchSubscriptions(requestOptions);
  const results = {
    existing: 0,
    created: 0,
    skipped: 0,
    failed: 0
  };

  for (const feed of syncFeeds) {
    const match = findMatchingSubscription(feed, existing);

    if (match) {
      results.existing += 1;
      continue;
    }

    try {
      const subscription = await createSubscription(feed.feedUrl, requestOptions);

      if (subscription) {
        existing.push(subscription);
        results.created += 1;
        logger.log(`Created Feedbin subscription: ${feed.title}`);
      } else {
        results.skipped += 1;
      }
    } catch (error) {
      results.failed += 1;
      logger.warn(`Could not create Feedbin subscription for ${feed.title}: ${error.message}`);
    }
  }

  logger.log(
    `Feedbin sync complete: existing=${results.existing}, created=${results.created}, skipped=${results.skipped}, failed=${results.failed}`
  );

  return results;
}

async function fetchSubscriptions(options) {
  const response = await feedbinFetch("/subscriptions.json?mode=extended", {}, options);
  if (!response.ok) throw new Error(`Feedbin subscriptions failed: ${response.status}`);

  const subscriptions = await response.json();
  if (!Array.isArray(subscriptions)) throw new Error("Feedbin subscriptions response was not a list.");

  return subscriptions;
}

async function createSubscription(feedUrl, options) {
  const response = await feedbinFetch(
    "/subscriptions.json",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ feed_url: feedUrl })
    },
    options
  );

  if (response.status === 201 || response.status === 302) {
    return response.json();
  }

  if (response.status === 300) {
    const choices = await response.json().catch(() => []);
    const choice = Array.isArray(choices) ? choices.find((item) => urlsMatch(item.feed_url, feedUrl)) : null;

    if (choice?.feed_url) {
      return createSubscription(choice.feed_url, options);
    }

    throw new Error("Feedbin returned multiple feed choices and none matched the configured URL.");
  }

  if (response.status === 404) {
    throw new Error("Feedbin could not find a feed at this URL.");
  }

  throw new Error(`Feedbin returned status ${response.status}.`);
}

async function feedbinFetch(path, requestOptions, options) {
  const env = options.env;
  const url = feedbinApiUrl(path, options);
  const attempts = positiveInteger(
    options.attempts ?? env.FEEDBIN_SYNC_ATTEMPTS ?? env.FEED_FETCH_ATTEMPTS,
    DEFAULT_ATTEMPTS
  );
  const fetchImpl = options.fetchImpl || fetch;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutMs = positiveInteger(
      options.timeoutMs ?? env.FEEDBIN_SYNC_TIMEOUT_MS ?? env.FEED_FETCH_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS
    );
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        ...requestOptions,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: feedbinAuthorization(env),
          ...requestOptions.headers
        }
      });

      if (!RETRYABLE_STATUSES.has(response.status) || attempt >= attempts) {
        return response;
      }

      await discardResponseBody(response);
      options.logger.warn(
        `Feedbin request returned ${response.status}; retrying (${attempt + 1}/${attempts}).`
      );
    } catch (error) {
      lastError = error;

      if (attempt >= attempts || !isRetryableFetchError(error)) {
        throw error;
      }

      options.logger.warn(
        `Feedbin request failed: ${error.message || String(error)}; retrying (${attempt + 1}/${attempts}).`
      );
    } finally {
      clearTimeout(timeout);
    }

    await sleep(retryDelayMs(attempt, options, env));
  }

  throw lastError;
}

function extraSyncTitlesFromEnv(env) {
  return new Set(
    String(env.FEEDBIN_SYNC_EXTRA_TITLES || "Joblo")
      .split(",")
      .map((title) => title.trim())
      .filter(Boolean)
  );
}

function findMatchingSubscription(feed, subscriptions) {
  return subscriptions.find((subscription) => {
    return (
      urlsMatch(feed.feedUrl, subscription.feed_url) ||
      urlsMatch(feed.siteUrl, subscription.site_url) ||
      hostsMatch(feed.feedUrl, subscription.feed_url) ||
      hostsMatch(feed.siteUrl, subscription.site_url)
    );
  });
}

function shouldSyncFeed(feed, extraSyncTitles) {
  return feed.source === "substack" || extraSyncTitles.has(feed.title) || feed.feedbinSync === true;
}

function urlsMatch(left, right) {
  const normalizedLeft = normalizeComparableUrl(left);
  const normalizedRight = normalizeComparableUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function hostsMatch(left, right) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.hostname.replace(/^www\./, "") === rightUrl.hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

function normalizeComparableUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.search = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function isRetryableFetchError(error) {
  return error?.name === "AbortError" || /fetch failed|network|timeout/i.test(error?.message || String(error));
}

function retryDelayMs(attempt, options, env) {
  const base = nonNegativeNumber(options.retryBaseDelayMs ?? env.FEED_RETRY_BASE_DELAY_MS, 750);
  const jitter = nonNegativeNumber(options.retryJitterMs ?? env.FEED_RETRY_JITTER_MS, 250);
  return base * 2 ** (attempt - 1) + Math.floor(Math.random() * jitter);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (isDirectRun(import.meta.url)) {
  try {
    const results = await syncFeedbinSubscriptions();
    if (results.failed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
