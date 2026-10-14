import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendEntry,
  buildReport,
  entriesSince,
  formatReport,
  hashSession,
  linkedSources,
  logFile,
  normalizeQuestion,
  pagePath,
  pruneLog,
  readEntries,
  soundsNotFound,
  TurnRecorder,
  type QuestionLogEntry,
} from "../src/questionlog.ts";

const DAY = 24 * 60 * 60 * 1000;

function tempLog(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qlog-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return logFile(path.join(dir, "agents", "demo"));
}

function entry(over: Partial<QuestionLogEntry> = {}): QuestionLogEntry {
  return {
    ts: new Date().toISOString(),
    session: "abc",
    question: "How do I install it?",
    backend: "claude",
    answerChars: 100,
    sources: ["https://docs.example.com/install"],
    searches: ["install"],
    notFound: false,
    ms: 1000,
    ...over,
  };
}

test("the recorder turns a streamed turn into one entry", () => {
  const rec = new TurnRecorder({ sessionId: "session-1", question: "How do retries work?", page: "/docs/jobs", backend: "ollama" });
  rec.see({ type: "status", message: "Searching docs: retry" });
  rec.see({ type: "status", message: "Reading page…" });
  rec.see({ type: "text", text: "See [Retries](https://docs.example.com/retries) and " });
  rec.see({ type: "text", text: "<https://docs.example.com/jobs>." });
  rec.see({ type: "done" });
  const e = rec.entry();
  assert.equal(e.question, "How do retries work?");
  assert.equal(e.page, "/docs/jobs");
  assert.equal(e.backend, "ollama");
  assert.equal(e.session, hashSession("session-1"));
  assert.notEqual(e.session, "session-1");
  assert.deepEqual(e.searches, ["retry"]);
  assert.deepEqual(e.sources, ["https://docs.example.com/retries", "https://docs.example.com/jobs"]);
  assert.equal(e.answerChars, "See [Retries](https://docs.example.com/retries) and <https://docs.example.com/jobs>.".length);
  assert.equal(e.notFound, false);
  assert.equal(e.error, undefined);
  assert.equal(typeof e.ms, "number");
});

test("the recorder marks errors and answers cut off before done", () => {
  const failed = new TurnRecorder({ sessionId: "s", question: "q", backend: "claude" });
  failed.see({ type: "error", message: "The assistant is unavailable right now." });
  assert.equal(failed.entry().error, "The assistant is unavailable right now.");

  const cut = new TurnRecorder({ sessionId: "s", question: "q", backend: "claude" });
  cut.see({ type: "text", text: "Partial" });
  assert.match(cut.entry().error ?? "", /cut off/);
});

test("only the path of the visitor's page is kept", () => {
  assert.equal(pagePath("https://example.com/docs/a?email=me@x.com#top"), "/docs/a");
  assert.equal(pagePath(undefined), undefined);
});

test("linked sources and not-found phrasing are detected", () => {
  assert.deepEqual(linkedSources("Go to https://x.dev/a. Also https://x.dev/a"), ["https://x.dev/a"]);
  assert.deepEqual(linkedSources("No links here"), []);
  assert.ok(soundsNotFound("Sorry, I couldn't find anything about SSO in the docs."));
  assert.ok(soundsNotFound("The documentation doesn't cover that; I don't have any information on pricing."));
  assert.ok(!soundsNotFound("Install it with npm install my-project."));
});

test("appended entries read back in order, skipping broken lines", (t) => {
  const file = tempLog(t);
  appendEntry(file, entry({ question: "first" }));
  fs.appendFileSync(file, '{"ts": "cut off mid-wri\n');
  appendEntry(file, entry({ question: "second" }));
  assert.deepEqual(readEntries(file).map((e) => e.question), ["first", "second"]);
  assert.deepEqual(readEntries(file + ".missing"), []);
});

test("pruning drops entries older than the retention window", (t) => {
  const file = tempLog(t);
  const now = Date.parse("2026-10-14T12:00:00Z");
  appendEntry(file, entry({ question: "old", ts: new Date(now - 31 * DAY).toISOString() }));
  appendEntry(file, entry({ question: "recent", ts: new Date(now - 29 * DAY).toISOString() }));
  appendEntry(file, entry({ question: "today", ts: new Date(now).toISOString() }));
  assert.equal(pruneLog(file, 30, now), 1);
  assert.deepEqual(readEntries(file).map((e) => e.question), ["recent", "today"]);
  assert.equal(pruneLog(file, 30, now), 0);
  assert.equal(pruneLog(file + ".missing", 30, now), 0);
});

test("entriesSince keeps only the last N days", () => {
  const now = Date.now();
  const got = entriesSince([entry({ ts: new Date(now - 8 * DAY).toISOString() }), entry({ ts: new Date(now - DAY).toISOString() })], 7, now);
  assert.equal(got.length, 1);
});

test("questions are normalized before grouping", () => {
  assert.equal(normalizeQuestion("  How do I INSTALL it?? "), "how do i install it");
});

test("the report groups questions, finds gaps and errors, and computes response times", () => {
  const entries = [
    entry({ question: "How do I install it?", session: "a", ms: 1000 }),
    entry({ question: "how do i install it", session: "b", ms: 2000 }),
    entry({ question: "How do I install it", session: "c", ms: 3000 }),
    entry({ question: "Do you support SSO?", sources: [], notFound: true, ms: 4000 }),
    entry({ question: "Pricing?", sources: [], ms: 5000 }),
    entry({ question: "Pricing", sources: [], ms: 6000 }),
    entry({ question: "Broken one", error: "The assistant is unavailable right now.", ms: 50 }),
    entry({ question: "Broken two", error: "The assistant is unavailable right now.", ms: 60 }),
  ];
  const r = buildReport(entries);
  assert.equal(r.total, 8);
  assert.equal(r.sessions, 4);
  assert.deepEqual(r.top[0], { question: "How do I install it", count: 3 });
  assert.deepEqual(r.top[1], { question: "Pricing", count: 2 });
  assert.deepEqual(r.gaps, [
    { question: "Pricing", count: 2, reason: "no source" },
    { question: "Do you support SSO?", count: 1, reason: "not found" },
  ]);
  assert.deepEqual(r.errors, [{ message: "The assistant is unavailable right now.", count: 2 }]);
  // Errored turns are left out of timings: 1000..6000 -> median 3000, p95 6000.
  assert.equal(r.medianMs, 3000);
  assert.equal(r.p95Ms, 6000);

  const text = formatReport(r, "demo", 7);
  assert.match(text, /8 questions from 4 conversations/);
  assert.match(text, /Do you support SSO\?\s+\[not found\]/);
});

test("an empty log gives a helpful report", () => {
  const r = buildReport([]);
  assert.equal(r.medianMs, null);
  assert.match(formatReport(r, "demo", 7), /LOG_QUESTIONS=1/);
});
