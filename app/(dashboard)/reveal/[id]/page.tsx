import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { prisma } from "@/lib/db/client";

import { MonacoPane } from "@/components/builder/reveal/monaco-pane";
import { PreviewPane } from "@/components/builder/reveal/preview-pane";
import { SummaryCard } from "@/components/builder/reveal/summary-card";
import { studioColors } from "@/lib/styles/studio-tokens";

export default async function RevealPage({
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

  const result = generation.result as
    | {
        workDir?: string;
        durationMs?: number;
        filesCreated?: number;
        summary?: string;
        decision?: string;
      }
    | null;

  // Pull file + test counts from Event log so we don't depend on result.filesCreated
  // being the latest snapshot.
  const fileEvents = await prisma.event.findMany({
    where: { generationId: id, type: "agent.file_created" },
    select: { payload: true },
  });
  let testCount = 0;
  for (const e of fileEvents) {
    const p = e.payload as { path?: string };
    if (typeof p?.path === "string" && (/\.test\.[tj]sx?$/.test(p.path) || /(^|[\\/])tests?[\\/]/.test(p.path))) {
      testCount += 1;
    }
  }

  // Fix-round count from events.
  const fixRoundEvents = await prisma.event.findMany({
    where: { generationId: id, type: "qa.fix_round" },
    select: { payload: true },
  });
  const fixRounds = fixRoundEvents.length;

  const decision: "go" | "no-go" | "pending" =
    result?.decision === "go"
      ? "go"
      : result?.decision === "no-go"
        ? "no-go"
        : generation.status === "complete"
          ? "go"
          : generation.status === "failed"
            ? "no-go"
            : "pending";

  return (
    <main
      className="h-[calc(100dvh-3.5rem)] w-full"
      style={{ background: studioColors.bg, color: studioColors.textPrimary }}
    >
      <div className="grid h-full grid-cols-[40%_40%_20%] gap-3 p-3">
        <MonacoPane generationId={id} />
        <PreviewPane
          workDir={result?.workDir ?? null}
          generationId={id}
          generationStatus={generation.status}
          livePreviewEnabled={process.env.ATELIER_LIVE_PREVIEW === "true"}
        />
        <SummaryCard
          generationId={id}
          decision={decision}
          summary={result?.summary ?? "Sin reporte QA disponible."}
          durationMs={result?.durationMs ?? null}
          fileCount={fileEvents.length}
          testCount={testCount}
          fixRounds={fixRounds}
          demoCredentials={{
            email: "admin@demo.atelier",
            password: "demo1234",
          }}
        />
      </div>
    </main>
  );
}
