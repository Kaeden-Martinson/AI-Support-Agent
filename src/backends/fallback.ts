import type { AgentEvent } from "../agent.ts";
import type { Backend, TextTurn, TurnInput } from "./shared.ts";

// A primary backend with a backup that answers when the primary is unavailable (LLM_FALLBACK).
//
// Each backend keeps its own history in its own shape, side by side. Every finished exchange is
// also recorded as plain text, and before a backend answers it catches up on the exchanges the
// other one answered, appended to its history as plain text turns. So the primary's history stays
// append-only (Claude's transcript is never rewritten, only extended), and a conversation that
// switches backends keeps its context in both directions.

interface FallbackState {
  /** Plain-text record of every finished exchange, whichever backend answered it. */
  turns: TextTurn[];
  primary: { history: unknown[]; seen: number };
  backup: { history: unknown[]; seen: number };
}

/** Thrown when the primary was unavailable and the backup failed too. */
export class BackupFailedError extends Error {
  readonly primaryError: unknown;
  readonly backupError: unknown;
  constructor(primaryError: unknown, backupError: unknown) {
    super("Primary and backup model both failed", { cause: backupError });
    this.primaryError = primaryError;
    this.backupError = backupError;
  }
}

export function withFallback(
  primary: Backend,
  backup: Backend,
  names: { primary: string; backup: string },
  log: (msg: string) => void = (msg) => console.warn(msg),
): Backend {
  async function* runOn(
    backend: Backend,
    side: { history: unknown[]; seen: number },
    state: FallbackState,
    input: TurnInput,
    onText: (text: string) => void,
  ): AsyncGenerator<AgentEvent, unknown[]> {
    const history = [...side.history, ...backend.textTurns(state.turns.slice(side.seen))];
    const gen = backend.answer({ ...input, history });
    let r = await gen.next();
    while (!r.done) {
      if (r.value.type === "text") onText(r.value.text);
      yield r.value;
      r = await gen.next();
    }
    return r.value;
  }

  async function* answer(input: TurnInput): AsyncGenerator<AgentEvent, unknown[]> {
    const state: FallbackState = (input.history[0] as FallbackState | undefined) ?? {
      turns: [],
      primary: { history: [], seen: 0 },
      backup: { history: [], seen: 0 },
    };
    let reply = "";
    const onText = (t: string) => (reply += t);
    const finish = (which: "primary" | "backup", history: unknown[]): unknown[] => {
      const turns = [...state.turns, { user: input.context + input.message, assistant: reply }];
      return [{ ...state, turns, [which]: { history, seen: turns.length } } satisfies FallbackState];
    };

    try {
      return finish("primary", yield* runOn(primary, state.primary, state, input, onText));
    } catch (err) {
      // Once text has reached the visitor, switching models would splice two answers together.
      if (reply || !primary.isUnavailable?.(err)) throw err;
      log(`[fallback] ${names.primary} unavailable (${describe(err)}); answering with ${names.backup}`);
      try {
        return finish("backup", yield* runOn(backup, state.backup, state, input, onText));
      } catch (backupErr) {
        throw new BackupFailedError(err, backupErr);
      }
    }
  }

  function errorMessage(err: unknown): string {
    return err instanceof BackupFailedError ? backup.errorMessage(err.backupError) : primary.errorMessage(err);
  }

  // A fallback backend is never itself a backup, so it needs no conversion from plain text.
  const textTurns = (): unknown[] => {
    throw new Error("withFallback backends can't be used as a backup");
  };

  return { answer, errorMessage, textTurns };
}

function describe(err: unknown): string {
  if (err && typeof err === "object") {
    const { status, message } = err as { status?: unknown; message?: unknown };
    const msg = typeof message === "string" ? message.slice(0, 200) : String(err);
    return typeof status === "number" ? `${status} ${msg}` : msg;
  }
  return String(err);
}
