"use client";

import { motion } from "motion/react";

import { studioColors, withAlpha } from "@/lib/styles/studio-tokens";

/**
 * API & Frontend — a wireframe grid that "weaves" itself, line by line.
 * Each row appears with a stagger; columns are drawn in a separate stagger
 * to suggest "scaffolding" instead of single-shot reveal.
 */
export function ApiGrid({ active }: { active: boolean }) {
  if (!active) return null;
  const rows = 4;
  const cols = 3;
  const cellW = 16;
  const cellH = 8;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <svg width={cellW * cols + 2} height={cellH * rows + 2} viewBox={`0 0 ${cellW * cols + 2} ${cellH * rows + 2}`}>
        {/* Horizontal lines = endpoints */}
        {Array.from({ length: rows + 1 }).map((_, i) => (
          <motion.line
            key={`h${i}`}
            x1="1"
            y1={1 + i * cellH}
            x2={cellW * cols + 1}
            y2={1 + i * cellH}
            stroke={withAlpha(studioColors.accentSecondary, 0.7)}
            strokeWidth="0.8"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: i * 0.18, duration: 0.6 }}
          />
        ))}
        {/* Vertical lines = pages */}
        {Array.from({ length: cols + 1 }).map((_, i) => (
          <motion.line
            key={`v${i}`}
            x1={1 + i * cellW}
            y1="1"
            x2={1 + i * cellW}
            y2={cellH * rows + 1}
            stroke={withAlpha(studioColors.accentPrimary, 0.6)}
            strokeWidth="0.8"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.6 + i * 0.18, duration: 0.6 }}
          />
        ))}
        {/* Flow shimmer overlay */}
        <motion.rect
          x="1"
          y="1"
          width={cellW * cols}
          height={cellH * rows}
          fill={`url(#api-shimmer)`}
          opacity={0.4}
          animate={{ opacity: [0.2, 0.5, 0.2] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <defs>
          <linearGradient id="api-shimmer" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="50%" stopColor={studioColors.accentSecondary} stopOpacity="0.2" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
