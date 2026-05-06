import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

import {
  detectReadySignal,
  EMPTY_PRD_STATE,
  extractStateBlock,
  mergePRDState,
  type PRDState,
} from "./prd-state";
import type { ChatMessage, DiscoveryEvent } from "./types";
import { runDiscoveryAgentFake } from "./runner-fake";

function loadDiscoveryPrompt(): string {
  const path = join(process.cwd(), "lib", "agents", "prompts", "discovery.md");
  return readFileSync(path, "utf-8");
}

function formatConversationPrompt(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return "Saluda al usuario y preguntale qué tipo de aplicación quiere generar. Recordá: bloque JSON primero (con todos los campos vacíos en arrays/strings), después el texto.";
  }

  const lines: string[] = ["<conversación previa>"];
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i];
    lines.push(m.role === "user" ? `Usuario: ${m.content}` : `Asistente: ${m.content}`);
  }
  lines.push("</conversación previa>");
  const last = messages[messages.length - 1];
  lines.push("");
  if (last.role === "user") {
    lines.push("<turno_actual>");
    lines.push(`Usuario: ${last.content}`);
    lines.push("</turno_actual>");
    lines.push("");
    lines.push(
      "Continuá como el asistente. Tu respuesta debe empezar con el bloque ```json``` actualizado y seguir con el texto conversacional. Si el estado ya cumple los umbrales (≥3 entities, ≥2 roles, ≥6 useCases) y cubre las reglas clave, cerrá con `READY_TO_BUILD`.",
    );
  } else {
    lines.push("Continuá la conversación.");
  }
  return lines.join("\n");
}

const ANSI_ESCAPE_RE = /\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

/**
 * Pure async generator that consumes raw stdout chunks from
 * `claude --print --output-format text` and emits the discovery event stream.
 *
 * Contract:
 * - Every non-empty chunk yields exactly one `delta` event with the chunk text
 *   (ANSI codes stripped). The full conversation context is reconstructed by
 *   the client by concatenating these deltas — the server is intentionally
 *   not stripping the JSON state block from the deltas (the chat does that
 *   in `visibleProse`).
 * - A `state` event is yielded the first time the running buffer contains
 *   a complete `\`\`\`json {...} \`\`\`` block that parses cleanly. It is
 *   re-yielded whenever a NEW JSON block parses to a different state.
 * - A `ready` event is yielded once when `READY_TO_BUILD` is detected on its
 *   own line AND a state has already been emitted.
 *
 * This function does NOT yield `done` — that's the responsibility of the
 * outer `runDiscoveryAgentClaude` so it can wait for the subprocess exit
 * code and decide whether to also yield `error`.
 */
export async function* parseClaudeTextStream(
  chunks: AsyncIterable<string>,
): AsyncGenerator<DiscoveryEvent> {
  let assembled = "";
  let lastEmittedState: PRDState | null = null;
  let readyEmitted = false;

  for await (const rawChunk of chunks) {
    const chunk = stripAnsi(rawChunk);
    if (chunk.length === 0) continue;
    assembled += chunk;
    yield { type: "delta", text: chunk };

    const block = extractStateBlock(assembled);
    if (block && typeof block === "object") {
      const candidate = mergePRDState(EMPTY_PRD_STATE, block as Partial<PRDState>);
      const serialized = JSON.stringify(candidate);
      if (lastEmittedState === null || JSON.stringify(lastEmittedState) !== serialized) {
        lastEmittedState = candidate;
        yield { type: "state", state: candidate };
      }
    }

    if (!readyEmitted && lastEmittedState !== null && detectReadySignal(assembled)) {
      readyEmitted = true;
      yield { type: "ready", state: lastEmittedState };
    }
  }
}

async function* runDiscoveryAgentClaude(
  messages: ChatMessage[],
): AsyncGenerator<DiscoveryEvent> {
  const systemPrompt = loadDiscoveryPrompt();
  const userPrompt = formatConversationPrompt(messages);
  const workDir = mkdtempSync(join(tmpdir(), "atelier-discovery-"));
  const debug = process.env.DEBUG_DISCOVERY === "1";

  // Note: NOT using `--tools ""` here. It's a varargs flag and without
  // `shell:true` the empty arg slurps the next positional, which causes
  // claude to error: "Input must be provided either through stdin or as a
  // prompt argument when using --print". The agent doesn't use tools anyway
  // (its prompt is chat-only).
  const args = [
    "--print",
    "--no-session-persistence",
    "--output-format",
    "text",
    "--system-prompt",
    systemPrompt,
    userPrompt,
  ];

  // IMPORTANT: do NOT use `shell: true` on Windows. With shell:true, Node
  // concatenates args without escaping, and the system prompt's markdown
  // (backticks, newlines, quotes) gets eaten by cmd.exe before it ever
  // reaches claude — symptom: claude answers as a generic assistant,
  // ignoring the Atelier discovery prompt entirely. spawn() resolves the
  // .exe / .cmd off PATH on its own.
  const executable = process.platform === "win32" ? "claude.exe" : "claude";
  const child = spawn(executable, args, {
    cwd: workDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrBuf = "";
  child.stderr.setEncoding("utf-8");
  child.stderr.on("data", (chunk: string) => {
    stderrBuf += chunk;
  });
  child.stdout.setEncoding("utf-8");

  const wrappedChunks = (async function* () {
    for await (const chunk of child.stdout as AsyncIterable<string>) {
      if (debug) console.log("[STDOUT-RAW]", JSON.stringify(chunk));
      yield chunk;
    }
  })();

  try {
    yield* parseClaudeTextStream(wrappedChunks);

    const exitCode: number | null = await new Promise((resolve) => {
      if (child.exitCode !== null) resolve(child.exitCode);
      else child.once("close", (code) => resolve(code));
    });

    if (exitCode !== 0) {
      yield {
        type: "error",
        message: `claude exited with code ${exitCode}: ${stderrBuf.slice(0, 400)}`,
      };
    }
    yield { type: "done" };
  } finally {
    if (child.exitCode === null) {
      child.kill();
    }
    rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function* runDiscoveryAgent(
  messages: ChatMessage[],
): AsyncGenerator<DiscoveryEvent> {
  const mode = process.env.DISCOVERY_RUNNER_MODE ?? "claude";
  if (mode === "fake") {
    yield* runDiscoveryAgentFake(messages);
    return;
  }
  yield* runDiscoveryAgentClaude(messages);
}

export { runDiscoveryAgentClaude, runDiscoveryAgentFake };
