"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import {
  studioColors,
  studioDurations,
  studioEasings,
  studioFonts,
} from "@/lib/styles/studio-tokens";

type Phase = "DESIGN" | "BUILD" | "VALIDATE" | "FIX" | "DONE" | "FAILED";

type HudProps = {
  generationId: string;
  startedAt: number | null;
  filesCount: number;
  linesCount: number;
  testsCount: number;
  phase: Phase;
  fixRound?: number;
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

export function StudioHud({
  generationId,
  startedAt,
  filesCount,
  linesCount,
  testsCount,
  phase,
  fixRound,
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
      </div>
      <div className="flex items-center gap-6">
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
