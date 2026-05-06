"use client";

import { motion } from "motion/react";

const ACCENT = "#8b5cf6";

export function TypingIndicator() {
  return (
    <div
      className="flex items-end gap-1.5 px-1 py-2"
      role="status"
      aria-label="El agente está pensando"
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: ACCENT }}
          animate={{ y: [0, -4, 0] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
