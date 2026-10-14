// `npm run tunnel`: expose the local server through a Cloudflare quick tunnel (a random
// https://*.trycloudflare.com address). Pass a named tunnel to use your own domain instead:
// `npm run tunnel -- <tunnel-name>`. See "Running from your own computer" in docs/deployment.md.
import { spawn } from "node:child_process";

const port = Number(process.env.PORT ?? 3000);
const name = process.argv[2];

if (!process.env.TRUST_PROXY) {
  console.warn("[tunnel] TRUST_PROXY is not set: every visitor will share one rate limit (the tunnel's IP). Set TRUST_PROXY=1 in .env and restart the server.");
}
try {
  const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (err) {
  console.warn(`[tunnel] No server answering on http://localhost:${port} (${(err as Error).message}). Start it with \`npm run serve\` in another terminal.`);
}

const args = name ? ["tunnel", "run", "--url", `http://localhost:${port}`, name] : ["tunnel", "--url", `http://localhost:${port}`];
console.log(`[tunnel] cloudflared ${args.join(" ")}`);
const child = spawn("cloudflared", args, { stdio: "inherit" });
child.on("error", (err) => {
  console.error(`[tunnel] Could not start cloudflared (${err.message}). Install it: winget install Cloudflare.cloudflared (Windows), brew install cloudflared (macOS).`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
