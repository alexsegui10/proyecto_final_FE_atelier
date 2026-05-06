import { describe, it, expect } from "vitest";

import { parseSseChunk } from "./sse-parser";

describe("parseSseChunk", () => {
  it("extracts a single event terminated by \\n\\n", () => {
    const { events, remainder } = parseSseChunk(
      'data: {"type":"delta","text":"hi"}\n\n',
    );
    expect(events).toEqual([{ type: "delta", text: "hi" }]);
    expect(remainder).toBe("");
  });

  it("extracts multiple events from a single chunk", () => {
    const buf =
      'data: {"type":"delta","text":"a"}\n\n' +
      'data: {"type":"delta","text":"b"}\n\n' +
      'data: {"type":"delta","text":"c"}\n\n';
    const { events, remainder } = parseSseChunk(buf);
    expect(events).toHaveLength(3);
    expect(events.map((e) => (e.type === "delta" ? e.text : ""))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(remainder).toBe("");
  });

  it("returns an unfinished trailing event in the remainder", () => {
    const { events, remainder } = parseSseChunk(
      'data: {"type":"delta","text":"a"}\n\ndata: {"type":"de',
    );
    expect(events).toHaveLength(1);
    expect(remainder).toBe('data: {"type":"de');
  });

  it("silently drops malformed JSON without halting the stream", () => {
    const buf =
      "data: {nope}\n\n" + 'data: {"type":"done"}\n\n';
    const { events } = parseSseChunk(buf);
    expect(events).toEqual([{ type: "done" }]);
  });

  it('accepts "data:" with no leading space', () => {
    const { events } = parseSseChunk('data:{"type":"delta","text":"x"}\n\n');
    expect(events).toEqual([{ type: "delta", text: "x" }]);
  });

  it("accepts \\r\\n\\r\\n as the event separator", () => {
    const { events, remainder } = parseSseChunk(
      'data: {"type":"delta","text":"win"}\r\n\r\n',
    );
    expect(events).toEqual([{ type: "delta", text: "win" }]);
    expect(remainder).toBe("");
  });

  it("ignores comment lines and non-data fields", () => {
    const buf =
      ": keep-alive ping\n" +
      'event: discovery\n' +
      'id: 1\n' +
      'data: {"type":"done"}\n\n';
    const { events } = parseSseChunk(buf);
    expect(events).toEqual([{ type: "done" }]);
  });

  it("returns an empty result when the buffer has no event boundary yet", () => {
    const { events, remainder } = parseSseChunk('data: {"type":"');
    expect(events).toEqual([]);
    expect(remainder).toBe('data: {"type":"');
  });
});
