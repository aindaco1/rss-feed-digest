import { loadConfig } from "../config/loadConfig.js";
import { mapLimit } from "../util/concurrency.js";
import { fetchFeedXml } from "./fetchFeeds.js";

const config = loadConfig();
const activeFeeds = config.feeds.filter((feed) => !feed.disabled);
const skippedFeeds = config.feeds.filter((feed) => feed.disabled);

const results = await mapLimit(activeFeeds, Number(process.env.FEED_AUDIT_CONCURRENCY || 8), async (feed) => {
  try {
    const xml = await fetchFeedXml(feed.feedUrl);
    return {
      ok: true,
      title: feed.title,
      topic: feed.topic,
      source: feed.source,
      feedUrl: feed.feedUrl,
      bytes: Buffer.byteLength(xml)
    };
  } catch (error) {
    return {
      ok: false,
      title: feed.title,
      topic: feed.topic,
      source: feed.source,
      feedUrl: feed.feedUrl,
      error: error.message
    };
  }
});

const working = results.filter((result) => result.ok);
const failing = results.filter((result) => !result.ok);

console.log(`Working feeds: ${working.length}/${activeFeeds.length}`);
console.log(`Disabled feeds: ${skippedFeeds.length}`);

if (failing.length) {
  console.log("\nFailures:");
  for (const result of failing) {
    console.log(`- ${result.title} (${result.feedUrl}): ${result.error}`);
  }
}

if (skippedFeeds.length) {
  console.log("\nDisabled:");
  for (const feed of skippedFeeds) {
    console.log(`- ${feed.title}: ${feed.disabledReason || "disabled"}`);
  }
}

if (failing.length) {
  process.exit(1);
}
