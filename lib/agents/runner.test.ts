import { describe, it, expect } from "vitest";

import { parseClaudeTextStream } from "./runner";
import type { DiscoveryEvent } from "./types";

async function* fromArray(parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function collect(stream: AsyncGenerator<DiscoveryEvent>): Promise<DiscoveryEvent[]> {
  const out: DiscoveryEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe("parseClaudeTextStream", () => {
  it("emits one delta per non-empty stdout chunk, in order", async () => {
    const events = await collect(
      parseClaudeTextStream(fromArray(["Hola, ", "¿qué ", "tal?"])),
    );
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.map((e) => (e.type === "delta" ? e.text : ""))).toEqual([
      "Hola, ",
      "¿qué ",
      "tal?",
    ]);
  });

  it("strips ANSI escape sequences from chunks before yielding", async () => {
    const events = await collect(
      parseClaudeTextStream(fromArray(["[33mhola[0m"])),
    );
    expect(events).toEqual([{ type: "delta", text: "hola" }]);
  });

  it("skips empty chunks without yielding a delta", async () => {
    const events = await collect(parseClaudeTextStream(fromArray(["", "ok", ""])));
    expect(events.filter((e) => e.type === "delta")).toHaveLength(1);
  });

  it("emits a state event the first time the JSON state block closes and parses", async () => {
    // Simulating the agent writing the JSON block over multiple chunks before
    // any prose lands.
    const chunks = [
      "```json\n{",
      '"objective":"yoga app",',
      '"roles":["admin","alumno"],',
      '"entities":[{"name":"User","fields":["email"]}],',
      '"useCases":["u1"],"notes":[]',
      "}\n```\n\n",
      "Hola.",
    ];
    const events = await collect(parseClaudeTextStream(fromArray(chunks)));
    const states = events.filter((e) => e.type === "state");
    expect(states).toHaveLength(1);
    if (states[0]?.type === "state") {
      expect(states[0].state.objective).toBe("yoga app");
      expect(states[0].state.roles).toEqual(["admin", "alumno"]);
    }
    // 7 deltas, 1 state
    expect(events.filter((e) => e.type === "delta")).toHaveLength(7);
  });

  it("does NOT emit state while the JSON block is still incomplete", async () => {
    const events = await collect(
      parseClaudeTextStream(
        fromArray(['```json\n{"objective":"yoga"', "...still typing..."]),
      ),
    );
    expect(events.some((e) => e.type === "state")).toBe(false);
  });

  it("ignores malformed JSON inside the block (no state event, stream keeps flowing)", async () => {
    const events = await collect(
      parseClaudeTextStream(fromArray(["```json\n{nope}\n```\n\nHola"])),
    );
    expect(events.some((e) => e.type === "state")).toBe(false);
    expect(events.filter((e) => e.type === "delta")).toHaveLength(1);
  });

  it("emits ready exactly once after READY_TO_BUILD lands AND a state was emitted", async () => {
    const finalState = JSON.stringify({
      objective: "yoga",
      roles: ["admin", "alumno"],
      entities: [
        { name: "User", fields: [] },
        { name: "Class", fields: [] },
        { name: "Booking", fields: [] },
      ],
      useCases: ["u1", "u2", "u3", "u4", "u5", "u6"],
      notes: [],
    });
    const chunks = [
      "```json\n",
      finalState,
      "\n```\n\n",
      "Recap breve.\n\n",
      "READY_TO_BUILD\n",
      "more text",
    ];
    const events = await collect(parseClaudeTextStream(fromArray(chunks)));
    const readys = events.filter((e) => e.type === "ready");
    expect(readys).toHaveLength(1);
    if (readys[0]?.type === "ready") {
      expect(readys[0].state.entities).toHaveLength(3);
      expect(readys[0].state.useCases).toHaveLength(6);
    }
  });

  it("does NOT emit ready when READY_TO_BUILD is glued to other words", async () => {
    const events = await collect(
      parseClaudeTextStream(
        fromArray([
          '```json\n{"objective":"x","roles":["a"],"entities":[],"useCases":[],"notes":[]}\n```\n\n',
          "estoy READY_TO_BUILD-ish todavía",
        ]),
      ),
    );
    expect(events.some((e) => e.type === "ready")).toBe(false);
  });

  it("end-to-end: a realistic agent turn produces the expected event sequence", async () => {
    // Closely mirrors what the real agent should produce on the FIRST turn.
    const chunks = [
      "```json\n",
      '{\n  "objective": "App de gestión de clases de yoga",\n',
      '  "roles": ["admin", "profesor", "alumno"],\n',
      '  "entities": [],\n',
      '  "useCases": [],\n',
      '  "notes": []\n}',
      "\n```\n\n",
      "Vale, ",
      "tres roles claros. ",
      "Para empezar, ",
      "¿el alumno reserva con cupo limitado o son sesiones a demanda?",
    ];
    const events = await collect(parseClaudeTextStream(fromArray(chunks)));

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "delta")).toHaveLength(11);
    expect(types.filter((t) => t === "state")).toHaveLength(1);
    expect(types.filter((t) => t === "ready")).toHaveLength(0);

    const concatenated = events
      .filter((e): e is Extract<DiscoveryEvent, { type: "delta" }> => e.type === "delta")
      .map((e) => e.text)
      .join("");
    expect(concatenated).toContain("App de gestión de clases de yoga");
    expect(concatenated).toContain("¿el alumno reserva con cupo limitado");
  });
});
