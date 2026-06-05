import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/config/loadConfig.js";

test("merges generated subscription feeds when provided", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-digest-config-"));
  const configPath = join(dir, "feeds.json");
  const generatedPath = join(dir, "youtube-subscriptions.json");

  writeFileSync(
    configPath,
    JSON.stringify({
      digest: { title: "Test Digest" },
      topics: ["Tech", "YouTube"],
      feeds: [
        {
          title: "Example",
          feedUrl: "https://example.com/feed",
          siteUrl: "https://example.com/",
          topic: "Tech",
          source: "feedbin"
        }
      ]
    })
  );
  writeFileSync(
    generatedPath,
    JSON.stringify({
      feeds: [
        {
          title: "Video Channel",
          feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC123",
          siteUrl: "https://www.youtube.com/channel/UC123",
          topic: "YouTube",
          source: "youtube"
        }
      ]
    })
  );

  const config = loadConfig(pathToFileURL(configPath), { generatedFeedPaths: [pathToFileURL(generatedPath)] });

  assert.equal(config.feeds.length, 2);
  assert.equal(config.feeds[1].title, "Video Channel");
});
