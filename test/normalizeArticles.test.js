import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFeedItems, stripFeedBoilerplate } from "../src/feeds/normalizeArticles.js";

const feed = {
  title: "Example Feed",
  feedUrl: "https://example.com/feed/",
  siteUrl: "https://example.com/",
  topic: "Film",
  source: "feedbin"
};

const window = {
  start: new Date("2026-05-30T13:00:00.000Z"),
  end: new Date("2026-06-01T13:00:00.000Z")
};

test("strips WordPress-style appeared-first boilerplate", () => {
  assert.equal(
    stripFeedBoilerplate(
      "Theodore Some cliche somewhere said that a picture is worth a thousand words. The post Awesome Art’s Tribute to 1980s Cartoons with He-Man appeared first on JoBlo."
    ),
    "Theodore Some cliche somewhere said that a picture is worth a thousand words."
  );

  assert.equal(
    stripFeedBoilerplate(
      "Total Recall poster by Kyle Lambert By Tim Pelan I made the movie in a way that it […] We Can Mis-Remember it 80s-Style: ‘Total Recall’ Was the Last Gasp 80s Ultraviolent Action Extravaganza for a New Decade appeared first on Cinephilia & Beyond.",
      {
        title:
          "We Can Mis-Remember it 80s-Style: ‘Total Recall’ Was the Last Gasp 80s Ultraviolent Action Extravaganza for a New Decade"
      }
    ),
    "Total Recall poster by Kyle Lambert By Tim Pelan I made the movie in a way that it […]"
  );

  assert.equal(
    stripFeedBoilerplate(
      "GetComics.info ~ Year : 2025 | Size : 943 MB They are two sworn foes who have been locked in an endless grudge match. The post Wolverine – The Death and Life of Sabretooth (TPB) (2025) appeared",
      { title: "Wolverine – The Death and Life of Sabretooth (TPB) (2025)" }
    ),
    "GetComics.info ~ Year : 2025 | Size : 943 MB They are two sworn foes who have been locked in an endless grudge match."
  );
});

test("normalizes article summary and text without feed boilerplate", () => {
  const articles = normalizeFeedItems(
    feed,
    {
      items: [
        {
          title: "Awesome Art",
          link: "https://example.com/awesome-art",
          isoDate: "2026-05-31T18:00:00.000Z",
          contentSnippet:
            "A short article summary. The post Awesome Art’s Tribute to 1980s Cartoons appeared first on JoBlo.",
          content:
            "<p>A short article body.</p><p>The post Awesome Art’s Tribute to 1980s Cartoons appeared first on JoBlo.</p>"
        }
      ]
    },
    window
  );

  assert.equal(articles[0].summary, "A short article summary.");
  assert.equal(articles[0].text, "A short article body.");
});

test("uses Atom id as the article URL when link and guid are absent", () => {
  const articles = normalizeFeedItems(
    feed,
    {
      items: [
        {
          title: "Atom-only article",
          id: "https://example.com/atom-only-article",
          isoDate: "2026-05-31T18:00:00.000Z",
          content: "Atom feed body"
        }
      ]
    },
    window
  );

  assert.equal(articles.length, 1);
  assert.equal(articles[0].url, "https://example.com/atom-only-article");
});

test("filters feed items by required title text", () => {
  const articles = normalizeFeedItems(
    { ...feed, titleIncludes: "1080p" },
    {
      items: [
        {
          title: "Protector (2025) [720p] [BluRay] [YTS.BZ]",
          link: "https://example.com/protector-720p",
          isoDate: "2026-05-31T18:00:00.000Z",
          content: "720p release"
        },
        {
          title: "Protector (2025) [1080p] [BluRay] [YTS.BZ]",
          link: "https://example.com/protector-1080p",
          isoDate: "2026-05-31T19:00:00.000Z",
          content: "1080p release"
        }
      ]
    },
    window
  );

  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "Protector (2025) [1080p] [BluRay] [YTS.BZ]");
});
