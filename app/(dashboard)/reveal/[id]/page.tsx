export default async function RevealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  return (
    <main className="h-[calc(100dvh-3.5rem)] w-full">
      <div className="grid h-full grid-rows-[auto_1fr]">
        <div className="border-b border-zinc-900/80 bg-zinc-950 px-6 py-4">
          <p className="text-xs uppercase tracking-widest text-zinc-500">Phase 4 (coming)</p>
          <h1 className="mt-1 text-lg font-semibold text-zinc-100">Reveal</h1>
        </div>
        <div className="grid grid-cols-2 divide-x divide-zinc-900/80">
          <section className="bg-zinc-950/50 p-6 text-zinc-500">
            <p className="text-xs uppercase tracking-widest text-zinc-600">Code viewer</p>
            <p className="mt-2 text-sm">Monaco editor will render the generated files here.</p>
          </section>
          <section className="bg-zinc-950/30 p-6 text-zinc-500">
            <p className="text-xs uppercase tracking-widest text-zinc-600">Live preview</p>
            <p className="mt-2 text-sm">WebContainers will boot the generated app here.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
