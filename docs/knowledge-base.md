# Training the agent on your content

"Training" here means indexing: the agent crawls or reads your content, splits it into passages, and searches those passages every time someone asks a question. The model itself isn't fine-tuned, so updates take effect the moment you re-ingest, and the agent only answers from what's actually on your site.

## Sources

An agent's sources live in `data/agents/<id>/agent.json`. Three kinds:

```json
{
  "sources": [
    { "type": "url", "url": "https://myproject.dev/docs/", "maxPages": 300, "pathPrefix": "/docs/" },
    { "type": "dir", "path": "../my-project/docs" },
    { "type": "file", "path": "../my-project/README.md" }
  ]
}
```

- **url**: crawls the site breadth-first, same origin only. It seeds from `/sitemap.xml` when present, honors `robots.txt` Disallow rules, skips assets, and drops duplicate pages. `pathPrefix` limits the crawl to one section of the site. `maxPages` defaults to 200.
- **dir**: reads `.md`, `.mdx`, `.markdown`, `.txt`, `.rst`, `.html` files recursively, skipping `node_modules`, `.git`, `dist` and `build`. Paths are relative to where you run the command.
- **file**: a single file.

For your own projects, pointing `dir` at the repo's `docs/` folder plus `README.md` usually gives better answers than crawling the deployed site, because Markdown keeps its structure.

## Building the index

```bash
npm run cli -- ingest my-project
```

This writes `data/agents/my-project/kb.json`. A running server picks up the new file automatically on the next request; no restart needed.

To re-index a deployed server remotely (for example from CI after you publish docs):

```bash
curl -X POST https://support.example.com/api/agents/my-project/reindex -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Sites rendered with JavaScript

The crawler reads server-rendered HTML. Single-page apps that render content only in the browser will look empty to it. Use a `dir` source with your Markdown docs instead, or make sure your docs site pre-renders (most docs frameworks like Docusaurus, VitePress, Nextra and Astro do).

## How retrieval works

Each page is split along its headings into passages of roughly 350 tokens; code blocks are never split. Search is BM25 keyword ranking with headings weighted higher. The model calls `search_docs` as a tool and reformulates its query when results miss, then calls `read_page` when it needs a full page. Agentic search like this handles wording mismatches well without needing an embeddings service.

## Debugging bad answers

See what the agent would retrieve for a query:

```bash
npm run cli -- search my-project "rate limit"
```

If the right passage isn't in the top results, the content probably uses different words than the question. Adding a FAQ page with the phrasing people actually use is the most effective fix.
