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

const sampleAllDataOpml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <body>
    <outline text="feeds">
      <outline type="rss" text="Podcast Show" xmlUrl="https://feeds.example.com/show.xml" htmlUrl="https://example.com/show">
        <outline text="Episode One" url="https://example.com/show/episode-one" guid="episode-one" enclosureUrl="https://audio.example.com/one.mp3" overcastUrl="https://overcast.fm/+ABC123" />
        <outline text="Episode Two" url="https://example.com/show/episode-two" overcastUrl="https://overcast.fm/+DEF456" />
      </outline>
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

test("keeps Overcast episode URLs from all-data OPML", () => {
  const feeds = opmlToPodcastFeeds(sampleAllDataOpml, {
    topic: "Audio",
    maxEpisodesPerFeed: 1
  });

  assert.deepEqual(feeds, [
    {
      title: "Podcast Show",
      feedUrl: "https://feeds.example.com/show.xml",
      siteUrl: "https://example.com/show",
      topic: "Audio",
      source: "podcast",
      overcastEpisodes: [
        {
          title: "Episode One",
          url: "https://example.com/show/episode-one",
          guid: "episode-one",
          enclosureUrl: "https://audio.example.com/one.mp3",
          overcastUrl: "https://overcast.fm/+ABC123"
        }
      ]
    }
  ]);
});

test("keeps all Overcast episodes by default", () => {
  const feeds = opmlToPodcastFeeds(sampleAllDataOpml, { topic: "Audio" });

  assert.equal(feeds[0].overcastEpisodes.length, 2);
  assert.deepEqual(
    feeds[0].overcastEpisodes.map((episode) => episode.overcastUrl),
    ["https://overcast.fm/+ABC123", "https://overcast.fm/+DEF456"]
  );
});

test("reads Overcast OPML from base64, raw text, or file path", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-digest-opml-"));
  const opmlPath = join(dir, "overcast.opml");
  writeFileSync(opmlPath, sampleOpml);

  assert.equal(readOvercastOpml({ OVERCAST_OPML_BASE64: Buffer.from(sampleOpml).toString("base64") }), sampleOpml);
  assert.equal(readOvercastOpml({ OVERCAST_OPML: sampleOpml }), sampleOpml);
  assert.equal(readOvercastOpml({ OVERCAST_OPML_PATH: opmlPath }), sampleOpml);
});

test("prefers decrypted Overcast OPML path over inline secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-digest-opml-"));
  const opmlPath = join(dir, "overcast.opml");
  writeFileSync(opmlPath, sampleAllDataOpml);

  assert.equal(
    readOvercastOpml({
      OVERCAST_OPML_PATH: opmlPath,
      OVERCAST_OPML_BASE64: Buffer.from(sampleOpml).toString("base64"),
      OVERCAST_OPML: sampleOpml
    }),
    sampleAllDataOpml
  );
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

test("skips definitely unavailable Overcast podcast feeds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-digest-overcast-"));
  const outputPath = join(dir, "podcast-subscriptions.json");
  const opml = `<?xml version="1.0"?>
    <opml version="1.0">
      <body>
        <outline text="Live Show" xmlUrl="https://feeds.example.com/live.xml" />
        <outline text="Dead Show" xmlUrl="https://feeds.example.com/dead.xml" />
      </body>
    </opml>`;

  const result = await syncOvercastSubscriptions({
    outputPath,
    opml,
    fetchImpl: async (url) => {
      if (String(url) === "https://feeds.example.com/dead.xml") {
        return new Response("Not found", { status: 404 });
      }

      return new Response("<?xml version=\"1.0\"?><rss></rss>", { status: 200 });
    }
  });
  const generated = JSON.parse(readFileSync(outputPath, "utf8"));

  assert.equal(result.feedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(
    generated.feeds.map((feed) => feed.title),
    ["Live Show"]
  );
  assert.deepEqual(generated.skippedFeeds, [
    {
      title: "Dead Show",
      feedUrl: "https://feeds.example.com/dead.xml",
      reason: "Status code 404"
    }
  ]);
});
