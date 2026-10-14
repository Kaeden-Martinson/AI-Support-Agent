# AI Support Agent

A self-hosted support chatbot you can attach to any webpage. Point it at your site or your docs folder, it indexes the content, and a one-line script tag adds a chat bubble that answers questions from that content, with links back to the source pages. Answers come from Claude by default, or from a local open-weights model via [Ollama](docs/deployment.md#running-fully-self-hosted) if nothing should leave your server.

Built for developers dropping it into their own projects: no database, no build step, no vendor dashboard. One Node process, JSON files on disk, and a ~15 KB widget.

```
 your site / docs ──ingest──▶ data/agents/<id>/kb.json
                                       │
 <script src=".../widget.js"> ──chat──▶ server ──▶ Claude (search_docs / read_page tools)
```

## Quick start

Requires Node 22.18 or newer and an [Anthropic API key](https://platform.claude.com/) (or a local [Ollama](docs/deployment.md#running-fully-self-hosted) install).

```bash
npm install
cp .env.example .env        # then set ANTHROPIC_API_KEY
npm run cli -- ingest demo  # index this repo's own docs
npm run serve
```

Open http://localhost:3000/demo and ask the bubble something like "how do I embed this in Next.js?". The demo agent is trained on this project's own documentation.

## Add it to your project

1. Create an agent and point it at your content:

   ```bash
   npm run cli -- init my-project --name "My Project" \
     --description "My Project is a CLI for deploying static sites." \
     --url https://myproject.dev/docs/ \
     --origin https://myproject.dev --origin http://localhost:5173
   ```

   Use `--dir ../my-project/docs` and `--file ../my-project/README.md` instead of (or alongside) `--url` to index local files.

2. Build its knowledge base:

   ```bash
   npm run cli -- ingest my-project
   ```

3. Try it in the terminal:

   ```bash
   npm run cli -- ask my-project "how do I get started?"
   ```

4. Add the widget to your site:

   ```html
   <script src="http://localhost:3000/widget.js" data-agent="my-project" defer></script>
   ```

## CLI

| Command | |
| --- | --- |
| `npm run cli -- init <id> --name ... --url/--dir/--file ...` | Create an agent |
| `npm run cli -- ingest <id>` | Crawl/read sources and rebuild the index |
| `npm run cli -- ask <id> [question]` | Chat in the terminal (interactive without a question) |
| `npm run cli -- search <id> <query>` | Show raw retrieval results |
| `npm run cli -- list` | List agents and index status |
| `npm run serve` | Start the server |

## Docs

- [Embedding the widget](docs/embedding.md): script attributes, React/Next.js, JavaScript API
- [Training on your content](docs/knowledge-base.md): sources, crawling, re-indexing, debugging retrieval
- [Configuration](docs/configuration.md): agent config, environment variables, HTTP API
- [Deploying](docs/deployment.md)

## Project layout

```
src/
  cli.ts            command-line entry point
  server.ts         HTTP server: widget, chat (SSE), config, reindex
  agent.ts          sessions; hands each message to the configured backend
  backends/         claude.ts (tool loop), ollama.ts (retrieve-then-answer), shared tools
  kb.ts             knowledge base build + BM25 search
  ingest/           crawler, local file reader, HTML extraction, chunker
public/
  widget.js         the embeddable chat widget (no dependencies)
  demo.html         demo page
data/agents/<id>/   agent.json (config) and kb.json (generated index)
```
