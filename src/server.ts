import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chat } from "./agent.ts";
import { checkOllama } from "./backends/ollama.ts";
import { ROOT, loadAgent, settings, type AgentConfig } from "./config.ts";
import { buildKnowledgeBase, getKnowledgeBase } from "./kb.ts";

const MAX_BODY = 16 * 1024;
const MAX_MESSAGE = 4000;
const PUBLIC_DIR = path.join(ROOT, "public");

// --- per-IP rate limit (sliding one-minute window) ---------------------------------------
const hits = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > settings.rateLimitPerMin;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of hits) if (ts.every((t) => now - t >= 60_000)) hits.delete(k);
}, 60_000).unref();

// --- helpers ---------------------------------------------------------------------------------
function cors(req: http.IncomingMessage, res: http.ServerResponse, agent: AgentConfig | null): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client
  // Browsers send Origin on same-origin POSTs too, e.g. from this server's own /demo page.
  if (origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`) return true;
  const allowed = (agent?.allowedOrigins ?? []).map((o) => o.replace(/\/+$/, ""));
  if (!allowed.includes("*") && !allowed.includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Body too large"), { status: 413 });
    parts.push(chunk);
  }
  try {
    const v = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function clientIp(req: http.IncomingMessage): string {
  // Behind a reverse proxy, set TRUST_PROXY=1 so the real visitor IP is used.
  const fwd = process.env.TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
  return fwd || req.socket.remoteAddress || "unknown";
}

function serveStatic(res: http.ServerResponse, file: string, type: string) {
  const full = path.join(PUBLIC_DIR, file);
  if (!fs.existsSync(full)) return json(res, 404, { error: "Not found" });
  res.writeHead(200, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  });
  fs.createReadStream(full).pipe(res);
}

// --- routes ----------------------------------------------------------------------------------
async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;

  if (req.method === "GET" && p === "/widget.js") return serveStatic(res, "widget.js", "text/javascript; charset=utf-8");
  if (req.method === "GET" && (p === "/" || p === "/demo")) return serveStatic(res, "demo.html", "text/html; charset=utf-8");
  if (req.method === "GET" && p === "/api/health") return json(res, 200, { ok: true });

  const m = /^\/api\/agents\/([a-z0-9-]+)\/(config|chat|reindex)$/.exec(p);
  if (!m) return json(res, 404, { error: "Not found" });
  const [, agentId, action] = m;
  const agent = loadAgent(agentId);

  if (!cors(req, res, agent)) return json(res, 403, { error: "Origin not allowed for this agent" });
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (!agent) return json(res, 404, { error: `Unknown agent "${agentId}"` });

  if (action === "config" && req.method === "GET") {
    const kb = getKnowledgeBase(agentId);
    return json(res, 200, { name: agent.name, greeting: agent.greeting ?? `Hi! Ask me anything about ${agent.name}.`, ready: !!kb });
  }

  if (action === "reindex" && req.method === "POST") {
    if (!settings.adminToken || req.headers.authorization !== `Bearer ${settings.adminToken}`) return json(res, 401, { error: "Unauthorized" });
    const kb = await buildKnowledgeBase(agent, (msg) => console.log(`[reindex ${agentId}] ${msg}`));
    return json(res, 200, { pages: kb.pages.length, chunks: kb.chunks.length, builtAt: kb.builtAt });
  }

  if (action === "chat" && req.method === "POST") {
    if (rateLimited(`${agentId}:${clientIp(req)}`)) return json(res, 429, { error: "Too many messages. Please wait a minute." });
    const body = await readJson(req);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return json(res, 400, { error: "message is required" });
    if (message.length > MAX_MESSAGE) return json(res, 400, { error: `Message too long (max ${MAX_MESSAGE} characters)` });
    const kb = getKnowledgeBase(agentId);
    if (!kb) return json(res, 503, { error: `Agent "${agentId}" has no knowledge base yet. Run: npm run cli -- ingest ${agentId}` });

    const page = body.page && typeof body.page === "object" ? (body.page as { url?: string; title?: string }) : undefined;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
    for await (const ev of chat(agent, kb, message, { sessionId, page })) {
      if (res.destroyed) break;
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    return res.end();
  }

  return json(res, 405, { error: "Method not allowed" });
}

export function startServer(port = settings.port) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!err.status) console.error(err);
      if (!res.headersSent) json(res, err.status ?? 500, { error: err.status ? err.message : "Internal error" });
      else res.end();
    });
  });
  server.listen(port, () => {
    console.log(`Support agent server on http://localhost:${port}`);
    console.log(`  demo:   http://localhost:${port}/demo`);
    console.log(`  widget: http://localhost:${port}/widget.js`);
    if (settings.provider === "ollama") {
      console.log(`  model:  ${settings.ollama.model} via Ollama at ${settings.ollama.url}`);
      checkOllama().then((warning) => warning && console.warn(`\n  Warning: ${warning}`));
    } else if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      console.warn("\n  Warning: ANTHROPIC_API_KEY is not set, so chat requests will fail. Add it to .env.");
    }
  });
  return server;
}
