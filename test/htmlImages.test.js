import test from "node:test";
import assert from "node:assert/strict";
import { firstImageFromHtml, normalizeImageUrl } from "../src/util/html.js";

test("normalizes bare-host and duplicated-host image URLs", () => {
  assert.equal(
    normalizeImageUrl("www.joblo.com/wp-content/uploads/example.jpg", "https://www.joblo.com/story/"),
    "https://www.joblo.com/wp-content/uploads/example.jpg"
  );

  assert.equal(
    normalizeImageUrl("https://www.joblo.com/www.joblo.com/wp-content/uploads/example.jpg", "https://www.joblo.com/story/"),
    "https://www.joblo.com/wp-content/uploads/example.jpg"
  );
});

test("normalizes WordPress proxy image URLs without losing query separators", () => {
  assert.equal(
    normalizeImageUrl(
      "https://i0.wp.com/abqraw.com/wp-content/uploads/2026/05/img_8106-1-1024x768.jpg?resize=640%2C480&#038;ssl=1",
      "https://abqraw.com/post/story/"
    ),
    "https://i0.wp.com/abqraw.com/wp-content/uploads/2026/05/img_8106-1-1024x768.jpg?resize=640%2C480&ssl=1"
  );
});

test("prefers article images over author headshots", () => {
  const html = `
    <a class="originals-author">
      <div class="staff-photo"><img width="300" height="300" src="https://www.joblo.com/wp-content/uploads/joblo-headshot-cody.jpg"></div>
    </a>
    <figure class="wp-block-image size-large">
      <img width="1024" height="576" src="https://www.joblo.com/wp-content/uploads/kiss-the-girls.jpg" alt="Kiss the Girls">
    </figure>
  `;

  assert.equal(firstImageFromHtml(html), "https://www.joblo.com/wp-content/uploads/kiss-the-girls.jpg");
});
