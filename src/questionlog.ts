import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentEvent } from "./agent.ts";

// Optional question log (LOG_QUESTIONS=1): one JSON line per answered message in
// data/agents/<id>/log.jsonl, so owners can see what visitors ask and where the docs fall short.
// Deliberately left out: IP addresses, the answer text, and the visitor's page URL beyond its path.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface QuestionLogEntry {
  /** ISO time the question arrived. */
  ts: string;
  /** Short one-way hash of the session id: groups a conversation without exposing a usable id. */
  session: string;
  question: string;
  /** Path of the page the visitor asked from, without host, query or fragment. */
  page?: string;
  /** Which model answered: "claude" or "ollama". */
  backend: string;
  answerChars: number;
  /** Absolute links the answer gave (what the widget shows as Sources). */
  sources: string[];
  /** Searches the agent ran, from its status events. */
  searches: string[];
  /** The answer said it couldn't find the information. */
  notFound: boolean;
  ms: number;
  /** Visitor-facing error message, when the turn failed or was cut off. */
  error?: string;
}

export function logFile(dir: string): string {
  return path.join(dir, "log.jsonl");
}

export function hashSession(id: string): string {
  return crypto.createHash("sha256").update(id).digest("hex").slice(0, 12);
}

/** Path part of a page URL, or undefined. Never the host, query string or fragment. */
export function pagePath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, "http://x").pathname.slice(0, 300);
  } catch {
    return undefined;
  }
}

// Same rules as the widget's Sources chips: markdown links, <autolinks> and bare http(s) URLs.
const LINK_RE = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?*_])/g;

export function linkedSources(answer: string): string[] {
  const out = new Set<string>();
  for (const m of answer.matchAll(LINK_RE)) out.add(m[1] ?? m[2] ?? m[3]);
  return [...out];
}

const NOT_FOUND_RE =
  /\b(couldn['’]?t|could not|can['’]?t|cannot|wasn['’]?t able to|was unable to|unable to) (find|locate)\b|\b(don['’]?t|do not) (have|see) (any )?(information|details|documentation)\b|\bno (information|mention|documentation) (about|on|of|for)\b|\bnot (covered|mentioned|documented) in the (docs|documentation)\b|\bdocs (don['’]?t|do not) (cover|mention)\b/i;

export function soundsNotFound(answer: string): boolean {
  return NOT_FOUND_RE.test(answer);
}

/** Collects one turn's events into a log entry. */
export class TurnRecorder {
  private readonly started = Date.now();
  private answer = "";
  private readonly searches: string[] = [];
  private error: string | undefined;
  private finished = false;
  private readonly base: { sessionId: string; question: string; page?: string; backend: string };

  constructor(base: { sessionId: string; question: string; page?: string; backend: string }) {
    this.base = base;
  }

  see(ev: AgentEvent): void {
    if (ev.type === "text") this.answer += ev.text;
    else if (ev.type === "status" && ev.message.startsWith("Searching docs: ")) this.searches.push(ev.message.slice(16));
    else if (ev.type === "error") this.error = ev.message;
    else if (ev.type === "done") this.finished = true;
  }

  entry(): QuestionLogEntry {
    const e: QuestionLogEntry = {
      ts: new Date(this.started).toISOString(),
      session: hashSession(this.base.sessionId),
      question: this.base.question,
      ...(this.base.page ? { page: this.base.page } : {}),
      backend: this.base.backend,
      answerChars: this.answer.length,
      sources: linkedSources(this.answer),
      searches: this.searches,
      notFound: soundsNotFound(this.answer),
      ms: Date.now() - this.started,
    };
    const error = this.error ?? (this.finished ? undefined : "Answer cut off (visitor left or request aborted)");
    if (error) e.error = error;
    return e;
  }
}

export function appendEntry(file: string, entry: QuestionLogEntry): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
}

/** Every well-formed entry in the file, oldest first. Unreadable lines are skipped. */
export function readEntries(file: string): QuestionLogEntry[] {
  if (!fs.existsSync(file)) return [];
  const out: QuestionLogEntry[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.ts === "string" && typeof e.question === "string") out.push(e);
    } catch {
      // a line cut short by a crash; ignore it
    }
  }
  return out;
}

