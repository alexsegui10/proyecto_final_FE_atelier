"use client";

import { motion } from "motion/react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleDashed,
  IconCompass,
  IconCpu,
  IconDatabase,
  IconFlask,
  IconFolder,
  IconKey,
  IconLayoutGrid,
  IconLoader2,
  IconMicroscope,
  IconPalette,
  IconPhoto,
  IconRotateClockwise2,
  IconRuler,
  IconServer,
  IconShield,
  IconSitemap,
  IconStar,
  IconTerminal2,
  IconTestPipe,
  IconTool,
  IconUsers,
  IconWand,
} from "@tabler/icons-react";

import {
  type AgentStatus,
  studioColors,
  studioDurations,
  studioEasings,
  studioFonts,
  studioStatusStyle,
} from "@/lib/styles/studio-tokens";

import type { AgentNameV3 } from "@/lib/agents/contracts-v3/agent-names";
import { getAnimationForAgent } from "./animations/registry";

// AgentKey is now the full v3 union
export type AgentKey = AgentNameV3;

export type AgentNodeData = {
  label: string;
  agent: AgentKey;
  status: AgentStatus;
  fileCount: number;
  miniLog?: string[];
};

// ─── Icon mapping — one icon per agent ───────────────────────────────

const ICONS: Record<AgentKey, typeof IconCompass> = {
  // wave-1
  "discovery":         IconFolder,
  "bootstrap-devops":  IconTerminal2,
  "architect":         IconCompass,
  // wave-2-design
  "ux-ui-designer":    IconPalette,
  "layout-architect":  IconRuler,
  "brand-identity":    IconStar,
  // wave-2-domain
  "domain-modeler":    IconSitemap,
  "persistence":       IconDatabase,
  "seeds-shape":       IconFlask,
  // wave-3-app-security
  "service-layer":     IconCpu,
  "auth-security":     IconKey,
  "rbac-authorization": IconShield,
  // wave-4
  "api-backend":       IconServer,
  "frontend-architect": IconLayoutGrid,
  "ui-components":     IconWand,
  "forms-validations": IconTestPipe,
  "visual-adapter":    IconPhoto,
  // wave-5
  "seeds-fixtures":    IconFolder,
  "tests-writer":      IconMicroscope,
  // wave-6 + 7
  "qa-reviewer":       IconUsers,
  "visual-qa":         IconTool,
};

// ─── Display labels ───────────────────────────────────────────────────

export const AGENT_LABELS: Record<AgentKey, string> = {
  "discovery":          "Discovery",
  "bootstrap-devops":   "Bootstrap & DevOps",
  "architect":          "Architect",
  "ux-ui-designer":     "UX / UI Designer",
  "layout-architect":   "Layout Architect",
  "brand-identity":     "Brand Identity",
  "domain-modeler":     "Domain Modeler",
  "persistence":        "Persistence",
  "seeds-shape":        "Seeds Shape",
  "service-layer":      "Service Layer",
  "auth-security":      "Auth Security",
  "rbac-authorization": "RBAC Authorization",
  "api-backend":        "API Backend",
  "frontend-architect": "Frontend Architect",
  "ui-components":      "UI Components",
  "forms-validations":  "Forms & Validations",
  "visual-adapter":     "Visual Adapter",
  "seeds-fixtures":     "Seeds Fixtures",
  "tests-writer":       "Tests Writer",
  "qa-reviewer":        "QA Reviewer",
  "visual-qa":          "Visual QA",
};

// ─── Sub-components ───────────────────────────────────────────────────

function StatusIcon({ status }: { status: AgentStatus }) {
  switch (status) {
    case "idle":
      return <IconCircleDashed size={11} />;
    case "working":
      return <IconLoader2 size={11} className="animate-spin" />;
    case "fixing":
      return <IconRotateClockwise2 size={11} className="animate-spin" />;
    case "done":
      return <IconCheck size={11} />;
    case "failed":
      return <IconAlertTriangle size={11} />;
  }
}

export function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const Icon = ICONS[data.agent];
  const style = studioStatusStyle[data.status];
  const isActive = data.status === "working" || data.status === "fixing";
  const Animation = getAnimationForAgent(data.agent);

  return (
    <div className="relative" style={{ width: 200, height: 72 }}>
      {style.glow ? (
        <motion.div
          aria-hidden
          className="absolute -inset-4 -z-10"
          style={{ background: style.glow, filter: "blur(6px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: isActive ? [0.3, 0.55, 0.3] : 0.4 }}
          transition={{
            duration: studioDurations.pulse,
            repeat: isActive ? Infinity : 0,
            ease: "easeInOut",
          }}
        />
      ) : null}

      <motion.div
        className="relative h-full w-full overflow-hidden rounded-md border"
        style={{
          background: studioColors.bgElevated,
          borderColor: style.border,
          boxShadow: isActive ? `0 0 0 1px ${style.ring}` : "none",
        }}
        animate={{ borderColor: style.border }}
        transition={{ duration: studioDurations.nodeStateChange, ease: studioEasings.default }}
      >
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2 !w-2 !border-zinc-800 !bg-zinc-900"
        />

        <Animation active={isActive} />

        {/* Header */}
        <div className="flex h-full items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={14} style={{ color: studioColors.textSecondary, flexShrink: 0 }} />
            <span
              className="truncate"
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: studioColors.textPrimary,
                fontFamily: studioFonts.body,
              }}
            >
              {data.label}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
            <span
              className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-widest"
              style={{
                color: style.badgeColor,
                border: `1px solid ${style.badgeColor}40`,
                background: `${style.badgeColor}10`,
                fontFamily: studioFonts.mono,
              }}
            >
              <StatusIcon status={data.status} />
              {style.badgeText}
            </span>
            {data.status === "done" && data.fileCount > 0 ? (
              <span
                className="text-[9px] uppercase tracking-widest"
                style={{ color: studioColors.success, fontFamily: studioFonts.mono }}
              >
                +{data.fileCount}f
              </span>
            ) : null}
          </div>
        </div>

        <Handle
          type="source"
          position={Position.Right}
          className="!h-2 !w-2 !border-zinc-800 !bg-zinc-900"
        />
      </motion.div>
    </div>
  );
}
