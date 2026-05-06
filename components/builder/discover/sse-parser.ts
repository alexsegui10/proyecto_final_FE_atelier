import type { DiscoveryEvent } from "@/lib/agents/types";

export type SseParseResult = {
  events: DiscoveryEvent[];
  /** Bytes that haven't completed an event yet — feed back in on the next read. */
  remainder: string;
};

/**
 * Parse a chunk of SSE bytes into discovery events plus the trailing
 * incomplete-event remainder.
 *
 * Designed to be called repeatedly on a growing buffer:
 *   buffer += decode(chunk);
 *   const { events, remainder } = parseSseChunk(buffer);
 *   buffer = remainder;
 *
 * Tolerant of:
 * - `\n\n` and `\r\n\r\n` event separators
 * - `data:` with or without a leading space (per SSE spec)
 * - Malformed JSON payloads (silently dropped — the rest of the stream
 *   keeps flowing)
 *
 * Note: comments (lines starting with `:`) and other SSE field names like
 * `event:` or `id:` are ignored. We only consume `data:` lines.
 */
export function parseSseChunk(buffer: string): SseParseResult {
  const events: DiscoveryEvent[] = [];
  let remainder = buffer;

  while (true) {
    const lfIdx = remainder.indexOf("\n\n");
    const crlfIdx = remainder.indexOf("\r\n\r\n");

    let eventEnd = -1;
    let separatorLength = 0;
    if (lfIdx !== -1 && (crlfIdx === -1 || lfIdx < crlfIdx)) {
      eventEnd = lfIdx;
      separatorLength = 2;
    } else if (crlfIdx !== -1) {
      eventEnd = crlfIdx;
      separatorLength = 4;
    } else {
      break;
    }

    const rawEvent = remainder.slice(0, eventEnd);
    remainder = remainder.slice(eventEnd + separatorLength);

    const dataLines = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"));
    if (dataLines.length === 0) continue;

    // SSE allows multiple data: lines per event, joined with a literal newline.
    const payload = dataLines
      .map((line) => (line.startsWith("data: ") ? line.slice(6) : line.slice(5)))
      .join("\n");

    try {
      events.push(JSON.parse(payload) as DiscoveryEvent);
    } catch {
      // Drop malformed payloads — keep the stream going for the well-formed ones.
    }
  }

  return { events, remainder };
}
