# Project Site and Widget Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a developer-facing home page at `/` and a refreshed corner-panel chat widget (new look, starter questions, one-time hint, source chips, retry), plus `baseUrl` so local doc sources produce real links.

**Architecture:** The server keeps serving static files from `public/`; a new `public/index.html` becomes the home page and `public/demo.html` stays at `/demo`. The widget stays one dependency-free `public/widget.js` in the existing ES5 style; its pure helpers are exposed on `SupportAgent._internals` so Node tests can load the file in a `vm` sandbox. Server changes are small: `/config` returns starter questions, and ingest maps local file paths to `baseUrl` links.

**Tech Stack:** Node 22.18+ running TypeScript directly (type stripping), `node:test` for tests, plain HTML/CSS/JS for the page and widget.

**Spec:** `specs/2026-10-14-site-and-widget-redesign-design.md`

## Global Constraints

- Node 22.18 or newer; TypeScript is run directly by Node, so only erasable syntax (no enums, no parameter properties) and `.ts` extensions in imports.
- No new npm dependencies, no build step, no framework, no web fonts.
- `public/widget.js` stays a single dependency-free file in ES5 style (`var`, `function`), rendered inside a Shadow DOM.
- Tokens: `--paper #f8f7f3`, `--ink #18181b`, `--muted #66666b`, `--line #e3e1da`, `--acc #1f6f50`, `--chip #eceae4`, `--code #1b1b1f`, `--err #a3321b`.
- Type scale ratio 1.333 from 13px: 13, 17.3, 23, 30.7, 41px. Radii: 4px controls/chips, 6px code, 8px strips, 12px chat panel.
- 1px `--line` borders for separation. The only shadows are the chat panel (`0 8px 28px rgba(24,24,27,.10)`) and the closed-state hint.
- Green only on links, status dot, source chips, active tab, and the widget's accent elements. No gradients, emoji or badges. No scroll animations.
- Widget default accent changes from `#2563eb` to `#1f6f50`.
- Starter questions: at most 3, each at most 80 characters. `data-hint`: at most 80 characters, shown once per browser session, hidden after 8 seconds or on open.
- Source chips: absolute `http(s)` links only, deduplicated by URL, at most 4.

## Before you start

The working tree must be clean. At the time of writing it has uncommitted local-model fixes (`public/demo.html`, `public/widget.js`, `src/backends/ollama.ts`, `src/ingest/chunker.ts`, `src/server.ts`, `.gitignore`). Ask your human partner to commit or set them aside first; Tasks 4–6 edit the same files. `superpowers/` and `data/agents/mysite/` are untracked and must never be staged.

Run every command from the repository root.

---

### Task 1: Test runner and linkable local sources (`baseUrl`)

**Files:**
- Modify: `package.json` (scripts)
- Modify: `tsconfig.json` (include)
- Modify: `src/config.ts` (`Source` type)
- Modify: `src/ingest/files.ts`
- Modify: `src/kb.ts:28-29`
- Modify: `data/agents/demo/agent.json`
- Modify: `docs/knowledge-base.md`
- Create: `test/files.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `readLocal(target: string, baseUrl?: string): RawPage[]` and `linkFor(baseUrl: string, root: string, file: string): string` in `src/ingest/files.ts`; `Source` dir/file variants gain `baseUrl?: string`; `npm test` runs `test/*.test.ts`.

- [ ] **Step 1: Add the test script and include tests in type-checking**

In `package.json`, add to `"scripts"`:

```json
"test": "node --test \"test/*.test.ts\""
```

In `tsconfig.json`, change `"include": ["src"]` to:

```json
"include": ["src", "test"]
```

- [ ] **Step 2: Write the failing test**

Create `test/files.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLocal } from "../src/ingest/files.ts";

function tempDocs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-docs-"));
  fs.mkdirSync(path.join(dir, "guides"));
  fs.writeFileSync(path.join(dir, "intro.md"), "# Intro\n\nThis page introduces the project and what it does for you.\n");
  fs.writeFileSync(path.join(dir, "guides", "install guide.md"), "# Install\n\nRun npm install, then npm run serve to start the server.\n");
  return dir;
}

test("dir source with baseUrl links each page under the base", () => {
  const dir = tempDocs();
  const urls = readLocal(dir, "https://github.com/me/repo/blob/main/docs").map((p) => p.url).sort();
  assert.deepEqual(urls, [
    "https://github.com/me/repo/blob/main/docs/guides/install%20guide.md",
    "https://github.com/me/repo/blob/main/docs/intro.md",
  ]);
});

test("file source with baseUrl links by file name", () => {
  const dir = tempDocs();
  const [page] = readLocal(path.join(dir, "intro.md"), "https://github.com/me/repo/blob/main/");
  assert.equal(page.url, "https://github.com/me/repo/blob/main/intro.md");
});

test("without baseUrl the url stays the cwd-relative path", () => {
  const dir = tempDocs();
  const file = path.join(dir, "intro.md");
  const [page] = readLocal(file);
  assert.equal(page.url, path.relative(process.cwd(), file).split(path.sep).join("/"));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. The first two tests fail because `url` is still the cwd-relative path (the second argument is ignored); the third passes.

- [ ] **Step 4: Add `baseUrl` to the source type**

In `src/config.ts`, replace the `dir` and `file` variants of `Source`:

```ts
  | { type: "dir"; path: string; baseUrl?: string }
  | { type: "file"; path: string; baseUrl?: string };
```

- [ ] **Step 5: Implement `baseUrl` in `src/ingest/files.ts`**

Replace `readLocal` and `readFile`'s signature/first lines so the file reads:

```ts
/** Read docs from a local directory (recursively) or a single file. Paths are relative to cwd. */
export function readLocal(target: string, baseUrl?: string): RawPage[] {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`Not found: ${target}`);
  const isDir = fs.statSync(abs).isDirectory();
  const files = isDir ? walk(abs) : [abs];
  // A dir source links paths inside the dir; a file source links its own file name.
  const root = isDir ? abs : path.dirname(abs);
  return files.flatMap((file) => {
    const page = readFile(file, baseUrl ? linkFor(baseUrl, root, file) : undefined);
    return page && page.text.length >= 40 ? [page] : [];
  });
}

