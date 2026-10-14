import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentEvent } from "../src/agent.ts";
import { extractLinks, findBadLinks, matches, parseChecks, runChecks, type ChatFn } from "../src/check.ts";

const PAGES = ["https://example.com/docs/install", "https://example.com/faq"];

test("phrases match case-insensitively through Markdown and curly quotes", () => {
  assert.ok(matches("It costs **$12.98** a month.", "$12.98 a month"));
  assert.ok(matches("You can’t share\n  your key.", "can't share your key"));
  assert.ok(matches("Click `Load unpacked`.", "load unpacked"));
  assert.ok(!matches("It costs $9.99 a month.", "$12.98"));
});

test("/slashes/ make a regex, with its own flags", () => {
  assert.ok(matches("Chrome, Edge and Brave", "/Chrome.*Edge/"));
  assert.ok(matches("No, iPhone isn't supported", "/\\b(no|not)\\b/i"));
  assert.ok(!matches("CHROME", "/chrome/"));
  assert.ok(matches("CHROME", "/chrome/i"));
  assert.ok(matches("Embed it on **any** site", "/any (site|origin)/"));
  assert.ok(matches("You can’t share it", "/can't/"));
});

test("links come from Markdown and bare URLs, without trailing punctuation", () => {
  const answer = "See [the FAQ](https://example.com/faq) or https://example.com/docs/install. Also https://example.com/faq again.";
  assert.deepEqual(extractLinks(answer), ["https://example.com/faq", "https://example.com/docs/install"]);
});

test("URLs inside code are example values, not links", () => {
  const answer = 'Set `"allowedOrigins": ["https://your-site.com"]`:\n\n```json\n{ "baseUrl": "https://github.com/me/docs/" }\n```\n\nSee https://example.com/faq.';
  assert.deepEqual(extractLinks(answer), ["https://example.com/faq"]);
});

test("bad links are those that aren't knowledge-base pages", () => {
  const answer = "Read https://example.com/faq/#refunds and https://example.com/docs/setup and [x](https://example.com/docs/install/).";
  assert.deepEqual(findBadLinks(answer, PAGES), ["https://example.com/docs/setup"]);
});

test("a URL quoted in the docs themselves isn't flagged", () => {
  const answer = "Join https://discord.gg/abc123 or https://discord.gg/made-up";
  assert.deepEqual(findBadLinks(answer, PAGES, "Support: https://discord.gg/abc123"), ["https://discord.gg/made-up"]);
});

test("parseChecks rejects malformed files with the position of the problem", () => {
  assert.throws(() => parseChecks({}), /list of conversations/);
  assert.throws(() => parseChecks([[{ ask: "hi" }], []]), /conversation 2/);
  assert.throws(() => parseChecks([[{ ask: "hi", expect: "x" }]]), /conversation 1, turn 1: "expect"/);
  assert.throws(() => parseChecks([[{ ask: "hi", forbid: ["/(/"] }]]), /bad regex/);
  assert.deepEqual(parseChecks([[{ ask: "hi", expect: ["hello"] }]]), [[{ ask: "hi", expect: ["hello"], forbid: undefined }]]);
});

/** Fake chat: answers from a script and records which session each message arrived in. */
function fakeChat(answers: Record<string, AgentEvent[]>, seen: { message: string; sessionId?: string }[]): ChatFn {
  let next = 0;
  return async function* (message, sessionId) {
    seen.push({ message, sessionId });
    yield { type: "session", sessionId: sessionId ?? `s${++next}` };
    yield* answers[message] ?? [{ type: "text", text: "I don't know." }];
    yield { type: "done" };
  };
}

test("runChecks keeps one session per conversation and judges each turn", async () => {
  const seen: { message: string; sessionId?: string }[] = [];
  const chat = fakeChat(
    {
      "How much?": [{ type: "text", text: "It's $9.99 " }, { type: "text", text: "a month. See https://example.com/pricing" }],
      "How do I cancel?": [{ type: "text", text: "Cancel from your dashboard." }],
      "Write a poem": [{ type: "text", text: "Roses are red..." }],
      "Broken": [{ type: "error", message: "backend down" }],
    },
    seen,
  );
  const results = await runChecks(
    [
      [{ ask: "How much?", expect: ["$9.99"] }, { ask: "How do I cancel?", expect: ["dashboard"] }],
      [{ ask: "Write a poem", forbid: ["/roses/i"] }],
      [{ ask: "Broken" }],
    ],
    chat,
    { pageUrls: PAGES },
  );

  assert.deepEqual(
    seen.map((s) => s.sessionId),
    [undefined, "s1", undefined, undefined],
  );
  assert.deepEqual(
    results.map((r) => [`${r.conversation}.${r.turn}`, r.passed]),
    [["1.1", false], ["1.2", true], ["2.1", false], ["3.1", false]],
  );
  assert.equal(results[0].answer, "It's $9.99 a month. See https://example.com/pricing");
  assert.deepEqual(results[0].missing, []);
  assert.deepEqual(results[0].badLinks, ["https://example.com/pricing"]);
  assert.deepEqual(results[2].forbidden, ["/roses/i"]);
  assert.equal(results[3].error, "backend down");
  assert.ok(results.every((r) => r.ms >= 0));
});
