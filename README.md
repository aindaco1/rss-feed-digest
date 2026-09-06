# RSS Feed Digest

Daily RSS digest generator for Alonso's feeds. It fetches Feedbin/Substack RSS feeds, deduplicates and clusters overlapping articles, optionally uses OpenAI to summarize coverage, and renders an HTML email for delivery through Resend. Optional subscription sync adds YouTube channels and Overcast podcasts.

## Quick start

Run commands from the repository root. The scheduled workflow uses Node.js 20.

```bash
npm ci
npm run validate:feeds
npm test
```

Build a preview for the current digest window without sending email or calling OpenAI:

```bash
npm run digest -- --dry-run --no-ai --no-embeddings
```

This fetches live feeds and writes HTML and JSON to `out/`. See [operations](docs/operations.md) for credentials, historical windows, output details, and sending.

For a sample layout with fixture content:

```bash
npm run render:sample
```

Open `out/sample-digest.html` to inspect the email layout.

## Documentation

| Guide | Contents |
| --- | --- |
| [Operations](docs/operations.md) | Environment setup, CLI usage, sending, GitHub Actions, and recovery |
| [Feeds](docs/feeds.md) | Feed configuration, audits, fallbacks, filtering, and clustering |
| [Subscriptions](docs/subscriptions.md) | Feedbin sync, YouTube OAuth, Overcast OPML, and app links |

[`.env.example`](.env.example) is the shared reference for supported environment variables and scheduled defaults. [The workflow](.github/workflows/daily-digest.yml) defines automation, and [the environment contract](src/config/environment.js) defines supported settings and credential requirements. Tests check that scheduled variables and defaults stay aligned.

Keep detailed guides in `docs/` and link them here. Update the guide that owns a topic instead of copying its instructions into another document.

## License

[MIT](LICENSE).
