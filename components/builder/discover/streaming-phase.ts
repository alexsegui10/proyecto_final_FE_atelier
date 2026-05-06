/**
 * Decides how the assistant turn should render at any given moment:
 * - `idle`: nothing to show — the chat is between turns
 * - `thinking`: the SSE stream is open but no visible prose has arrived yet
 *   (the agent might be writing the JSON state block, which the chat hides)
 * - `streaming`: the agent is writing prose into the bubble — show the
 *   text plus a blinking cursor
 *
 * Pure function so the chat-presentation logic can be tested without
 * mounting React or simulating SSE.
 */
export type StreamingPhase = "idle" | "thinking" | "streaming";

export function streamingPhase(
  streaming: { raw: string } | null,
  visibleText: string,
): StreamingPhase {
  if (streaming === null) return "idle";
  if (visibleText.trim().length === 0) return "thinking";
  return "streaming";
}

/**
 * Strip the agent's first ```json``` state block from a message so only the
 * conversational prose is shown in chat. The state block is rendered
 * separately in the live PRD card.
 *
 * Edge cases:
 * - No ```json fence at all → returns the input unchanged.
 * - ```json fence opened but not yet closed (mid-stream) → returns "" so the
 *   bubble stays in "thinking" instead of flashing a partial JSON dump.
 */
export function visibleProse(text: string): string {
  if (!text.includes("```json")) return text;
  const closing = text.match(/```json[\s\S]*?```/);
  if (!closing) return "";
  const idx = text.indexOf(closing[0]) + closing[0].length;
  return text.slice(idx).replace(/READY_TO_BUILD/g, "").trim();
}
