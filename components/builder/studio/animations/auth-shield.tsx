"use client";

import { motion } from "motion/react";

import { studioColors, withAlpha } from "@/lib/styles/studio-tokens";

/**
 * Auth & RBAC — a shield outline with concentric rings (one per role) and
 * dots (abilities) lighting up around them. Animation: rings draw in
 * sequence, dots blink on with stagger.
 */
export function AuthShield({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <svg width="60" height="64" viewBox="0 0 60 64">
        {/* Shield outline */}
        <motion.path
          d="M30 4 L52 12 L52 32 Q52 52 30 60 Q8 52 8 32 L8 12 Z"
          fill={withAlpha(studioColors.accentPrimary, 0.05)}
          stroke={studioColors.accentPrimary}
          strokeWidth="1.5"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.7 }}
          transition={{ duration: 1.4, ease: "easeInOut" }}
        />
        {/* Concentric rings (3 roles) */}
        {[18, 13, 8].map((r, i) => (
          <motion.circle
            key={r}
            cx="30"
            cy="32"
            r={r}
            fill="none"
            stroke={withAlpha(studioColors.accentPrimary, 0.5)}
            strokeWidth="0.6"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.8 }}
            transition={{ delay: 1.4 + i * 0.3, duration: 0.5 }}
          />
        ))}
        {/* Ability dots — pulsing */}
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (i * Math.PI * 2) / 8;
          const x = 30 + Math.cos(angle) * 18;
          const y = 32 + Math.sin(angle) * 18;
          return (
            <motion.circle
              key={i}
              cx={x}
              cy={y}
              r="1.5"
              fill={studioColors.accentPrimary}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{
                duration: 1.5,
                delay: 2 + i * 0.15,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}
