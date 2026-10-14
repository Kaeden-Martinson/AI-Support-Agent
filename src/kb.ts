import fs from "node:fs";
import path from "node:path";
import { agentDir, type AgentConfig } from "./config.ts";
import { chunkPages } from "./ingest/chunker.ts";
import { crawlSite } from "./ingest/crawler.ts";
import { readLocal } from "./ingest/files.ts";
import type { Chunk, RawPage } from "./ingest/types.ts";

export interface KnowledgeBaseFile {
  builtAt: string;
  pages: RawPage[];
  chunks: Chunk[];
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
}

/** Fetch every source in the agent config, chunk it, and write data/agents/<id>/kb.json. */
export async function buildKnowledgeBase(cfg: AgentConfig, log: (msg: string) => void = () => {}): Promise<KnowledgeBaseFile> {
  const pages: RawPage[] = [];
  for (const src of cfg.sources) {
    if (src.type === "url") {
      log(`Crawling ${src.url} (max ${src.maxPages ?? 200} pages)`);
      pages.push(...(await crawlSite(src.url, { maxPages: src.maxPages, pathPrefix: src.pathPrefix, onPage: (u, n) => log(`  [${n}] ${u}`) })));
    } else {
      log(`Reading ${src.path}`);
      const found = readLocal(src.path, src.baseUrl);
      found.forEach((p) => log(`  ${p.url}`));
      pages.push(...found);
    }
  }
  const kb: KnowledgeBaseFile = { builtAt: new Date().toISOString(), pages, chunks: chunkPages(pages) };
  const file = path.join(agentDir(cfg.id), "kb.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(kb));
  fs.renameSync(file + ".tmp", file);
  cache.delete(cfg.id);
  log(`Indexed ${pages.length} pages into ${kb.chunks.length} chunks`);
  return kb;
}

// ---------------------------------------------------------------------------
// Retrieval: BM25 over chunk text, with the page title and section heading boosted.
// Claude calls search_docs several times with reworded queries when the first one misses,
// which covers most of the gap lexical search has against embeddings.

const STOP = new Set(
  "a an and are as at be but by can do does for from how i if in into is it its me my of on or our so that the their them then there these this to was we what when where which who why will with you your".split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((t) => !STOP.has(t)).map(stem);
}

function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export class KnowledgeBase {
  readonly builtAt: string;
  readonly pages: RawPage[];
  readonly chunks: Chunk[];
  private docs: Map<string, number>[] = [];
  private lengths: number[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(file: KnowledgeBaseFile) {
    this.builtAt = file.builtAt;
    this.pages = file.pages;
    this.chunks = file.chunks;
    for (const c of this.chunks) {
      // Title and section count twice so "Install" in a heading outranks a passing mention.
      const tokens = tokenize(`${c.title} ${c.section} ${c.title} ${c.section} ${c.text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push(tf);
      this.lengths.push(tokens.length);
    }
    this.avgLen = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length);
  }

  search(query: string, limit = 6): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    const N = this.chunks.length;
    const k1 = 1.2;
    const b = 0.75;
    const hits: SearchHit[] = [];
    for (let i = 0; i < N; i++) {
      const tf = this.docs[i];
      let score = 0;
      for (const t of terms) {
        const f = tf.get(t);
        if (!f) continue;
        const df = this.df.get(t)!;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * this.lengths[i]) / this.avgLen));
      }
      if (score > 0) hits.push({ chunk: this.chunks[i], score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  page(url: string): RawPage | undefined {
    const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
    return this.pages.find((p) => norm(p.url) === norm(url));
  }
}

const cache = new Map<string, { mtimeMs: number; kb: KnowledgeBase }>();

/** Load an agent's knowledge base, reloading automatically when kb.json changes on disk. */
export function getKnowledgeBase(agentId: string): KnowledgeBase | null {
  const file = path.join(agentDir(agentId), "kb.json");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(agentId);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.kb;
  const kb = new KnowledgeBase(JSON.parse(fs.readFileSync(file, "utf8")));
  cache.set(agentId, { mtimeMs: stat.mtimeMs, kb });
  return kb;
}
