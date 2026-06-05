import test from "node:test";
import assert from "node:assert/strict";
import { appLinkForArticle } from "../src/util/appLinks.js";

test("builds Overcast app links from episode URLs", () => {
  assert.deepEqual(
    appLinkForArticle({
      sourceType: "podcast",
      feedUrl: "https://feeds.example.com/show.xml",
      overcastUrl: "https://overcast.fm/+ABC123"
    }),
    {
      label: "Open in Overcast",
      url: "https://overcast.fm/+ABC123"
    }
  );
});

test("omits Overcast app links without episode URLs", () => {
  assert.equal(
    appLinkForArticle({
      sourceType: "podcast",
      feedUrl: "https://feeds.example.com/show.xml"
    }),
    null
  );
});

test("builds configurable Video Lite links for YouTube videos", () => {
  assert.deepEqual(
    appLinkForArticle(
      {
        sourceType: "youtube",
        url: "https://www.youtube.com/shorts/video-id"
      },
      {
        VIDEO_LITE_URL_TEMPLATE: "videolite://open?video={videoId}&url={encodedUrl}"
      }
    ),
    {
      label: "Open in Video Lite",
      url: "videolite://open?video=video-id&url=https%3A%2F%2Fwww.youtube.com%2Fshorts%2Fvideo-id"
    }
  );
});

test("omits YouTube app links when Video Lite template is not configured", () => {
  assert.equal(
    appLinkForArticle(
      {
        sourceType: "youtube",
        url: "https://www.youtube.com/watch?v=video-id"
      },
      {}
    ),
    null
  );
});