/** Web address for a local file, e.g. ".../blob/main/docs/" + "guides/install.md". */
export function linkFor(baseUrl: string, root: string, file: string): string {
  const rel = path.relative(root, file).split(path.sep).map(encodeURIComponent).join("/");
  return baseUrl.replace(/\/*$/, "/") + rel;
}
```

Then change `readFile` to take the optional URL and use it in both return statements:

```ts
function readFile(file: string, url?: string): RawPage | null {
  const raw = fs.readFileSync(file, "utf8");
  const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html" || ext === ".htm") {
    const page = extractHtml(raw);
    return { url: url ?? rel, title: page.title || rel, text: page.text };
  }
```

and at the end of `readFile`:

```ts
  return { url: url ?? rel, title, text: tidy(text) };
```

Leave `walk` and the front-matter handling unchanged.

- [ ] **Step 6: Pass `baseUrl` through ingest**

In `src/kb.ts`, change:

```ts
      const found = readLocal(src.path);
```

to:

```ts
      const found = readLocal(src.path, src.baseUrl);
```

- [ ] **Step 7: Run the tests and type-check**

Run: `npm test`
Expected: PASS, 3 tests.

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 8: Point the demo agent at GitHub and document `baseUrl`**

In `data/agents/demo/agent.json`, replace `"sources"` with:

```json
  "sources": [
    { "type": "file", "path": "README.md", "baseUrl": "https://github.com/Kaeden-Martinson/AI-Support-Agent/blob/main/" },
    { "type": "dir", "path": "docs", "baseUrl": "https://github.com/Kaeden-Martinson/AI-Support-Agent/blob/main/docs/" }
  ]
```

In `docs/knowledge-base.md`, after the `- **file**: a single file.` bullet, add:

```markdown
- **baseUrl** (optional, on `dir` and `file`): the web address where those files are published, such as `https://github.com/me/my-project/blob/main/docs/`. Without it, answers can only name local paths like `docs/install.md`, which visitors can't open. With it, each page's link becomes `baseUrl` plus its path inside the folder, so answers link to the real page and the widget shows it as a source.
```

- [ ] **Step 9: Re-ingest and check the URLs**

Run: `npm run cli -- ingest demo`
Expected: `Indexed 5 pages into …` (chunk count may differ).

Run: `npm run cli -- search demo "embed"`
Expected: result URLs start with `https://github.com/Kaeden-Martinson/AI-Support-Agent/blob/main/`.

Run: `npm run cli -- search mysite "refund"` (skip if `data/agents/mysite` doesn't exist)
Expected: result URLs still start with `https://thevoidx.com/`, untouched because `mysite` has no `baseUrl`.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json src/config.ts src/ingest/files.ts src/kb.ts data/agents/demo/agent.json docs/knowledge-base.md test/files.test.ts
git commit -m "Add test runner and baseUrl for linkable local doc sources" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Starter questions from the server

**Files:**
- Modify: `src/config.ts` (`AgentConfig`, new `starterQuestions`)
- Modify: `src/server.ts` (config route, around line 102)
- Modify: `data/agents/demo/agent.json`
- Modify: `docs/configuration.md`
- Create: `test/config.test.ts`
- Create: `test/server.test.ts`

**Interfaces:**
- Consumes: `npm test` from Task 1.
- Produces: `starterQuestions(cfg: AgentConfig): string[]` in `src/config.ts`; `GET /api/agents/:id/config` returns `{ name: string, greeting: string, suggestions: string[], ready: boolean }`. Task 5 reads `suggestions`.

- [ ] **Step 1: Write the failing unit test**

Create `test/config.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL with a SyntaxError that `starterQuestions` is not exported by `src/config.ts`.

- [ ] **Step 3: Implement `starterQuestions`**

In `src/config.ts`, add to `AgentConfig` after `greeting?: string;`:

```ts
  /** Starter questions the widget offers when a chat first opens. */
  suggestions?: string[];
```

and add below `isValidAgentId`:

```ts
/** The starter questions the widget may show: the first three non-blank ones, each at most 80 characters. */
export function starterQuestions(cfg: AgentConfig): string[] {
  return (cfg.suggestions ?? [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 3);
}
```

- [ ] **Step 4: Run the unit test**

Run: `npm test`
Expected: PASS for `test/config.test.ts` and `test/files.test.ts`.

- [ ] **Step 5: Write the failing server test**

Create `test/server.test.ts`:

```ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { startServer } from "../src/server.ts";

const server = startServer(0);
after(() => {
  server.closeAllConnections();
  server.close();
});

async function base(): Promise<string> {
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

test("config returns the demo agent's starter questions", async () => {
  const res = await fetch(`${await base()}/api/agents/demo/config`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, "AI Support Agent");
  assert.equal(body.suggestions.length, 3);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test`
Expected: FAIL in `test/server.test.ts`: `Cannot read properties of undefined (reading 'length')`.

- [ ] **Step 7: Return suggestions from `/config` and add them to the demo agent**

In `src/server.ts`, add `starterQuestions` to the import from `./config.ts`, and change the config route's response to:

```ts
    return json(res, 200, {
      name: agent.name,
      greeting: agent.greeting ?? `Hi! Ask me anything about ${agent.name}.`,
      suggestions: starterQuestions(agent),
      ready: !!kb,
    });
```

In `data/agents/demo/agent.json`, add after `"greeting"`:

```json
  "suggestions": ["How do I embed it in Next.js?", "Can I run it without an API key?", "How do I train it on my docs?"],
```

- [ ] **Step 8: Run tests and type-check**

Run: `npm test`
Expected: PASS, all tests in 3 files.

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 9: Document `suggestions`**

In `docs/configuration.md`, add to the agent config example JSON after `"greeting"`:

```json
  "suggestions": ["How do I install it?", "How do retries work?"],
```

and add this row to the field table after `greeting`:

```markdown
| `suggestions` | Up to three starter questions shown as buttons when the chat first opens (each up to 80 characters) |
```

and in the `GET /api/agents/:id/config` section change `Returns \`{ name, greeting, ready }\`.` to:

```markdown
Returns `{ name, greeting, suggestions, ready }`.
```

- [ ] **Step 10: Commit**

```bash
git add src/config.ts src/server.ts data/agents/demo/agent.json docs/configuration.md test/config.test.ts test/server.test.ts
git commit -m "Serve starter questions from the agent config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Collect source links in the widget

**Files:**
- Modify: `public/widget.js` (new `collectSources`, `_internals` on the API object)
- Create: `test/widget.test.ts`

**Interfaces:**
- Consumes: `npm test` from Task 1.
- Produces: `collectSources(md: string): Array<{ href: string, text: string }>` inside `widget.js`, exposed as `window.SupportAgent._internals.collectSources` (and `_internals.markdown`). Task 4 calls `collectSources` to render chips.

- [ ] **Step 1: Write the failing test**

Create `test/widget.test.ts`:

```ts
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

const { collectSources } = loadWidget();

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL in `test/widget.test.ts`: `Cannot read properties of undefined (reading 'collectSources')`.

- [ ] **Step 3: Implement `collectSources` and expose internals**

In `public/widget.js`, add after the `markdown` function:

```js
  // Links an answer used, shown as "Sources" chips: absolute http(s) only, deduped, first four.
  function collectSources(md) {
    var out = [];
    var seen = {};
    var text = md.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
    var re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?])/g;
    var m;
    while ((m = re.exec(text)) && out.length < 4) {
      var href = m[2] || m[3] || m[4];
      if (seen[href]) continue;
      seen[href] = true;
      out.push({ href: href, text: m[1] || href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") });
    }
    return out;
  }
```

In the `api` object, add after `reset: …`:

```js
    /** For tests only; not a stable API. */
    _internals: { markdown: markdown, collectSources: collectSources },
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, all tests in 4 files.

- [ ] **Step 5: Commit**

```bash
git add public/widget.js test/widget.test.ts
git commit -m "Collect answer source links in the widget" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Widget look, searching, answered and error states

**Files:**
- Modify: `public/widget.js` (CSS, icons, `build`, new `sourcesHtml`/`updateChrome`, `loadConfig`, `renderHistory`, `send`)
- Modify: `docs/embedding.md` (default color note)

**Interfaces:**
- Consumes: `collectSources` from Task 3; `esc`, `markdown` (existing).
- Produces: `Widget.prototype.updateChrome()`, `Widget.prototype.send(text, retry)` (second argument `true` resends without adding the user message again), `this.resetBtn`, `this.sr`, `this.foot`. Task 5 builds on `build`, `renderHistory`, `send` and `open` as written here.

- [ ] **Step 1: Replace the CSS and icons**

Replace the whole `var CSS = …;` statement with:

```js
  var CSS =
    ":host{all:initial}" +
    "*{box-sizing:border-box}[hidden]{display:none!important}" +
    ".root{--c:#1f6f50;--bg:#fff;--fg:#18181b;--muted:#66666b;--line:#e3e1da;--chip:#eceae4;--code:#1b1b1f;" +
    "--err:#a3321b;--errbg:#fbf3f0;--errline:#ecd2c9;" +
    "font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--fg);position:fixed;bottom:20px;z-index:2147483000}" +
    "@media (prefers-color-scheme:dark){.root{--bg:#18181b;--fg:#ededea;--muted:#9a9a9f;--line:#2e2e33;--chip:#27272b;--code:#0e0e10;" +
    "--err:#f0a08a;--errbg:#2a1c18;--errline:#4a2c24}}" +
    ".right{right:20px}.left{left:20px}" +
    ".launcher{width:46px;height:46px;border-radius:50%;border:0;background:var(--c);color:#fff;cursor:pointer;display:grid;place-items:center;margin-left:auto}" +
    ".left .launcher{margin-left:0}" +
    "button:focus-visible,a:focus-visible{outline:2px solid var(--c);outline-offset:2px}" +
    ".panel{display:none;flex-direction:column;width:380px;height:560px;max-height:calc(100vh - 100px);background:var(--bg);" +
    "border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 28px rgba(24,24,27,.10);overflow:hidden;margin-bottom:12px}" +
    ".open .panel{display:flex}" +
    "@media (max-width:480px){.root{bottom:12px}.right{right:12px}.left{left:12px}.panel{width:calc(100vw - 24px);height:calc(100vh - 90px)}}" +
    ".head{display:flex;align-items:center;gap:4px;padding:10px 10px 10px 14px;border-bottom:1px solid var(--line)}" +
    ".head h2{font-size:14px;font-weight:600;margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".head button{background:transparent;border:0;color:var(--muted);cursor:pointer;font:inherit;font-size:12.5px;padding:4px 7px;border-radius:4px;display:grid;place-items:center}" +
    ".head button:hover{color:var(--fg);background:var(--chip)}" +
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px}" +
    ".msg{word-wrap:break-word;overflow-wrap:anywhere}" +
    ".msg p{margin:0 0 8px}.msg p:last-child{margin:0}.msg ul,.msg ol{margin:4px 0 8px;padding-left:20px}" +
    ".user{align-self:flex-end;max-width:85%;background:var(--c);color:#fff;padding:7px 11px;border-radius:12px 12px 3px 12px;white-space:pre-wrap}" +
    ".bot{align-self:stretch}" +
    ".bot a{color:var(--c);font-weight:600;text-decoration:none}.bot a:hover{text-decoration:underline}" +
    ".stat{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:12.5px}" +
    ".stat::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--c);animation:sa-pulse 1.2s ease-in-out infinite}" +
    ".skel{height:10px;border-radius:3px;margin-top:8px;background:linear-gradient(90deg,var(--chip) 0,var(--bg) 50%,var(--chip) 100%);" +
    "background-size:200% 100%;animation:sa-shim 1.4s linear infinite}" +
    ".skel:nth-child(2){width:92%}.skel:nth-child(3){width:78%}.skel:nth-child(4){width:60%}" +
    "@keyframes sa-pulse{50%{opacity:.3}}@keyframes sa-shim{to{background-position:-200% 0}}" +
    "@media (prefers-reduced-motion:reduce){.stat::before,.skel{animation:none}}" +
    ".err{align-self:stretch;border:1px solid var(--errline);background:var(--errbg);color:var(--err);border-radius:6px;padding:9px 11px;font-size:13px}" +
    ".retry{display:block;margin-top:4px;padding:0;border:0;background:none;color:var(--fg);font:inherit;font-weight:600;" +
    "text-decoration:underline;text-underline-offset:2px;cursor:pointer}" +
    ".src{margin-top:10px;padding-top:9px;border-top:1px dashed var(--line);display:flex;flex-wrap:wrap;align-items:center;gap:5px}" +
    ".src span{width:100%;font-size:11px;color:var(--muted)}" +
    ".bot .chip{font-size:12px;font-weight:600;color:var(--c);border:1px solid var(--line);border-radius:4px;padding:1px 8px;text-decoration:none}" +
    "code{font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--chip);padding:1px 4px;border-radius:3px}" +
    "pre{position:relative;background:var(--code);color:#e3e3e3;padding:10px 12px;border-radius:6px;overflow-x:auto;margin:8px 0}" +
    "pre code{background:none;padding:0;color:inherit;white-space:pre}" +
    ".copy{position:absolute;top:6px;right:6px;font:11px system-ui,sans-serif;padding:1px 7px;border-radius:4px;border:1px solid #3a3a40;" +
    "background:transparent;color:#a1a1a6;cursor:pointer}" +
    ".form{margin:0;padding:10px 10px 0;border-top:1px solid var(--line)}" +
    ".field{display:flex;align-items:flex-end;gap:6px;border:1px solid var(--line);border-radius:9px;padding:5px 5px 5px 10px;background:var(--bg)}" +
    ".field:focus-within{border-color:var(--c)}" +
    "textarea{flex:1;resize:none;border:0;outline:0;padding:4px 0;font:inherit;color:var(--fg);background:transparent;max-height:120px}" +
    ".send{flex-shrink:0;width:28px;height:28px;border:0;border-radius:6px;background:var(--c);color:#fff;display:grid;place-items:center;cursor:pointer}" +
    ".send:disabled{background:var(--line);cursor:default}" +
    ".foot{font-size:11px;color:var(--muted);text-align:center;padding:6px 12px 8px}" +
    ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}";
```

Replace the `ICON_CHAT` and `ICON_CLOSE` statements with:

```js
  var ICON_CHAT =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_CLOSE =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_X =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_SEND =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
```

- [ ] **Step 2: Add the chips renderer**

Add after `collectSources`:

```js
  function sourcesHtml(md) {
    var list = collectSources(md);
    if (!list.length) return "";
    return (
      '<div class="src"><span>Sources</span>' +
      list
        .map(function (s) {
          return '<a class="chip" href="' + esc(s.href) + '" target="_blank" rel="noopener noreferrer">' + esc(s.text) + "</a>";
        })
        .join("") +
      "</div>"
    );
  }
```

- [ ] **Step 3: Replace the panel markup and element lookups in `build`**

In `Widget.prototype.build`, replace the `shadow.innerHTML = …;` statement with:

```js
    shadow.innerHTML =
      "<style>" + CSS + "</style>" +
      '<div class="root ' + (this.opts.position === "left" ? "left" : "right") + '">' +
      '<div class="panel" role="dialog" aria-label="Support chat">' +
      '<div class="head"><h2></h2>' +
      '<button type="button" class="reset" hidden>New chat</button>' +
      '<button type="button" class="x" aria-label="Close support chat">' + ICON_X + "</button></div>" +
      '<div class="log" aria-live="polite"></div>' +
      '<div class="sr" aria-live="polite"></div>' +
      '<form class="form"><div class="field"><textarea rows="1" placeholder="Ask a question…" aria-label="Message"></textarea>' +
      '<button class="send" type="submit" aria-label="Send">' + ICON_SEND + "</button></div></form>" +
      '<div class="foot">Answers can be wrong. Check the linked pages.</div>' +
      "</div>" +
      '<button class="launcher" type="button" aria-label="Open support chat">' + ICON_CHAT + "</button>" +
      "</div>";
```

After `this.title = $("h2");` add:

```js
    this.resetBtn = $(".reset");
    this.sr = $(".sr");
    this.foot = $(".foot");
```

After the `$(".reset").addEventListener(…)` line add:

```js
    $(".x").addEventListener("click", function () { self.close(); });
```

- [ ] **Step 4: Footer text from the config, chrome updates, and chips in history**

In `Widget.prototype.loadConfig`, after `if (!self.opts.title) self.title.textContent = cfg.name;` add:

```js
        self.foot.textContent = "Answers come from " + cfg.name + "'s docs and can be wrong.";
```

Replace `Widget.prototype.renderHistory` with:

```js
  Widget.prototype.renderHistory = function () {
    this.log.innerHTML = "";
    if (this.greeting) this.add("bot", markdown(this.greeting));
    for (var i = 0; i < this.state.history.length; i++) {
      var m = this.state.history[i];
      if (m.role === "user") this.add("user", esc(m.text));
      else this.add("bot", markdown(m.text) + sourcesHtml(m.text));
    }
    this.updateChrome();
  };

  // "New chat" and the follow-up placeholder only make sense once a conversation exists.
  Widget.prototype.updateChrome = function () {
    var started = this.state.history.length > 0;
    this.resetBtn.hidden = !started;
    this.input.placeholder = started ? "Ask a follow-up…" : "Ask a question…";
  };
```

- [ ] **Step 5: Replace `send` with the searching, answered and error states**

Replace the whole `Widget.prototype.send = function (text) { … };` with:

```js
  /** Send a question. With retry=true, resend the last question without adding it to the log again. */
  Widget.prototype.send = function (text, retry) {
    var self = this;
    text = (text || "").trim();
    if (!text || this.busy) return;
    if (!this.state.open) this.open();
    this.busy = true;
    this.sendBtn.disabled = true;
    if (!retry) {
      this.input.value = "";
      this.input.style.height = "auto";
      this.add("user", esc(text));
      this.state.history.push({ role: "user", text: text });
      this.save();
      this.updateChrome();
    }

    // Placeholder until the first words arrive: a live status line and three shimmer lines.
    var pending = document.createElement("div");
    pending.className = "msg bot pending";
    pending.innerHTML =
      '<div class="stat" aria-hidden="true">Searching docs…</div><div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    this.log.appendChild(pending);
    this.log.scrollTop = this.log.scrollHeight;
    var statusEl = pending.querySelector(".stat");
    var announced = false;
    var bubble = null;
    var answer = "";

    function finish(errMsg) {
      pending.remove();
      if (answer) {
        bubble.innerHTML = markdown(answer) + sourcesHtml(answer);
        self.state.history.push({ role: "assistant", text: answer });
        self.save();
      }
      if (errMsg) {
        // Offer a retry only when nothing was answered, so a retry can't duplicate a partial answer.
        var box = self.add("err", esc(errMsg) + (answer ? "" : '<button type="button" class="retry">Try again</button>'));
        var retryBtn = box.querySelector(".retry");
        if (retryBtn) {
          retryBtn.addEventListener("click", function () {
            box.remove();
            self.send(text, true);
          });
        }
      }
      self.busy = false;
      self.sendBtn.disabled = false;
      self.updateChrome();
      self.input.focus();
    }

    fetch(this.server + "/api/agents/" + encodeURIComponent(this.key) + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        sessionId: this.state.sessionId,
        page: { url: location.href, title: document.title },
      }),
    })
      .then(function (res) {
        if (!res.ok || !res.body) {
          return res.json().then(
            function (j) { finish(j.error || "Request failed (" + res.status + ")"); },
            function () { finish("Request failed (" + res.status + ")"); }
          );
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buf = "";
        var errored = null;
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return finish(errored);
            buf += decoder.decode(r.value, { stream: true });
            var events = buf.split("\n\n");
            buf = events.pop();
            for (var i = 0; i < events.length; i++) {
              var line = events[i].replace(/^data: /, "");
              var ev;
              try { ev = JSON.parse(line); } catch (e) { continue; }
              if (ev.type === "session") {
                self.state.sessionId = ev.sessionId;
                self.save();
              } else if (ev.type === "status") {
                statusEl.textContent = ev.message;
                if (!announced) {
                  self.sr.textContent = ev.message;
                  announced = true;
                }
              } else if (ev.type === "text") {
                if (!bubble) {
                  pending.remove();
                  bubble = self.add("bot", "");
                }
                answer += ev.text;
                bubble.innerHTML = markdown(answer);
                var nearBottom = self.log.scrollHeight - self.log.scrollTop - self.log.clientHeight < 80;
                if (nearBottom) self.log.scrollTop = self.log.scrollHeight;
              } else if (ev.type === "error") {
                errored = ev.message;
              }
            }
            return pump();
          });
        }
        return pump();
      })
      .catch(function () {
        finish("Couldn't reach the support server.");
      });
  };
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS, all tests (the vm test proves the file still loads).

- [ ] **Step 7: Check every state in the browser**

Start the server: `PORT=3001 npm run serve` (in the background). Open `http://localhost:3001/demo` in a browser.

Paste this into the DevTools console to replace the chat endpoint with a scripted stream, then run each scenario:

```js
window.__mock = function (events, delay) {
  var real = window.__realFetch || (window.__realFetch = window.fetch);
  window.fetch = function (u, o) {
    if (String(u).indexOf("/chat") < 0) return real(u, o);
    var enc = new TextEncoder();
    return Promise.resolve(new Response(new ReadableStream({
      start: function (c) {
        var i = 0;
        (function next() {
          if (i >= events.length) return c.close();
          c.enqueue(enc.encode("data: " + JSON.stringify(events[i++]) + "\n\n"));
          setTimeout(next, delay || 400);
        })();
      }
    }), { status: 200 }));
  };
};
SupportAgent.reset();
__mock([{type:"session",sessionId:"x"},{type:"status",message:"Searching docs: retry, backoff"},
  {type:"text",text:"Set `retries` on the queue.\n\n```js\nqueue.add(job, { retries: 3 })\n```\n\nSee [Retries guide](https://ex.com/retries) and [Queue options](https://ex.com/queue). Also [Retries guide](https://ex.com/retries)."},
  {type:"done"}], 900);
SupportAgent.ask("How do I retry failed jobs?");
```

Expected, in order:
- the visitor's message appears as a green bubble on the right
- "Searching docs…" with a pulsing dot and three shimmer lines; the status text changes to "Searching docs: retry, backoff"
- the answer replaces the shimmer, with no bubble around it and the code block keeping its Copy button
- under the answer, "Sources" with exactly two chips, "Retries guide" and "Queue options"
- "New chat" is visible in the header, and the input says "Ask a follow-up…"

Error and retry:

```js
__mock([{type:"session",sessionId:"x"},{type:"error",message:"The assistant's model server isn't reachable right now."}], 300);
SupportAgent.ask("Second question");
```

Expected: a light red box with that message and a "Try again" link. Then run the first `__mock(...)` call again (without `SupportAgent.ask`) and click "Try again": the red box disappears, no second "Second question" bubble appears, and the scripted answer arrives.

Also check:
- With DevTools' "Emulate CSS prefers-reduced-motion: reduce", the dot and shimmer stop animating.
- In dark mode ("Emulate prefers-color-scheme: dark"), text stays readable and borders visible.
- At 375px width the panel fills the screen with 12px margins.
- Pressing Esc closes the panel and focus returns to the launcher.

Stop the server when done.

- [ ] **Step 8: Document the color change**

In `docs/embedding.md`, change the `data-color` row of the attributes table to:

```markdown
| `data-color` | `#1f6f50` | Accent color (any CSS color). Before the redesign the default was blue; set `data-color="#2563eb"` to keep it |
```

- [ ] **Step 9: Commit**

```bash
git add public/widget.js docs/embedding.md
git commit -m "Restyle the widget and add searching, sources and retry states" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hint and starter questions in the widget

**Files:**
- Modify: `public/widget.js` (CSS additions, `build`, `loadConfig`, `renderHistory`, `open`, `send`, new `showHint`/`hideHint`, auto-init)
- Modify: `docs/embedding.md`

**Interfaces:**
- Consumes: `GET /config` `suggestions: string[]` from Task 2; `renderHistory`, `send(text, retry)`, `open`, `storage(key, value)` from Task 4 and the existing file.
- Produces: init option `hint` / attribute `data-hint`; `Widget.prototype.showHint()`, `Widget.prototype.hideHint()`.

- [ ] **Step 1: Add the CSS**

Append to the end of the `CSS` string (before the final `;`):

```js
    +
    ".hint{position:absolute;bottom:6px;right:56px;width:max-content;max-width:220px;background:var(--bg);color:var(--fg);" +
    "border:1px solid var(--line);border-radius:10px 10px 3px 10px;padding:7px 11px;font-size:13px;box-shadow:0 4px 14px rgba(24,24,27,.08)}" +
    ".left .hint{right:auto;left:56px;border-radius:10px 10px 10px 3px}.open .hint{display:none}" +
    ".sugg{display:flex;flex-direction:column;align-items:flex-start;gap:6px}" +
    ".sugg button{font:inherit;font-size:13px;text-align:left;color:var(--fg);background:var(--bg);border:1px solid var(--line);" +
    "border-radius:8px;padding:7px 11px;cursor:pointer}.sugg button:hover{border-color:var(--c)}"
```

- [ ] **Step 2: Show the hint once per browser session**

In `Widget.prototype.build`, replace the last two lines:

```js
    this.renderHistory();
    if (this.state.open || this.opts.open) this.open();
```

with:

```js
    this.renderHistory();
    if (this.state.open || this.opts.open) this.open();
    else if (this.opts.hint && !storage(this.key + ":hint")) this.showHint();
```

Add after `Widget.prototype.save`:

```js
  // One-line nudge beside the closed launcher; shown once per browser session, gone after 8s or on open.
  Widget.prototype.showHint = function () {
    var self = this;
    var hint = document.createElement("div");
    hint.className = "hint";
    hint.setAttribute("role", "status");
    hint.textContent = String(this.opts.hint).slice(0, 80);
    this.root.insertBefore(hint, this.launcher);
    storage(this.key + ":hint", true);
    this.hint = hint;
    this.hintTimer = setTimeout(function () { self.hideHint(); }, 8000);
  };
  Widget.prototype.hideHint = function () {
    if (!this.hint) return;
    clearTimeout(this.hintTimer);
    this.hint.remove();
    this.hint = null;
  };
```

In `Widget.prototype.open`, add as the first line:

```js
    this.hideHint();
```

In the auto-init block at the bottom, add to the `api.init({ … })` options:

```js
      hint: d.hint,
```

and update the comment on `init` to:

```js
    /** Mount the widget. opts: { agent, server?, title?, color?, position?, greeting?, hint?, open? } */
```

and the file header's optional attributes line to:

```js
 * Optional attributes: data-server, data-title, data-color, data-position="left|right",
 * data-greeting, data-hint, data-open="true". Or skip data-agent and call SupportAgent.init({...}) yourself.
```

- [ ] **Step 3: Starter questions on first open**

In `Widget.prototype.loadConfig`, after `self.greeting = self.opts.greeting || cfg.greeting;` add:

```js
        self.suggestions = (cfg.suggestions || []).slice(0, 3);
```

In `Widget.prototype.renderHistory`, after the greeting line (`if (this.greeting) …`), add:

```js
    if (!this.state.history.length && this.suggestions && this.suggestions.length) {
      var self = this;
      var box = document.createElement("div");
      box.className = "sugg";
      this.suggestions.forEach(function (q) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = q;
        b.addEventListener("click", function () { self.send(q); });
        box.appendChild(b);
      });
      this.log.appendChild(box);
    }
```

In `Widget.prototype.send`, inside the `if (!retry) {` block, add as its first line:

```js
      var sugg = this.log.querySelector(".sugg");
      if (sugg) sugg.remove();
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 5: Check in the browser**

Temporarily add `data-hint="Questions about setup? Ask here."` to the widget script tag in `public/demo.html` (revert after this step). Start `PORT=3001 npm run serve` and open `http://localhost:3001/demo` in a fresh private window.

Expected:
- the hint bubble appears to the left of the closed launcher, then disappears after about 8 seconds
- reloading the page does not show it again (same session); a new private window shows it once more
- opening the chat hides the hint immediately
- the first open shows the greeting and the three demo starter questions as buttons
- clicking one sends it, and the buttons disappear
- "New chat" brings the buttons back

Revert the temporary `data-hint` edit in `public/demo.html`, then stop the server.

- [ ] **Step 6: Document `data-hint`**

In `docs/embedding.md`, add this row to the attributes table after `data-greeting`:

```markdown
| `data-hint` | (none) | One line shown beside the closed bubble once per visit, e.g. "Questions? Ask here." Up to 80 characters |
```

and in the `SupportAgent.init` example add `hint: "Questions? Ask here.",` after `position: "left",`.

- [ ] **Step 7: Commit**

```bash
git add public/widget.js docs/embedding.md
git commit -m "Add the one-time hint and starter questions to the widget" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Home page at `/`

**Files:**
- Create: `public/index.html`
- Modify: `src/server.ts:87`
- Modify: `test/server.test.ts`
- Modify: `README.md` (project layout)

**Interfaces:**
- Consumes: the widget from Tasks 4–5 (loaded with `data-agent="demo"`), the demo agent's GitHub links from Task 1.
- Produces: `GET /` serves `public/index.html`; `GET /demo` keeps serving `public/demo.html`.

- [ ] **Step 1: Write the failing route tests**

Append to `test/server.test.ts`:

```ts
test("/ serves the home page", async () => {
  const res = await fetch(`${await base()}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await res.text(), /trained on your own docs/);
});

test("/demo still serves the test page", async () => {
  const res = await fetch(`${await base()}/demo`);
  assert.match(await res.text(), /<title>Support Agent Demo<\/title>/);
});
```

- [ ] **Step 2: Run them to verify the first fails**

Run: `npm test`
Expected: FAIL in "/ serves the home page" (the demo page doesn't contain the headline); "/demo still serves the test page" passes.

- [ ] **Step 3: Split the routes**

In `src/server.ts`, replace:

```ts
  if (req.method === "GET" && (p === "/" || p === "/demo")) return serveStatic(res, "demo.html", "text/html; charset=utf-8");
```

with:

```ts
  if (req.method === "GET" && p === "/") return serveStatic(res, "index.html", "text/html; charset=utf-8");
  if (req.method === "GET" && p === "/demo") return serveStatic(res, "demo.html", "text/html; charset=utf-8");
```

- [ ] **Step 4: Create the page**

Create `public/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>support-agent · self-hosted support chat</title>
  <meta name="description" content="A self-hosted support chat for your project, trained on your own docs. One script tag, answers with links to your pages, Claude or a local model.">
  <style>
    :root { --paper:#f8f7f3; --ink:#18181b; --muted:#66666b; --line:#e3e1da; --acc:#1f6f50; --chip:#eceae4; --code:#1b1b1f; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:13px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
    a { color:var(--acc); text-decoration:none; font-weight:600; }
    a:hover { text-decoration:underline; }
    a:focus-visible, button:focus-visible { outline:2px solid var(--acc); outline-offset:2px; }
    code, pre, .mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .wrap { max-width:960px; margin:0 auto; padding:0 28px; }

    nav { border-bottom:1px solid var(--line); }
    nav .wrap { display:flex; align-items:center; gap:22px; height:52px; }
    nav .mark { font:600 13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--ink); margin-right:auto; }
    nav a:not(.mark) { color:var(--muted); font-weight:400; }

    h1 { font-size:41px; line-height:1.08; letter-spacing:-.02em; font-weight:650; margin:0 0 16px; max-width:16ch; }
    h2 { font-size:23px; line-height:1.2; letter-spacing:-.01em; font-weight:650; margin:0 0 8px; }
    h3 { font-size:13px; font-weight:650; margin:0 0 4px; }
    .lede { font-size:17.3px; color:var(--muted); max-width:44ch; margin:0 0 22px; }
    .label { font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; margin:0 0 10px; }
    section { border-top:1px solid var(--line); padding:48px 0; }

    .hero { display:grid; grid-template-columns:1.1fr .9fr; gap:40px; padding-top:56px; padding-bottom:52px; align-items:start; }
    .term { position:relative; background:var(--code); color:#d8d8d8; font-size:12px; line-height:1.75; border-radius:6px; padding:14px 16px; margin:0; overflow-x:auto; white-space:pre; }
    .term .p { color:#77777d; user-select:none; }
    .copy { position:absolute; right:10px; top:10px; font:11px system-ui,sans-serif; color:#a1a1a6; background:transparent; border:1px solid #3a3a40; border-radius:4px; padding:1px 7px; cursor:pointer; }
    .cta { margin-top:20px; display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
    .btn { background:var(--ink); color:#fff; padding:9px 16px; border-radius:4px; }
    .btn:hover { text-decoration:none; background:#2b2b30; }

    .example { background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; font-size:12.5px; }
    .example .hd { display:flex; justify-content:space-between; padding:11px 14px; border-bottom:1px solid var(--line); font-weight:600; }
    .example .hd span { color:var(--muted); font-weight:400; font-size:12px; }
    .example .b { padding:14px; display:flex; flex-direction:column; gap:10px; }
    .example .u { align-self:flex-end; background:var(--acc); color:#fff; padding:7px 11px; border-radius:12px 12px 3px 12px; }
    .example .st { color:var(--muted); font-size:11.5px; display:flex; align-items:center; gap:6px; }
    .example .st::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--acc); }
    .example p { margin:0; }
    .example code { font-size:12px; background:var(--chip); padding:1px 4px; border-radius:3px; }
    .example pre { background:var(--code); color:#d8d8d8; font-size:11.5px; line-height:1.6; border-radius:6px; padding:10px 12px; margin:6px 0; }
    .example .src { border-top:1px dashed var(--line); padding-top:9px; display:flex; flex-wrap:wrap; gap:5px; }
    .example .src span { width:100%; font-size:11px; color:var(--muted); }
    .example .chip { font-size:11.5px; border:1px solid var(--line); border-radius:4px; padding:1px 7px; }
    .example .ft { border-top:1px solid var(--line); padding:10px 14px; }
    .example .in { border:1px solid var(--line); border-radius:9px; padding:8px 10px; color:var(--muted); }
    .caption { font-size:11.5px; color:var(--muted); margin:8px 0 0; }

    .flow { display:grid; grid-template-columns:repeat(4,1fr); border:1px solid var(--line); border-radius:8px; background:#fff; margin-top:22px; }
    .flow div { padding:14px 16px; border-right:1px solid var(--line); }
    .flow div:last-child { border-right:0; }
    .flow small { font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--acc); display:block; margin-bottom:6px; }
    .flow p { margin:0; color:var(--muted); font-size:12px; }

    .split { display:grid; grid-template-columns:.8fr 1.2fr; gap:40px; }
    .split > div > p { color:var(--muted); margin:0; }
    table { width:100%; border-collapse:collapse; font-size:12px; margin-top:14px; }
    td { border-top:1px solid var(--line); padding:7px 0; vertical-align:top; }
    td:first-child { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; width:42%; }
    td:last-child { color:var(--muted); }
    [role="tablist"] { display:flex; gap:2px; border-bottom:1px solid var(--line); }
    [role="tab"] { font:inherit; font-size:12px; color:var(--muted); background:none; border:0; padding:8px 12px; cursor:pointer; }
    [role="tab"][aria-selected="true"] { color:var(--ink); font-weight:600; box-shadow:inset 0 -2px 0 var(--acc); }
    [role="tabpanel"] .term { border-radius:0 0 6px 6px; }

    .models { display:grid; grid-template-columns:1fr 1fr; border:1px solid var(--line); border-radius:8px; background:#fff; margin-top:22px; }
    .models > div { padding:18px 20px; }
    .models > div + div { border-left:1px solid var(--line); }
    .models ul { margin:8px 0 0; padding-left:16px; color:var(--muted); font-size:12.5px; }
    .models li { margin-bottom:4px; }
    .models code { font-size:11.5px; background:var(--chip); padding:1px 4px; border-radius:3px; }

    footer { border-top:1px solid var(--line); padding:22px 0; color:var(--muted); font-size:12px; }
    footer .wrap { display:flex; gap:20px; flex-wrap:wrap; }
    footer span { margin-right:auto; }

    @media (max-width:760px) {
      .hero, .split, .models { grid-template-columns:1fr; }
      .models > div + div { border-left:0; border-top:1px solid var(--line); }
      .flow { grid-template-columns:1fr 1fr; }
      .flow div:nth-child(2) { border-right:0; }
      .flow div:nth-child(-n+2) { border-bottom:1px solid var(--line); }
    }
    @media (max-width:480px) {
      .wrap { padding:0 16px; }
      h1 { font-size:30.7px; }
      .flow { grid-template-columns:1fr; }
      .flow div { border-right:0; border-bottom:1px solid var(--line); }
      .flow div:last-child { border-bottom:0; }
      nav .wrap { gap:14px; }
    }
  </style>
</head>
<body>
  <nav><div class="wrap">
    <a class="mark" href="/">support-agent</a>
    <a href="https://github.com/Kaeden-Martinson/AI-Support-Agent#readme">Docs</a>
    <a href="https://github.com/Kaeden-Martinson/AI-Support-Agent/blob/main/docs/deployment.md">Self-hosting</a>
    <a href="https://github.com/Kaeden-Martinson/AI-Support-Agent">GitHub</a>
  </div></nav>

  <main>
    <div class="wrap hero">
      <div>
        <h1>A support chat for your project, trained on your own docs.</h1>
        <p class="lede">Point it at a website or a docs folder, add one script tag, and it answers visitors from your pages, linking the one it used.</p>
        <pre class="term"><button class="copy" type="button" data-copy="git clone https://github.com/Kaeden-Martinson/AI-Support-Agent&#10;npm run cli -- init my-app --name &quot;My App&quot; --dir ./docs&#10;npm run cli -- ingest my-app&#10;npm run serve">Copy</button><span class="p">$ </span>git clone https://github.com/Kaeden-Martinson/AI-Support-Agent
<span class="p">$ </span>npm run cli -- init my-app --name "My App" --dir ./docs
<span class="p">$ </span>npm run cli -- ingest my-app
<span class="p">$ </span>npm run serve</pre>
        <div class="cta">
          <a class="btn" href="https://github.com/Kaeden-Martinson/AI-Support-Agent">View on GitHub</a>
          <a href="https://github.com/Kaeden-Martinson/AI-Support-Agent#quick-start">Quick start →</a>
        </div>
      </div>
      <div>
        <div class="example" aria-label="Example conversation">
          <div class="hd">support-agent docs<span>New chat</span></div>
          <div class="b">
            <div class="u">Can I run it without an API key?</div>
            <div class="st">Searched docs: local model, ollama</div>
            <div>
              <p>Yes. Install Ollama, pull a model, and set the provider:</p>
              <pre>LLM_PROVIDER=ollama
OLLAMA_MODEL=llama3.1:8b</pre>
              <p>Nothing leaves your machine; answers are a little less sharp than Claude's.</p>
            </div>
            <div class="src"><span>Sources</span>
              <a class="chip" href="https://github.com/Kaeden-Martinson/AI-Support-Agent/blob/main/docs/deployment.md#running-fully-self-hosted">Running fully self-hosted</a>
              <a class="chip" href="https://github.com/Kaeden-Martinson/AI-Support-Agent/blob/main/docs/configuration.md">Configuration</a>
            </div>
          </div>
          <div class="ft"><div class="in">Ask a follow-up…</div></div>
        </div>
        <p class="caption">Try the real one: it's in the corner, answering from this project's docs.</p>
      </div>
    </div>

    <section><div class="wrap">
      <p class="label">How it answers</p>
      <h2>Your pages in, cited answers out.</h2>
      <div class="flow">
        <div><small>1 · ingest</small><h3>Crawl or read</h3><p>Your site, a docs folder, or a README. Respects robots.txt.</p></div>
        <div><small>2 · index</small><h3>Split by heading</h3><p>Passages kept whole, code blocks never cut. One JSON file.</p></div>
        <div><small>3 · search</small><h3>Find the passage</h3><p>Keyword search over your passages. Claude retries with other wording when it misses.</p></div>
        <div><small>4 · answer</small><h3>Reply with a link</h3><p>Streams the answer and links the page it came from.</p></div>
      </div>
    </div></section>

    <section><div class="wrap split">
      <div>
        <p class="label">Embed</p>
        <h2>One script tag on any site.</h2>
        <p>It renders in its own Shadow DOM, so your CSS can't break it. Works in plain HTML, Next.js, React, Vue, anything that can add a script.</p>
        <table>
          <tr><td>data-agent</td><td>Which agent answers</td></tr>
          <tr><td>data-color</td><td>Your accent color</td></tr>
          <tr><td>data-position</td><td>left or right corner</td></tr>
          <tr><td>SupportAgent.ask()</td><td>Open it from your own button</td></tr>
        </table>
      </div>
      <div>
        <div role="tablist" aria-label="Embed code">
          <button role="tab" id="tab-html" aria-controls="panel-html" aria-selected="true">HTML</button>
          <button role="tab" id="tab-next" aria-controls="panel-next" aria-selected="false" tabindex="-1">Next.js</button>
          <button role="tab" id="tab-react" aria-controls="panel-react" aria-selected="false" tabindex="-1">React</button>
        </div>
        <div role="tabpanel" id="panel-html" aria-labelledby="tab-html"><pre class="term"><button class="copy" type="button">Copy</button><code>&lt;script src="https://support.example.com/widget.js"
  data-agent="my-app"
  data-color="#1f6f50" defer&gt;&lt;/script&gt;</code></pre></div>
        <div role="tabpanel" id="panel-next" aria-labelledby="tab-next" hidden><pre class="term"><button class="copy" type="button">Copy</button><code>import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    &lt;html lang="en"&gt;
      &lt;body&gt;
        {children}
        &lt;Script src="https://support.example.com/widget.js"
          data-agent="my-app" strategy="afterInteractive" /&gt;
      &lt;/body&gt;
    &lt;/html&gt;
  );
}</code></pre></div>
        <div role="tabpanel" id="panel-react" aria-labelledby="tab-react" hidden><pre class="term"><button class="copy" type="button">Copy</button><code>import { useEffect } from "react";

export function SupportWidget() {
  useEffect(() =&gt; {
    const s = document.createElement("script");
    s.src = "https://support.example.com/widget.js";
    s.dataset.agent = "my-app";
    s.defer = true;
    document.body.appendChild(s);
  }, []);
  return null;
}</code></pre></div>
      </div>
    </div></section>

    <section><div class="wrap">
      <p class="label">Models</p>
      <h2>Claude by default. Your own GPU when nothing may leave the box.</h2>
      <div class="models">
        <div><h3>Claude</h3><ul><li>Searches several times and reasons across pages</li><li>Best at saying "I couldn't find that" instead of guessing</li><li>Paid per message; set a rate limit</li></ul></div>
        <div><h3>Ollama, local</h3><ul><li><code>llama3.1:8b</code> fits an 8 GB GPU</li><li>No API key, no data leaves your server</li><li>Fine for direct "how do I" questions; weaker across many pages</li></ul></div>
      </div>
    </div></section>
  </main>

  <footer><div class="wrap">
    <span>support-agent · self-hosted, no database</span>
    <a href="https://github.com/Kaeden-Martinson/AI-Support-Agent">GitHub</a>
    <a href="https://github.com/Kaeden-Martinson/AI-Support-Agent#readme">Docs</a>
  </div></footer>

  <script>
    // Copy buttons: hero commands come from data-copy (no "$ " prompts); code tabs copy their code.
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".copy");
      if (!btn || !navigator.clipboard) return;
      var text = btn.dataset.copy || btn.parentElement.querySelector("code").textContent;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = "Copy"; }, 1200);
      });
    });

    // Code tabs: click or arrow keys.
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(t); });
      t.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        var next = tabs[(i + d + tabs.length) % tabs.length];
        select(next);
        next.focus();
      });
    });
  </script>
  <script src="/widget.js" data-agent="demo" data-hint="Questions about setup? Ask here." defer></script>
</body>
</html>
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, all tests including both route tests.

- [ ] **Step 6: Check the page in the browser**

Start `PORT=3001 npm run serve` and open `http://localhost:3001/`.

Expected at 1280px wide:
- nav, hero (headline left, example right), the four-step strip, the embed section and the models section all appear, matching the approved mockup `page-full.html`
- the hero Copy button puts the four commands on the clipboard without `$ ` prompts
- the tabs switch with clicks and with ←/→ when focused, and each tab's Copy copies its code
- the corner widget opens, shows the three starter questions, and answers a real question with GitHub source chips

Expected at 375px wide (DevTools device mode): every two-column block stacks into one column, the strip becomes a single column, the headline is smaller, and the page never scrolls sideways (`document.documentElement.scrollWidth === innerWidth` in the console returns `true`).

Stop the server.

- [ ] **Step 7: Update the README's layout list**

In `README.md`, in the `## Project layout` block, replace:

```
  demo.html         demo page
```

with:

```
  index.html        home page served at /
  demo.html         widget test page at /demo?agent=<id>
```

- [ ] **Step 8: Commit**

```bash
git add public/index.html src/server.ts test/server.test.ts README.md
git commit -m "Add the project home page at /" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

**Files:** none changed unless a check fails.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified build, ready for your human partner to review.

- [ ] **Step 1: Tests and types**

Run: `npm test`
Expected: PASS, all tests in 4 files, 0 failures.

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 2: Local-model answers are unchanged**

With Ollama running and `LLM_PROVIDER=ollama` in `.env`, start `PORT=3001 npm run serve` and open `http://localhost:3001/demo?agent=mysite`. Click "New chat" before each line below, and ask these messages (the last two in the same chat):

1. How much is VoidX with the VPN? (expect $12.98 a month)
2. I bought VoidX 5 days ago and don't like it. Can I get a refund? (expect: outside the 3-day window, can still open a Discord ticket)
3. Does it work on my iPhone? (expect: no, desktop Chrome/Edge/Brave/Opera only)
4. How do I buy it for a friend? (expect: "Gift it" after checkout, Discord user ID)
5. Do you have a yearly plan or a discount code? (expect: not in the docs, ask in Discord; nothing invented)
6. Is there a VPN server in London? (expect: no; Los Angeles, Atlanta, Frankfurt, Osaka, Sydney)
7. How do I install it? (expect: the unzip / Developer mode / Load unpacked steps)
8. I paid but I don't see my key anywhere (expect: finish the claim/gift step, else Discord ticket)
9. Can I share my key with my brother? (expect: no, breaks the Terms of Service)
10. Does it work on Firefox? (expect: not listed; Chrome, Edge, Brave, Opera)
11. Write me a poem about pizza (expect: politely declines)
12. How much does it cost? then, in the same chat, and how do I cancel it? (expect: $9.99/month; cancel from the dashboard, access until the period ends)

Expected: answers match the notes above (this plan only changed the display), every link opens a real `https://thevoidx.com/` page, and answers that contain those links show them as source chips.

- [ ] **Step 3: Report**

Tell your human partner what was verified and anything that wasn't (for example if Ollama wasn't available). Don't push; pushing is their call.
