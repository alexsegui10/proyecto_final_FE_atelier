"use client";

import { motion } from "motion/react";

import { studioColors, withAlpha } from "@/lib/styles/studio-tokens";

/**
 * Architect — slow-rotating compass + faint blueprint grid that draws itself
 * inside the node. The compass needle accelerates slightly during `working`
 * to suggest "searching" then settles when `done` (parent unmounts the
 * component on done so this is just the working state).
 */
export function ArchitectCompass({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        className="absolute"
        style={{ opacity: 0.4 }}
      >
        {/* Outer ring */}
        <circle
          cx="32"
          cy="32"
          r="28"
          fill="none"
          stroke={withAlpha(studioColors.accentPrimary, 0.5)}
          strokeWidth="1"
        />
        {/* Inner ticks */}
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 30 * Math.PI) / 180;
          const x1 = 32 + Math.cos(angle) * 24;
          const y1 = 32 + Math.sin(angle) * 24;
          const x2 = 32 + Math.cos(angle) * 27;
          const y2 = 32 + Math.sin(angle) * 27;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={withAlpha(studioColors.accentPrimary, 0.4)}
              strokeWidth="1"
            />
          );
        })}
        {/* Rotating needle */}
        <motion.line
          x1="32"
          y1="32"
          x2="32"
          y2="10"
          stroke={studioColors.accentPrimary}
          strokeWidth="1.5"
          strokeLinecap="round"
          style={{ originX: "32px", originY: "32px" }}
          animate={{ rotate: 360 }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        />
        <circle
          cx="32"
          cy="32"
          r="2"
          fill={studioColors.accentPrimary}
        />
      </svg>
    </div>
  );
}
