import { test } from "node:test";
import assert from "node:assert/strict";
import { starterQuestions, type AgentConfig } from "../src/config.ts";

const base: AgentConfig = { id: "t", name: "T", description: "d", allowedOrigins: ["*"], sources: [] };

test("no suggestions gives an empty list", () => {
  assert.deepEqual(starterQuestions(base), []);
});

test("keeps the first three, trims, drops blanks and caps length at 80", () => {
  const long = "x".repeat(100);
  const got = starterQuestions({ ...base, suggestions: ["  How do I install it? ", "", long, "Third", "Fourth"] });
  assert.deepEqual(got, ["How do I install it?", "x".repeat(80), "Third"]);
});
