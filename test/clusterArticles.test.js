import test from "node:test";
import assert from "node:assert/strict";
import { clusterArticles } from "../src/cluster/clusterArticles.js";

function article(overrides) {
  return {
    id: overrides.id,
    title: overrides.title,
    summary: overrides.summary || "",
    text: overrides.text || "",
    canonicalUrl: overrides.canonicalUrl || `https://example.com/${overrides.id}`,
    topicHint: overrides.topicHint || "Tech",
    publishedAt: overrides.publishedAt || "2026-06-01T12:00:00.000Z",
    sourceName: overrides.sourceName || "Example",
    sourceType: overrides.sourceType,
    url: overrides.url || `https://example.com/${overrides.id}`,
    imageUrl: null
  };
}

test("clusters identical canonical URLs", () => {
  const clusters = clusterArticles([
    article({ id: "a", title: "Apple announces new iPhone", canonicalUrl: "https://example.com/apple" }),
    article({ id: "b", title: "Apple announces new iPhone today", canonicalUrl: "https://example.com/apple" })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 2);
});

test("keeps unrelated stories separate", () => {
  const clusters = clusterArticles([
    article({ id: "a", title: "Apple announces new iPhone", summary: "A phone launch in California" }),
    article({ id: "b", title: "Mets bullpen collapses late", summary: "A baseball game recap" })
  ]);

  assert.equal(clusters.length, 2);
});

test("clusters cross-source stories with distinctive shared title anchors", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Nvidia Challenges Apple Silicon With New RTX Spark PC Chip",
      summary: "Nvidia is positioning the RTX Spark platform as a compact AI PC system.",
      text: "Nvidia says RTX Spark is built for local AI workloads and efficient desktop performance.",
      sourceName: "Mac Rumors"
    }),
    article({
      id: "b",
      title: "Microsoft Surface Ultra laptop features Nvidia's new Spark platform",
      summary: "Microsoft is preparing a Surface Ultra laptop using Nvidia Spark hardware.",
      text: "The Nvidia Spark platform is being used for AI-focused PCs and laptop designs.",
      sourceName: "Boing Boing"
    })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 2);
});

test("clusters cross-source stories with strong shared title phrases and short summaries", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Nvidia’s RTX Spark Laptops Look Hell-Bent on Disruption",
      summary: "The company’s RTX Spark chips might finally turn the AI PC into reality.",
      text: "The company’s RTX Spark chips might finally turn the AI PC into reality.",
      sourceName: "Wired Top Stories"
    }),
    article({
      id: "b",
      title: "Adobe Premiere to Get Supercharged With New NVIDIA RTX Spark Partnership",
      summary: "Adobe and NVIDIA are bringing RTX Spark acceleration to Premiere and other creative apps.",
      text: "Adobe Premiere will use NVIDIA RTX Spark hardware for faster AI, editing, color, and effects.",
      sourceName: "No Film School",
      topicHint: "Film"
    })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 2);
});

test("clusters cross-source stories about the same data center water issue", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Data Center Operators Are Trying to Fix Their Water Use Problems",
      summary:
        "Google, Microsoft, and other hyperscalers have come under scrutiny for their impact on water quality and availability.",
      text: "Data center operators are looking for ways to reduce water use and address local water availability.",
      sourceName: "Wired Top Stories",
      publishedAt: "2026-06-03T10:00:00.000Z"
    }),
    article({
      id: "b",
      title: "AI has a water problem. Google thinks it has a fix",
      summary:
        "In the face of backlash to the AI data center buildout, Google is touting commitments to replenish more water than its data centers use by 2030 and invest in local water infrastructure.",
      text: "Google says it will use alternative water sources, invest in local infrastructure, and be more transparent about AI data center water use.",
      sourceName: "The Verge",
      publishedAt: "2026-06-03T13:00:00.000Z"
    })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 2);
});

