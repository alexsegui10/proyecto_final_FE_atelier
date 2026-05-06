import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { IconAlertTriangle, IconCheck, IconFile } from "@tabler/icons-react";

import { prisma } from "@/lib/db/client";

type FileEvent = {
  agent: string;
  path: string;
  lines: number;
};

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
    include: {
      project: { select: { userId: true, name: true } },
    },
  });
  if (!generation || generation.project.userId !== userId) {
    notFound();
  }

  const fileEvents = await prisma.event.findMany({
    where: { generationId: id, type: "agent.file_created" },
    orderBy: { ts: "asc" },
  });
  const files: FileEvent[] = fileEvents
    .map((e) => {
      const p = e.payload as { agent?: string; path?: string; lines?: number };
      if (typeof p?.path !== "string" || typeof p?.agent !== "string") return null;
      return { agent: p.agent, path: p.path, lines: typeof p.lines === "number" ? p.lines : 0 };
    })
    .filter((f): f is FileEvent => f !== null);

  // QA report from the last `agent.completed` event for the qa-reviewer agent,
  // OR from the artifact JSON via Generation.result if we persisted it there.
  // Simplest: read from the in-memory artifact if we stored it.
  // (The agent writes .atelier/qa-reviewer.json in workDir — but workDir may be
  // gone. The QA report's `summary` is in Generation.result.)
  const generationResult = generation.result as
    | { summary?: string; decision?: string; workDir?: string }
    | null
    | undefined;

  const qaCompleted = await prisma.event.findFirst({
    where: { generationId: id, type: "agent.completed" },
    orderBy: { ts: "desc" },
  });
  const qaPayload = qaCompleted?.payload as { agent?: string; summary?: string } | null;
  const qaSummary = qaPayload?.agent === "qa-reviewer" ? qaPayload.summary : undefined;

  const decision = generationResult?.decision ?? null;
  const isGo = decision === "go";

  return (
    <main className="min-h-[calc(100dvh-3.5rem)] w-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="flex items-baseline justify-between border-b border-zinc-900/80 pb-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-zinc-500">Reveal</p>
            <h1 className="mt-1 text-2xl font-semibold">{generation.project.name}</h1>
            <p className="mt-1 text-xs text-zinc-500 font-mono">generation {id}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs uppercase tracking-widest ${
                isGo
                  ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-300"
                  : decision === "no-go"
                    ? "border-red-800/60 bg-red-950/40 text-red-300"
                    : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
              }`}
            >
              {isGo ? <IconCheck size={12} /> : <IconAlertTriangle size={12} />}
              {decision ? decision.toUpperCase() : generation.status.toUpperCase()}
            </span>
          </div>
        </header>

        <section className="mt-6 grid gap-6 md:grid-cols-[2fr_1fr]">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">
              Archivos generados ({files.length})
            </h2>
            {files.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">
                No se registraron archivos en esta generación.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-900/60 rounded-md border border-zinc-900/60 bg-zinc-950/30">
                {files.map((f, idx) => (
                  <li key={`${f.path}-${idx}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <IconFile size={14} className="text-zinc-500 shrink-0" />
                    <span className="font-mono text-xs text-zinc-300 truncate">{f.path}</span>
                    <span className="ml-auto rounded bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-500">
                      {f.lines}L
                    </span>
                    <span className="rounded bg-violet-950/40 px-2 py-0.5 font-mono text-[10px] text-violet-300">
                      {f.agent}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="flex flex-col gap-4">
            <section className="rounded-md border border-zinc-900/60 bg-zinc-950/30 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                QA report
              </h3>
              <p className="mt-2 text-sm text-zinc-300">
                {generationResult?.summary ?? qaSummary ?? "Sin reporte QA disponible."}
              </p>
            </section>

            <section className="rounded-md border border-zinc-900/60 bg-zinc-950/30 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
                Descargar
              </h3>
              <p className="mt-2 text-xs text-zinc-500">
                Phase 4: Monaco viewer + WebContainers preview + download zip. Por ahora la
                lista de archivos está arriba; el workDir crudo está en{" "}
                <span className="font-mono text-zinc-300">
                  {generationResult?.workDir ?? "(no registrado)"}
                </span>
                .
              </p>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
