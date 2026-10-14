import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { chat } from "./agent.ts";
import { agentDir, isValidAgentId, listAgents, loadAgent, saveAgent, type AgentConfig, type Source } from "./config.ts";
import { buildKnowledgeBase, getKnowledgeBase } from "./kb.ts";
import { buildReport, entriesSince, formatReport, logFile, readEntries } from "./questionlog.ts";
import { startServer } from "./server.ts";

const HELP = `AI Support Agent

Usage: npm run cli -- <command> [options]

  init <agent-id>    Create an agent
      --name <name>          Product/site name (required)
      --description <text>   What the product is (one or two sentences)
      --url <url>            Website to crawl (repeatable)
      --dir <path>           Local docs folder to index (repeatable)
      --file <path>          Single local file to index (repeatable)
      --origin <origin>      Origin allowed to embed the widget (repeatable; default "*")
      --max-pages <n>        Crawl limit per URL (default 200)
      --contact <text>       Where to send people when docs don't cover it
  ingest <agent-id>  Crawl/read the agent's sources and rebuild its knowledge base
  ask <agent-id> [question]
                     Chat with the agent in the terminal (interactive without a question)
  search <agent-id> <query>
                     Show raw search results (for debugging retrieval)
  report <agent-id>  Summarize the question log (needs LOG_QUESTIONS=1 on the server):
                     most-asked questions, likely docs gaps, errors, response times
      --days <n>             How far back to look (default 7)
  list               List agents
  serve              Start the HTTP server (widget + API)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    description: { type: "string" },
    url: { type: "string", multiple: true },
    dir: { type: "string", multiple: true },
    file: { type: "string", multiple: true },
    origin: { type: "string", multiple: true },
    "max-pages": { type: "string" },
    contact: { type: "string" },
    days: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const [command, agentId, ...rest] = positionals;

function requireAgent(): AgentConfig {
  if (!agentId) fail("Missing <agent-id>");
  const cfg = loadAgent(agentId);
  if (!cfg) fail(`No agent "${agentId}". Create it with: npm run cli -- init ${agentId} --name "..." --url https://...`);
  return cfg;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function ask(cfg: AgentConfig, question: string, sessionId?: string): Promise<string | undefined> {
  const kb = getKnowledgeBase(cfg.id) ?? fail(`No knowledge base yet. Run: npm run cli -- ingest ${cfg.id}`);
  let sid = sessionId;
  for await (const ev of chat(cfg, kb, question, { sessionId })) {
    if (ev.type === "session") sid = ev.sessionId;
    else if (ev.type === "text") process.stdout.write(ev.text);
    else if (ev.type === "status") process.stdout.write(`\x1b[2m[${ev.message}]\x1b[0m\n`);
    else if (ev.type === "error") process.stdout.write(`\n\x1b[31m${ev.message}\x1b[0m`);
  }
  process.stdout.write("\n");
  return sid;
}

switch (command) {
  case "init": {
    if (!agentId || !isValidAgentId(agentId)) fail("Usage: init <agent-id>  (lowercase letters, digits, dashes)");
    if (loadAgent(agentId)) fail(`Agent "${agentId}" already exists — edit data/agents/${agentId}/agent.json`);
    if (!values.name) fail("--name is required");
    const maxPages = values["max-pages"] ? Number(values["max-pages"]) : undefined;
    const sources: Source[] = [
      ...(values.url ?? []).map((url) => ({ type: "url" as const, url, ...(maxPages ? { maxPages } : {}) })),
      ...(values.dir ?? []).map((path) => ({ type: "dir" as const, path })),
      ...(values.file ?? []).map((path) => ({ type: "file" as const, path })),
    ];
    if (!sources.length) fail("Give at least one --url, --dir or --file");
    saveAgent({
      id: agentId,
      name: values.name,
      description: values.description ?? `${values.name}.`,
      supportContact: values.contact,
      allowedOrigins: values.origin?.length ? values.origin : ["*"],
      sources,
    });
    console.log(`Created data/agents/${agentId}/agent.json. Next: npm run cli -- ingest ${agentId}`);
    break;
  }
  case "ingest": {
    const cfg = requireAgent();
    await buildKnowledgeBase(cfg, console.log);
    break;
  }
  case "ask": {
    const cfg = requireAgent();
    if (rest.length) {
      await ask(cfg, rest.join(" "));
      break;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let sid: string | undefined;
    console.log(`Chatting with ${cfg.name}. Ctrl+C to quit.`);
    for (;;) {
      const q = (await rl.question("\n> ")).trim();
      if (q) sid = await ask(cfg, q, sid);
    }
  }
  case "search": {
    const cfg = requireAgent();
    const kb = getKnowledgeBase(cfg.id) ?? fail("No knowledge base yet");
    for (const h of kb.search(rest.join(" "), 8)) {
      console.log(`\n${h.score.toFixed(2)}  ${h.chunk.title} — ${h.chunk.section}\n      ${h.chunk.url}\n      ${h.chunk.text.slice(0, 160).replace(/\n/g, " ")}…`);
    }
    break;
  }
  case "report": {
    const cfg = requireAgent();
    const days = values.days ? Number(values.days) : 7;
    if (!(days > 0)) fail("--days must be a positive number");
    const entries = entriesSince(readEntries(logFile(agentDir(cfg.id))), days);
    console.log(formatReport(buildReport(entries), cfg.id, days));
    break;
  }
  case "list": {
    for (const id of listAgents()) {
      const kb = getKnowledgeBase(id);
      console.log(`${id.padEnd(24)} ${kb ? `${kb.pages.length} pages, ${kb.chunks.length} chunks (built ${kb.builtAt})` : "not ingested"}`);
    }
    break;
  }
  case "serve":
    startServer();
    break;
  default:
    console.log(HELP);
}
