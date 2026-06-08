import test from "node:test";
import assert from "node:assert/strict";
import { appLinkForArticle } from "../src/util/appLinks.js";

test("omits podcast app links even when Overcast episode URLs are present", () => {
  assert.equal(
    appLinkForArticle({
      sourceType: "podcast",
      feedUrl: "https://feeds.example.com/show.xml",
      overcastUrl: "https://overcast.fm/+ABC123"
    }),
    null
  );
});

test("builds configurable Video Lite links for YouTube videos", () => {
  assert.deepEqual(
    appLinkForArticle(
      {
        sourceType: "youtube",
        url: "https://www.youtube.com/watch?v=video-id"
      },
      {
        VIDEO_LITE_URL_TEMPLATE: "videolite://open?video={videoId}&url={encodedUrl}"
      }
    ),
    {
      label: "Open in Video Lite",
      url: "videolite://open?video=video-id&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dvideo-id"
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
