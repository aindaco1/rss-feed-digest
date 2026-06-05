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
  assert.match(html, /width="50%" valign="top"/);
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
        name: "Podcasts",
        articles: [
          {
            headline: "Podcast episode",
            summary: "A new episode.",
            url: "https://example.com/episode",
            appUrl: "overcast://x-callback-url/add?url=https%3A%2F%2Ffeeds.example.com%2Fshow.xml",
            appLabel: "Open in Overcast",
            sources: [
              {
                name: "Podcast Show",
                title: "Podcast episode",
                url: "https://example.com/episode",
                appUrl: "overcast://x-callback-url/add?url=https%3A%2F%2Ffeeds.example.com%2Fshow.xml",
                appLabel: "Open in Overcast"
              }
            ]
          }
        ]
      }
    ]
  });

  assert.match(html, /Open in Overcast/);
  assert.match(html, /overcast:\/\/x-callback-url\/add\?url=https%3A%2F%2Ffeeds\.example\.com%2Fshow\.xml/);
});
