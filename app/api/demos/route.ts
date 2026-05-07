import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export type DemoEntry = {
  slug: string;
  label: string;
  description: string;
  available: boolean;
  totalDurationMs: number | null;
  filesGenerated: number | null;
};

function demoRoot(): string {
  return join(process.cwd(), "out", "demo-cache");
}

const DEMOS: Array<{ slug: string; label: string }> = [
  { slug: "yoga", label: "Estudio de yoga" },
  { slug: "tutorias", label: "Tutorías académicas" },
];

export async function GET() {
  const root = demoRoot();
  const entries: DemoEntry[] = [];
  for (const d of DEMOS) {
    const eventsPath = join(root, d.slug, "events.json");
    if (existsSync(eventsPath)) {
      try {
        const raw = await readFile(eventsPath, "utf-8");
        const data = JSON.parse(raw) as {
          summary?: string;
          totalDurationMs?: number;
          filesGenerated?: number;
        };
        entries.push({
          slug: d.slug,
          label: d.label,
          description: data.summary ?? "",
          available: true,
          totalDurationMs: data.totalDurationMs ?? null,
          filesGenerated: data.filesGenerated ?? null,
        });
        continue;
      } catch {
        /* fall through to unavailable */
      }
    }
    entries.push({
      slug: d.slug,
      label: d.label,
      description: "Pendiente de generar — corré pnpm agents:test con la fixture.",
      available: false,
      totalDurationMs: null,
      filesGenerated: null,
    });
  }
  return NextResponse.json({ demos: entries });
}
