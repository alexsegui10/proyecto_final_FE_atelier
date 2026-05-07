"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { IconArrowUp, IconLoader2 } from "@tabler/icons-react";

import { PRDCard } from "./prd-card";
import { ErrorBubble } from "./error-bubble";
import { TypingIndicator } from "./typing-indicator";
import { TypingCursor } from "./typing-cursor";
import { streamingPhase, visibleProse } from "./streaming-phase";
import { parseSseChunk } from "./sse-parser";
import {
  applyDiscoveryEvent,
  beginTurn,
  clearError,
  INITIAL_CHAT_STATE,
  toWireMessages,
  transportFailure,
  type ChatState,
  type DisplayMessage,
} from "./chat-state";

const INITIAL_HINT =
  'Pegá una descripción rápida: "app de gestión de clases de yoga con admin, profe y alumnos".';

export function DiscoverChat() {
  const router = useRouter();
  const [state, setState] = useState<ChatState>(INITIAL_CHAT_STATE);
  const [building, setBuilding] = useState(false);
  const [input, setInput] = useState("");
  const [hasGreeted, setHasGreeted] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const consumeStream = useCallback(
    async (stream: ReadableStream<Uint8Array>, signal: AbortSignal) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          if (signal.aborted) {
            await reader.cancel().catch(() => undefined);
            return;
          }
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const { events, remainder } = parseSseChunk(buffer);
          buffer = remainder;
          for (const event of events) {
            setState((s) => applyDiscoveryEvent(s, event));
          }
        }
      } finally {
        reader.releaseLock?.();
      }
    },
    [],
  );

  const sendTurn = useCallback(
    async (turnState: ChatState) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const wire = toWireMessages(turnState.messages);
      try {
        const response = await fetch("/api/discovery/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: wire }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`stream failed: ${response.status}`);
        }
        await consumeStream(response.body, controller.signal);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((s) => transportFailure(s, (err as Error).message));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [consumeStream],
  );

  /**
   * Submits a new turn. Computes the next state outside of setState so the
   * SSE call gets a fresh, post-`beginTurn` snapshot rather than racing the
   * batch.
   */
  const submitMessage = useCallback(
    (content: string | undefined) => {
      const next = beginTurn(stateRef.current, content);
      stateRef.current = next;
      setState(next);
      void sendTurn(next);
    },
    [sendTurn],
  );

  useEffect(() => {
    if (hasGreeted) return;
    setHasGreeted(true);
    submitMessage(undefined);
  }, [hasGreeted, submitMessage]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [state.messages, state.error]);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || state.isStreaming) return;
      setInput("");
      submitMessage(trimmed);
    },
    [input, state.isStreaming, submitMessage],
  );

  const handleRetry = useCallback(() => {
    if (state.isStreaming) return;
    const cleared = clearError(stateRef.current);
    stateRef.current = cleared;
    setState(cleared);
    submitMessage(undefined);
  }, [state.isStreaming, submitMessage]);

  const handleBuild = useCallback(async () => {
    if (building) return;
    setBuilding(true);
    setState((s) => clearError(s));
    try {
      const name = state.prdState.objective || "Atelier Project";
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, prd: state.prdState }),
      });
      if (!response.ok) {
        throw new Error(`project create failed: ${response.status}`);
      }
      const project = (await response.json()) as { id: string };

      // Phase 2: kick off the generator agents and redirect to the live Studio.
      const startResponse = await fetch("/api/generate/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!startResponse.ok) {
        throw new Error(`generate/start failed: ${startResponse.status}`);
      }
      const { generationId } = (await startResponse.json()) as { generationId: string };
      router.push(`/studio/${generationId}`);
    } catch (err) {
      setState((s) => ({ ...s, error: (err as Error).message }));
      setBuilding(false);
    }
  }, [building, state.prdState, router]);

  return (
    <div className="grid h-full grid-cols-[3fr_2fr] gap-4 px-6 py-4">
      <section className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-900/60 bg-zinc-950/30">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            {state.messages.map((m, idx) => (
              <MessageRenderer key={idx} message={m} />
            ))}
            {state.error && !state.isStreaming ? (
              <ErrorBubble message={state.error} onRetry={handleRetry} />
            ) : null}
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="border-t border-zinc-900/60 bg-zinc-950/60 px-6 py-4"
        >
          <div
            className={`mx-auto flex max-w-2xl items-end gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 transition-opacity ${
              state.isStreaming ? "opacity-50" : "opacity-100"
            }`}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              rows={1}
              placeholder={
                state.messages.length === 0 ? INITIAL_HINT : "Tu mensaje…"
              }
              disabled={state.isStreaming}
              className="max-h-40 flex-1 resize-none bg-transparent py-1 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={state.isStreaming || input.trim().length === 0}
              className="rounded-md p-1.5 text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
              aria-label="Enviar"
            >
              {state.isStreaming ? (
                <IconLoader2 size={16} className="animate-spin" />
              ) : (
                <IconArrowUp size={16} />
              )}
            </button>
          </div>
        </form>
      </section>

      <PRDCard
        state={state.prdState}
        ready={state.ready && !state.isStreaming}
        onBuild={handleBuild}
        building={building}
      />
    </div>
  );
}

function MessageRenderer({ message }: { message: DisplayMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-zinc-800/70 px-4 py-2 text-sm text-zinc-100">
          {message.content}
        </div>
      </div>
    );
  }

  const isLive = message.status === "pending" || message.status === "streaming";
  const visible = visibleProse(message.content);
  const phase = streamingPhase(isLive ? { raw: message.content } : null, visible);

  if (phase === "thinking") {
    return <TypingIndicator />;
  }

  return (
    <div className="text-sm leading-relaxed text-zinc-200">
      <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-li:my-0.5 prose-pre:bg-zinc-900/60 prose-pre:text-xs prose-code:text-violet-300">
        <ReactMarkdown>{visible}</ReactMarkdown>
      </div>
      {phase === "streaming" ? <TypingCursor /> : null}
    </div>
  );
}