test("clusters event coverage with a shared product phrase", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Sony’s State Of Play Showed That Every Publisher Is Terrified Of GTA 6",
      summary: "Sony's State of Play showcase focused on games trying to avoid GTA 6's release window.",
      text: "The PlayStation State of Play presentation showed how publishers are scheduling around GTA 6.",
      sourceName: "Kotaku",
      topicHint: "Games"
    }),
    article({
      id: "b",
      title: "Everything We Saw At PlayStation’s Big Summer State Of Play Showcase",
      summary: "The PlayStation showcase collected Sony's biggest State of Play trailers and announcements.",
      text: "Sony's big summer State of Play showcase included game reveals, trailers, and release dates.",
      sourceName: "Kotaku",
      topicHint: "Games"
    }),
    article({
      id: "c",
      title: "PlayStation’s Showcase Chat Got Spammed The Whole Time On Twitch By People Demanding Destiny 3",
      summary: "During Sony's PlayStation showcase on Twitch, viewers kept spamming chat about Destiny 3.",
      text: "The State of Play stream's chat was dominated by PlayStation fans demanding Destiny 3 news.",
      sourceName: "Kotaku",
      topicHint: "Games"
    })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 3);
});

test("clusters event coverage when the bridging article arrives later", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "All Marvel characters in Wolverine on PS5 (so far)",
      summary: "Marvel's Wolverine debuted a new trailer at Sony's PlayStation State of Play.",
      text: "The PS5 game showed Wolverine, Jean Grey, and several Marvel characters during Sony's stream.",
      sourceName: "Polygon",
      topicHint: "Games",
      publishedAt: "2026-06-03T19:00:20.000Z"
    }),
    article({
      id: "b",
      title: "12 Things We Just Learned About Marvel’s Wolverine And Why The Other X-Men Aren’t In It",
      summary: "The upcoming PS5 exclusive is Insomniac Games' bloodiest action-adventure yet.",
      text: "Insomniac showed Marvel's Wolverine gameplay and details after Sony's presentation.",
      sourceName: "Kotaku",
      topicHint: "Games",
      publishedAt: "2026-06-03T15:45:54.000Z"
    }),
    article({
      id: "c",
      title: "PlayStation is getting back to what it’s good at",
      summary:
        "PlayStation used its most recent State of Play showcase to focus on premium single-player games, beginning with Marvel's Wolverine from Insomniac.",
      text: "The State of Play showcase opened with Marvel's Wolverine gameplay, Jean Grey, and other single-player PlayStation games.",
      sourceName: "The Verge",
      topicHint: "Tech",
      publishedAt: "2026-06-03T15:30:15.000Z"
    })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 3);
});

test("merges sparse same-event follow-ups into an anchored cluster", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "All Marvel characters in Wolverine on PS5 (so far)",
      summary: "Marvel's Wolverine debuted a new trailer at Sony's PlayStation State of Play.",
      text: "The PS5 game showed Wolverine, Jean Grey, and several Marvel characters during Sony's stream.",
      sourceName: "Polygon",
      topicHint: "Games",
      publishedAt: "2026-06-03T19:00:20.000Z"
    }),
    article({
      id: "b",
      title: "12 Things We Just Learned About Marvel’s Wolverine And Why The Other X-Men Aren’t In It",
      summary: "The upcoming PS5 exclusive is Insomniac Games' bloodiest action-adventure yet.",
      text: "Insomniac showed Marvel's Wolverine gameplay and details after Sony's presentation.",
      sourceName: "Kotaku",
      topicHint: "Games",
      publishedAt: "2026-06-03T15:45:54.000Z"
    }),
    article({
      id: "c",
      title: "PlayStation is getting back to what it’s good at",
      summary:
        "PlayStation used its most recent State of Play showcase to focus on premium single-player games, beginning with Marvel's Wolverine from Insomniac.",
      text: "The State of Play showcase opened with Marvel's Wolverine gameplay, Jean Grey, and other single-player PlayStation games.",
      sourceName: "The Verge",
      topicHint: "Tech",
      publishedAt: "2026-06-03T15:30:15.000Z"
    }),
    article({
      id: "d",
      title: "Extended WOLVERINE trailer reveals Jean Grey and more",
      summary: "Insomniac's Wolverine gameplay reveal shows Jean Grey and brutal action.",
      text: "The extended Wolverine trailer reveals Jean Grey and more details from Insomniac's PS5 game.",
      sourceName: "Comics Beat",
      topicHint: "Comics",
      publishedAt: "2026-06-03T13:00:42.000Z"
    }),
    article({
      id: "e",
      title: "We Need To Talk About The Violence In That Wolverine Reveal",
      summary: "Worry not, this is no demand for sanitizing anything; it's an appeal to the craft",
      text: "",
      sourceName: "Kotaku",
      topicHint: "Games",
      publishedAt: "2026-06-03T15:08:50.000Z"
    }),
    article({
      id: "f",
      title: "Insomniac's Wolverine game looks every bit as bloody as it should",
      summary:
        "With how great Insomniac's Spider-Man game was and how okay its sequel was, it's no surprise that Marvel has apparently designated them the Marvel game studio.",
      text: "",
      sourceName: "Boing Boing",
      topicHint: "Projects",
      publishedAt: "2026-06-03T16:46:19.000Z"
    })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 6);
});

