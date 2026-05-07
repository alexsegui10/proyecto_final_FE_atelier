/**
 * Studio design tokens — single source of truth for the cinematic Studio
 * canvas. Every component pulls colors, fonts, easings and durations from
 * here. The numbers are tuned for 60fps on a M1 MacBook Air; if anything
 * starts dropping frames, simplify the animation that uses these tokens
 * before changing the tokens themselves.
 */

export const studioColors = {
  bg: "#0a0e1a",
  bgElevated: "#0f1424",
  borderSubtle: "rgba(31, 41, 55, 0.6)",
  borderActive: "rgba(139, 92, 246, 0.6)",
  borderDone: "rgba(16, 185, 129, 0.45)",
  borderFailed: "rgba(239, 68, 68, 0.55)",
  borderFixing: "rgba(245, 158, 11, 0.55)",
  textPrimary: "#e5e7eb",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  accentPrimary: "#8b5cf6",
  accentSecondary: "#3b82f6",
  success: "#10b981",
  warning: "#f59e0b",
  error: "#ef4444",
} as const;

/** Hex with alpha helper — `withAlpha("#8b5cf6", 0.4)` → "rgba(139, 92, 246, 0.4)" */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const studioGradients = {
  accent: "linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)",
  activeGlow: `radial-gradient(closest-side, ${withAlpha(studioColors.accentPrimary, 0.25)} 0%, transparent 70%)`,
  doneGlow: `radial-gradient(closest-side, ${withAlpha(studioColors.success, 0.18)} 0%, transparent 70%)`,
  fixingGlow: `radial-gradient(closest-side, ${withAlpha(studioColors.warning, 0.22)} 0%, transparent 70%)`,
  qaScanner: `linear-gradient(90deg, transparent 0%, ${withAlpha(studioColors.accentPrimary, 0.5)} 50%, transparent 100%)`,
} as const;

export const studioFonts = {
  body: "var(--font-sans, Inter, sans-serif)",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  display: "var(--font-sans, Inter, sans-serif)",
} as const;

export const studioEasings = {
  /** Most transitions — UI-native, no bounce. */
  default: [0.25, 0.46, 0.45, 0.94] as const,
  /** Slot-machine number flip — overshoots slightly. */
  overshoot: [0.34, 1.56, 0.64, 1] as const,
  /** Aggressive ease-in for the big-bang outro. */
  contractIn: [0.7, 0, 0.84, 0] as const,
  /** Smooth ease-out for fade-ins. */
  smoothOut: [0.16, 1, 0.3, 1] as const,
} as const;

export const studioDurations = {
  pulse: 3.0,
  nodeStateChange: 0.4,
  hudCounter: 0.5,
  particle: 1.2,
  scannerSweep: 2.4,
  bigBang: 1.6,
} as const;

/** Per-status visual style for a generator agent node. */
export type AgentStatus = "idle" | "working" | "done" | "fixing" | "failed";

export const studioStatusStyle: Record<AgentStatus, {
  border: string;
  ring: string;
  badgeText: string;
  badgeColor: string;
  glow?: string;
}> = {
  idle: {
    border: studioColors.borderSubtle,
    ring: "transparent",
    badgeText: "IDLE",
    badgeColor: studioColors.textMuted,
  },
  working: {
    border: studioColors.borderActive,
    ring: withAlpha(studioColors.accentPrimary, 0.25),
    badgeText: "WORKING",
    badgeColor: studioColors.accentPrimary,
    glow: studioGradients.activeGlow,
  },
  done: {
    border: studioColors.borderDone,
    ring: "transparent",
    badgeText: "DONE",
    badgeColor: studioColors.success,
    glow: studioGradients.doneGlow,
  },
  fixing: {
    border: studioColors.borderFixing,
    ring: withAlpha(studioColors.warning, 0.3),
    badgeText: "FIXING",
    badgeColor: studioColors.warning,
    glow: studioGradients.fixingGlow,
  },
  failed: {
    border: studioColors.borderFailed,
    ring: "transparent",
    badgeText: "FAILED",
    badgeColor: studioColors.error,
  },
};
