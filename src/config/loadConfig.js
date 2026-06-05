import { existsSync, readFileSync } from "node:fs";

const DEFAULT_CONFIG_URL = new URL("../../config/feeds.json", import.meta.url);
const DEFAULT_GENERATED_FEED_URLS = [
  new URL("../../config/youtube-subscriptions.json", import.meta.url),
  new URL("../../config/podcast-subscriptions.json", import.meta.url)
];

export function loadConfig(path = DEFAULT_CONFIG_URL, options = {}) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  const generatedFeedPaths = options.generatedFeedPaths || (isDefaultConfigPath(path) ? DEFAULT_GENERATED_FEED_URLS : []);

  for (const generatedFeedPath of generatedFeedPaths) {
    if (!existsSync(generatedFeedPath)) continue;

    const generated = JSON.parse(readFileSync(generatedFeedPath, "utf8"));
    const generatedFeeds = Array.isArray(generated) ? generated : generated.feeds;
    if (Array.isArray(generatedFeeds)) {
      config.feeds.push(...generatedFeeds);
    }
  }

  return config;
}

function isDefaultConfigPath(path) {
  return new URL(path, import.meta.url).toString() === DEFAULT_CONFIG_URL.toString();
}
