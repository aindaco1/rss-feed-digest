import { loadConfig } from "../config/loadConfig.js";

const API_BASE = (process.env.FEEDBIN_API_BASE || "https://api.feedbin.com/v2").replace(/\/+$/, "");
const EXTRA_SYNC_TITLES = new Set(
  String(process.env.FEEDBIN_SYNC_EXTRA_TITLES || "Joblo")
    .split(",")
    .map((title) => title.trim())
    .filter(Boolean)
);

const config = loadConfig();
const syncFeeds = config.feeds.filter((feed) => !feed.disabled && shouldSyncFeed(feed));

if (!process.env.FEEDBIN_EMAIL || !process.env.FEEDBIN_PASSWORD) {
  throw new Error("Missing FEEDBIN_EMAIL or FEEDBIN_PASSWORD.");
}

const existing = await fetchSubscriptions();
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
    const subscription = await createSubscription(feed.feedUrl);

    if (subscription) {
      existing.push(subscription);
      results.created += 1;
      console.log(`Created Feedbin subscription: ${feed.title}`);
    } else {
      results.skipped += 1;
    }
  } catch (error) {
    results.failed += 1;
    console.warn(`Could not create Feedbin subscription for ${feed.title}: ${error.message}`);
  }
}

console.log(
  `Feedbin sync complete: existing=${results.existing}, created=${results.created}, skipped=${results.skipped}, failed=${results.failed}`
);

if (results.failed) {
  process.exit(1);
}

async function fetchSubscriptions() {
  const response = await feedbinFetch("/subscriptions.json?mode=extended");
  if (!response.ok) throw new Error(`Feedbin subscriptions failed: ${response.status}`);

  const subscriptions = await response.json();
  if (!Array.isArray(subscriptions)) throw new Error("Feedbin subscriptions response was not a list.");

  return subscriptions;
}

async function createSubscription(feedUrl) {
  const response = await feedbinFetch("/subscriptions.json", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ feed_url: feedUrl })
  });

  if (response.status === 201 || response.status === 302) {
    return response.json();
  }

  if (response.status === 300) {
    const choices = await response.json().catch(() => []);
    const choice = Array.isArray(choices) ? choices.find((item) => urlsMatch(item.feed_url, feedUrl)) : null;

    if (choice?.feed_url) {
      return createSubscription(choice.feed_url);
    }

    throw new Error("Feedbin returned multiple feed choices and none matched the configured URL.");
  }

  if (response.status === 404) {
    throw new Error("Feedbin could not find a feed at this URL.");
  }

  throw new Error(`Feedbin returned status ${response.status}.`);
}

async function feedbinFetch(path, options = {}) {
  const url = new URL(path.replace(/^\//, ""), `${API_BASE}/`);

  return fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      authorization: authorizationHeader(),
      ...options.headers
    }
  });
}

function authorizationHeader() {
  return `Basic ${Buffer.from(`${process.env.FEEDBIN_EMAIL}:${process.env.FEEDBIN_PASSWORD}`).toString("base64")}`;
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

function shouldSyncFeed(feed) {
  return feed.source === "substack" || EXTRA_SYNC_TITLES.has(feed.title) || feed.feedbinSync === true;
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
