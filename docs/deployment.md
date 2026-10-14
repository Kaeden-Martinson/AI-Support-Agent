# Deploying

The server is a single Node process with no database: agent configs and indexes are JSON files under `data/agents/`. Anything that runs Node 22.18+ works (a VPS, Fly.io, Railway, Render, a container).

## Steps

1. Copy the project (including `data/agents/<id>/agent.json`) to the host.
2. `npm ci --omit=dev`
3. Set `ANTHROPIC_API_KEY`, `ADMIN_TOKEN` and `PORT` in the environment (or `LLM_PROVIDER=ollama` instead of the API key, or `LLM_FALLBACK=ollama` alongside it; see below).
4. `npm run cli -- ingest <id>` (or commit `kb.json`, or call the reindex endpoint after boot).
5. `npm run serve`

Put it behind HTTPS (most platforms do this for you) and set `TRUST_PROXY=1` when a proxy sits in front.

## Checklist before going live

- Replace `"*"` in `allowedOrigins` with your real site origins.
- Keep `RATE_LIMIT_PER_MIN` modest; every message is a paid model call (or, with Ollama, a slice of your GPU).
- Set an `ADMIN_TOKEN` if you want remote re-indexing, and leave it empty otherwise.
- Re-run ingest whenever docs change. A CI step that calls the reindex endpoint after a docs deploy keeps it current.

## Scaling notes

Conversation sessions are kept in memory, so run one instance, or use sticky sessions if you run several. The keyword index is rebuilt in memory from `kb.json` when the file changes; tens of thousands of passages load in well under a second.

## Running fully self-hosted

Crawling, indexing and search already run entirely on your server. The only outside call is the model that writes the answer. Set `LLM_PROVIDER=ollama` to use a local open-weights model through [Ollama](https://ollama.com) instead, and no visitor question leaves your machine.

1. Install Ollama and pull a model:

   ```bash
   ollama pull llama3.1:8b
   ```

2. In `.env`:

   ```
   LLM_PROVIDER=ollama
   OLLAMA_MODEL=llama3.1:8b
   # OLLAMA_URL=http://localhost:11434   (if Ollama runs elsewhere)
   ```

3. `npm run serve`. On startup the server checks that Ollama is reachable and has the model, and prints a warning if not.

**Hardware.** An 8B model in 4-bit quantization (Ollama's default) needs about 8 GB of GPU memory with the default 8K context: roughly 5 GB of weights, about 1 GB of context cache, plus runtime overhead and whatever else is using the card. Apple Silicon Macs with 16 GB+ unified memory work well. CPU-only works but answers take tens of seconds. Bigger models (14B–32B) answer noticeably better if you have 12–24 GB. Ollama serves one request per model at a time by default, so concurrent visitors queue; see `OLLAMA_NUM_PARALLEL` in Ollama's docs.

**How it answers.** Small models are unreliable at driving a search loop, so the Ollama backend searches the knowledge base itself for each message (combined with the previous question, so follow-ups like "and on Vue?" still find the right pages), puts the top `OLLAMA_PASSAGES` passages in the prompt, and streams the answer. `OLLAMA_TOOLS=1` additionally lets the model run its own searches when its model supports tool calling.

**What to expect compared with Claude.** Answers are fine for direct "how do I…" questions whose answer sits in one or two passages. Expect weaker results when an answer has to be pieced together from several pages, when the visitor's wording differs a lot from the docs (Claude re-searches with other terms; the local pipeline searches once), on long code samples, and in following the site owner's `instructions`. Small models also make things up more often when the docs don't cover a question. Try it on your own docs with `npm run cli -- ask <id>` (interactive when given no question) before switching the widget over.

## Ollama as a backup for Claude

With `LLM_FALLBACK=ollama` (and `LLM_PROVIDER=claude`), Claude answers as usual, and the local Ollama model takes over a message whenever Claude can't answer it: a connection error or timeout, a 5xx or overloaded response, a 429 rate limit, or an authentication, permission or out-of-credit error (including a missing API key). Other errors, such as a malformed request, are not retried on Ollama.

1. Set up Ollama as in steps 1 and 2 above, but keep `LLM_PROVIDER=claude` and add:

   ```
   LLM_FALLBACK=ollama
   ```

2. `npm run serve`. On startup the server prints the backup model and checks that Ollama is reachable and has it, printing a warning if not.

**When it switches.** The decision is made per message, and only before any answer text has been sent. If Claude fails after part of an answer has already reached the visitor, the visitor sees the usual error instead of a second answer spliced onto the first. Claude's own retries (the SDK retries 429 and 5xx responses a couple of times) happen first, so a failover can take a few seconds. Each failover is logged on the server as `[fallback] Claude unavailable (<status and message>); answering with Ollama (<model>)`. If Ollama fails as well, the visitor sees Ollama's error message.

**Conversations that switch.** Each backend keeps its own session history in its own format, and every finished exchange is also recorded as plain text. Before a backend answers, it catches up on the exchanges the other one answered, appended to its history as plain question/answer turns. So when Ollama takes over mid-conversation it sees the earlier questions and Claude's answers, and when Claude comes back its transcript is extended (never rewritten) with what Ollama said. Claude's searches and tool calls are not shown to Ollama, and Ollama's retrieved passages are not shown to Claude; each searches afresh.
