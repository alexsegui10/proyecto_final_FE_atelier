"use client";

import { motion } from "motion/react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  IconAlertTriangle,
  IconBox,
  IconCheck,
  IconChecks,
  IconCircleDashed,
  IconCompass,
  IconCpu,
  IconLayoutGrid,
  IconLoader2,
  IconLock,
  IconRotateClockwise2,
} from "@tabler/icons-react";

import {
  type AgentStatus,
  studioColors,
  studioDurations,
  studioEasings,
  studioFonts,
  studioStatusStyle,
} from "@/lib/styles/studio-tokens";

import { ArchitectCompass } from "./animations/architect-compass";
import { DomainCubes } from "./animations/domain-cubes";
import { UseCasesGears } from "./animations/usecases-gears";
import { AuthShield } from "./animations/auth-shield";
import { ApiGrid } from "./animations/api-grid";
import { QaScanner } from "./animations/qa-scanner";

export type AgentKey =
  | "architect"
  | "domain-persistence"
  | "use-cases"
  | "auth-rbac"
  | "api-frontend"
  | "qa-reviewer";

export type AgentNodeData = {
  label: string;
  agent: AgentKey;
  status: AgentStatus;
  fileCount: number;
  miniLog?: string[];
};

const ICONS: Record<AgentKey, typeof IconCompass> = {
  architect: IconCompass,
  "domain-persistence": IconBox,
  "use-cases": IconCpu,
  "auth-rbac": IconLock,
  "api-frontend": IconLayoutGrid,
  "qa-reviewer": IconChecks,
};

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

function SignatureAnimation({
  agent,
  active,
}: {
  agent: AgentKey;
  active: boolean;
}) {
  switch (agent) {
    case "architect":
      return <ArchitectCompass active={active} />;
    case "domain-persistence":
      return <DomainCubes active={active} />;
    case "use-cases":
      return <UseCasesGears active={active} />;
    case "auth-rbac":
      return <AuthShield active={active} />;
    case "api-frontend":
      return <ApiGrid active={active} />;
    case "qa-reviewer":
      return <QaScanner active={active} />;
  }
}

export function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const Icon = ICONS[data.agent];
  const style = studioStatusStyle[data.status];
  const isActive = data.status === "working" || data.status === "fixing";

  return (
    <div className="relative" style={{ width: 240, height: 132 }}>
      {/* Ambient glow behind the node when active */}
      {style.glow ? (
        <motion.div
          aria-hidden
          className="absolute -inset-6 -z-10"
          style={{
            background: style.glow,
            filter: "blur(8px)",
          }}
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
        animate={{
          borderColor: style.border,
        }}
        transition={{ duration: studioDurations.nodeStateChange, ease: studioEasings.default }}
      >
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2 !w-2 !border-zinc-800 !bg-zinc-900"
        />

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <Icon size={14} style={{ color: studioColors.textSecondary }} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: studioColors.textPrimary,
                fontFamily: studioFonts.body,
              }}
            >
              {data.label}
            </span>
          </div>
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
        </div>

        {/* Body — either the signature animation, or a mini-terminal log,
            or a static placeholder when idle/done. */}
        <div className="relative h-[78px] border-t" style={{ borderColor: studioColors.borderSubtle }}>
          <SignatureAnimation agent={data.agent} active={isActive} />

          {/* Done state — small file counter */}
          {data.status === "done" && data.fileCount > 0 ? (
            <div
              className="flex h-full items-center justify-center text-center"
              style={{ color: studioColors.success, fontFamily: studioFonts.mono }}
            >
              <span className="text-[10px] uppercase tracking-widest">
                +{data.fileCount} files
              </span>
            </div>
          ) : null}
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
