"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  IconBrandChrome,
  IconCheck,
  IconClipboard,
  IconExternalLink,
  IconInfoCircle,
  IconLoader2,
  IconPlayerStop,
  IconRefresh,
  IconAlertTriangle,
} from "@tabler/icons-react";

import { studioColors, studioFonts } from "@/lib/styles/studio-tokens";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────

type PreviewState =
  | { kind: "placeholder" }
  | { kind: "booting" }
  | { kind: "live"; url: string }
  | { kind: "error"; message: string };

interface PreviewPaneProps {
  workDir: string | null;
  generationId: string;
  generationStatus: string;
  livePreviewEnabled: boolean;
}

// ─── Component ────────────────────────────────────────────────────────

export function PreviewPane({
  workDir,
  generationId,
  generationStatus,
  livePreviewEnabled,
}: PreviewPaneProps) {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ kind: "placeholder" });
  const activeGenerationId = useRef<string | null>(null);

  const commands = `cd ${workDir ?? "<workDir>"}
pnpm install
pnpm prisma migrate dev
pnpm seed     # crea el admin demo
pnpm dev`;

  function handleCopy() {
    navigator.clipboard.writeText(commands).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Start preview when generation completes and live preview is enabled.
  useEffect(() => {
    if (!livePreviewEnabled) return;
    if (generationStatus !== "complete") return;
    if (!workDir) return;

    // Already live for this generation
    if (
      activeGenerationId.current === generationId &&
      (preview.kind === "live" || preview.kind === "booting")
    ) {
      return;
    }

    activeGenerationId.current = generationId;
    setPreview({ kind: "booting" });

    let cancelled = false;

    async function start() {
      try {
        const res = await fetch(`/api/preview/start/${generationId}`, {
          method: "POST",
        });
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            disabled?: boolean;
          };
          if (body.disabled) {
            setPreview({ kind: "placeholder" });
            return;
          }
          setPreview({
            kind: "error",
            message: body.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        const data = (await res.json()) as { url?: string; error?: string };
        if (cancelled) return;
        if (data.url) {
          setPreview({ kind: "live", url: data.url });
        } else {
          setPreview({ kind: "error", message: data.error ?? "no url returned" });
        }
      } catch (err) {
        if (cancelled) return;
        setPreview({
          kind: "error",
          message: err instanceof Error ? err.message : "fetch failed",
        });
      }
    }

    void start();

    return () => {
      cancelled = true;
    };
  }, [generationId, generationStatus, livePreviewEnabled, workDir, preview.kind]);

  // Stop preview on unmount or generation change.
  useEffect(() => {
    return () => {
      if (activeGenerationId.current) {
        void fetch(`/api/preview/stop/${activeGenerationId.current}`, {
          method: "POST",
        }).catch(() => undefined);
        activeGenerationId.current = null;
      }
    };
  }, [generationId]);

  function handleRetry() {
    activeGenerationId.current = null;
    setPreview({ kind: "placeholder" });
  }

  function handleStop() {
    void fetch(`/api/preview/stop/${generationId}`, { method: "POST" }).catch(
      () => undefined,
    );
    activeGenerationId.current = null;
    setPreview({ kind: "placeholder" });
  }

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-md border"
      style={{
        borderColor: studioColors.borderSubtle,
        background: studioColors.bgElevated,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: studioColors.borderSubtle }}
      >
        <div className="flex items-center gap-2">
          <IconBrandChrome size={14} style={{ color: studioColors.textSecondary }} />
          <span
            className="text-xs"
            style={{ color: studioColors.textPrimary, fontFamily: studioFonts.mono }}
          >
            {preview.kind === "live"
              ? `localhost:${new URL(preview.url).port}`
              : "Live preview"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {preview.kind === "booting" && (
            <span
              className="flex items-center gap-1 text-[10px]"
              style={{ color: studioColors.textMuted, fontFamily: studioFonts.mono }}
            >
              <IconLoader2 size={10} className="animate-spin" />
              arrancando…
            </span>
          )}
          {preview.kind === "live" && (
            <>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest"
                style={{
                  borderColor: "rgba(34, 197, 94, 0.45)",
                  color: "#22c55e",
                  fontFamily: studioFonts.mono,
                }}
              >
                live
              </span>
              <button
                onClick={handleStop}
                className="rounded p-0.5 hover:opacity-70"
                title="Detener preview"
              >
                <IconPlayerStop size={12} style={{ color: studioColors.textMuted }} />
              </button>
            </>
          )}
          {preview.kind === "error" && (
            <button
              onClick={handleRetry}
              className="rounded p-0.5 hover:opacity-70"
              title="Reintentar"
            >
              <IconRefresh size={12} style={{ color: studioColors.warning }} />
            </button>
          )}
          {(preview.kind === "placeholder" || preview.kind === "error") && (
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest"
              style={{
                borderColor: "rgba(245, 158, 11, 0.45)",
                color: studioColors.warning,
                fontFamily: studioFonts.mono,
              }}
            >
              {livePreviewEnabled ? "offline" : "deploy required"}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="relative flex-1 overflow-hidden">
        {/* ── Live iframe ── */}
        {preview.kind === "live" && (
          <iframe
            src={preview.url}
            className="h-full w-full border-none"
            title="Live preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}

        {/* ── Booting spinner ── */}
        {preview.kind === "booting" && (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <IconLoader2
                size={28}
                className="animate-spin"
                style={{ color: studioColors.accentPrimary }}
              />
              <span
                className="text-xs"
                style={{ color: studioColors.textMuted, fontFamily: studioFonts.mono }}
              >
                Arrancando app generada…
              </span>
              <span
                className="text-[11px]"
                style={{ color: studioColors.textMuted }}
              >
                pnpm dev — puede tardar hasta 60s
              </span>
            </div>
          </div>
        )}

        {/* ── Error state ── */}
        {preview.kind === "error" && (
          <div className="flex h-full items-center justify-center px-6">
            <div
              className="max-w-md rounded-lg border p-5"
              style={{
                borderColor: "rgba(239, 68, 68, 0.35)",
                background: `${studioColors.bg}cc`,
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <IconAlertTriangle size={15} style={{ color: "#ef4444" }} />
                <h3
                  className="text-sm font-medium"
                  style={{ color: studioColors.textPrimary }}
                >
                  Preview no disponible
                </h3>
              </div>
              <p
                className="mb-3 text-xs leading-relaxed"
                style={{ color: studioColors.textSecondary }}
              >
                {preview.message}
              </p>
              <p
                className="text-[11px]"
                style={{ color: studioColors.textMuted }}
              >
                La app está igualmente generada. Ejecutala localmente con los
                comandos del panel de comandos. Pulsa{" "}
                <IconRefresh
                  size={10}
                  className="inline"
                  style={{ color: studioColors.warning }}
                />{" "}
                para reintentar.
              </p>
            </div>
          </div>
        )}

        {/* ── Placeholder (default / no live preview) ── */}
        {preview.kind === "placeholder" && (
          <>
            {/* Animated wallpaper grid */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage: `linear-gradient(${studioColors.borderSubtle} 1px, transparent 1px), linear-gradient(90deg, ${studioColors.borderSubtle} 1px, transparent 1px)`,
                backgroundSize: "32px 32px",
                opacity: 0.25,
              }}
            />
            <motion.div
              aria-hidden
              className="absolute -inset-12"
              style={{
                background: `radial-gradient(closest-side, rgba(139, 92, 246, 0.18) 0%, transparent 70%)`,
                filter: "blur(20px)",
              }}
              animate={{ opacity: [0.4, 0.7, 0.4] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />

            <div className="relative flex h-full items-center justify-center px-6 py-8">
              <div
                className="max-w-md rounded-lg border p-6 backdrop-blur"
                style={{
                  borderColor: studioColors.borderSubtle,
                  background: `${studioColors.bg}cc`,
                }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <IconInfoCircle size={16} style={{ color: studioColors.accentPrimary }} />
                  <h3
                    className="text-sm font-medium"
                    style={{ color: studioColors.textPrimary }}
                  >
                    Tu app está lista
                  </h3>
                </div>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: studioColors.textSecondary }}
                >
                  El árbol de archivos a la izquierda es la app real, generada
                  por los 21 agentes de Atelier. Para arrancarla localmente:
                </p>
                <div className="relative mt-3">
                  <pre
                    className="overflow-x-auto rounded-md border px-3 py-2 text-[11px] leading-relaxed"
                    style={{
                      borderColor: studioColors.borderSubtle,
                      background: studioColors.bg,
                      color: studioColors.textPrimary,
                      fontFamily: studioFonts.mono,
                    }}
                  >
                    {commands}
                  </pre>
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={handleCopy}
                      style={{ fontFamily: studioFonts.mono }}
                    >
                      {copied ? (
                        <>
                          <IconCheck size={11} />
                          Copiado ✓
                        </>
                      ) : (
                        <>
                          <IconClipboard size={11} />
                          Copiar comandos
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <p
                  className="mt-3 text-[11px]"
                  style={{ color: studioColors.textMuted }}
                >
                  <span style={{ color: studioColors.warning }}>Preview live:</span>{" "}
                  {livePreviewEnabled
                    ? "habilitado — arrancará al completar la generación."
                    : "disponible al desplegar con ATELIER_LIVE_PREVIEW=true."}
                </p>
                {workDir ? (
                  <a
                    href={`/api/generate/${encodeURIComponent(workDir)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center gap-1.5 text-[11px] underline-offset-4 hover:underline"
                    style={{ color: studioColors.accentPrimary }}
                  >
                    <IconExternalLink size={11} />
                    Ver workDir crudo en disco
                  </a>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
