import { mkdirSync, writeFileSync } from "node:fs";

const SUMMARY_LIMIT = 280;

const styles = {
  page: "margin:0;padding:0;background:#0f0f0f;color:#f6f1e8;font-family:Arial,Helvetica,sans-serif;",
  shell: "width:100%;background:#0f0f0f;padding:22px 0;",
  container: "width:100%;max-width:760px;margin:0 auto;background:#171717;border:1px solid #2a2a2a;",
  header: "padding:28px 28px 22px;border-bottom:1px solid #383838;",
  eyebrow: "margin:0 0 8px;color:#a9a197;font-size:11px;line-height:1.35;text-transform:uppercase;letter-spacing:1.6px;font-weight:700;",
  h1: "margin:0;color:#fff;font-size:36px;line-height:0.98;font-weight:900;letter-spacing:0;",
  deck: "margin:14px 0 0;color:#cfc7bd;font-size:14px;line-height:1.45;",
  divider: "height:1px;background:#383838;border:0;margin:0;",
  topicWrap: "padding:24px 28px 8px;",
  topicTitle: "margin:0;color:#fff;font-size:24px;line-height:1;font-weight:900;letter-spacing:0;",
  topicRule: "height:3px;background:#f05a28;border:0;margin:10px 0 0;width:58px;",
  topicGridWrap: "padding:0 22px 12px;",
  topicGrid: "width:100%;border-collapse:collapse;border-spacing:0;",
  columnLeft: "width:50%;vertical-align:top;padding:0 6px 0 0;",
  columnRight: "width:50%;vertical-align:top;padding:0 0 0 6px;",
  columnFull: "width:100%;vertical-align:top;padding:0;",
  card: "background:#f4f1ea;color:#141414;border:1px solid #e2ded5;margin:0 0 12px;border-radius:7px;overflow:hidden;",
  cardBody: "padding:11px 12px 12px;",
  cardImage: "display:block;width:100%;height:108px;object-fit:cover;border:0;background:#ded8ce;",
  cardImageLink: "display:block;text-decoration:none;border:0;line-height:0;",
  sourceLine: "margin:0 0 6px;color:#675f55;font-size:10px;line-height:1.3;text-transform:uppercase;letter-spacing:1px;font-weight:800;",
  articleTitle: "margin:0 0 7px;color:#111;font-size:16px;line-height:1.2;font-weight:900;letter-spacing:0;",
  appLinkLine: "margin:-2px 0 8px;color:#4b443d;font-size:12px;line-height:1.35;font-weight:800;",
  summary: "margin:0 0 9px;color:#262626;font-size:13px;line-height:1.38;",
  sourceLinks: "margin:0;padding:8px 0 0;border-top:1px solid #d8d2c8;color:#4b443d;font-size:11px;line-height:1.45;",
  sourceLinksLabel: "font-weight:800;color:#2b2824;",
  link: "color:#111;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;",
  footer: "padding:20px 28px 26px;color:#90887f;font-size:12px;line-height:1.45;border-top:1px solid #383838;"
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderSources(sources = []) {
  if (!sources.length) return "";
  const isCombined = sources.length > 1;

  const links = sources
    .map((source) => {
      const sourceName = source.name || source.site || "Source";
      const label = isCombined && source.title ? `${sourceName}: ${source.title}` : sourceName;
      const name = escapeHtml(label);
      const url = source.url || source.link;
      const sourceLink = url
        ? `<a href="${escapeHtml(url)}" style="${styles.link}">${name}</a>`
        : name;
      const appLink = source.appUrl
        ? ` <span style="color:#7a7167;">&middot;</span> <a href="${escapeHtml(source.appUrl)}" style="${styles.link}">${escapeHtml(
            source.appLabel || "Open in app"
          )}</a>`
        : "";
      return `${sourceLink}${appLink}`;
    })
    .join(isCombined ? "<br>" : " &middot; ");

  const label = isCombined ? `<span style="${styles.sourceLinksLabel}">Original articles</span><br>` : "";
  return `<p style="${styles.sourceLinks}">${label}${links}</p>`;
}

function renderSourceHeading(sources = []) {
  if (!sources.length) return "";
  const counts = new Map();

  for (const source of sources) {
    const name = source.name || source.site || "Source";
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  const names = [...counts.entries()].map(([name, count]) => `${name}${count > 1 ? ` (${count})` : ""}`);
  return sources.length > 1 ? `Combined from ${names.join(" + ")}` : names[0];
}

function renderArticle(article) {
  const sources = article.sources || [];
  const sourceNames = renderSourceHeading(sources);
  const imageTag = article.imageUrl
    ? `<img class="digest-card-img" src="${escapeHtml(article.imageUrl)}" alt="${escapeHtml(article.imageAlt || article.headline || "")}" style="${styles.cardImage}">`
    : "";
  const image = imageTag && article.url
    ? `<a href="${escapeHtml(article.url)}" style="${styles.cardImageLink}">${imageTag}</a>`
    : imageTag;
  const summary = compactSummary(article.summary);

  return `
    <article style="${styles.card}">
      ${image}
      <div style="${styles.cardBody}">
        ${sourceNames ? `<p style="${styles.sourceLine}">${escapeHtml(sourceNames)}</p>` : ""}
        <h2 style="${styles.articleTitle}">
          ${article.url ? `<a href="${escapeHtml(article.url)}" style="${styles.link}">${escapeHtml(article.headline)}</a>` : escapeHtml(article.headline)}
        </h2>
        ${article.appUrl ? `<p style="${styles.appLinkLine}"><a href="${escapeHtml(article.appUrl)}" style="${styles.link}">${escapeHtml(article.appLabel || "Open in app")}</a></p>` : ""}
        <p style="${styles.summary}">${escapeHtml(summary)}</p>
        ${renderSources(sources)}
      </div>
    </article>`;
}

function compactSummary(value = "") {
  const summary = String(value).replace(/\s+/g, " ").trim();
  if (summary.length <= SUMMARY_LIMIT) return summary;

  const truncated = summary.slice(0, SUMMARY_LIMIT - 1).replace(/\s+\S*$/, "");
  return `${truncated}...`;
}

function splitColumns(articles) {
  const columns = [[], []];
  articles.forEach((article, index) => {
    columns[index % 2].push(article);
  });
  return columns;
}

function renderArticleColumns(articles) {
  if (articles.length === 1) {
    return `<table class="digest-grid" role="presentation" cellspacing="0" cellpadding="0" border="0" style="${styles.topicGrid}">
      <tr>
        <td class="digest-column" style="${styles.columnFull}">${renderArticle(articles[0])}</td>
      </tr>
    </table>`;
  }

  const [left, right] = splitColumns(articles);

  return `<table class="digest-grid" role="presentation" cellspacing="0" cellpadding="0" border="0" style="${styles.topicGrid}">
    <tr>
      <td class="digest-column" width="50%" valign="top" style="${styles.columnLeft}">
        ${left.map(renderArticle).join("\n")}
      </td>
      <td class="digest-column" width="50%" valign="top" style="${styles.columnRight}">
        ${right.map(renderArticle).join("\n")}
      </td>
    </tr>
  </table>`;
}

function renderTopic(topic) {
  const articles = topic.articles || [];
  if (!articles.length) return "";

  return `
    <section>
      <div style="${styles.topicWrap}">
        <h2 style="${styles.topicTitle}">${escapeHtml(topic.name)}</h2>
        <div style="${styles.topicRule}"></div>
      </div>
      <div style="${styles.topicGridWrap}">
        ${renderArticleColumns(articles)}
      </div>
    </section>`;
}

export function renderDigestEmail({ title = "Alonso's Daily Digest", dateLabel, intro, headerImageUrl, topics }) {
  const headerImage = headerImageUrl
    ? `<img src="${escapeHtml(headerImageUrl)}" alt="" style="display:block;width:100%;height:auto;border:0;">`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} - ${escapeHtml(dateLabel)}</title>
    <style>
      @media screen and (min-width: 421px) {
        .digest-column { display: table-cell !important; width: 50% !important; }
      }
      @media screen and (max-width: 420px) {
        .digest-container { width: 100% !important; max-width: 100% !important; }
        .digest-column { display: block !important; width: 100% !important; padding: 0 !important; }
        .digest-card-img { height: auto !important; }
      }
    </style>
  </head>
  <body style="${styles.page}">
    <div style="${styles.shell}">
      <main class="digest-container" style="${styles.container}">
        ${headerImage}
        <header style="${styles.header}">
          <p style="${styles.eyebrow}">${escapeHtml(dateLabel)}</p>
          <h1 style="${styles.h1}">${escapeHtml(title)}</h1>
          ${intro ? `<p style="${styles.deck}">${escapeHtml(intro)}</p>` : ""}
        </header>
        ${topics.map(renderTopic).join("\n")}
        <footer style="${styles.footer}">
          Sent by the RSS Feed Digest workflow. Articles are grouped from the last digest window and linked back to the original sources.
        </footer>
      </main>
    </div>
  </body>
</html>`;
}

const isDirectRun = process.argv[1]?.endsWith("renderDigestEmail.js");

if (isDirectRun) {
  const html = renderDigestEmail({
    dateLabel: "06/01/2026",
    intro: "A sample email shell using the DIY Filmmaker digest rhythm: bold header, image-led cards, tight source metadata, and strong topic dividers.",
    topics: [
      {
        name: "Tech",
        articles: [
          {
            headline: "A clustered story headline goes here",
            url: "https://example.com/story",
            imageUrl: "https://picsum.photos/1200/675?digest-tech",
            imageAlt: "Abstract technology image",
            summary: "This is where the generated synthesis lands: concise, useful, and written as one article built from overlapping coverage.",
            sources: [
              { name: "The Verge", url: "https://www.theverge.com" },
              { name: "Ars Technica", url: "https://arstechnica.com" }
            ]
          }
        ]
      },
      {
        name: "Film",
        articles: [
          {
            headline: "A Substack-heavy film item",
            url: "https://example.com/film",
            imageUrl: "https://picsum.photos/1200/675?digest-film",
            imageAlt: "Film still",
            summary: "The final renderer will list the article source names, summary, image, and links inside this same card treatment.",
            sources: [
              { name: "On The Circuit", url: "https://onthecircuit.substack.com" },
              { name: "8 Above with Jon Reiss", url: "https://jonreiss.substack.com" }
            ]
          }
        ]
      }
    ]
  });

  mkdirSync(new URL("../../out", import.meta.url), { recursive: true });
  writeFileSync(new URL("../../out/sample-digest.html", import.meta.url), html);
  console.log("Wrote out/sample-digest.html");
}
