import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

export interface ExtractedPage {
  title: string;
  /** Markdown-ish text: headings as "#", code as fenced blocks, paragraphs separated by blank lines. */
  text: string;
  links: string[];
}

const DROP = "script,style,noscript,svg,iframe,template,form,nav,header,footer,aside,[aria-hidden=true],[hidden]";
const BLOCK = new Set([
  "p", "div", "section", "article", "main", "ul", "ol", "li", "table", "tr", "blockquote",
  "dl", "dt", "dd", "figure", "figcaption", "details", "summary", "br", "hr",
]);

/** Pull readable text out of an HTML page, keeping heading structure and code blocks. */
export function extractHtml(html: string, baseUrl?: string): ExtractedPage {
  const $ = cheerio.load(html);

  const links: string[] = [];
  if (baseUrl) {
    $("a[href]").each((_, a) => {
      try {
        links.push(new URL($(a).attr("href")!, baseUrl).toString());
      } catch {
        /* ignore malformed hrefs */
      }
    });
  }

  const title = ($("title").first().text() || $("h1").first().text() || "").trim().replace(/\s+/g, " ");
  $(DROP).remove();

  const root = $("main").first().length
    ? $("main").first()
    : $("[role=main]").first().length
      ? $("[role=main]").first()
      : $("article").first().length
        ? $("article").first()
        : $("body");

  const out: string[] = [];
  const walk = (node: AnyNode) => {
    if (node.type === "text") {
      out.push((node as unknown as { data: string }).data.replace(/\s+/g, " "));
      return;
    }
    if (node.type !== "tag") return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      const t = $(el).text().trim().replace(/\s+/g, " ");
      if (t) out.push(`\n\n${"#".repeat(Number(heading[1]))} ${t}\n\n`);
      return;
    }
    if (tag === "pre") {
      out.push(`\n\n\`\`\`\n${preText(el).replace(/\n+$/, "")}\n\`\`\`\n\n`);
      return;
    }
    if (tag === "code") {
      out.push("`" + $(el).text() + "`");
      return;
    }
    const block = BLOCK.has(tag);
    if (block) out.push(tag === "li" ? "\n- " : "\n\n");
    for (const child of el.children) walk(child);
    if (tag === "td" || tag === "th") out.push(" | ");
    if (block) out.push("\n");
  };
  for (const child of root.get(0)?.children ?? []) walk(child);

  return { title, text: tidy(out.join("")), links };
}

/**
 * Text of a <pre>, keeping line breaks. Syntax highlighters (Shiki, Prism, highlight.js) often
 * render each line as its own element with no newline characters between them.
 */
function preText(node: AnyNode): string {
  if (node.type === "text") return (node as unknown as { data: string }).data;
  if (node.type !== "tag") return "";
  const el = node as Element;
  if (el.tagName.toLowerCase() === "br") return "\n";
  const inner = el.children.map(preText).join("");
  const isLine = /\bline\b/.test(el.attribs.class ?? "") || el.tagName.toLowerCase() === "div";
  return isLine && !inner.endsWith("\n") ? inner + "\n" : inner;
}

/** Trim stray whitespace and collapse blank lines, leaving fenced code blocks untouched. */
export function tidy(text: string): string {
  let inFence = false;
  return text
    .split("\n")
    .map((l) => {
      const fence = /^\s*```/.test(l);
      if (fence) inFence = !inFence;
      if (inFence && !fence) return l.replace(/[ \t]+$/g, "");
      return l.replace(/[ \t]+$/g, "").replace(/^[ \t]+(?!-)/, "");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
