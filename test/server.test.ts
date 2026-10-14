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

test("clientIp ignores a spoofed X-Forwarded-For behind a trusted proxy", async () => {
  const { clientIp } = await import("../src/server.ts");
  const req = (headers: Record<string, string>) =>
    ({ headers, socket: { remoteAddress: "127.0.0.1" } }) as unknown as import("node:http").IncomingMessage;
  const prev = process.env.TRUST_PROXY;
  try {
    delete process.env.TRUST_PROXY;
    assert.equal(clientIp(req({ "x-forwarded-for": "1.2.3.4" })), "127.0.0.1");

    process.env.TRUST_PROXY = "1";
    // The visitor sent a fake value; the proxy appended the real one.
    assert.equal(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" })), "203.0.113.7");
    assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
    // Cloudflare's own header wins over anything in X-Forwarded-For.
    assert.equal(
      clientIp(req({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "6.6.6.6, 198.51.100.9" })),
      "198.51.100.9",
    );
    assert.equal(clientIp(req({})), "127.0.0.1");
  } finally {
    if (prev === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prev;
  }
});
