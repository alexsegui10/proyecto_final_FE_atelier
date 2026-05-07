"use client";

import { motion } from "motion/react";
import {
  IconBrandChrome,
  IconExternalLink,
  IconInfoCircle,
} from "@tabler/icons-react";

import { studioColors, studioFonts } from "@/lib/styles/studio-tokens";

/**
 * Preview pane — placeholder for the WebContainers live boot.
 *
 * The full-fat WebContainers integration (mount FS → pnpm install → prisma
 * migrate → pnpm dev → iframe) is non-trivial: SQLite adapter for the
 * skeleton, env shimming, port forwarding, error states. Per the
 * FINAL_STRETCH_PROMPT explicit fallback, we ship a polished placeholder
 * for the demo and document how to run the generated app locally — that
 * matches the "Demo en vivo disponible al desplegar" plan.
 */
export function PreviewPane({ workDir }: { workDir: string | null }) {
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
            Live preview
          </span>
        </div>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest"
          style={{
            borderColor: "rgba(245, 158, 11, 0.45)",
            color: studioColors.warning,
            fontFamily: studioFonts.mono,
          }}
        >
          deploy required
        </span>
      </div>

      {/* Centered placeholder */}
      <div className="relative flex-1">
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
                La app generada arranca al desplegar
              </h3>
            </div>
            <p
              className="text-xs leading-relaxed"
              style={{ color: studioColors.textSecondary }}
            >
              El árbol de archivos a la izquierda es la app real, generada por los
              6 agentes de Atelier en tiempo real. Para arrancarla:
            </p>
            <pre
              className="mt-3 overflow-x-auto rounded-md border px-3 py-2 text-[11px] leading-relaxed"
              style={{
                borderColor: studioColors.borderSubtle,
                background: studioColors.bg,
                color: studioColors.textPrimary,
                fontFamily: studioFonts.mono,
              }}
            >
{`cd ${workDir ?? "<workDir>"}
pnpm install
pnpm prisma migrate dev
pnpm seed     # crea el admin demo
pnpm dev`}
            </pre>
            <p
              className="mt-3 text-[11px]"
              style={{ color: studioColors.textMuted }}
            >
              <span style={{ color: studioColors.warning }}>Phase 4 roadmap:</span>{" "}
              embedded WebContainers boot con SQLite — hoy diferido por restricciones de tamaño del
              skeleton y compatibilidad de adaptadores Prisma 7 con WebContainers.
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
      </div>
    </div>
  );
}
