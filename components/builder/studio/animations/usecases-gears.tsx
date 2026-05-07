"use client";

import { motion } from "motion/react";

import { studioColors, withAlpha } from "@/lib/styles/studio-tokens";

/**
 * Use cases — 3 gears at different sizes spinning at different speeds, in
 * opposite directions (mechanically meshed). Pure SVG.
 */
export function UseCasesGears({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <svg width="68" height="48" viewBox="0 0 68 48" style={{ opacity: 0.55 }}>
        <Gear cx={20} cy={24} r={10} teeth={8} duration={4} direction={1} />
        <Gear cx={42} cy={20} r={7} teeth={6} duration={3} direction={-1} />
        <Gear cx={56} cy={32} r={5} teeth={5} duration={2.4} direction={1} />
      </svg>
    </div>
  );
}

function Gear({
  cx,
  cy,
  r,
  teeth,
  duration,
  direction,
}: {
  cx: number;
  cy: number;
  r: number;
  teeth: number;
  duration: number;
  direction: 1 | -1;
}) {
  const toothPath: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i * 2 * Math.PI) / teeth;
    const a1 = ((i + 0.5) * 2 * Math.PI) / teeth;
    const inner = r * 0.7;
    const outer = r;
    const x0 = Math.cos(a0) * inner;
    const y0 = Math.sin(a0) * inner;
    const x1 = Math.cos(a1) * outer;
    const y1 = Math.sin(a1) * outer;
    toothPath.push(`${i === 0 ? "M" : "L"} ${x0} ${y0} L ${x1} ${y1}`);
  }
  return (
    <motion.g
      style={{ originX: `${cx}px`, originY: `${cy}px` }}
      animate={{ rotate: direction * 360 }}
      transition={{ duration, repeat: Infinity, ease: "linear" }}
    >
      <g transform={`translate(${cx}, ${cy})`}>
        <circle
          r={r * 0.4}
          fill="none"
          stroke={studioColors.accentPrimary}
          strokeWidth="0.8"
        />
        <path
          d={toothPath.join(" ") + " Z"}
          fill="none"
          stroke={withAlpha(studioColors.accentPrimary, 0.7)}
          strokeWidth="1"
        />
      </g>
    </motion.g>
  );
}
