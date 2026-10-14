import type { AgentEvent } from "./agent.ts";

// Answer-quality checks: run scripted conversations through the agent and test each answer
// against phrases it must and must not contain, plus flag links that aren't real pages.
// The chat function is passed in so tests can drive this without a model.

export interface CheckTurn {
  ask: string;
  /** Each must appear in the answer. A plain phrase matches case-insensitively; "/regex/flags" is a regex. */
  expect?: string[];
  /** None may appear in the answer. Same syntax as expect. */
  forbid?: string[];
}

export type CheckConversation = CheckTurn[];

export type ChatFn = (message: string, sessionId?: string) => AsyncIterable<AgentEvent>;

export interface TurnResult {
  conversation: number;
  turn: number;
  ask: string;
  answer: string;
  ms: number;
  error?: string;
  missing: string[];
  forbidden: string[];
  badLinks: string[];
  passed: boolean;
}

/** Validate the parsed checks.json, throwing a message that points at the bad entry. */
export function parseChecks(data: unknown): CheckConversation[] {
  if (!Array.isArray(data)) throw new Error("checks.json must be a list of conversations");
  return data.map((conv, i) => {
    const where = `conversation ${i + 1}`;
    if (!Array.isArray(conv) || !conv.length) throw new Error(`${where} must be a non-empty list of turns`);
    return conv.map((t, j) => {
      const at = `${where}, turn ${j + 1}`;
      if (!t || typeof t !== "object" || typeof t.ask !== "string" || !t.ask.trim()) throw new Error(`${at} needs an "ask" string`);
      for (const key of ["expect", "forbid"] as const) {
        const v = t[key];
        if (v !== undefined && (!Array.isArray(v) || v.some((p) => typeof p !== "string"))) throw new Error(`${at}: "${key}" must be a list of strings`);
        for (const p of v ?? []) toMatcher(p, at);
      }
      return { ask: t.ask, expect: t.expect, forbid: t.forbid };
    });
  });
}

// Models dress answers up in Markdown and typographic quotes; phrases shouldn't have to.
function normalize(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\*\*|[*`]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function toMatcher(pattern: string, where = "checks.json"): (answer: string) => boolean {
  const re = /^\/(.+)\/([a-z]*)$/s.exec(pattern);
  if (re) {
    let regex: RegExp;
    try {
      regex = new RegExp(re[1], re[2]);
    } catch (err) {
      throw new Error(`${where}: bad regex ${pattern}: ${(err as Error).message}`);
    }
    return (answer) => regex.test(answer);
  }
  const phrase = normalize(pattern);
  return (answer) => normalize(answer).includes(phrase);
}

/** Does the answer contain this phrase or match this "/regex/"? */
export function matches(answer: string, pattern: string): boolean {
  return toMatcher(pattern)(answer);
}

/** Every absolute http(s) link in the answer, from Markdown links and bare URLs. */
export function extractLinks(answer: string): string[] {
  const found = (answer.match(/https?:\/\/[^\s<>"'`)\]]+/g) ?? []).map((u) => u.replace(/[.,;:!?*_]+$/, ""));
  return [...new Set(found)];
}

function normUrl(u: string): string {
  return u.replace(/#.*$/, "").replace(/\/+$/, "");
}

/**
 * Links that aren't pages in the knowledge base. A URL quoted verbatim in the indexed
 * content (a Discord invite, say) counts as real too: it came from the docs, not the model.
 */
export function findBadLinks(answer: string, pageUrls: string[], kbText = ""): string[] {
  const pages = new Set(pageUrls.map(normUrl));
  return extractLinks(answer).filter((u) => !pages.has(normUrl(u)) && !kbText.includes(normUrl(u)));
}

/** Check one answer against its turn. */
export function judge(turn: CheckTurn, answer: string, pageUrls: string[], kbText = "") {
  const missing = (turn.expect ?? []).filter((p) => !matches(answer, p));
  const forbidden = (turn.forbid ?? []).filter((p) => matches(answer, p));
  const badLinks = findBadLinks(answer, pageUrls, kbText);
  return { missing, forbidden, badLinks, passed: !missing.length && !forbidden.length && !badLinks.length };
}

/** Run every conversation, one chat session each, reporting each turn as it finishes. */
export async function runChecks(
  conversations: CheckConversation[],
  chat: ChatFn,
  kb: { pageUrls: string[]; text?: string },
  onResult: (r: TurnResult) => void = () => {},
): Promise<TurnResult[]> {
  const results: TurnResult[] = [];
  for (const [ci, conv] of conversations.entries()) {
    let sessionId: string | undefined;
    for (const [ti, turn] of conv.entries()) {
      const started = performance.now();
      let answer = "";
      let error: string | undefined;
      try {
        for await (const ev of chat(turn.ask, sessionId)) {
          if (ev.type === "session") sessionId = ev.sessionId;
          else if (ev.type === "text") answer += ev.text;
          else if (ev.type === "error") error = ev.message;
        }
      } catch (err) {
        error = (err as Error).message;
      }
      const ms = Math.round(performance.now() - started);
      const verdict = judge(turn, answer, kb.pageUrls, kb.text);
      const result: TurnResult = { conversation: ci + 1, turn: ti + 1, ask: turn.ask, answer: answer.trim(), ms, error, ...verdict, passed: verdict.passed && !error };
      results.push(result);
      onResult(result);
    }
  }
  return results;
}

const color = (code: number, s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

/** One row per turn: verdict, id, time, question, then the answer and whatever went wrong. */
export function formatResult(r: TurnResult): string {
  const lines = [
    `${r.passed ? color(32, "PASS") : color(31, "FAIL")}  ${`${r.conversation}.${r.turn}`.padEnd(5)} ${`${(r.ms / 1000).toFixed(1)}s`.padStart(6)}  ${r.ask}`,
    color(2, `      ${r.passed ? oneLine(r.answer, 200) : r.answer.replace(/\n/g, "\n      ")}`),
  ];
  if (r.error) lines.push(color(31, `      error: ${r.error}`));
  if (r.missing.length) lines.push(color(31, `      missing: ${r.missing.map((p) => JSON.stringify(p)).join(", ")}`));
  if (r.forbidden.length) lines.push(color(31, `      forbidden: ${r.forbidden.map((p) => JSON.stringify(p)).join(", ")}`));
  if (r.badLinks.length) lines.push(color(31, `      not a page in the knowledge base: ${r.badLinks.join(", ")}`));
  return lines.join("\n");
}

export function formatSummary(results: TurnResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const secs = results.reduce((a, r) => a + r.ms, 0) / 1000;
  const line = `${passed}/${results.length} answers passed in ${secs.toFixed(1)}s`;
  return passed === results.length ? color(32, line) : color(31, line);
}