test("does not merge articles that only share a franchise term", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "All Marvel characters in Wolverine on PS5 (so far)",
      summary: "Marvel's Wolverine debuted a new trailer at Sony's PlayStation State of Play.",
      text: "The PS5 game showed Wolverine, Jean Grey, and several Marvel characters during Sony's stream.",
      sourceName: "Polygon",
      topicHint: "Games"
    }),
    article({
      id: "b",
      title: "12 Things We Just Learned About Marvel’s Wolverine And Why The Other X-Men Aren’t In It",
      summary: "The upcoming PS5 exclusive is Insomniac Games' bloodiest action-adventure yet.",
      text: "Insomniac showed Marvel's Wolverine gameplay and details after Sony's presentation.",
      sourceName: "Kotaku",
      topicHint: "Games"
    }),
    article({
      id: "c",
      title: "Wolverine Omnibus arrives in stores",
      summary: "A collected edition reprints a classic run from the 1990s.",
      text: "The omnibus includes older comics issues and creator notes.",
      sourceName: "Comics Beat",
      topicHint: "Comics"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("clusters same-source stories with a distinctive shared title phrase", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Film Quote of the Day: How Clint Eastwood Redefined the Western With This 'Unforgiven' Line",
      summary:
        "Clint Eastwood reshaped the Western with Unforgiven and its view of aging killers, moral compromise, and sparse directing.",
      text: "Unforgiven shows how Clint Eastwood dismantled the Western persona he helped build through quiet, morally complicated filmmaking.",
      topicHint: "Film",
      sourceName: "No Film School"
    }),
    article({
      id: "b",
      title: "6 Lessons from the 6 Films Clint Eastwood Loves Most",
      summary:
        "Clint Eastwood's favorite films include Unforgiven and show how he thinks about directing, moral compromise, and sparse filmmaking.",
      text: "Eastwood's choices reveal his taste for films with complicated moral worlds and restrained directing.",
      topicHint: "Film",
      sourceName: "No Film School"
    })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 2);
});

test("clusters same-source roundup and full story when a title phrase appears in the lead", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Lucian Freud’s Dozing Nude",
      summary: "Remembering Julio Le Parc, a dispatch from art shows in abandoned homes in Seattle, and more.",
      text: "Remembering Julio Le Parc, a dispatch from art shows in abandoned homes in Seattle, and more.",
      topicHint: "Film",
      sourceName: "Hyperallergic"
    }),
    article({
      id: "b",
      title: "Artist Julio Le Parc, Maestro of Light, Movement, and Defiance, Dies at 97",
      summary:
        "While his contemporaries focused on abstraction, Julio Le Parc viewed the liberation of the spectator as parallel to society's.",
      text: "Julio Le Parc made kinetic and optical art concerned with light, movement, and political liberation.",
      topicHint: "Film",
      sourceName: "Hyperallergic"
    })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 2);
});

