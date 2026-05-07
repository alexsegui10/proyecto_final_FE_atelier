/**
 * Skeleton placeholder. The Pages & Routing agent replaces this with the
 * actual landing built from screens-map.json. Kept as a thin component
 * so `pnpm typecheck` is green even before any agent runs.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-muted-foreground text-xs tracking-widest uppercase">
        atelier · skeleton v2
      </p>
      <h1 className="font-display text-3xl font-semibold">{"{{APP_NAME}}"}</h1>
      <p className="text-muted-foreground max-w-md">{"{{DESCRIPTION}}"}</p>
    </main>
  );
}
