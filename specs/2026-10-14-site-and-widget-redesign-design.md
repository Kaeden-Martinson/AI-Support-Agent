# Project site and chat widget redesign

Date: 2026-10-14
Status: approved in brainstorming, awaiting spec review

## Goal

Give the project a real home page for developers, and refresh the embeddable chat widget to match. A developer landing on the page should understand what the agent does, see it working, and have the commands to self-host it from GitHub, without scrolling past a sales pitch.

## Decisions already made

| Question | Choice |
| --- | --- |
| Which page | The AI Support Agent's own site (not VoidX) |
| Main action | Self-host from GitHub |
| Page structure | Layout A: headline and setup commands on the left, chat example on the right |
| Widget style | Corner panel (refined version of today's bubble) |
| Look | Paper and green: warm off-white, near-black ink, one deep green accent, system fonts |

The approved mockups are `page-full.html` and `widget-states.html` in `.superpowers/brainstorm/` (not committed).

## Non-goals

- No hosted service, signup or waitlist.
- No multi-page docs site. The page links to the Markdown docs on GitHub.
- No server-side change to how answers are produced. Source chips are built in the browser from links the answer already contains.
- No build step, framework or web fonts.

## Design tokens

Used by both the page and the widget's default theme.

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#f8f7f3` | Page background |
| `--ink` | `#18181b` | Text, primary button, dark code blocks' frame |
| `--muted` | `#66666b` | Secondary text |
| `--line` | `#e3e1da` | All borders (1px) |
| `--acc` | `#1f6f50` | Links, status dot, source chips, active tab underline |
| `--chip` | `#eceae4` | Inline code background |
| `--code` | `#1b1b1f` | Code block background |
| `--err` | `#a3321b` | Error text |

- **Type:** system UI font for text, `ui-monospace` stack for code and the wordmark. Scale ratio 1.333 from a 13px base: 13, 17.3, 23, 30.7, 41px. Headlines use weight 650 and slight negative tracking.
- **Radii:** 4px for controls and chips, 6px for code blocks, 8px for content strips, 12px for the chat panel.
- **Separation:** 1px `--line` borders everywhere. The only shadow is on the floating chat panel and the closed-state hint, because they sit over sites whose backgrounds we can't predict.
- **Accent use:** green appears only on links, the status dot, source chips and the active tab. No gradients, emoji or badges.

## Section 1: the page

Served by the existing server at `/` from a new `public/index.html`. The current test page stays at `/demo?agent=<id>`.

Content width 960px, 28px side padding. Sections are separated by a 1px top border and 48px of vertical padding. Below 760px wide, every two-column block stacks into one column; below 480px the headline drops one step on the scale (30.7px).

1. **Nav.** `support-agent` wordmark in monospace on the left. Links on the right: Docs (README on GitHub), Self-hosting (`docs/deployment.md` on GitHub), GitHub (repo).
2. **Hero, two columns (1.1 : 0.9).**
   - Left: headline "A support chat for your project, trained on your own docs." Lede: "Point it at a website or a docs folder, add one script tag, and it answers visitors from your pages, linking the one it used." Then a dark terminal block with the four commands (`git clone https://github.com/Kaeden-Martinson/AI-Support-Agent`, `npm run cli -- init my-app --name "My App" --dir ./docs`, `npm run cli -- ingest my-app`, `npm run serve`) and a Copy button that copies all four lines. Below: a "View on GitHub" button and a "Quick start →" link to the README's quick start.
   - Right: a static example conversation drawn with the widget's own styles. Question "Can I run it without an API key?", the status line "Searched docs: local model, ollama", an answer with the `LLM_PROVIDER=ollama` / `OLLAMA_MODEL=llama3.1:8b` code block, and source chips "Running fully self-hosted" and "Configuration". It's static HTML, so it always renders and costs nothing. A caption under it reads "Try the real one: it's in the corner, answering from this project's docs."
3. **How it answers.** Label "How it answers", heading "Your pages in, cited answers out." One bordered strip with four cells in a row (stacking to two by two, then one column, on narrow screens): ingest, index, search, answer, each with one sentence. The search cell says "Claude retries with other wording when it misses", since the local model searches once.
4. **Embed, two columns (0.8 : 1.2).** Left: heading "One script tag on any site.", a sentence about the Shadow DOM, and a table of `data-agent`, `data-color`, `data-position` and `SupportAgent.ask()`. Right: code tabs for HTML, Next.js and React, each with a Copy button. The Next.js and React snippets are the ones already in `docs/embedding.md`.
5. **Models.** Heading "Claude by default. Your own GPU when nothing may leave the box." Two bordered columns comparing Claude and Ollama, three bullets each, matching the trade-offs in `docs/deployment.md`.
6. **Footer.** "support-agent · self-hosted, no database", then GitHub and Docs links.

The page loads `widget.js` with `data-agent="demo"`, so the live corner widget answers from this project's docs.

**Interactions on the page:** the code tabs switch with click and arrow keys (`role="tablist"`), and each Copy button shows "Copied" for 1.2 seconds. Nothing animates on scroll.

## Section 2: the widget

Same file (`public/widget.js`) and same embed API. The look changes, and four small features are added.

**Look**

- **Launcher:** 46px circle in the site's accent (`data-color`) with the chat icon; it becomes a close icon when open. The default accent changes from today's blue `#2563eb` to `#1f6f50`. Sites that embed without `data-color` will turn green; the docs tell them to set `data-color="#2563eb"` to keep the old color.
- **Panel:** 380 × 560px, white, 1px `--line` border, 12px radius, one soft shadow (`0 8px 28px rgba(24,24,27,.10)`). Full screen below 480px wide, as today.
- **Header:** white with a bottom border, agent name, a "New chat" text button (hidden until there's a conversation) and a close button. No colored bar.
- **Messages:** the visitor's messages are accent-colored bubbles on the right. The agent's answers sit directly on the panel with no bubble, so code blocks and lists use the full width.
- **Input:** a bordered field with a square accent send button showing an up arrow, greyed out while a reply is streaming. The footer note reads "Answers come from {name}'s docs and can be wrong."
- **Dark mode:** follows the visitor's `prefers-color-scheme` as today, with dark versions of the same tokens.

**States**

1. **Closed:** the launcher only. If the site sets `data-hint`, a small speech bubble with that text appears beside the launcher once per browser session (remembered in `sessionStorage`). It disappears when the widget opens or after 8 seconds.
2. **First open:** the greeting, then up to three starter questions as bordered buttons. Clicking one sends it. They disappear after the first message.
3. **Searching:** after sending, a status line with a pulsing green dot shows the server's status text ("Searching docs: retry, backoff"). Three shimmering placeholder lines hold the answer's place until the first text arrives.
4. **Answered:** the answer streams in as Markdown, as today. When the answer is complete, every absolute `http(s)` link in it is collected, deduplicated by URL, and shown as up to four source chips under a "Sources" label, using the link text as the chip label. Links stay inline in the text too. Relative links get no chip (they wouldn't resolve on the host site); see "Linkable local sources" below.
5. **Error:** a light red box with the server's error message and a "Try again" link that resends the same question in the same session.

**New configuration**

| Setting | Where | Rules |
| --- | --- | --- |
| `data-hint` | script tag | Optional; up to 80 characters |
| `suggestions` | `agent.json` | Optional list; the server sends the first three, each trimmed to 80 characters |

`GET /api/agents/:id/config` adds `suggestions: string[]` (empty when unset). Init options gain `hint` to match `data-hint`.

**Linkable local sources**

Pages read from a `dir` or `file` source are stored under their repo-relative path (`docs/embedding.md`), which isn't a link a visitor can open. Those sources gain an optional `baseUrl`. When it's set, ingest stores each page's URL as `baseUrl` + the path relative to the source's own folder (for a `file` source, its file name). The demo agent uses `"baseUrl": "https://github.com/Kaeden-Martinson/AI-Support-Agent/blob/main/docs/"` for `docs` and `".../blob/main/"` for `README.md`, so its answers link to the GitHub pages and get source chips. Without `baseUrl`, behavior is unchanged.

**Accessibility**

- The log stays `aria-live="polite"`. The status line and placeholder lines are hidden from screen readers; the status text is announced once.
- Esc closes the panel and focus returns to the launcher, as today. Starter questions, chips, Try again and Send are real buttons or links with visible focus rings.
- With `prefers-reduced-motion`, the pulse and shimmer are replaced by static versions.

## Files touched

| File | Change |
| --- | --- |
| `public/index.html` | New page |
| `public/widget.js` | New styles, hint, starter questions, placeholder lines, source chips, retry, send button |
| `src/server.ts` | `/` serves `index.html`; `/config` returns `suggestions` |
| `src/config.ts` | `suggestions?: string[]` on `AgentConfig`; optional `baseUrl` on `dir` and `file` sources |
| `src/ingest/files.ts`, `src/kb.ts` | Apply `baseUrl` when building page URLs |
| `data/agents/demo/agent.json` | Add three starter questions and `baseUrl`s; re-ingest |
| `docs/embedding.md`, `docs/configuration.md`, `docs/knowledge-base.md` | Document `data-hint`, `suggestions` and `baseUrl` |

## Testing

- `npm run typecheck` passes.
- In the browser at desktop and 375px widths: the page sections stack correctly, tabs and Copy buttons work, and nothing scrolls sideways.
- Widget, checked with the existing mocked chat stream plus one real local-model answer:
  - every state above appears
  - chips match the answer's links, with duplicates removed and at most four
  - Try again resends the question
  - the hint appears only once per session
  - starter questions send and then disappear
  - dark mode and reduced motion work
- After re-ingesting `demo`, `npm run cli -- search demo "embed"` shows GitHub URLs, and an agent without `baseUrl` (`mysite`) keeps its URLs unchanged.
- Re-run the 13-question local-model check on `mysite` to confirm answers are unchanged (only the display changed).
