import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { opmlToPodcastFeeds, readOvercastOpml, syncOvercastSubscriptions } from "../src/feeds/syncOvercastSubscriptions.js";

const sampleOpml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <body>
    <outline text="Tech">
      <outline type="rss" text="Second Show" xmlUrl="https://podcasts.example.com/second.xml" htmlUrl="https://example.com/second" />
      <outline type="rss" title="First Show" text="Ignored Text" xmlUrl="http://feeds.example.com/first/" htmlUrl="https://example.com/first" />
      <outline type="rss" title="Duplicate First" xmlUrl="https://feeds.example.com/first" htmlUrl="https://example.com/duplicate" />
    </outline>
  </body>
</opml>`;

test("converts Overcast OPML outlines to podcast feeds", () => {
  const feeds = opmlToPodcastFeeds(sampleOpml, { topic: "Audio" });

  assert.deepEqual(feeds, [
    {
      title: "First Show",
      feedUrl: "http://feeds.example.com/first/",
      siteUrl: "https://example.com/first",
      topic: "Audio",
      source: "podcast"
    },
    {
      title: "Second Show",
      feedUrl: "https://podcasts.example.com/second.xml",
      siteUrl: "https://example.com/second",
      topic: "Audio",
      source: "podcast"
    }
  ]);
});

test("reads Overcast OPML from base64, raw text, or file path", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-digest-opml-"));
  const opmlPath = join(dir, "overcast.opml");
  writeFileSync(opmlPath, sampleOpml);

  assert.equal(readOvercastOpml({ OVERCAST_OPML_BASE64: Buffer.from(sampleOpml).toString("base64") }), sampleOpml);
  assert.equal(readOvercastOpml({ OVERCAST_OPML: sampleOpml }), sampleOpml);
  assert.equal(readOvercastOpml({ OVERCAST_OPML_PATH: opmlPath }), sampleOpml);
});

test("syncs Overcast OPML to generated podcast feed config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-digest-overcast-"));
  const outputPath = join(dir, "podcast-subscriptions.json");

  const result = await syncOvercastSubscriptions({
    outputPath,
    opml: sampleOpml,
    topic: "Podcasts",
    maxSubscriptions: 1
  });
  const generated = JSON.parse(readFileSync(outputPath, "utf8"));

  assert.equal(result.feedCount, 1);
  assert.equal(generated.source, "overcast-opml");
  assert.equal(generated.feeds.length, 1);
  assert.equal(generated.feeds[0].title, "Second Show");
});
