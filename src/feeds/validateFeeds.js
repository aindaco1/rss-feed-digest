import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../../config/feeds.json", import.meta.url), "utf8"));
const topics = new Set(config.topics);
const seen = new Map();
const errors = [];

for (const [index, feed] of config.feeds.entries()) {
  const label = feed.title || `feed ${index + 1}`;

  for (const field of ["title", "feedUrl", "siteUrl", "topic", "source"]) {
    if (!feed[field]) errors.push(`${label}: missing ${field}`);
  }

  if (feed.feedUrl) {
    try {
      new URL(feed.feedUrl);
    } catch {
      errors.push(`${label}: invalid feedUrl ${feed.feedUrl}`);
    }

    if (seen.has(feed.feedUrl)) {
      errors.push(`${label}: duplicate feedUrl, first seen at ${seen.get(feed.feedUrl)}`);
    } else {
      seen.set(feed.feedUrl, label);
    }
  }

  if (feed.siteUrl) {
    try {
      new URL(feed.siteUrl);
    } catch {
      errors.push(`${label}: invalid siteUrl ${feed.siteUrl}`);
    }
  }

  if (feed.fallbackImageUrl) {
    try {
      new URL(feed.fallbackImageUrl);
    } catch {
      errors.push(`${label}: invalid fallbackImageUrl ${feed.fallbackImageUrl}`);
    }
  }

  if (feed.titleIncludes && typeof feed.titleIncludes !== "string") {
    errors.push(`${label}: titleIncludes must be a string`);
  }

  if (feed.excludeSingleIssues !== undefined && typeof feed.excludeSingleIssues !== "boolean") {
    errors.push(`${label}: excludeSingleIssues must be a boolean`);
  }

  if (feed.excludeSponsored !== undefined && typeof feed.excludeSponsored !== "boolean") {
    errors.push(`${label}: excludeSponsored must be a boolean`);
  }

  if (feed.topic && !topics.has(feed.topic)) {
    errors.push(`${label}: topic "${feed.topic}" is not declared in config.topics`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const bySource = config.feeds.reduce((counts, feed) => {
  counts[feed.source] = (counts[feed.source] || 0) + 1;
  return counts;
}, {});

console.log(`Validated ${config.feeds.length} feeds across ${topics.size} topics.`);
console.log(`Sources: ${Object.entries(bySource).map(([source, count]) => `${source}=${count}`).join(", ")}`);
