import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent } from "../src/agent.ts";
import { claudeBackend } from "../src/backends/claude.ts";
import { withFallback } from "../src/backends/fallback.ts";
import { ollamaBackend } from "../src/backends/ollama.ts";
import type { Backend, TurnInput } from "../src/backends/shared.ts";
import type { AgentConfig } from "../src/config.ts";
import { KnowledgeBase } from "../src/kb.ts";

const cfg: AgentConfig = { id: "t", name: "Acme", description: "Acme makes widgets.", allowedOrigins: ["*"], sources: [] };
const kb = new KnowledgeBase({
  builtAt: "",
  pages: [{ url: "https://acme.test/refunds", title: "Refunds", text: "Refunds are accepted within 30 days." }],
  chunks: [{ id: 0, url: "https://acme.test/refunds", title: "Refunds", section: "", text: "Refunds are accepted within 30 days." }],
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub Ollama's /api/chat with a streamed answer, recording each request body. */
function stubOllama(reply: string): { bodies: { messages: { role: string; content: string }[] }[] } {
  const calls = { bodies: [] as { messages: { role: string; content: string }[] }[] };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /\/api\/chat$/);
    calls.bodies.push(JSON.parse(String(init?.body)));
    const lines = reply.split(" ").map((w, i) => JSON.stringify({ message: { role: "assistant", content: (i ? " " : "") + w } }) + "\n");
    return new Response(lines.join("") + JSON.stringify({ done: true }) + "\n", { status: 200 });
  }) as typeof fetch;
  return calls;
}

/** A Claude stand-in: real error handling, scripted answers. */
function fakeClaude(script: (input: TurnInput) => AsyncGenerator<AgentEvent, unknown[]>): Backend & { calls: TurnInput[] } {
  const calls: TurnInput[] = [];
  return {
    ...claudeBackend,
    calls,
    answer(input) {
      calls.push(input);
      return script(input);
    },
  };
}

/** An API error shaped like the real response body. */
const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, message, new Headers());
const overloaded = () => apiError(529, "overloaded_error", "Overloaded");

async function run(backend: Backend, message: string, history: unknown[]) {
  const events: AgentEvent[] = [];
  const gen = backend.answer({ cfg, kb, message, context: "", history });
  let r = await gen.next();
  while (!r.done) {
    events.push(r.value);
    r = await gen.next();
  }
  return { events, history: r.value, text: events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("") };
}

const quiet = () => {};

test("Ollama answers when Claude fails before any text", async () => {
  const ollama = stubOllama("Within 30 days.");
  const claude = fakeClaude(async function* () {
    yield { type: "status", message: "Searching docs: refunds" };
    throw overloaded();
  });
  const logs: string[] = [];
  const backend = withFallback(claude, ollamaBackend, { primary: "Claude", backup: "Ollama" }, (m) => logs.push(m));

  const { text, history } = await run(backend, "How long do refunds take?", []);
  assert.equal(text, "Within 30 days.");
  assert.equal(ollama.bodies.length, 1);
  assert.equal(ollama.bodies[0].messages.at(-1)?.content, "How long do refunds take?");
  assert.match(ollama.bodies[0].messages[0].content, /Refunds are accepted within 30 days/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Claude unavailable \(529 .*\); answering with Ollama/);
  assert.equal(history.length, 1);
});

test("each kind of outage fails over", async () => {
  const errors = [
    new Anthropic.APIConnectionError({ message: "Connection error." }),
    apiError(429, "rate_limit_error", "Rate limited"),
    apiError(401, "authentication_error", "invalid x-api-key"),
    apiError(500, "api_error", "Internal server error"),
    apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
    new Error("Could not resolve authentication method. Expected one of apiKey, authToken"),
  ];
  for (const err of errors) assert.equal(claudeBackend.isUnavailable?.(err), true, String(err));

  const notOutages = [apiError(400, "invalid_request_error", "messages: bad shape"), new TypeError("x is undefined")];
  for (const err of notOutages) assert.equal(claudeBackend.isUnavailable?.(err), false, String(err));
});

test("no failover once Claude has streamed text", async () => {
  const ollama = stubOllama("should not be used");
  const claude = fakeClaude(async function* () {
    yield { type: "text", text: "Refunds are" };
    throw overloaded();
  });
  const backend = withFallback(claude, ollamaBackend, { primary: "Claude", backup: "Ollama" }, quiet);

  await assert.rejects(run(backend, "Refunds?", []), (err: unknown) => err instanceof Anthropic.APIError && err.status === 529);
  assert.equal(ollama.bodies.length, 0);
});

test("no failover for errors that aren't outages", async () => {
  const ollama = stubOllama("should not be used");
  const claude = fakeClaude(async function* () {
    throw new TypeError("bug");
  });
  const backend = withFallback(claude, ollamaBackend, { primary: "Claude", backup: "Ollama" }, quiet);
  await assert.rejects(run(backend, "Refunds?", []), TypeError);
  assert.equal(ollama.bodies.length, 0);
});

test("if the backup fails too, the visitor sees the backup's error", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const claude = fakeClaude(async function* () {
    throw overloaded();
  });
  const backend = withFallback(claude, ollamaBackend, { primary: "Claude", backup: "Ollama" }, quiet);
  let caught: unknown;
  await run(backend, "Refunds?", []).catch((e) => (caught = e));
  assert.match(backend.errorMessage(caught), /model server isn't reachable/);
});

test("a session that switches backends keeps its context on both sides", async () => {
  let claudeDown = false;
  const claude = fakeClaude(async function* (input) {
    if (claudeDown) throw overloaded();
    yield { type: "text", text: "Claude answer" };
    return [...input.history, { role: "user", content: input.message }, { role: "assistant", content: [{ type: "text", text: "Claude answer" }] }];
  });
  const backend = withFallback(claude, ollamaBackend, { primary: "Claude", backup: "Ollama" }, quiet);

  // Turn 1: Claude.
  let state = (await run(backend, "first", [])).history;
  const claudeAfterTurn1 = claude.calls[0];

  // Turn 2: Claude down, Ollama gets turn 1 as plain text.
  claudeDown = true;
  const ollama = stubOllama("Ollama answer");
  state = (await run(backend, "second", state)).history;
  assert.deepEqual(
    ollama.bodies[0].messages.slice(1).map((m) => [m.role, m.content]),
    [["user", "first"], ["assistant", "Claude answer"], ["user", "second"]],
  );

  // Turn 3: Claude back. Its history is its own turn-1 transcript, untouched, with turn 2 appended as text.
  claudeDown = false;
  await run(backend, "third", state);
  const h = claude.calls[2].history as { role: string; content: unknown }[];
  assert.deepEqual(h.slice(0, 2), [
    { role: "user", content: "first" },
    { role: "assistant", content: [{ type: "text", text: "Claude answer" }] },
  ]);
  assert.deepEqual(h.slice(2), [
    { role: "user", content: "second" },
    { role: "assistant", content: "Ollama answer" },
  ]);
  assert.equal(claudeAfterTurn1.history.length, 0);
});
