"use client";

import { motion } from "motion/react";

import { studioColors, withAlpha } from "@/lib/styles/studio-tokens";

/**
 * Domain cubes — 4 wireframe cubes rotating in 3D, staggered. Pure CSS
 * transforms (no Three.js). Looks "constructed" rather than spinning by
 * not all rotating in sync.
 */
export function DomainCubes({ active }: { active: boolean }) {
  if (!active) return null;
  const cubes = [
    { x: -22, y: -14, size: 12, delay: 0 },
    { x: 12, y: -8, size: 10, delay: 0.4 },
    { x: -10, y: 14, size: 11, delay: 0.8 },
    { x: 18, y: 14, size: 9, delay: 1.2 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="relative"
        style={{ width: 80, height: 60, perspective: 200 }}
      >
        {cubes.map((c, i) => (
          <motion.div
            key={i}
            className="absolute border"
            style={{
              left: `calc(50% + ${c.x}px - ${c.size / 2}px)`,
              top: `calc(50% + ${c.y}px - ${c.size / 2}px)`,
              width: c.size,
              height: c.size,
              borderColor: withAlpha(studioColors.accentSecondary, 0.7),
              backgroundColor: withAlpha(studioColors.accentSecondary, 0.1),
              transformStyle: "preserve-3d",
            }}
            animate={{
              rotateX: [0, 360],
              rotateY: [0, 360],
            }}
            transition={{
              duration: 4 + i * 0.6,
              delay: c.delay,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}
      </div>
    </div>
  );
}