test("does not let same-source roundups bridge unrelated stories", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Inside Chicago’s Obama Center",
      summary:
        "Italian art workers announce a nationwide strike, New York’s Penn Station to feature Trump’s name, and have you heard about the Obamalisk?",
      text: "Italian art workers announce a nationwide strike. Chicago’s Obama Presidential Center opens in Jackson Park.",
      topicHint: "Film",
      sourceName: "Hyperallergic",
      publishedAt: "2026-06-09T10:00:49.000Z"
    }),
    article({
      id: "b",
      title: "A First Look at the Art in the New Obama Presidential Center",
      summary:
        "The Obama Presidential Center in Chicago’s Jackson Park features public art, educational spaces, and community amenities.",
      text: "The Obama Center includes commissions from Maya Lin and Idris Khan and will open in Chicago later this month.",
      topicHint: "Film",
      sourceName: "Hyperallergic",
      publishedAt: "2026-06-08T21:57:21.000Z"
    }),
    article({
      id: "c",
      title: "Italian Arts Workers Announce Nationwide Strike",
      summary:
        "Arts and culture workers across Italy are launching a nationwide strike over labor conditions and public funding.",
      text: "The strike involves museum workers, cultural workers, and unions across Italy.",
      topicHint: "Film",
      sourceName: "Hyperallergic",
      publishedAt: "2026-06-08T20:20:46.000Z"
    }),
    article({
      id: "d",
      title: "Discover MA Arts and Cultural Enterprise at Central Saint Martins",
      summary: "Develop business skills for cultural management and production on this flexible online Masters.",
      text: "The course prepares cultural producers and arts professionals for leadership in the cultural sector.",
      topicHint: "Film",
      sourceName: "Hyperallergic",
      publishedAt: "2026-06-08T15:00:37.000Z"
    })
  ]);

  assert.equal(clusters.length, 3);
  assert.deepEqual(
    clusters.map((cluster) => cluster.articles.map((item) => item.id).sort()),
    [["a", "b"], ["c"], ["d"]]
  );
});

test("clusters same-source raw milk and RFK dairy stories", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: 'RFK, Jr. says "depriving" children of whole milk constitutes "a form of child abuse"',
      summary:
        "HHS Secretary Robert F. Kennedy, Jr. toured a Wisconsin dairy farm and touted the Whole Milk for Healthy Kids Act.",
      text: "Kennedy promoted full-fat dairy products in school meal programs during June Dairy Month.",
      topicHint: "Projects",
      sourceName: "Boing Boing",
      publishedAt: "2026-06-08T18:33:29.000Z"
    }),
    article({
      id: "b",
      title: "Nearly 60 Idahoans get a quick lesson in the joys of pasteurization",
      summary:
        "Raw milk is having another one of those weeks where it reminds everyone why Louis Pasteur got a Wikipedia page, and RFK Jr wears a tinfoil hat.",
      text: "Idaho health officials are investigating how nearly 60 people got sick after drinking raw milk.",
      topicHint: "Projects",
      sourceName: "Boing Boing",
      publishedAt: "2026-06-08T18:28:28.000Z"
    })
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 2);
});

