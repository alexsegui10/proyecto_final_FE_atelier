"use client";

import { useState } from "react";
import {
  IconCheck,
  IconCopy,
  IconAlertTriangle,
  IconDownload,
  IconRefresh,
} from "@tabler/icons-react";

import { studioColors, studioFonts } from "@/lib/styles/studio-tokens";

type Decision = "go" | "no-go" | "pending";

export type SummaryCardProps = {
  generationId: string;
  decision: Decision;
  summary: string;
  durationMs: number | null;
  fileCount: number;
  testCount: number;
  fixRounds: number;
  demoCredentials?: { email: string; password: string };
};

function CredentialRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 rounded-sm border px-2 py-1.5"
      style={{ borderColor: studioColors.borderSubtle, background: studioColors.bg }}
    >
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-widest"
          style={{ color: studioColors.textMuted, fontFamily: studioFonts.mono }}
        >
          {label}
        </div>
        <div className="truncate text-[12px]"
          style={{ color: studioColors.textPrimary, fontFamily: studioFonts.mono }}
        >
          {value}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
        className="shrink-0 rounded-sm p-1 transition-colors hover:bg-zinc-800"
        title="Copiar"
      >
        {copied ? (
          <IconCheck size={12} style={{ color: studioColors.success }} />
        ) : (
          <IconCopy size={12} style={{ color: studioColors.textSecondary }} />
        )}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest"
        style={{ color: studioColors.textMuted, fontFamily: studioFonts.mono }}
      >
        {label}
      </span>
      <span className="mt-0.5 tabular-nums"
        style={{
          color: studioColors.textPrimary,
          fontFamily: studioFonts.mono,
          fontSize: 16,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function SummaryCard({
  generationId,
  decision,
  summary,
  durationMs,
  fileCount,
  testCount,
  fixRounds,
  demoCredentials,
}: SummaryCardProps) {
  const decisionColor =
    decision === "go"
      ? studioColors.success
      : decision === "no-go"
        ? studioColors.error
        : studioColors.warning;

  return (
    <aside
      className="flex h-full flex-col gap-4 overflow-y-auto rounded-md border p-4"
      style={{ borderColor: studioColors.borderSubtle, background: studioColors.bgElevated }}
    >
      {/* Decision badge */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest"
          style={{ color: studioColors.textMuted, fontFamily: studioFonts.mono }}
        >
          Reveal
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em]"
          style={{ borderColor: decisionColor, color: decisionColor, fontFamily: studioFonts.mono }}
        >
          {decision === "go" ? <IconCheck size={11} /> : <IconAlertTriangle size={11} />}
          {decision}
        </span>
      </div>

      {/* Summary */}
      <p className="text-[12px] leading-relaxed" style={{ color: studioColors.textSecondary }}>
        {summary || "Sin reporte QA disponible."}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-3">
        <Stat label="Archivos" value={fileCount.toString()} />
        <Stat label="Tests" value={testCount.toString()} />
        <Stat label="Tiempo" value={fmtDuration(durationMs)} />
        <Stat label="Fix rounds" value={fixRounds.toString()} />
      </div>

      {/* Demo credentials */}
      {demoCredentials ? (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest"
            style={{ color: studioColors.textMuted, fontFamily: studioFonts.mono }}
          >
            Credenciales demo
          </div>
          <CredentialRow label="email" value={demoCredentials.email} />
          <CredentialRow label="password" value={demoCredentials.password} />
        </div>
      ) : null}

      {/* Actions */}
      <div className="mt-auto flex flex-col gap-2 border-t pt-3" style={{ borderColor: studioColors.borderSubtle }}>
        <a
          href={`/api/generate/${generationId}/files`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors"
          style={{
            borderColor: studioColors.borderSubtle,
            color: studioColors.textPrimary,
          }}
        >
          <IconDownload size={12} />
          Ver árbol completo (JSON)
        </a>
        <a
          href="/discover"
          className="inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-white"
          style={{ background: studioColors.accentPrimary }}
        >
          <IconRefresh size={12} />
          Re-generar otra app
        </a>
      </div>
    </aside>
  );
}
