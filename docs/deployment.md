# Deploying

The server is a single Node process with no database: agent configs and indexes are JSON files under `data/agents/`. Anything that runs Node 22.18+ works (a VPS, Fly.io, Railway, Render, a container).

## Steps

1. Copy the project (including `data/agents/<id>/agent.json`) to the host.
2. `npm ci --omit=dev`
3. Set `ANTHROPIC_API_KEY`, `ADMIN_TOKEN` and `PORT` in the environment.
4. `npm run cli -- ingest <id>` (or commit `kb.json`, or call the reindex endpoint after boot).
5. `npm run serve`

Put it behind HTTPS (most platforms do this for you) and set `TRUST_PROXY=1` when a proxy sits in front.

## Checklist before going live

- Replace `"*"` in `allowedOrigins` with your real site origins.
- Keep `RATE_LIMIT_PER_MIN` modest; every message is a paid model call.
- Set an `ADMIN_TOKEN` if you want remote re-indexing, and leave it empty otherwise.
- Re-run ingest whenever docs change. A CI step that calls the reindex endpoint after a docs deploy keeps it current.

## Scaling notes

Conversation sessions are kept in memory, so run one instance, or use sticky sessions if you run several. The keyword index is rebuilt in memory from `kb.json` when the file changes; tens of thousands of passages load in well under a second.
