import { describe, it, expect } from "vitest";

import { runDiscoveryAgentFake } from "./runner-fake";
import type { DiscoveryEvent } from "./types";

async function collect(stream: AsyncGenerator<DiscoveryEvent>): Promise<DiscoveryEvent[]> {
  const out: DiscoveryEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

describe("runDiscoveryAgentFake", () => {
  it("greets on the first turn (no user messages)", async () => {
    const events = await collect(runDiscoveryAgentFake([]));
    const types = events.map((e) => e.type);
    expect(types).toContain("delta");
    expect(types[types.length - 1]).toBe("done");
  });

  it("emits a state event after the first user turn", async () => {
    const events = await collect(
      runDiscoveryAgentFake([{ role: "user", content: "yoga app con admin profe alumno" }]),
    );
    const stateEvents = events.filter((e) => e.type === "state");
    expect(stateEvents.length).toBeGreaterThan(0);
    if (stateEvents[0]?.type === "state") {
      expect(stateEvents[0].state.roles).toContain("admin");
    }
  });

  it("emits ready after enough turns", async () => {
    const turns = [
      { role: "user" as const, content: "yoga app" },
      { role: "assistant" as const, content: "..." },
      { role: "user" as const, content: "cupo limitado, cancela 2h antes" },
      { role: "assistant" as const, content: "..." },
      { role: "user" as const, content: "membresías mensuales o trimestrales" },
    ];
    const events = await collect(runDiscoveryAgentFake(turns));
    const ready = events.find((e) => e.type === "ready");
    expect(ready).toBeDefined();
    if (ready?.type === "ready") {
      expect(ready.state.entities.length).toBeGreaterThanOrEqual(3);
      expect(ready.state.useCases.length).toBeGreaterThanOrEqual(6);
    }
  });
});