test("does not cluster same-source stories that only share a generic template phrase", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "10 Hacks Every Perplexity User Should Know",
      summary: "Tips for using Perplexity more effectively.",
      text: "These Perplexity search and research tips help users work faster.",
      topicHint: "Projects",
      sourceName: "Lifehacker"
    }),
    article({
      id: "b",
      title: "10 Tasker Hacks Every Android User Should Know",
      summary: "Tips for using Tasker on Android more effectively.",
      text: "These Tasker automation tips help Android users work faster.",
      topicHint: "Projects",
      sourceName: "Lifehacker"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not cluster unrelated coupon and promo templates from the same source", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Paramount+ Coupon Codes and Deals for June 2026",
      summary: "Save on a streaming subscription with the latest tested coupon codes and discounts.",
      text: "These coupon codes, promo codes, and deals were checked for June savings.",
      topicHint: "Tech",
      sourceName: "Wired Top Stories"
    }),
    article({
      id: "b",
      title: "Nike Promo Codes and Discounts: 30% for June 2026",
      summary: "A roundup of current Nike discount codes, coupons, and shopping deals.",
      text: "These coupon codes, promo codes, and deals were checked for June savings.",
      topicHint: "Tech",
      sourceName: "Wired Top Stories"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not cluster same-source brand stories without a shared event or product", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Apple Announces Europe's First Developer Center",
      summary: "Apple will open a developer center in Berlin with workshops and labs for app makers.",
      text: "The Berlin developer center will host sessions, labs, and appointments for developers.",
      topicHint: "Tech",
      sourceName: "Mac Rumors"
    }),
    article({
      id: "b",
      title: "Apple Music Classical Announces New Partnership With London's Wigmore Hall",
      summary: "Apple Music Classical is partnering with Wigmore Hall on performances and recordings.",
      text: "The music partnership centers on classical performances, recordings, and concert programming.",
      topicHint: "Tech",
      sourceName: "Mac Rumors"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not cluster unrelated software update and device fix posts", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "You Should Install the June Android Security Patch ASAP",
      summary: "The latest Android security patch fixes vulnerabilities affecting phones and tablets.",
      text: "The Android patch includes security fixes and should be installed by affected users.",
      topicHint: "Projects",
      sourceName: "Lifehacker"
    }),
    article({
      id: "b",
      title: "Update iOS Now to Fix Your iPhone's Charging Problems",
      summary: "Apple's iOS update addresses a bug that caused some iPhones to charge incorrectly.",
      text: "The iPhone charging fix is part of an iOS update and is unrelated to Android security patches.",
      topicHint: "Projects",
      sourceName: "Lifehacker"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not cluster different showcase stories through an ambiguous title and lead phrase", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "The Post-PlayStation-Showcase Fallout",
      summary: "Also: the creator of El Shaddai: Ascension of the Metatron returns.",
      text: "Also: the creator of El Shaddai: Ascension of the Metatron returns.",
      topicHint: "Games",
      sourceName: "Kotaku"
    }),
    article({
      id: "b",
      title: "What To Expect At Xbox’s Big Summer Showcase Event",
      summary: "Will Fallout 3 Remastered be there? Will we see more Blade?",
      text: "Will Fallout 3 Remastered be there? Will we see more Blade?",
      topicHint: "Games",
      sourceName: "Kotaku"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not cluster device news with a related product deal", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Google Expands AirDrop Support to More Android Phones",
      summary: "Google is bringing its AirDrop-style file sharing feature to more Android and Pixel phones.",
      text: "The feature update expands sharing compatibility across Android phones.",
      topicHint: "Tech",
      sourceName: "Mac Rumors"
    }),
    article({
      id: "b",
      title: "The Pixel 10 Pro Is $250 Off Right Now",
      summary: "A current sale cuts the price of Google's Pixel 10 Pro phone.",
      text: "The deal is a discount on Pixel hardware, not a software compatibility change.",
      topicHint: "Projects",
      sourceName: "Lifehacker"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not cluster unrelated same-source movie posts that only share genre wording", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Rich Flu trailer: Mary Elizabeth Winstead stars in thriller where the richer you are, the faster you die",
      summary: "The thriller follows wealthy characters facing a deadly epidemic.",
      text: "The trailer highlights Mary Elizabeth Winstead in a new thriller.",
      topicHint: "Film",
      sourceName: "Joblo"
    }),
    article({
      id: "b",
      title: "Rachel Nichols and Britt Robertson star in psychological horror thriller Night at the Carriage House",
      summary: "The psychological horror thriller centers on different characters and a different production.",
      text: "Rachel Nichols and Britt Robertson lead the separate horror thriller.",
      topicHint: "Film",
      sourceName: "Joblo"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not cluster same-source music posts because of singularized name collisions", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Michael Stipe & Andrew Watt Perform Rooster Theme For The First Time On Kimmel",
      summary: "Michael Stipe and Andrew Watt performed the Rooster theme on late-night TV.",
      text: "The performance featured Stipe, Watt, and a television appearance.",
      topicHint: "Music",
      sourceName: "Stereogum"
    }),
    article({
      id: "b",
      title: "Regulator Watts Share First New Music In 29 Years",
      summary: "Regulator Watts released their first new music in nearly three decades.",
      text: "The band Regulator Watts returned with new music after a long break.",
      topicHint: "Music",
      sourceName: "Stereogum"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not use broad story matching for download-topic articles", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Nvidia Spark (2026) [1080p] [WEBRip] [YTS.BZ]",
      summary: "Nvidia Spark release details.",
      text: "Nvidia Spark release details.",
      topicHint: "Downloads",
      sourceName: "YTS"
    }),
    article({
      id: "b",
      title: "Nvidia Spark Omnibus (2026)",
      summary: "Nvidia Spark collection details.",
      text: "Nvidia Spark collection details.",
      topicHint: "Downloads",
      sourceName: "Get Comics"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not cluster same-source articles unless canonical URLs match", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "The Women in Security Documentary (2025) [1080p] [WEBRip] [YTS.BZ]",
      summary: "IMDB Rating: 0.0/10 Genre: Documentary Size: 672.25 MB Runtime: 1hr 13 min",
      sourceName: "YTS"
    }),
    article({
      id: "b",
      title: "Keloglan Aramizda (1972) [1080p] [WEBRip] [YTS.BZ]",
      summary: "IMDB Rating: 6.2/10 Genre: Comedy / History Size: 736.98 MB Runtime: 1hr 20 min",
      sourceName: "YTS"
    })
  ]);

  assert.equal(clusters.length, 2);
});

