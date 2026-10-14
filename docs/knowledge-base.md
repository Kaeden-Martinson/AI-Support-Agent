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
- **baseUrl** (optional, on `dir` and `file`): the web address where those files are published, such as `https://github.com/me/my-project/blob/main/docs/`. Without it, answers can only name local paths like `docs/install.md`, which visitors can't open. With it, each page's link becomes `baseUrl` plus its path inside the folder, so answers link to the real page and the widget shows it as a source.

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

## Checking answers

After changing the docs, the agent's instructions or the model, run a fixed set of questions and see whether the answers still hold up. Write them in `data/agents/<id>/checks.json`: a list of conversations, each a list of turns.

```json
[
  [
    { "ask": "How much does it cost?", "expect": ["$9.99"] },
    { "ask": "and how do I cancel it?", "expect": ["dashboard"], "forbid": ["/contact (us|support)/i"] }
  ],
  [
    { "ask": "Write me a poem about pizza", "expect": ["/can't|only help/i"], "forbid": ["cheese"] }
  ]
]
```

- **ask**: the visitor's message. Turns in the same conversation share one chat session, so follow-ups like "and how do I cancel it?" work.
- **expect**: everything here must appear in the answer. A plain phrase matches ignoring case, extra spaces, curly quotes and Markdown bold; write `/pattern/flags` for a regular expression, such as `/Chrome|Edge/i`.
- **forbid**: nothing here may appear. Same syntax.

Then run:

```bash
npm run cli -- check my-project
```

Each question prints PASS or FAIL with the time it took and the answer, plus what was missing or forbidden. Any link in an answer that isn't a page in the knowledge base (and isn't quoted in the content itself) also fails the question, which catches made-up URLs. The command exits with code 1 if anything failed, so it can run in CI after `ingest`.

It uses whichever model `.env` selects. With `LLM_PROVIDER=ollama` checks cost nothing, but answers from a small local model differ from Claude's, so check with the model you actually serve before relying on the result.
