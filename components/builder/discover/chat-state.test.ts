import { describe, it, expect } from "vitest";

import type { DiscoveryEvent } from "@/lib/agents/types";
import type { PRDState } from "@/lib/agents/prd-state";

import {
  applyDiscoveryEvent,
  beginTurn,
  clearError,
  INITIAL_CHAT_STATE,
  toWireMessages,
  transportFailure,
  type ChatState,
} from "./chat-state";
import { parseSseChunk } from "./sse-parser";

function feed(state: ChatState, events: DiscoveryEvent[]): ChatState {
  return events.reduce(applyDiscoveryEvent, state);
}

const SAMPLE_PRD: PRDState = {
  objective: "yoga app",
  roles: ["admin", "alumno"],
  entities: [{ name: "User", fields: ["email"] }],
  useCases: ["alumno reserva clase"],
  notes: [],
};

describe("beginTurn", () => {
  it("adds a user message + a pending assistant placeholder", () => {
    const next = beginTurn(INITIAL_CHAT_STATE, "hola");
    expect(next.messages).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "", status: "pending" },
    ]);
    expect(next.isStreaming).toBe(true);
    expect(next.error).toBeNull();
  });

  it("only adds the placeholder when there's no user content (greeting case)", () => {
    const next = beginTurn(INITIAL_CHAT_STATE);
    expect(next.messages).toEqual([
      { role: "assistant", content: "", status: "pending" },
    ]);
  });

  it("clears any standing error", () => {
    const start: ChatState = { ...INITIAL_CHAT_STATE, error: "boom" };
    expect(beginTurn(start, "x").error).toBeNull();
  });
});

describe("applyDiscoveryEvent — delta sequence (the regression test)", () => {
  it("delta×3 → state → done leaves the trailing assistant message complete with concatenated text", () => {
    let state = beginTurn(INITIAL_CHAT_STATE, "yoga app con admin profe alumno");
    const events: DiscoveryEvent[] = [
      { type: "delta", text: "Vale, " },
      { type: "delta", text: "tres roles. " },
      { type: "delta", text: "¿Capacidad fija o variable?" },
      { type: "state", state: SAMPLE_PRD },
      { type: "done" },
    ];
    state = feed(state, events);

    const last = state.messages[state.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("Vale, tres roles. ¿Capacidad fija o variable?");
    expect(last.status).toBe("complete");
    expect(state.isStreaming).toBe(false);
    expect(state.prdState.objective).toBe("yoga app");
  });

  it("each delta flips the placeholder to 'streaming' on the first append", () => {
    let state = beginTurn(INITIAL_CHAT_STATE, "x");
    expect(state.messages.at(-1)?.status).toBe("pending");
    state = applyDiscoveryEvent(state, { type: "delta", text: "abc" });
    expect(state.messages.at(-1)?.status).toBe("streaming");
    expect(state.messages.at(-1)?.content).toBe("abc");
    state = applyDiscoveryEvent(state, { type: "delta", text: "def" });
    expect(state.messages.at(-1)?.content).toBe("abcdef");
  });

  it("preserves earlier messages — only the trailing placeholder grows", () => {
    let state = beginTurn(INITIAL_CHAT_STATE, "first");
    state = feed(state, [
      { type: "delta", text: "respuesta inicial" },
      { type: "done" },
    ]);
    state = beginTurn(state, "segundo");
    state = feed(state, [
      { type: "delta", text: "ok" },
      { type: "done" },
    ]);
    expect(state.messages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "respuesta inicial", status: "complete" },
      { role: "user", content: "segundo" },
      { role: "assistant", content: "ok", status: "complete" },
    ]);
  });
});

