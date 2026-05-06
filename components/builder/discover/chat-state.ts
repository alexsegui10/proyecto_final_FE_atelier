import { EMPTY_PRD_STATE, type PRDState } from "@/lib/agents/prd-state";
import type { ChatMessage, DiscoveryEvent } from "@/lib/agents/types";

export type MessageStatus = "pending" | "streaming" | "complete";

/**
 * Display-side message: a wire ChatMessage plus its lifecycle status.
 * - undefined / "complete": settled, render normally
 * - "pending": placeholder before any delta has arrived (renders typing dots)
 * - "streaming": deltas are flowing into `content` (renders prose + cursor)
 */
export type DisplayMessage = ChatMessage & {
  status?: MessageStatus;
};

export type ChatState = {
  messages: DisplayMessage[];
  prdState: PRDState;
  ready: boolean;
  error: string | null;
  isStreaming: boolean;
};

export const INITIAL_CHAT_STATE: ChatState = {
  messages: [],
  prdState: EMPTY_PRD_STATE,
  ready: false,
  error: null,
  isStreaming: false,
};

/**
 * Append a user turn (optional) and a pending assistant placeholder.
 * Called when the user submits a new message OR when the chat boots and
 * needs the agent to greet (no user content).
 */
export function beginTurn(state: ChatState, userContent?: string): ChatState {
  const additions: DisplayMessage[] = [];
  if (userContent !== undefined && userContent.trim().length > 0) {
    additions.push({ role: "user", content: userContent });
  }
  additions.push({ role: "assistant", content: "", status: "pending" });
  return {
    ...state,
    messages: [...state.messages, ...additions],
    isStreaming: true,
    error: null,
  };
}

/**
 * Apply a single SSE event to the chat state.
 * Pure: caller wraps in setState((s) => applyDiscoveryEvent(s, event)).
 */
export function applyDiscoveryEvent(
  state: ChatState,
  event: DiscoveryEvent,
): ChatState {
  switch (event.type) {
    case "delta":
      return appendDelta(state, event.text);
    case "state":
      return { ...state, prdState: event.state };
    case "ready":
      return { ...state, prdState: event.state, ready: true };
    case "error":
      return failTurn(state, event.message);
    case "done":
      return finalizeTurn(state);
    default: {
      const exhaustive: never = event;
      void exhaustive;
      return state;
    }
  }
}

function appendDelta(state: ChatState, text: string): ChatState {
  const lastIdx = state.messages.length - 1;
  const last = state.messages[lastIdx];
  const isLive =
    last?.role === "assistant" &&
    (last.status === "pending" || last.status === "streaming");

  if (isLive) {
    const next: DisplayMessage = {
      ...last,
      content: last.content + text,
      status: "streaming",
    };
    return {
      ...state,
      messages: [...state.messages.slice(0, lastIdx), next],
    };
  }

  // Defensive: a delta arrived without a placeholder. Don't lose the data —
  // start a new streaming assistant message so it shows up on screen.
  return {
    ...state,
    messages: [
      ...state.messages,
      { role: "assistant", content: text, status: "streaming" },
    ],
  };
}

function failTurn(state: ChatState, message: string): ChatState {
  // Drop the in-progress assistant placeholder so the user message stays at
  // the tail — Retry then resends a clean conversation.
  const lastIdx = state.messages.length - 1;
  const last = state.messages[lastIdx];
  const messages =
    last?.role === "assistant" && last.status !== "complete"
      ? state.messages.slice(0, lastIdx)
      : state.messages;
  return { ...state, messages, error: message };
}

function finalizeTurn(state: ChatState): ChatState {
  const lastIdx = state.messages.length - 1;
  const last = state.messages[lastIdx];
  if (!last || last.role !== "assistant" || last.status === "complete") {
    return { ...state, isStreaming: false };
  }
  if (last.content.trim().length === 0) {
    // Nothing was streamed (e.g., transport-level failure). Drop the empty
    // placeholder so the chat doesn't show a hollow bubble.
    return {
      ...state,
      messages: state.messages.slice(0, lastIdx),
      isStreaming: false,
    };
  }
  const next: DisplayMessage = { ...last, status: "complete" };
  return {
    ...state,
    messages: [...state.messages.slice(0, lastIdx), next],
    isStreaming: false,
  };
}

/**
 * Transport-level failure (network drop, non-2xx response): fold the failure
 * into the same shape the SSE error+done sequence would produce.
 */
export function transportFailure(state: ChatState, message: string): ChatState {
  return finalizeTurn(failTurn(state, message));
}

export function clearError(state: ChatState): ChatState {
  return { ...state, error: null };
}

/**
 * Strip the trailing pending/streaming placeholder before sending the
 * conversation to the server — the server is going to PRODUCE that response,
 * not consume it.
 */
export function toWireMessages(messages: DisplayMessage[]): ChatMessage[] {
  return messages
    .filter((m) => m.status !== "pending" && m.status !== "streaming")
    .map(({ role, content }) => ({ role, content }));
}
