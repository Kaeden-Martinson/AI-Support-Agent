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
