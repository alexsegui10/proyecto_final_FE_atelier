import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EventRow = { id: string; type: string; payload: unknown; ts: Date };

function encode(event: EventRow): Uint8Array {
  return new TextEncoder().encode(
    `id: ${event.id}\ndata: ${JSON.stringify({ type: event.type, payload: event.payload, ts: event.ts.toISOString() })}\n\n`,
  );
}

const TERMINAL_EVENT_TYPES = new Set(["generation.completed", "generation.failed"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id: generationId } = await params;

  const generation = await prisma.generation.findUnique({
    where: { id: generationId },
    include: { project: { select: { userId: true } } },
  });
  if (!generation) {
    return new Response("Not found", { status: 404 });
  }
  if (generation.project.userId !== userId) {
    return new Response("Forbidden", { status: 403 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const aborted = request.signal;
      let lastEventDate: Date | null = null;
      let terminated = false;

      // Replay all events that have happened so far so a refresh / reconnect
      // shows the full timeline.
      const initial = await prisma.event.findMany({
        where: { generationId },
        orderBy: { ts: "asc" },
      });
      for (const ev of initial) {
        controller.enqueue(encode(ev as EventRow));
        lastEventDate = ev.ts;
        if (TERMINAL_EVENT_TYPES.has(ev.type)) {
          terminated = true;
        }
      }

      // Long-poll the Event table for new rows. Could be replaced by Postgres
      // LISTEN/NOTIFY later — Phase 3+ task.
      const POLL_MS = 250;
      while (!terminated && !aborted.aborted) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (aborted.aborted) break;

        const fresh = await prisma.event.findMany({
          where: lastEventDate
            ? { generationId, ts: { gt: lastEventDate } }
            : { generationId },
          orderBy: { ts: "asc" },
        });
        for (const ev of fresh) {
          controller.enqueue(encode(ev as EventRow));
          lastEventDate = ev.ts;
          if (TERMINAL_EVENT_TYPES.has(ev.type)) {
            terminated = true;
            break;
          }
        }
      }

      controller.close();
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
