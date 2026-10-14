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
