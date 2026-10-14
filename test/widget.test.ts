import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

type Source = { href: string; text: string };
type Internals = { collectSources(md: string): Source[]; markdown(md: string): string };

// Run widget.js in a sandbox with just enough of a browser for it to load without mounting.
function loadWidget(): Internals {
  const window: { SupportAgent?: { _internals: Internals } } = {};
  vm.runInContext(fs.readFileSync("public/widget.js", "utf8"), vm.createContext({ window, document: { currentScript: null } }));
  return window.SupportAgent!._internals;
}

// Results come from the vm realm, so copy them into this realm for strict deepEqual.
const sandbox = loadWidget();
const collectSources = (md: string): Source[] => JSON.parse(JSON.stringify(sandbox.collectSources(md)));

test("uses link text as the label and skips relative links", () => {
  const got = collectSources("See [Install guide](https://ex.com/install) and [local](docs/a.md).");
  assert.deepEqual(got, [{ href: "https://ex.com/install", text: "Install guide" }]);
});

test("dedupes by URL and keeps at most four", () => {
  const md = [1, 2, 3, 4, 5].map((n) => `[P${n}](https://ex.com/${n})`).join(" ") + " [again](https://ex.com/1)";
  const got = collectSources(md);
  assert.equal(got.length, 4);
  assert.deepEqual(got.map((s) => s.href), ["https://ex.com/1", "https://ex.com/2", "https://ex.com/3", "https://ex.com/4"]);
});

test("picks up autolinks and bare URLs without trailing punctuation", () => {
  const got = collectSources("Go to <https://ex.com/dash?tab=x> or https://ex.com/faq.");
  assert.deepEqual(got.map((s) => s.href), ["https://ex.com/dash?tab=x", "https://ex.com/faq"]);
  assert.equal(got[1].text, "ex.com/faq");
});

test("ignores URLs inside code", () => {
  const got = collectSources("Run `curl https://ex.com/a` then:\n```\nfetch('https://ex.com/b')\n```");
  assert.deepEqual(got, []);
});
