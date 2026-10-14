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
| `allowedOrigins` | Sites allowed to embed this agent. `["*"]` allows any site; use explicit origins in production so other sites can't spend your API credits |
| `sources` | What to index; see [knowledge-base.md](knowledge-base.md) |

One server can host many agents, one per project. Each agent has its own folder under `data/agents/`.

## Server environment (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | | Claude API key (required) |
| `PORT` | `3000` | HTTP port |
| `ADMIN_TOKEN` | | Bearer token for the reindex endpoint; reindex is disabled when empty |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model that answers questions |
| `CLAUDE_EFFORT` | `low` | `low`, `medium`, `high`, `xhigh` or `max`. Higher means more thorough and slower |
| `RATE_LIMIT_PER_MIN` | `20` | Chat messages per visitor IP per minute, per agent |
| `TRUST_PROXY` | | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For` |

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

Returns `{ name, greeting, ready }`.

### `POST /api/agents/:id/reindex`

Requires `Authorization: Bearer <ADMIN_TOKEN>`. Rebuilds the knowledge base from the agent's sources.
