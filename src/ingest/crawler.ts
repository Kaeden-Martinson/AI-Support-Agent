import { extractHtml } from "./extract.ts";
import type { RawPage } from "./types.ts";

const USER_AGENT = "AISupportAgentBot/0.1 (+self-hosted support agent indexer)";
const SKIP_EXT = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|mp4|mp3|webm|woff2?|ttf|css|js|json|xml|rss)$/i;

export interface CrawlOptions {
  maxPages?: number;
  /** Only follow links whose path starts with this, e.g. "/docs/" (defaults to the whole site). */
  pathPrefix?: string;
  concurrency?: number;
  onPage?: (url: string, n: number) => void;
}

/** Breadth-first crawl of one site, same origin only, honoring robots.txt Disallow rules. */
export async function crawlSite(startUrl: string, opts: CrawlOptions = {}): Promise<RawPage[]> {
  const start = new URL(startUrl);
  const maxPages = opts.maxPages ?? 200;
  const concurrency = opts.concurrency ?? 4;
  const prefix = opts.pathPrefix ?? "/";
  const disallow = await robotsDisallow(start.origin);

  const allowed = (u: URL) =>
    u.origin === start.origin &&
    u.pathname.startsWith(prefix) &&
    !SKIP_EXT.test(u.pathname) &&
    !disallow.some((d) => u.pathname.startsWith(d));

  const queue: string[] = [normalize(start)];
  const seen = new Set(queue);
  for (const u of await sitemapUrls(start.origin)) {
    const url = new URL(u);
    const key = normalize(url);
    if (allowed(url) && !seen.has(key)) {
      seen.add(key);
      queue.push(key);
    }
  }

  const pages: RawPage[] = [];
  const contentHashes = new Set<string>();

  const worker = async () => {
    while (queue.length && pages.length < maxPages) {
      const url = queue.shift()!;
      let res: Response;
      try {
        res = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      } catch {
        continue;
      }
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) continue;
      const finalUrl = new URL(res.url);
      if (!allowed(finalUrl)) continue;

      const page = extractHtml(await res.text(), finalUrl.toString());
      for (const link of page.links) {
        let u: URL;
        try {
          u = new URL(link);
        } catch {
          continue;
        }
        const key = normalize(u);
        if (allowed(u) && !seen.has(key)) {
          seen.add(key);
          queue.push(key);
        }
      }
      // Skip near-empty pages and exact duplicates (e.g. /docs and /docs/index.html).
      const hash = page.text.slice(0, 2000);
      if (page.text.length < 80 || contentHashes.has(hash) || pages.length >= maxPages) continue;
      contentHashes.add(hash);
      pages.push({ url: normalize(finalUrl), title: page.title || finalUrl.pathname, text: page.text });
      opts.onPage?.(finalUrl.toString(), pages.length);
    }
  };
  // Workers exit when the queue is momentarily empty, so run waves until nothing new turns up.
  while (queue.length && pages.length < maxPages) {
    await Promise.all(Array.from({ length: concurrency }, worker));
  }
  return pages;
}

function normalize(u: URL): string {
  const copy = new URL(u.toString());
  copy.hash = "";
  for (const p of [...copy.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$|^gclid$/.test(p)) copy.searchParams.delete(p);
  return copy.toString();
}

async function robotsDisallow(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const rules: string[] = [];
    let applies = false;
    for (const raw of (await res.text()).split("\n")) {
      const line = raw.split("#")[0].trim();
      const [k, ...rest] = line.split(":");
      const key = k?.toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*" || value.toLowerCase().startsWith("aisupportagentbot");
      else if (key === "disallow" && applies && value) rules.push(value.replace(/\*.*$/, ""));
    }
    return rules;
  } catch {
    return [];
  }
}

async function sitemapUrls(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/sitemap.xml`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return [...(await res.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]).filter((u) => !u.endsWith(".xml"));
  } catch {
    return [];
  }
}
