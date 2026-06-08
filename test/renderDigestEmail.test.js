import test from "node:test";
import assert from "node:assert/strict";
import { renderDigestEmail } from "../src/email/renderDigestEmail.js";

test("renders digest header, topics, article metadata, and escaped text", () => {
  const html = renderDigestEmail({
    title: "Alonso's Daily Digest",
    dateLabel: "06/01/2026",
    intro: "Intro",
    topics: [
      {
        name: "Tech",
        articles: [
          {
            headline: "A <dangerous> headline",
            summary: "Summary & context",
            url: "https://example.com",
            imageUrl: "https://images.example.com/story.jpg",
            sources: [{ name: "The Verge", url: "https://www.theverge.com" }]
          },
          {
            headline: "Second story",
            summary: "Another summary",
            url: "https://example.com/second",
            sources: [{ name: "Ars Technica", url: "https://arstechnica.com" }]
          }
        ]
      }
    ]
  });

  assert.match(html, /Alonso&#39;s Daily Digest/);
  assert.match(html, /06\/01\/2026/);
  assert.match(html, /Tech/);
  assert.match(html, /A &lt;dangerous&gt; headline/);
  assert.match(html, /Summary &amp; context/);
  assert.match(html, /The Verge/);
  assert.match(html, /class="digest-grid"/);
  assert.match(html, /width="49%" valign="top"/);
  assert.match(html, /class="digest-column-spacer" width="2%"/);
  assert.match(html, /min-width: 421px/);
  assert.match(html, /max-width: 420px/);
  assert.doesNotMatch(html, /max-width: 640px/);
  assert.match(html, /<a href="https:\/\/example\.com" style="display:block;text-decoration:none;border:0;line-height:0;"><img class="digest-card-img" src="https:\/\/images\.example\.com\/story\.jpg"/);
});

test("renders combined article sources in heading and original article links", () => {
  const html = renderDigestEmail({
    dateLabel: "06/01/2026",
    topics: [
      {
        name: "Tech",
        articles: [
          {
            headline: "Merged story",
            summary: "A synthesized summary.",
            url: "https://example.com/lead",
            sources: [
              { name: "The Verge", title: "Original Verge story", url: "https://www.theverge.com/story" },
              { name: "Ars Technica", title: "Original Ars story", url: "https://arstechnica.com/story" }
            ]
          }
        ]
      }
    ]
  });

  assert.match(html, /Combined from The Verge \+ Ars Technica/);
  assert.match(html, /Original articles/);
  assert.match(html, /The Verge: Original Verge story/);
  assert.match(html, /Ars Technica: Original Ars story/);
});

test("renders app links for articles and sources", () => {
  const html = renderDigestEmail({
    dateLabel: "06/01/2026",
    topics: [
      {
        name: "YouTube",
        articles: [
          {
            headline: "Video episode",
            summary: "A new video.",
            url: "https://www.youtube.com/watch?v=video-id",
            appUrl: "videolite://open?video=video-id",
            appLabel: "Open in Video Lite",
            sources: [
              {
                name: "YouTube Channel",
                title: "Video episode",
                url: "https://www.youtube.com/watch?v=video-id",
                appUrl: "videolite://open?video=video-id",
                appLabel: "Open in Video Lite"
              }
            ]
          }
        ]
      }
    ]
  });

  assert.match(html, /Open in Video Lite/);
  assert.match(html, /videolite:\/\/open\?video=video-id/);
});

test("does not render non-web article or source URLs as links", () => {
  const html = renderDigestEmail({
    dateLabel: "06/01/2026",
    topics: [
      {
        name: "Podcasts",
        articles: [
          {
            headline: "Podcast episode",
            summary: "A new episode.",
            url: "episode-guid",
            imageUrl: "https://images.example.com/podcast.jpg",
            sources: [{ name: "Podcast Show", url: "source-guid" }]
          }
        ]
      }
    ]
  });

  assert.match(html, /Podcast episode/);
  assert.match(html, /Podcast Show/);
  assert.doesNotMatch(html, /href="episode-guid"/);
  assert.doesNotMatch(html, /href="source-guid"/);
});

test("balances desktop columns by estimated article height", () => {
  const html = renderDigestEmail({
    dateLabel: "06/01/2026",
    topics: [
      {
        name: "Tech",
        articles: [
          {
            headline: "Tall first story with a deliberately long headline that wraps across several lines",
            summary:
              "This first item has an image and a longer body. It should be estimated as much taller than the following short cards so the next two articles are placed in the right column instead of alternating the third article back to the left column.",
            url: "https://example.com/tall",
            imageUrl: "https://images.example.com/tall.jpg",
            sources: [
              { name: "Source One", title: "Tall source story", url: "https://example.com/tall/source-one" },
              { name: "Source Two", title: "Another tall source story", url: "https://example.com/tall/source-two" }
            ]
          },
          {
            headline: "Short second story",
            summary: "Brief summary.",
            url: "https://example.com/short-second",
            sources: [{ name: "Source Three", url: "https://example.com/short-second" }]
          },
          {
            headline: "Short third story",
            summary: "Brief summary.",
            url: "https://example.com/short-third",
            sources: [{ name: "Source Four", url: "https://example.com/short-third" }]
          }
        ]
      }
    ]
  });

  const { left, right } = desktopColumns(html);
  assert.match(left, /Tall first story/);
  assert.doesNotMatch(left, /Short second story/);
  assert.doesNotMatch(left, /Short third story/);
  assert.match(right, /Short second story/);
  assert.match(right, /Short third story/);
});

test("renders YouTube, Podcasts, and Downloads topics at the bottom", () => {
  const html = renderDigestEmail({
    dateLabel: "06/01/2026",
    topics: [
      topic("YouTube"),
      topic("Tech"),
      topic("Downloads"),
      topic("Film"),
      topic("Podcasts")
    ]
  });

  const topicPositions = ["Tech", "Film", "YouTube", "Podcasts", "Downloads"].map((name) => ({
    name,
    index: html.indexOf(`<h2 style="margin:0;color:#fff;font-size:24px;line-height:1;font-weight:900;letter-spacing:0;">${name}</h2>`)
  }));

  for (const { name, index } of topicPositions) {
    assert.notEqual(index, -1, `Expected topic ${name}`);
  }

  assert(topicPositions[0].index < topicPositions[1].index);
  assert(topicPositions[1].index < topicPositions[2].index);
  assert(topicPositions[2].index < topicPositions[3].index);
  assert(topicPositions[3].index < topicPositions[4].index);
});

function topic(name) {
  return {
    name,
    articles: [
      {
        headline: `${name} story`,
        summary: "Summary.",
        url: `https://example.com/${name.toLowerCase()}`,
        sources: [{ name: `${name} Source`, url: `https://example.com/${name.toLowerCase()}/source` }]
      }
    ]
  };
}

function desktopColumns(html) {
  const leftMarker =
    '<td class="digest-column digest-column-half" width="49%" valign="top" style="width:49%;vertical-align:top;padding:0;">';
  const rightMarker =
    '<td class="digest-column digest-column-half" width="49%" valign="top" style="width:49%;vertical-align:top;padding:0;">';
  const leftStart = html.indexOf(leftMarker);
  const rightStart = html.indexOf(rightMarker, leftStart + leftMarker.length);
  const rightEnd = html.indexOf("</td>", rightStart);

  assert.notEqual(leftStart, -1, "Expected rendered left desktop column");
  assert.notEqual(rightStart, -1, "Expected rendered right desktop column");
  assert.notEqual(rightEnd, -1, "Expected right desktop column end");

  return {
    left: html.slice(leftStart + leftMarker.length, rightStart),
    right: html.slice(rightStart + rightMarker.length, rightEnd)
  };
}
