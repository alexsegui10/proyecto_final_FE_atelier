"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import {
  studioColors,
  studioDurations,
  studioEasings,
  studioFonts,
} from "@/lib/styles/studio-tokens";
import { WAVES_V3 } from "@/lib/agents/contracts-v3/waves";

type Phase = "DESIGN" | "BUILD" | "VALIDATE" | "FIX" | "DONE" | "FAILED";

type HudProps = {
  generationId: string;
  startedAt: number | null;
  filesCount: number;
  linesCount: number;
  testsCount: number;
  phase: Phase;
  fixRound?: number;
  currentWaveIndex: number;
  agentsDone: number;
  formatRescueActive: boolean;
  formatRescueFailed: boolean;
};

/**
 * Slot-machine numeric counter. When the value increments, the new digit
 * slides up from below while the old digit slides up out the top — like
 * a mechanical odometer. Easing has a slight overshoot so each tick feels
 * mechanical rather than UI-default.
 */
function SlotCounter({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <div className="relative h-5 min-w-[2ch] overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -18, opacity: 0 }}
            transition={{
              duration: studioDurations.hudCounter,
              ease: studioEasings.overshoot,
            }}
            className="block tabular-nums"
            style={{
              fontFamily: studioFonts.mono,
              color: studioColors.textPrimary,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </div>
      <span
        className="text-[10px] uppercase tracking-widest"
        style={{ color: studioColors.textMuted, fontFamily: studioFonts.mono }}
      >
        {label}
      </span>
    </div>
  );
}

function Timer({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsedSec =
    startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = Math.floor(elapsedSec / 60).toString().padStart(2, "0");
  const ss = (elapsedSec % 60).toString().padStart(2, "0");
  return (
    <motion.div
      animate={{ opacity: [0.85, 1, 0.85] }}
      transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
      style={{
        fontFamily: studioFonts.mono,
        color: studioColors.textPrimary,
        fontSize: 22,
        fontWeight: 500,
        letterSpacing: "0.05em",
      }}
      className="tabular-nums"
    >
      {mm}:{ss}
    </motion.div>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const color = useMemo(() => {
    switch (phase) {
      case "DESIGN":
      case "BUILD":
        return studioColors.accentPrimary;
      case "VALIDATE":
        return studioColors.accentSecondary;
      case "FIX":
        return studioColors.warning;
      case "DONE":
        return studioColors.success;
      case "FAILED":
        return studioColors.error;
    }
  }, [phase]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phase}
        initial={{ opacity: 0, filter: "blur(4px)", y: 4 }}
        animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
        exit={{ opacity: 0, filter: "blur(4px)", y: -4 }}
        transition={{ duration: 0.4, ease: studioEasings.smoothOut }}
        className="rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em]"
        style={{
          borderColor: color,
          color,
          fontFamily: studioFonts.mono,
        }}
      >
        {phase}
      </motion.div>
    </AnimatePresence>
  );
}

/** Human-readable wave name: "wave-4c-components-forms" → "Wave 4c · Components Forms" */
function formatWaveName(raw: string): string {
  return raw
    .replace(/^wave-/, "Wave ")
    .replace(/-/g, " ")
    .replace(/\bwave (\S+)\b/, (_, id) => `Wave ${id} ·`);
}

function WaveLabel({ waveIndex }: { waveIndex: number }) {
  const wave = WAVES_V3[waveIndex];
  if (!wave) return null;
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={wave.name}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.35, ease: studioEasings.smoothOut }}
        className="text-[10px] uppercase tracking-widest"
        style={{ color: studioColors.accentPrimary, fontFamily: studioFonts.mono }}
      >
        {formatWaveName(wave.name)}
      </motion.span>
    </AnimatePresence>
  );
}

function FormatRescueBadge({ active, failed }: { active: boolean; failed: boolean }) {
  const show = active || failed;
  if (!show) return null;
  const color = failed ? studioColors.error : studioColors.warning;
  const label = failed ? "rescue failed" : "format rescue";
  return (
    <AnimatePresence>
      <motion.span
        key="rescue"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ duration: 0.25 }}
        className="rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-widest"
        style={{
          borderColor: color,
          color,
          fontFamily: studioFonts.mono,
        }}
      >
        {label}
      </motion.span>
    </AnimatePresence>
  );
}

export function StudioHud({
  generationId,
  startedAt,
  filesCount,
  linesCount,
  testsCount,
  phase,
  fixRound,
  currentWaveIndex,
  agentsDone,
  formatRescueActive,
  formatRescueFailed,
}: HudProps) {
  return (
    <div
      className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-6 py-2.5 backdrop-blur"
      style={{
        background: `${studioColors.bg}cc`,
        borderBottom: `1px solid ${studioColors.borderSubtle}`,
      }}
    >
      <div className="flex items-center gap-5">
        <Timer startedAt={startedAt} />
        <PhaseBadge phase={phase} />
        {fixRound ? (
          <span
            className="text-[10px] uppercase tracking-widest"
            style={{ color: studioColors.warning, fontFamily: studioFonts.mono }}
          >
            fix round {fixRound}/3
          </span>
        ) : null}
        <WaveLabel waveIndex={currentWaveIndex} />
        <FormatRescueBadge active={formatRescueActive} failed={formatRescueFailed} />
      </div>
      <div className="flex items-center gap-6">
        <SlotCounter value={agentsDone} label={`/ ${WAVES_V3.flatMap((w) => w.agents).length} agents`} />
        <SlotCounter value={filesCount} label="files" />
        <SlotCounter value={linesCount} label="lines" />
        <SlotCounter value={testsCount} label="tests" />
        <span
          className="text-[10px] tabular-nums"
          style={{ color: studioColors.textMuted, fontFamily: studioFonts.mono }}
        >
          gen {generationId.slice(0, 8)}…
        </span>
      </div>
    </div>
  );
}
