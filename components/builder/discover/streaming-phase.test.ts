import { describe, it, expect } from "vitest";

import { streamingPhase } from "./streaming-phase";

describe("streamingPhase", () => {
  it("returns 'idle' when nothing is in flight", () => {
    expect(streamingPhase(null, "")).toBe("idle");
    // Idle wins even if there is text from a prior turn — the streaming arg
    // is the source of truth for whether the bubble should render at all.
    expect(streamingPhase(null, "hola, ya pasó")).toBe("idle");
  });

  it("returns 'thinking' between submit and the first visible delta", () => {
    expect(streamingPhase({ raw: "" }, "")).toBe("thinking");
  });

  it("stays in 'thinking' while the agent writes the hidden JSON state block", () => {
    // The agent is mid-stream but only the JSON has arrived — the chat
    // hides that block, so visibleText is still empty.
    const raw = '```json\n{ "objective": "yoga"';
    expect(streamingPhase({ raw }, "")).toBe("thinking");
  });

  it("treats whitespace-only visible text as still thinking", () => {
    expect(streamingPhase({ raw: "  \n\t" }, "  \n\t")).toBe("thinking");
  });

  it("flips to 'streaming' on the first non-whitespace visible character", () => {
    expect(streamingPhase({ raw: "Hola" }, "Hola")).toBe("streaming");
    expect(
      streamingPhase(
        { raw: '```json\n{}\n```\n\nHola, ¿qué' },
        "Hola, ¿qué",
      ),
    ).toBe("streaming");
  });
});