/** Drop entries older than `days`. Returns how many were removed. */
export function pruneLog(file: string, days: number, now = Date.now()): number {
  if (!fs.existsSync(file)) return 0;
  const cutoff = now - days * DAY_MS;
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  const keep = lines.filter((l) => {
    try {
      const t = Date.parse(JSON.parse(l).ts);
      return !Number.isNaN(t) && t >= cutoff;
    } catch {
      return false;
    }
  });
  const removed = lines.length - keep.length;
  if (removed) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, keep.map((l) => l + "\n").join(""));
    fs.renameSync(tmp, file);
  }
  return removed;
}

// --- report ----------------------------------------------------------------------------------

/** Lowercase, drop punctuation and extra spaces, so "How do I install?" and "how do i install" group. */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface QuestionGroup {
  /** The most recent wording of the question. */
  question: string;
  count: number;
}

export interface Report {
  total: number;
  sessions: number;
  top: QuestionGroup[];
  /** Answered without linking any source, or said it couldn't find the answer. */
  gaps: (QuestionGroup & { reason: "no source" | "not found" })[];
  errors: { message: string; count: number }[];
  medianMs: number | null;
  p95Ms: number | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** Group entries by normalized question, most asked first. */
function group(entries: QuestionLogEntry[]): (QuestionGroup & { notFound: boolean })[] {
  const map = new Map<string, QuestionGroup & { notFound: boolean }>();
  for (const e of entries) {
    const key = normalizeQuestion(e.question);
    if (!key) continue;
    const g = map.get(key) ?? { question: e.question, count: 0, notFound: false };
    g.question = e.question;
    g.count++;
    g.notFound ||= !!e.notFound;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.question.localeCompare(b.question));
}

export function buildReport(entries: QuestionLogEntry[], limit = 15): Report {
  const answered = entries.filter((e) => !e.error);
  const gapEntries = answered.filter((e) => e.notFound || !e.sources?.length);
  const errorCounts = new Map<string, number>();
  for (const e of entries) if (e.error) errorCounts.set(e.error, (errorCounts.get(e.error) ?? 0) + 1);
  const times = answered.map((e) => e.ms).filter((n) => typeof n === "number").sort((a, b) => a - b);
  return {
    total: entries.length,
    sessions: new Set(entries.map((e) => e.session)).size,
    top: group(entries)
      .slice(0, limit)
      .map(({ question, count }) => ({ question, count })),
    gaps: group(gapEntries)
      .slice(0, limit)
      .map(({ question, count, notFound }) => ({ question, count, reason: notFound ? "not found" : "no source" })),
    errors: [...errorCounts].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count),
    medianMs: percentile(times, 50),
    p95Ms: percentile(times, 95),
  };
}

export function entriesSince(entries: QuestionLogEntry[], days: number, now = Date.now()): QuestionLogEntry[] {
  const cutoff = now - days * DAY_MS;
  return entries.filter((e) => Date.parse(e.ts) >= cutoff);
}

function secs(ms: number | null): string {
  return ms === null ? "n/a" : `${(ms / 1000).toFixed(1)}s`;
}

export function formatReport(r: Report, agentId: string, days: number): string {
  const lines = [`Question report for ${agentId}, last ${days} day${days === 1 ? "" : "s"}`, ""];
  if (!r.total) return [...lines, "No questions logged. Is LOG_QUESTIONS=1 set on the server?"].join("\n");
  lines.push(`${r.total} questions from ${r.sessions} conversations. Response time: median ${secs(r.medianMs)}, 95th percentile ${secs(r.p95Ms)}.`);
  lines.push("", "Most asked:");
  for (const g of r.top) lines.push(`  ${String(g.count).padStart(4)}  ${g.question}`);
  lines.push("", "Likely docs gaps (no source linked, or the answer couldn't find it):");
  if (!r.gaps.length) lines.push("  none");
  for (const g of r.gaps) lines.push(`  ${String(g.count).padStart(4)}  ${g.question}  [${g.reason}]`);
  lines.push("", "Errors:");
  if (!r.errors.length) lines.push("  none");
  for (const e of r.errors) lines.push(`  ${String(e.count).padStart(4)}  ${e.message}`);
  return lines.join("\n");
}