describe("applyDiscoveryEvent — non-delta events", () => {
  it("'state' updates prdState without mutating messages", () => {
    let state = beginTurn(INITIAL_CHAT_STATE, "x");
    state = applyDiscoveryEvent(state, { type: "delta", text: "ack" });
    const before = state.messages;
    state = applyDiscoveryEvent(state, { type: "state", state: SAMPLE_PRD });
    expect(state.messages).toBe(before);
    expect(state.prdState.objective).toBe("yoga app");
  });

  it("'ready' sets ready=true and stores the final PRD", () => {
    let state = beginTurn(INITIAL_CHAT_STATE, "x");
    state = applyDiscoveryEvent(state, { type: "ready", state: SAMPLE_PRD });
    expect(state.ready).toBe(true);
    expect(state.prdState).toEqual(SAMPLE_PRD);
  });

  it("'error' drops the placeholder and records the message", () => {
    let state = beginTurn(INITIAL_CHAT_STATE, "x");
    state = applyDiscoveryEvent(state, { type: "delta", text: "partial" });
    state = applyDiscoveryEvent(state, {
      type: "error",
      message: "claude exit 1",
    });
    expect(state.error).toBe("claude exit 1");
    expect(state.messages).toEqual([{ role: "user", content: "x" }]);
  });

  it("'done' after 'error' just settles isStreaming=false (no resurrection)", () => {
    let state = beginTurn(INITIAL_CHAT_STATE, "x");
    state = feed(state, [
      { type: "delta", text: "partial" },
      { type: "error", message: "boom" },
      { type: "done" },
    ]);
    expect(state.error).toBe("boom");
    expect(state.messages).toEqual([{ role: "user", content: "x" }]);
    expect(state.isStreaming).toBe(false);
  });

  it("'done' with an empty placeholder drops it (no hollow bubble)", () => {
    let state = beginTurn(INITIAL_CHAT_STATE, "x");
    state = applyDiscoveryEvent(state, { type: "done" });
    expect(state.messages).toEqual([{ role: "user", content: "x" }]);
    expect(state.isStreaming).toBe(false);
  });

  it("a stray delta with no placeholder still surfaces as a streaming message", () => {
    const state = applyDiscoveryEvent(INITIAL_CHAT_STATE, {
      type: "delta",
      text: "hola",
    });
    expect(state.messages).toEqual([
      { role: "assistant", content: "hola", status: "streaming" },
    ]);
  });
});

describe("toWireMessages", () => {
  it("strips pending and streaming placeholders before sending", () => {
    const wire = toWireMessages([
      { role: "user", content: "hola" },
      { role: "assistant", content: "Hola.", status: "complete" },
      { role: "user", content: "qué tal" },
      { role: "assistant", content: "Bien, ", status: "streaming" },
    ]);
    expect(wire).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "Hola." },
      { role: "user", content: "qué tal" },
    ]);
  });
});

describe("transportFailure & clearError", () => {
  it("transportFailure drops the placeholder, records the error, ends streaming", () => {
    let state = beginTurn(INITIAL_CHAT_STATE, "hola");
    state = transportFailure(state, "stream failed: 500");
    expect(state.error).toBe("stream failed: 500");
    expect(state.messages).toEqual([{ role: "user", content: "hola" }]);
    expect(state.isStreaming).toBe(false);
  });

  it("clearError leaves messages and prdState alone", () => {
    const start: ChatState = {
      ...INITIAL_CHAT_STATE,
      error: "boom",
      messages: [{ role: "user", content: "x" }],
      prdState: SAMPLE_PRD,
    };
    const next = clearError(start);
    expect(next.error).toBeNull();
    expect(next.messages).toBe(start.messages);
    expect(next.prdState).toBe(start.prdState);
  });
});

describe("end-to-end: parser → reducer", () => {
  it("a raw SSE chunk of delta×3 + state + done updates the trailing message correctly", () => {
    let state = beginTurn(INITIAL_CHAT_STATE, "yoga app");
    const wire =
      'data: {"type":"delta","text":"Hola, "}\n\n' +
      'data: {"type":"delta","text":"¿qué "}\n\n' +
      'data: {"type":"delta","text":"tal?"}\n\n' +
      'data: {"type":"state","state":{"objective":"yoga","roles":["a"],"entities":[],"useCases":[],"notes":[]}}\n\n' +
      'data: {"type":"done"}\n\n';
    const { events, remainder } = parseSseChunk(wire);
    expect(remainder).toBe("");
    state = feed(state, events);

    const last = state.messages[state.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("Hola, ¿qué tal?");
    expect(last.status).toBe("complete");
    expect(state.prdState.objective).toBe("yoga");
    expect(state.isStreaming).toBe(false);
  });
});
