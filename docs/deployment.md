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

## Running from your own computer

You don't need a server or an open port to put the widget on a live site. A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) makes an outbound connection from your computer to Cloudflare and gives you a public HTTPS address that forwards to `http://localhost:3000`. It's free, and combined with `LLM_PROVIDER=ollama` the whole thing costs nothing to run.

1. Install `cloudflared`:

   ```bash
   winget install Cloudflare.cloudflared
   ```

   (macOS: `brew install cloudflared`; Linux: see Cloudflare's downloads page.) Open a new terminal afterwards so it's on your `PATH`.

2. In `.env`, set at least:

   ```
   TRUST_PROXY=1
   RATE_LIMIT_PER_MIN=10
   ```

   `TRUST_PROXY=1` is required: every request reaches the server from the tunnel on localhost, so without it all visitors share one rate limit and one busy visitor blocks everyone. With it, the server takes the visitor's address from the `X-Forwarded-For` header Cloudflare adds. Keep the rate limit low with Ollama, since one GPU answers one message at a time.

3. Make sure the agent's `allowedOrigins` lists the site that embeds the widget, e.g. `["https://example.com"]` (add `https://www.example.com` too if that host serves your site).

4. Start the server, then the tunnel in a second terminal:

   ```bash
   npm run serve
   ```

   ```bash
   npm run tunnel
   ```

   `npm run tunnel` warns if `TRUST_PROXY` isn't set or the server isn't answering, then runs `cloudflared` against `http://localhost:$PORT`.

### Quick tunnel (testing)

With no arguments, `npm run tunnel` runs `cloudflared tunnel --url http://localhost:3000`. No Cloudflare account is needed. It prints an address like `https://random-words.trycloudflare.com`; use it as `data-server` in the script tag:

```html
<script src="https://random-words.trycloudflare.com/widget.js" data-agent="my-project" data-server="https://random-words.trycloudflare.com" defer></script>
```

The address changes every time `cloudflared` restarts, so you have to update the script tag on your site each time. Cloudflare also says quick tunnels are for testing, with no uptime guarantee. Good for trying it out, not for leaving on a site for weeks.

### Named tunnel (stable address on your own domain)

For an address that never changes, such as `https://support.example.com`, use a named tunnel. You need a free Cloudflare account, and the domain's DNS must be managed by Cloudflare.

1. `cloudflared tunnel login`: opens a browser to pick the domain, and saves a certificate in `~/.cloudflared`.
2. `cloudflared tunnel create support-agent`: creates the tunnel and a credentials file.
3. `cloudflared tunnel route dns support-agent support.example.com`: adds the DNS record.
4. `npm run tunnel -- support-agent`: runs `cloudflared tunnel run --url http://localhost:3000 support-agent`.
5. Use `https://support.example.com` as the script `src` and `data-server`.

To start it with Windows instead of from a terminal, write the URL into a `config.yml` (see Cloudflare's docs) and run `cloudflared service install`.

### Keeping it running

- **The widget works only while your computer is on, awake and online, and while both `npm run serve` and the tunnel are running.** When it isn't, `widget.js` can't load, so the chat bubble doesn't appear on your site, and a visitor who already has the chat open gets a connection error. Your site is otherwise unaffected.
- Stop the computer from sleeping while it serves visitors. On Windows: Settings → System → Power → "When plugged in, put my device to sleep after" → Never (laptops: keep it plugged in, and set the lid-close action to "Do nothing" if you close it). On macOS, `caffeinate -s` while it runs.
- Windows Update restarts, Ollama updates and closed terminals all stop it. Check `https://<your address>/api/health` after a restart.
- Everything a visitor sends reaches only your computer and, with Ollama, stays there. The question log (`LOG_QUESTIONS=1`) is written to `data/agents/<id>/log.jsonl` on the same disk.
