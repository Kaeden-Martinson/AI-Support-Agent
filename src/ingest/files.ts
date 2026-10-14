import fs from "node:fs";
import path from "node:path";
import { extractHtml, tidy } from "./extract.ts";
import type { RawPage } from "./types.ts";

const TEXT_EXT = new Set([".md", ".mdx", ".markdown", ".txt", ".rst", ".html", ".htm"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "data", "coverage"]);

/** Read docs from a local directory (recursively) or a single file. Paths are relative to cwd. */
export function readLocal(target: string): RawPage[] {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`Not found: ${target}`);
  const files = fs.statSync(abs).isDirectory() ? walk(abs) : [abs];
  return files.flatMap((file) => {
    const page = readFile(file);
    return page && page.text.length >= 40 ? [page] : [];
  });
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function readFile(file: string): RawPage | null {
  const raw = fs.readFileSync(file, "utf8");
  const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html" || ext === ".htm") {
    const page = extractHtml(raw);
    return { url: rel, title: page.title || rel, text: page.text };
  }
  // Strip YAML front matter, but use its title if present.
  let text = raw.replace(/\r\n/g, "\n");
  let title = "";
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (fm) {
    title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1])?.[1] ?? "";
    text = text.slice(fm[0].length);
  }
  title ||= /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? path.basename(file);
  return { url: rel, title, text: tidy(text) };
}
