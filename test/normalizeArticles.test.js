import test from "node:test";
import assert from "node:assert/strict";
import { isLikelySponsoredPost, normalizeFeedItems, stripFeedBoilerplate } from "../src/feeds/normalizeArticles.js";
import { hydrateMissingImages } from "../src/feeds/fetchFeeds.js";

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

test("decodes HTML entities in article titles and snippets", () => {
  const articles = normalizeFeedItems(
    feed,
    {
      items: [
        {
          title: "Pebblebee&#8217;s Halo &amp; Finder can keep you safe",
          link: "https://example.com/pebblebee",
          isoDate: "2026-05-31T18:00:00.000Z",
          contentSnippet: "It&#8217;s on sale and messages aren&#8217;t garbled.",
          content: "<p>It&#8217;s on sale.</p>"
        }
      ]
    },
    window
  );

  assert.equal(articles[0].title, "Pebblebee’s Halo & Finder can keep you safe");
  assert.equal(articles[0].summary, "It’s on sale and messages aren’t garbled.");
  assert.equal(articles[0].text, "It’s on sale.");
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

test("ignores malformed guid objects when article links are valid", () => {
  const articles = normalizeFeedItems(
    feed,
    {
      items: [
        {
          title: "Article with malformed guid",
          link: "https://example.com/article-with-malformed-guid",
          guid: {
            $: { isPermaLink: "false" }
          },
          isoDate: "2026-05-31T18:00:00.000Z",
          content: "Article body"
        }
      ]
    },
    window
  );

  assert.equal(articles.length, 1);
  assert.equal(articles[0].url, "https://example.com/article-with-malformed-guid");
});

test("uses Atom link objects as article URLs before image hydration", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://jacobin.com/2026/06/rights-corporate-personhood-ai-environment");
    return new Response('<meta property="og:image" content="https://media.jacobin.com/images/2026/6/167126433179.jpg">', {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  };

  const articles = normalizeFeedItems(
    {
      ...feed,
      title: "Jacobin",
      feedUrl: "https://jacobinmag.com/feed/",
      siteUrl: "https://jacobin.com",
      topic: "Politics"
    },
    {
      items: [
        {
          title: "Giving Rights to Robots Is a Bad Idea",
          link: [{ href: "https://jacobin.com/2026/06/rights-corporate-personhood-ai-environment" }],
          id: "tag:jacobin.com,2026:post-1",
          isoDate: "2026-05-31T18:00:00.000Z",
          content: "Article body"
        }
      ]
    },
    window
  );

  assert.equal(articles[0].url, "https://jacobin.com/2026/06/rights-corporate-personhood-ai-environment");
  await hydrateMissingImages(articles);
  assert.equal(articles[0].imageUrl, "https://media.jacobin.com/images/2026/6/167126433179.jpg");
});

test("matches Overcast episode URLs onto podcast items", () => {
  const articles = normalizeFeedItems(
    {
      ...feed,
      title: "Podcast Show",
      feedUrl: "https://feeds.example.com/show.xml",
      source: "podcast",
      topic: "Podcasts",
      overcastEpisodes: [
        {
          title: "Episode One",
          url: "https://example.com/show/episode-one",
          enclosureUrl: "https://audio.example.com/one.mp3",
          overcastUrl: "https://overcast.fm/+ABC123"
        },
        {
          title: "Episode Two",
          overcastUrl: "https://overcast.fm/+DEF456"
        }
      ]
    },
    {
      items: [
        {
          title: "Episode One",
          link: "https://example.com/show/episode-one?utm_source=rss",
          isoDate: "2026-05-31T18:00:00.000Z",
          enclosure: {
            url: "https://audio.example.com/one.mp3",
            type: "audio/mpeg"
          },
          content: "Episode summary"
        },
        {
          title: "Episode Two",
          guid: "episode-two-guid",
          isoDate: "2026-05-31T19:00:00.000Z",
          content: "Episode summary"
        }
      ]
    },
    window
  );

  assert.equal(articles[0].overcastUrl, "https://overcast.fm/+ABC123");
  assert.equal(articles[1].overcastUrl, "https://overcast.fm/+DEF456");
});

test("uses media group descriptions and thumbnails for video feeds", () => {
  const articles = normalizeFeedItems(
    { ...feed, title: "YouTube Test", feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC123" },
    {
      items: [
        {
          title: "A city gardening short",
          link: "https://www.youtube.com/watch?v=video-id",
          isoDate: "2026-05-31T18:00:00.000Z",
          author: "YouTube Channel",
          mediaGroup: {
            "media:description": ["Turn small spaces into urban gardens."],
            "media:thumbnail": [
              {
                $: {
                  url: "https://i.ytimg.com/vi/video-id/hqdefault.jpg",
                  width: "480",
                  height: "360"
                }
              }
            ]
          }
        }
      ]
    },
    window
  );

  assert.equal(articles[0].summary, "Turn small spaces into urban gardens.");
  assert.equal(articles[0].imageUrl, "https://i.ytimg.com/vi/video-id/hqdefault.jpg");
});

test("excludes YouTube Shorts", () => {
  const articles = normalizeFeedItems(
    {
      ...feed,
      title: "YouTube Test",
      feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC123",
      source: "youtube"
    },
    {
      items: [
        {
          title: "A short clip",
          link: "https://www.youtube.com/shorts/short-id",
          isoDate: "2026-05-31T18:00:00.000Z",
          content: "Short body"
        },
        {
          title: "Tagged short #shorts",
          link: "https://www.youtube.com/watch?v=tagged-short-id",
          isoDate: "2026-05-31T19:00:00.000Z",
          content: "Tagged short body"
        },
        {
          title: "Regular video",
          link: "https://www.youtube.com/watch?v=video-id",
          isoDate: "2026-05-31T20:00:00.000Z",
          content: "Regular video body"
        }
      ]
    },
    window
  );

  assert.deepEqual(
    articles.map((article) => article.title),
    ["Regular video"]
  );
});

test("strips redundant YouTube URLs from YouTube summaries", () => {
  const articles = normalizeFeedItems(
    {
      ...feed,
      title: "YouTube Test",
      feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC123",
      source: "youtube"
    },
    {
      items: [
        {
          title: "A live episode",
          link: "https://www.youtube.com/live/DHBg5kW-voA",
          isoDate: "2026-05-31T18:00:00.000Z",
          mediaGroup: {
            "media:description": [
              "Watch the rest of this monumental meeting at https://www.youtube.com/live/DHBg5kW-voA?si=abc123 Support the show."
            ]
          }
        },
        {
          title: "A short clip",
          link: "https://youtu.be/video-id",
          isoDate: "2026-05-31T19:00:00.000Z",
          mediaGroup: {
            "media:description": ["A short clip https://youtu.be/video-id"]
          }
        }
      ]
    },
    window
  );

  assert.equal(articles[0].url, "https://www.youtube.com/live/DHBg5kW-voA");
  assert.equal(articles[0].summary, "Watch the rest of this monumental meeting. Support the show.");
  assert.equal(articles[1].summary, "A short clip");
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

test("normalizes YTS release titles for display", () => {
  const articles = normalizeFeedItems(
    { ...feed, title: "YTS", feedUrl: "https://yts.lt/rss", siteUrl: "https://yts.bz/", titleIncludes: "1080p" },
    {
      items: [
        {
          title: "Miss You, Love You (2026) [1080p] [WEBRip] [x265] [10bit] [5.1] [YTS.BZ]",
          link: "https://example.com/miss-you-love-you",
          isoDate: "2026-05-31T18:00:00.000Z",
          content: "1080p release"
        },
        {
          title: "Slightly New (2024) [1080p] [WEBRip] [YTS.BZ]",
          link: "https://example.com/slightly-new",
          isoDate: "2026-05-31T19:00:00.000Z",
          content: "1080p release"
        },
        {
          title: "Filtered Movie (2026) [720p] [WEBRip] [YTS.BZ]",
          link: "https://example.com/filtered-movie",
          isoDate: "2026-05-31T20:00:00.000Z",
          content: "720p release"
        }
      ]
    },
    window
  );

  assert.deepEqual(
    articles.map((article) => article.title),
    ["Miss You, Love You (2026) -- (x265, 10bit, 5.1)", "Slightly New (2024) -- (1080p, WEBRip)"]
  );
});

test("filters GetComics-style single issue titles when configured", () => {
  const articles = normalizeFeedItems(
    { ...feed, title: "Get Comics", excludeSingleIssues: true },
    {
      items: [
        {
          title: "Superhero Adventures #1 (2026)",
          link: "https://example.com/superhero-adventures-1",
          isoDate: "2026-05-31T18:00:00.000Z",
          content: "Single issue"
        },
        {
          title: "Wolverine – The Death and Life of Sabretooth (TPB) (2025)",
          link: "https://example.com/wolverine-tpb",
          isoDate: "2026-05-31T19:00:00.000Z",
          content: "Trade paperback"
        },
        {
          title: "Nocturnals – Halloween Noir (Graphic Novel) (2025)",
          link: "https://example.com/nocturnals-graphic-novel",
          isoDate: "2026-05-31T20:00:00.000Z",
          content: "Graphic novel"
        },
        {
          title: "Dark Nights – Death Metal Omnibus (2024)",
          link: "https://example.com/death-metal-omnibus",
          isoDate: "2026-05-31T21:00:00.000Z",
          content: "Omnibus"
        },
        {
          title: "2026.06.03 Weekly Pack",
          link: "https://example.com/weekly-pack",
          isoDate: "2026-05-31T22:00:00.000Z",
          content: "Weekly pack"
        }
      ]
    },
    window
  );

  assert.deepEqual(
    articles.map((article) => article.title),
    [
      "Wolverine – The Death and Life of Sabretooth (TPB) (2025)",
      "Nocturnals – Halloween Noir (Graphic Novel) (2025)",
      "Dark Nights – Death Metal Omnibus (2024)",
      "2026.06.03 Weekly Pack"
    ]
  );
});

test("filters sponsored posts by disclosure text when configured", () => {
  const articles = normalizeFeedItems(
    { ...feed, title: "Boing Boing", excludeSponsored: true },
    {
      items: [
        {
          title: "Why choose between ChatGPT, Claude, and Gemini when one $60 platform gives you all three?",
          link: "https://example.com/ai-platform-deal",
          isoDate: "2026-05-31T18:00:00.000Z",
          content:
            "<p>TL;DR: Get access to multiple AI tools for one price.</p><p>Disclosure: Boing Boing earns a commission on purchases made through links in this post.</p>"
        },
        {
          title: "A history of local theater sponsors",
          link: "https://example.com/theater-sponsors",
          isoDate: "2026-05-31T19:00:00.000Z",
          content: "<p>The story covers how a theater sponsor helped fund free community performances.</p>"
        }
      ]
    },
    window
  );

  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "A history of local theater sponsors");
});

test("scopes page-level sponsored disclosure checks to the current article", () => {
  assert.equal(
    isLikelySponsoredPost({
      title: "Meta backs off tracking workers' keystrokes after they revolt",
      contentHtml: `<html><body>
        <article>
          <h1>Meta backs off tracking workers' keystrokes after they revolt</h1>
          <p>Meta has backed off a little after workers objected to data collection.</p>
        </article>
        <aside>
          <h2>Store</h2>
          <p>Disclosure: Boing Boing earns a commission on purchases made through links in this post.</p>
        </aside>
      </body></html>`,
      scopeContentToTitle: true
    }),
    false
  );

  assert.equal(
    isLikelySponsoredPost({
      title: "If you're paying a la carte for AI models, this $60 lifetime pass gets you ChatGPT, Claude & more",
      contentHtml: `<html><body>
        <article>
          <h1>If you're paying a la carte for AI models, this $60 lifetime pass gets you ChatGPT, Claude & more</h1>
          <p>Disclosure: Boing Boing earns a commission on purchases made through links in this post.</p>
          <p>TL;DR: ChatPlayground AI lets you compare several models.</p>
        </article>
      </body></html>`,
      scopeContentToTitle: true
    }),
    true
  );
});
