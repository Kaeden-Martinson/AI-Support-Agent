import type { AgentEvent } from "../agent.ts";
import type { AgentConfig } from "../config.ts";
import type { KnowledgeBase, SearchHit } from "../kb.ts";

const PAGE_CHAR_LIMIT = 30_000;

/** One visitor message for a backend to answer. */
export interface TurnInput {
  cfg: AgentConfig;
  kb: KnowledgeBase;
  /** The visitor's message as typed. */
  message: string;
  /** `<page_context>` prefix (or ""), to put in front of the message the model sees. */
  context: string;
  /** This backend's own history for the session, as returned by its previous turn. */
  history: unknown[];
}

/** A model that answers questions. Each backend owns the shape of its session history. */
export interface Backend {
  /** Stream events for one turn and return the session history including it. */
  answer(input: TurnInput): AsyncGenerator<AgentEvent, unknown[]>;
  /** Visitor-facing message for an error thrown by answer(). */
  errorMessage(err: unknown): string;
}

export const SEARCH_DOCS_DESCRIPTION =
  "Full-text keyword search over the site's documentation and pages. Returns the best-matching passages with their page URL. " +
  "Matching is lexical, so if results look off, search again with different wording, synonyms, or the exact product terms likely used in the docs. " +
  "Search before answering any question about the product.";

export const READ_PAGE_DESCRIPTION =
  "Read the full text of one page from the knowledge base, by the exact URL a search result returned. " +
  "Use when a passage is cut off or you need surrounding context (full steps, a complete code sample, a table).";

export function formatHits(hits: SearchHit[]): string {
  return hits
    .map((h, i) => `[${i + 1}] ${h.chunk.title}${h.chunk.section ? ` — ${h.chunk.section}` : ""}\nURL: ${h.chunk.url}\n${h.chunk.text}`)
    .join("\n\n---\n\n");
}

export function runTool(kb: KnowledgeBase, name: string, input: unknown): { content: string; isError?: boolean } {
  const args = (input ?? {}) as Record<string, unknown>;
  if (name === "search_docs") {
    if (typeof args.query !== "string" || !args.query.trim()) return { content: "query must be a non-empty string", isError: true };
    const hits = kb.search(args.query, 6);
    if (!hits.length) return { content: "No matches. Try different keywords." };
    return { content: formatHits(hits) };
  }
  if (name === "read_page") {
    if (typeof args.url !== "string") return { content: "url must be a string", isError: true };
    const page = kb.page(args.url);
    if (!page) return { content: `No page with URL ${args.url} in the knowledge base. Use a URL from search results.`, isError: true };
    const text = page.text.length > PAGE_CHAR_LIMIT ? page.text.slice(0, PAGE_CHAR_LIMIT) + "\n\n[Page truncated here — search for specific terms to find later sections.]" : page.text;
    return { content: `# ${page.title}\nURL: ${page.url}\n\n${text}` };
  }
  return { content: `Unknown tool ${name}`, isError: true };
}

/** Status line shown while a tool runs, or null for tools that don't announce themselves. */
export function toolStatus(name: string, input: unknown): string | null {
  if (name === "search_docs") return `Searching docs: ${clean(String((input as { query?: unknown })?.query ?? ""), 80)}`;
  if (name === "read_page") return "Reading page…";
  return null;
}

export function clean(s: string | undefined, max: number): string {
  return (s ?? "").replace(/[<>\r\n]/g, " ").slice(0, max).trim();
}
