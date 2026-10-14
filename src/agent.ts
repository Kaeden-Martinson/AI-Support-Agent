import crypto from "node:crypto";
import { claudeBackend } from "./backends/claude.ts";
import { ollamaBackend } from "./backends/ollama.ts";
import { clean, type Backend } from "./backends/shared.ts";
import { agentDir, settings, type AgentConfig } from "./config.ts";
import type { KnowledgeBase } from "./kb.ts";
import { appendEntry, logFile, pagePath, TurnRecorder } from "./questionlog.ts";

const MAX_TURNS_PER_SESSION = 40;
const SESSION_TTL_MS = 60 * 60 * 1000;

const backend: Backend = settings.provider === "ollama" ? ollamaBackend : claudeBackend;

export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "status"; message: string }
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface PageContext {
  url?: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// Sessions live on the server and are append-only: the browser only ever sends the newest
// message, so visitors can't forge earlier assistant turns. Each backend decides what its
// history entries look like; this module only stores them.

interface Session {
  agentId: string;
  history: unknown[];
  turns: number;
  busy: boolean;
  touched: number;
}

const sessions = new Map<string, Session>();

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) if (s.touched < cutoff && !s.busy) sessions.delete(id);
}, 60_000).unref();

function getSession(agentId: string, sessionId?: string): { id: string; session: Session } {
  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (sessionId && existing && existing.agentId === agentId) return { id: sessionId, session: existing };
  const id = crypto.randomUUID();
  const session: Session = { agentId, history: [], turns: 0, busy: false, touched: Date.now() };
  sessions.set(id, session);
  return { id, session };
}

// ---------------------------------------------------------------------------

/** Answer one visitor message, streaming events as they happen. */
export async function* chat(
  cfg: AgentConfig,
  kb: KnowledgeBase,
  message: string,
  opts: { sessionId?: string; page?: PageContext } = {},
): AsyncGenerator<AgentEvent> {
  const { id, session } = getSession(cfg.id, opts.sessionId);
  yield { type: "session", sessionId: id };

  if (session.busy) {
    yield { type: "error", message: "Still working on your previous message." };
    return;
  }
  if (session.turns >= MAX_TURNS_PER_SESSION) {
    yield { type: "error", message: "This conversation has reached its length limit. Please start a new chat." };
    return;
  }

  session.busy = true;
  session.touched = Date.now();
  session.turns++;
  const pageUrl = clean(opts.page?.url, 500);
  const recorder = settings.logQuestions
    ? new TurnRecorder({ sessionId: id, question: message, page: pagePath(pageUrl), backend: settings.provider })
    : null;
  const context = pageUrl ? `<page_context>Visitor is on: ${pageUrl}${opts.page?.title ? ` (${clean(opts.page.title, 200)})` : ""}</page_context>\n\n` : "";

  try {
    // Backends work on a copy and we commit only a completed exchange, so a failed request
    // leaves the session history clean (no dangling user turn or unanswered tool call).
    session.history = yield* recorded(backend.answer({ cfg, kb, message, context, history: session.history }), recorder);
    recorder?.see({ type: "done" });
    yield { type: "done" };
  } catch (err) {
    session.turns--;
    console.error("[chat]", err);
    const error: AgentEvent = { type: "error", message: backend.errorMessage(err) };
    recorder?.see(error);
    yield error;
  } finally {
    session.busy = false;
    session.touched = Date.now();
    if (recorder) {
      try {
        appendEntry(logFile(agentDir(cfg.id)), recorder.entry());
      } catch (err) {
        console.error("[question log]", err);
      }
    }
  }
}

/** Pass a backend's events through, letting the question log see each one. */
async function* recorded(gen: AsyncGenerator<AgentEvent, unknown[]>, recorder: TurnRecorder | null): AsyncGenerator<AgentEvent, unknown[]> {
  if (!recorder) return yield* gen;
  let finished = false;
  try {
    for (;;) {
      const r = await gen.next();
      if (r.done) {
        finished = true;
        return r.value;
      }
      recorder.see(r.value);
      yield r.value;
    }
  } finally {
    // The visitor went away mid-answer: let the backend clean up as yield* would have.
    if (!finished) await gen.return([]);
  }
}
