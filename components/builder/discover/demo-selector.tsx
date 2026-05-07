"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlayerPlayFilled, IconLoader2 } from "@tabler/icons-react";

import { studioColors, studioFonts } from "@/lib/styles/studio-tokens";

type Demo = {
  slug: string;
  label: string;
  description: string;
  available: boolean;
};

export function DemoSelector() {
  const router = useRouter();
  const [demos, setDemos] = useState<Demo[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    fetch("/api/demos")
      .then((r) => r.json() as Promise<{ demos: Demo[] }>)
      .then((data) => {
        if (!aborted) setDemos(data.demos);
      })
      .catch(() => undefined);
    return () => {
      aborted = true;
    };
  }, []);

  if (!demos || demos.length === 0) return null;
  const available = demos.filter((d) => d.available);
  if (available.length === 0) return null;

  async function handlePlay(slug: string) {
    if (playing) return;
    setPlaying(slug);
    setError(null);
    try {
      const r = await fetch(`/api/demos/${slug}/play?speed=6`, {
        method: "POST",
      });
      if (!r.ok) throw new Error(`replay failed: ${r.status}`);
      const data = (await r.json()) as { generationId: string };
      router.push(`/studio/${data.generationId}`);
    } catch (err) {
      setError((err as Error).message);
      setPlaying(null);
    }
  }

  return (
    <div className="border-b border-zinc-900/60 bg-zinc-950/40 px-6 py-3">
      <div className="mx-auto flex max-w-2xl items-center gap-3">
        <span
          className="text-[10px] uppercase tracking-widest"
          style={{ color: studioColors.textMuted, fontFamily: studioFonts.mono }}
        >
          O elige una demo:
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {demos.map((demo) => (
            <button
              key={demo.slug}
              type="button"
              disabled={!demo.available || playing !== null}
              onClick={() => void handlePlay(demo.slug)}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: demo.available
                  ? "rgba(139, 92, 246, 0.5)"
                  : studioColors.borderSubtle,
                color: demo.available
                  ? studioColors.textPrimary
                  : studioColors.textMuted,
                background: demo.available ? "rgba(139, 92, 246, 0.08)" : "transparent",
              }}
              title={demo.description}
            >
              {playing === demo.slug ? (
                <IconLoader2 size={11} className="animate-spin" />
              ) : (
                <IconPlayerPlayFilled size={11} />
              )}
              {demo.label}
              {!demo.available ? (
                <span
                  className="ml-1 text-[9px] uppercase"
                  style={{ color: studioColors.textMuted }}
                >
                  pendiente
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {error ? (
          <span className="text-[11px] text-red-400">{error}</span>
        ) : null}
      </div>
    </div>
  );
}
