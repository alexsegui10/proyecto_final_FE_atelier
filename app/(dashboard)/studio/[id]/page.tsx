import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { prisma } from "@/lib/db/client";

import { StudioCanvas } from "./studio-canvas";

export default async function StudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) {
    notFound();
  }

  const generation = await prisma.generation.findUnique({
    where: { id },
    include: { project: { select: { userId: true, name: true } } },
  });
  if (!generation || generation.project.userId !== userId) {
    notFound();
  }

  return <StudioCanvas generationId={id} />;
}
