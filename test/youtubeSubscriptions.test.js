import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { youtubeSubscriptionItemsToFeeds, syncYouTubeSubscriptions } from "../src/feeds/syncYouTubeSubscriptions.js";

test("converts YouTube subscription API items to channel feeds", () => {
  const feeds = youtubeSubscriptionItemsToFeeds(
    [
      {
        snippet: {
          title: "Beta Channel",
          resourceId: { channelId: "UCbeta" },
          thumbnails: {
            high: { url: "https://images.example.com/beta.jpg" }
          }
        }
      },
      {
        snippet: {
          title: "Alpha Channel",
          resourceId: { channelId: "UCalpha" }
        }
      },
      {
        snippet: {
          title: "Duplicate Beta",
          resourceId: { channelId: "UCbeta" }
        }
      }
    ],
    { topic: "Videos" }
  );

  assert.deepEqual(feeds, [
    {
      title: "Alpha Channel",
      feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCalpha",
      siteUrl: "https://www.youtube.com/channel/UCalpha",
      topic: "Videos",
      source: "youtube"
    },
    {
      title: "Beta Channel",
      feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbeta",
      siteUrl: "https://www.youtube.com/channel/UCbeta",
      topic: "Videos",
      source: "youtube",
      fallbackImageUrl: "https://images.example.com/beta.jpg"
    }
  ]);
});

test("syncs YouTube subscriptions through token refresh and paginated API calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rss-digest-youtube-"));
  const outputPath = join(dir, "youtube-subscriptions.json");
  const requestedUrls = [];

  const result = await syncYouTubeSubscriptions({
    outputPath,
    topic: "YouTube",
    env: {
      YOUTUBE_CLIENT_ID: "client-id",
      YOUTUBE_CLIENT_SECRET: "client-secret",
      YOUTUBE_REFRESH_TOKEN: "refresh-token"
    },
    fetchImpl: async (url, options) => {
      requestedUrls.push(String(url));

      if (String(url) === "https://oauth2.googleapis.com/token") {
        const body = String(options.body);
        assert.match(body, /grant_type=refresh_token/);
        assert.match(body, /refresh_token=refresh-token/);
        return Response.json({ access_token: "access-token" });
      }

      assert.equal(options.headers.authorization, "Bearer access-token");
      const apiUrl = new URL(url);
      assert.equal(apiUrl.searchParams.get("mine"), "true");
      assert.equal(apiUrl.searchParams.get("maxResults"), "50");

      if (!apiUrl.searchParams.get("pageToken")) {
        return Response.json({
          nextPageToken: "next",
          items: [
            {
              snippet: {
                title: "First Channel",
                resourceId: { channelId: "UCfirst" }
              }
            }
          ]
        });
      }

      return Response.json({
        items: [
          {
            snippet: {
              title: "Second Channel",
              resourceId: { channelId: "UCsecond" }
            }
          }
        ]
      });
    }
  });

  const generated = JSON.parse(readFileSync(outputPath, "utf8"));

  assert.equal(result.subscriptionCount, 2);
  assert.equal(result.feedCount, 2);
  assert.equal(requestedUrls.length, 3);
  assert.deepEqual(
    generated.feeds.map((feed) => feed.title),
    ["First Channel", "Second Channel"]
  );
});
