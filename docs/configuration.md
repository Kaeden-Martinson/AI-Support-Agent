# Configuration

## Agent config (`data/agents/<id>/agent.json`)

```json
{
  "id": "my-project",
  "name": "My Project",
  "description": "My Project is an open-source job queue for Node.js backed by Postgres.",
  "instructions": "Answer in a friendly, direct tone. For billing questions, direct people to the pricing page.",
  "supportContact": "GitHub issues at https://github.com/me/my-project/issues",
  "greeting": "Hi! Ask me anything about My Project.",
  "suggestions": ["How do I install it?", "How do retries work?"],
  "allowedOrigins": ["https://myproject.dev", "http://localhost:5173"],
  "sources": [{ "type": "dir", "path": "../my-project/docs" }]
}
```

| Field | Purpose |
| --- | --- |
| `name` | Product name, used in the system prompt and widget header |
| `description` | One or two sentences describing the product; helps the agent stay on topic |
| `instructions` | Optional extra rules: tone, scope, what to escalate |
| `supportContact` | Where to send people when the docs don't have the answer |
| `greeting` | First message in the widget |
| `suggestions` | Up to three starter questions shown as buttons when the chat first opens (each up to 80 characters) |
| `allowedOrigins` | Sites allowed to embed this agent. `["*"]` allows any site; use explicit origins in production so other sites can't spend your API credits |
| `sources` | What to index; see [knowledge-base.md](knowledge-base.md) |

One server can host many agents, one per project. Each agent has its own folder under `data/agents/`.

## Server environment (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `claude` | Which model answers questions: `claude` or `ollama` (a local model; see [Running fully self-hosted](deployment.md#running-fully-self-hosted)) |
| `LLM_FALLBACK` | | Set to `ollama` to answer with the local Ollama model whenever Claude is unavailable (see [Ollama as a backup for Claude](deployment.md#ollama-as-a-backup-for-claude)). Only applies with `LLM_PROVIDER=claude`; off when empty |
| `ANTHROPIC_API_KEY` | | Claude API key (required when `LLM_PROVIDER=claude`) |
| `PORT` | `3000` | HTTP port |
| `ADMIN_TOKEN` | | Bearer token for the reindex endpoint; reindex is disabled when empty |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model that answers questions |
| `CLAUDE_EFFORT` | `low` | `low`, `medium`, `high`, `xhigh` or `max`. Higher means more thorough and slower |
| `OLLAMA_URL` | `http://localhost:11434` | Where Ollama listens. The `OLLAMA_*` settings apply with `LLM_PROVIDER=ollama` or `LLM_FALLBACK=ollama` |
| `OLLAMA_MODEL` | `llama3.1:8b` | Ollama model to use. Pull it first with `ollama pull <model>` |
| `OLLAMA_NUM_CTX` | `8192` | Context window requested from Ollama, in tokens. Ollama's own default is too small for the retrieved passages; larger values use more GPU memory |
| `OLLAMA_PASSAGES` | `6` | Knowledge-base passages put in front of the model for each question |
| `OLLAMA_TOOLS` | `0` | Set to `1` to also let the model run its own `search_docs`/`read_page` calls. Needs a model with tool calling; small models often do worse with it on |
| `RATE_LIMIT_PER_MIN` | `20` | Chat messages per visitor IP per minute, per agent |
| `TRUST_PROXY` | | Set to `1` behind a reverse proxy so rate limits use the visitor IP from `CF-Connecting-IP` (Cloudflare) or the last `X-Forwarded-For` entry. Only set it when a proxy really sits in front, or visitors can fake their IP |
| `LOG_QUESTIONS` | `0` | Set to `1` to keep a log of visitor questions; see [Question log](#question-log) |
| `LOG_RETENTION_DAYS` | `30` | Question-log entries older than this are deleted each time the server starts |

## Question log

With `LOG_QUESTIONS=1`, the server appends one JSON line per answered message to `data/agents/<id>/log.jsonl`, so you can see what visitors ask and which questions your docs don't cover. It is off by default, and the file is in `.gitignore`.

Each line stores:

| Field | What it is |
| --- | --- |
| `ts` | When the question arrived |
| `session` | A short one-way hash of the chat session id. It groups messages from one conversation but can't be used to resume or identify it |
| `question` | The visitor's message, exactly as typed |
| `page` | The path of the page the widget was on (for example `/docs/install`), when the widget sent one |
| `backend` | Which model answered: `claude` or `ollama` |
| `answerChars` | Length of the answer in characters |
| `sources` | The links the answer gave (what the widget shows as Sources) |
| `searches` | The doc searches the agent ran while answering |
| `notFound` | `true` when the answer said it couldn't find the information |
| `ms` | Time from receiving the question to finishing the answer |
| `error` | The error message shown to the visitor, when the answer failed or the visitor left mid-answer |

What is **not** stored: IP addresses, the answer text, the page's host, query string or fragment, the page title, and the real session id. Messages rejected before reaching the model (rate-limited, too long, or sent while the previous one was still running) aren't logged.

Visitors can type anything, including names or email addresses, and the `question` field keeps it verbatim. If you turn the log on, mention it in your privacy policy, keep `LOG_RETENTION_DAYS` as short as is useful, and treat the file as personal data. Old entries are pruned when the server starts, so a server that runs for months without restarting keeps them until the next restart; delete the file at any time to clear it.

To summarize the log:

```bash
npm run cli -- report my-project --days 7
```

The report shows the most-asked questions (grouped ignoring case and punctuation), likely docs gaps (questions answered without linking any source, or where the answer said it couldn't find the information), errors, and the median and 95th-percentile response time. `--days` defaults to 7.

## HTTP API

The widget uses these, and you can call them from your own UI too.

### `POST /api/agents/:id/chat`

Request body:

```json
{ "message": "How do I retry failed jobs?", "sessionId": "optional, from a previous response", "page": { "url": "...", "title": "..." } }
```

The response is a Server-Sent Events stream. Each event is a `data:` line with JSON:

- `{"type":"session","sessionId":"..."}`: always first; send it back with the next message to continue the conversation
- `{"type":"status","message":"Searching docs: retry"}`: progress while the agent searches
- `{"type":"text","text":"..."}`: a piece of the answer (Markdown)
- `{"type":"error","message":"..."}`
- `{"type":"done"}`

### `GET /api/agents/:id/config`

Returns `{ name, greeting, suggestions, ready }`.

### `POST /api/agents/:id/reindex`

Requires `Authorization: Bearer <ADMIN_TOKEN>`. Rebuilds the knowledge base from the agent's sources.
