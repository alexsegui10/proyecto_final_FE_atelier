"use client";

import { motion } from "motion/react";

import { studioColors, withAlpha } from "@/lib/styles/studio-tokens";

/**
 * Generic pulse — a simple radial glow that breathes.
 * Used by agents that don't have a dedicated animation.
 */
export function GenericPulse({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <motion.div
        className="rounded-full"
        style={{
          width: 32,
          height: 32,
          background: `radial-gradient(closest-side, ${withAlpha(studioColors.accentPrimary, 0.55)} 0%, transparent 100%)`,
          filter: "blur(4px)",
        }}
        animate={{ scale: [0.85, 1.15, 0.85], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