test("does not cluster related YouTube videos from the same channel", () => {
  const clusters = clusterArticles([
    article({
      id: "a",
      title: "Apple Vision Pro review after one week",
      summary: "Apple Vision Pro review with hands on impressions after one week of daily use.",
      text: "Apple Vision Pro review hands on impressions daily use.",
      sourceName: "Example Channel",
      sourceType: "youtube",
      topicHint: "YouTube"
    }),
    article({
      id: "b",
      title: "Apple Vision Pro review and hands-on impressions",
      summary: "Apple Vision Pro review after a week with hands on testing and daily use.",
      text: "Apple Vision Pro review hands on impressions daily use.",
      sourceName: "Example Channel",
      sourceType: "youtube",
      topicHint: "YouTube"
    })
  ]);

  assert.equal(clusters.length, 2);
  assert.deepEqual(
    clusters.map((cluster) => cluster.articles.length),
    [1, 1]
  );
});

test("does not cluster YouTube videos through embeddings", () => {
  const videos = [
    article({
      id: "a",
      title: "Wolverine trailer reaction",
      summary: "A reaction to the new Wolverine gameplay trailer.",
      sourceName: "First Channel",
      sourceType: "youtube",
      topicHint: "YouTube"
    }),
    article({
      id: "b",
      title: "Wolverine gameplay breakdown",
      summary: "A breakdown of the new Wolverine gameplay trailer.",
      sourceName: "Second Channel",
      sourceType: "youtube",
      topicHint: "YouTube"
    })
  ];
  const clusters = clusterArticles(videos, {
    vectorsById: new Map([
      ["a", [1, 0, 0]],
      ["b", [1, 0, 0]]
    ])
  });

  assert.equal(clusters.length, 2);
  assert.deepEqual(
    clusters.map((cluster) => cluster.articles.length),
    [1, 1]
  );
});
