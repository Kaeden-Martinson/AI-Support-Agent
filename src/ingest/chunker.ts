import type { Chunk, RawPage } from "./types.ts";

const TARGET = 1400; // characters per chunk, roughly 350 tokens
const MAX = 2400;

/**
 * Split each page into chunks along its heading structure, so a chunk stays within one
 * section and carries that section's heading trail. Long sections split at paragraph breaks;
 * fenced code blocks are never split down the middle.
 */
export function chunkPages(pages: RawPage[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const page of pages) {
    for (const { trail, body } of sections(page.text)) {
      for (const text of pack(paragraphs(body))) {
        chunks.push({ id: chunks.length, url: page.url, title: page.title, section: trail.join(" > "), text });
      }
    }
  }
  return chunks;
}

function sections(text: string): { trail: string[]; body: string }[] {
  const out: { trail: string[]; body: string }[] = [];
  const trail: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) out.push({ trail: [...trail], body });
    buf = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    const h = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      trail.length = Math.min(trail.length, level - 1);
      while (trail.length < level - 1) trail.push("");
      trail[level - 1] = h[2].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out.map((s) => ({ ...s, trail: s.trail.filter(Boolean) }));
}

/** Paragraphs separated by blank lines, keeping fenced code blocks whole. */
function paragraphs(body: string): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (buf.length) out.push(buf.join("\n"));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push(buf.join("\n"));
  return out;
}

function pack(paras: string[]): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > TARGET) {
      out.push(cur);
      cur = "";
    }
    if (p.length > MAX && !p.startsWith("```")) {
      // A single giant paragraph: hard-split on sentence boundaries.
      for (const piece of p.match(new RegExp(`[\\s\\S]{1,${TARGET}}(?:[.!?](?=\\s)|$)`, "g")) ?? [p]) out.push(piece.trim());
      continue;
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out.filter(Boolean);
}
