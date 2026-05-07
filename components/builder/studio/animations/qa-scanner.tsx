"use client";

import { motion } from "motion/react";

import { studioColors, withAlpha } from "@/lib/styles/studio-tokens";

/**
 * QA scanner — a horizontal laser line that sweeps top-to-bottom inside the
 * node. Three thin lines staggered for a "scanning" feel. Non-decorative in
 * the sense that it tracks the agent's actual `working` state, but the
 * exact motion is decoration and is disabled under prefers-reduced-motion.
 */
export function QaScanner({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
      {[0, 0.6, 1.2].map((delay) => (
        <motion.div
          key={delay}
          className="absolute left-0 right-0 h-[1.5px]"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${withAlpha(studioColors.success, 0.85)} 50%, transparent 100%)`,
            boxShadow: `0 0 12px ${withAlpha(studioColors.success, 0.6)}`,
          }}
          initial={{ top: "0%" }}
          animate={{ top: ["0%", "100%"] }}
          transition={{
            duration: 1.8,
            delay,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      ))}
    </div>
  );
}
