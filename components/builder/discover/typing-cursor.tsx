"use client";

import { motion } from "motion/react";

export function TypingCursor() {
  return (
    <motion.span
      aria-hidden
      className="inline-block align-text-bottom text-violet-400"
      animate={{ opacity: [1, 0.1, 1] }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    >
      ▍
    </motion.span>
  );
}
