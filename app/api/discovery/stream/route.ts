import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { runDiscoveryAgent } from "@/lib/agents/runner";
import type { ChatMessage, DiscoveryEvent } from "@/lib/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  messages: ChatMessage[];
};

function isValidMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as { role?: unknown; content?: unknown };
  return (
    (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
  );
}

function parseBody(payload: unknown): RequestBody | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { messages?: unknown };
  if (!Array.isArray(body.messages)) return null;
  if (!body.messages.every(isValidMessage)) return null;
  return { messages: body.messages };
}

function encodeSse(event: DiscoveryEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const body = parseBody(payload);
  if (!body) {
    return new Response("Invalid body", { status: 400 });
  }

  const debug = process.env.DEBUG_DISCOVERY === "1";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const aborted = request.signal;
      try {
        for await (const event of runDiscoveryAgent(body.messages)) {
          if (aborted.aborted) break;
          if (debug) console.log("[SSE-OUT]", JSON.stringify(event));
          controller.enqueue(encodeSse(event));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "discovery runner crashed";
        if (debug) console.log("[SSE-OUT]", JSON.stringify({ type: "error", message }));
        controller.enqueue(encodeSse({ type: "error", message }));
        controller.enqueue(encodeSse({ type: "done" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
