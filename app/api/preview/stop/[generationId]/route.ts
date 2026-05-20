/**
 * POST|DELETE /api/preview/stop/[generationId]
 *
 * Kills the preview subprocess for a generation and removes it from the
 * registry. Safe to call if there is no running preview — returns 204.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { prisma } from "@/lib/db/client";
import { killProcess, registry } from "@/lib/preview/subprocess-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(
  _request: NextRequest,
  { params }: { params: Promise<{ generationId: string }> },
) {
  const { generationId } = await params;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Auth check (lightweight — just confirm ownership)
  const generation = await prisma.generation.findUnique({
    where: { id: generationId },
    include: { project: { select: { userId: true } } },
  });
  if (!generation) {
    return new NextResponse(null, { status: 204 });
  }
  if (generation.project.userId !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const entry = registry.get(generationId);
  if (entry) {
    await killProcess(entry.process);
    registry.delete(generationId);
  }

  return new NextResponse(null, { status: 204 });
}

export const POST = handle;
export const DELETE = handle;
