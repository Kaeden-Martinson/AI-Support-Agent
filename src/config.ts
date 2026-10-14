import fs from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
export const AGENTS_DIR = path.join(ROOT, "data", "agents");

export type LlmProvider = "claude" | "ollama";

function provider(): LlmProvider {
  const v = (process.env.LLM_PROVIDER || "claude").toLowerCase();
  if (v !== "claude" && v !== "ollama") throw new Error(`LLM_PROVIDER must be "claude" or "ollama", got "${v}"`);
  return v;
}

function flag(v: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(v ?? "");
}

export const settings = {
  port: Number(process.env.PORT ?? 3000),
  adminToken: process.env.ADMIN_TOKEN ?? "",
  provider: provider(),
  model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  effort: (process.env.CLAUDE_EFFORT || "low") as "low" | "medium" | "high" | "xhigh" | "max",
  ollama: {
    url: (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, ""),
    model: process.env.OLLAMA_MODEL || "llama3.1:8b",
    /** Context window to request. Ollama's own default is small enough to cut off the retrieved passages. */
    numCtx: Number(process.env.OLLAMA_NUM_CTX || 8192),
    /** How many knowledge-base passages to put in front of the model for each question. */
    passages: Number(process.env.OLLAMA_PASSAGES || 6),
    /** Also let the model call search_docs/read_page itself. Needs a model with tool support. */
    tools: flag(process.env.OLLAMA_TOOLS),
  },
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN ?? 20),
};

export type Source =
  | { type: "url"; url: string; maxPages?: number; pathPrefix?: string }
  | { type: "dir"; path: string; baseUrl?: string }
  | { type: "file"; path: string; baseUrl?: string };

export interface AgentConfig {
  id: string;
  name: string;
  /** One or two sentences on what the product/site is. Goes into the system prompt. */
  description: string;
  /** Extra instructions for tone, scope, escalation, etc. */
  instructions?: string;
  /** Where to send people when the docs don't have the answer. */
  supportContact?: string;
  greeting?: string;
  /** Origins allowed to embed the widget. ["*"] allows any origin (fine for local dev). */
  allowedOrigins: string[];
  sources: Source[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidAgentId(id: string): boolean {
  return ID_RE.test(id);
}

export function agentDir(id: string): string {
  if (!isValidAgentId(id)) throw new Error(`Invalid agent id "${id}" (use lowercase letters, digits, dashes)`);
  return path.join(AGENTS_DIR, id);
}

export function loadAgent(id: string): AgentConfig | null {
  if (!isValidAgentId(id)) return null;
  const file = path.join(agentDir(id), "agent.json");
  if (!fs.existsSync(file)) return null;
  const cfg = JSON.parse(fs.readFileSync(file, "utf8")) as AgentConfig;
  return { ...cfg, id };
}

export function saveAgent(cfg: AgentConfig): void {
  const dir = agentDir(cfg.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "agent.json"), JSON.stringify(cfg, null, 2) + "\n");
}

export function listAgents(): string[] {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  return fs
    .readdirSync(AGENTS_DIR)
    .filter((id) => isValidAgentId(id) && fs.existsSync(path.join(AGENTS_DIR, id, "agent.json")));
}
