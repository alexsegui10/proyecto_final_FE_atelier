"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  IconCheck,
  IconCircleDashed,
  IconCompass,
  IconDatabase,
  IconCpu,
  IconLock,
  IconLayoutDashboard,
  IconChecks,
  IconAlertTriangle,
  IconLoader2,
} from "@tabler/icons-react";
import "@xyflow/react/dist/style.css";

type AgentKey =
  | "architect"
  | "domain-persistence"
  | "use-cases"
  | "auth-rbac"
  | "api-frontend"
  | "qa-reviewer";

type AgentStatus = "idle" | "working" | "done" | "failed";

type AgentNodeData = {
  label: string;
  agent: AgentKey;
  status: AgentStatus;
  fileCount: number;
};

const ICONS: Record<AgentKey, typeof IconCompass> = {
  architect: IconCompass,
  "domain-persistence": IconDatabase,
  "use-cases": IconCpu,
  "auth-rbac": IconLock,
  "api-frontend": IconLayoutDashboard,
  "qa-reviewer": IconChecks,
};

const LABELS: Record<AgentKey, string> = {
  architect: "Architect",
  "domain-persistence": "Domain & Persistence",
  "use-cases": "Use Cases",
  "auth-rbac": "Auth & RBAC",
  "api-frontend": "API & Frontend",
  "qa-reviewer": "QA Reviewer",
};

const AGENT_ORDER: readonly AgentKey[] = [
  "architect",
  "domain-persistence",
  "use-cases",
  "auth-rbac",
  "api-frontend",
  "qa-reviewer",
] as const;

const POSITIONS: Record<AgentKey, { x: number; y: number }> = {
  architect: { x: 0, y: 0 },
  "domain-persistence": { x: 280, y: 0 },
  "use-cases": { x: 560, y: 0 },
  "auth-rbac": { x: 140, y: 180 },
  "api-frontend": { x: 420, y: 180 },
  "qa-reviewer": { x: 700, y: 180 },
};

const STATUS_BADGE: Record<AgentStatus, { color: string; label: string; icon: typeof IconCircleDashed }> = {
  idle: { color: "text-zinc-500", label: "IDLE", icon: IconCircleDashed },
  working: { color: "text-violet-400", label: "WORKING", icon: IconLoader2 },
  done: { color: "text-emerald-400", label: "DONE", icon: IconCheck },
  failed: { color: "text-red-400", label: "FAILED", icon: IconAlertTriangle },
};

const STATUS_BORDER: Record<AgentStatus, string> = {
  idle: "border-zinc-800/80",
  working: "border-violet-500/60 ring-1 ring-violet-500/30",
  done: "border-emerald-700/60",
  failed: "border-red-800/60",
};

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const Icon = ICONS[data.agent];
  const badge = STATUS_BADGE[data.status];
  const BadgeIcon = badge.icon;
  return (
    <div
      className={`group flex w-56 flex-col gap-2 rounded-lg border bg-zinc-900/70 px-4 py-3 shadow-sm transition-colors duration-300 ${STATUS_BORDER[data.status]}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-zinc-700 !bg-zinc-800" />
      <div className="flex items-center gap-2 text-zinc-300">
        <Icon size={16} className="text-zinc-500" />
        <span className="text-sm font-medium">{data.label}</span>
      </div>
      <div className={`flex items-center gap-1.5 text-[11px] ${badge.color}`}>
        <BadgeIcon
          size={12}
          className={data.status === "working" ? "animate-spin" : undefined}
        />
        <span className="uppercase tracking-wide">{badge.label}</span>
        {data.fileCount > 0 ? (
          <span className="ml-auto rounded-sm bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300">
            {data.fileCount} files
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-zinc-700 !bg-zinc-800" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

const edges: Edge[] = [
  { id: "e1", source: "architect", target: "domain-persistence" },
  { id: "e2", source: "domain-persistence", target: "use-cases" },
  { id: "e3", source: "use-cases", target: "auth-rbac" },
  { id: "e4", source: "auth-rbac", target: "api-frontend" },
  { id: "e5", source: "api-frontend", target: "qa-reviewer" },
];

type EventPayload = {
  type: string;
  payload: Record<string, unknown>;
  ts: string;
};

type AgentState = {
  status: AgentStatus;
  fileCount: number;
};

type Hud = {
  startedAt: number | null;
  totalFiles: number;
  failureReason: string | null;
};

export function StudioCanvas({ generationId }: { generationId: string }) {
  const router = useRouter();
  const [agentStates, setAgentStates] = useState<Record<AgentKey, AgentState>>(
    () =>
      Object.fromEntries(
        AGENT_ORDER.map((a) => [a, { status: "idle" as AgentStatus, fileCount: 0 }]),
      ) as Record<AgentKey, AgentState>,
  );
  const [hud, setHud] = useState<Hud>({ startedAt: null, totalFiles: 0, failureReason: null });
  const [now, setNow] = useState(Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);

  // Tick the clock every second when a generation is running.
  useEffect(() => {
    if (hud.startedAt === null || hud.failureReason !== null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hud.startedAt, hud.failureReason]);

  useEffect(() => {
    const es = new EventSource(`/api/generate/stream/${generationId}`);
    eventSourceRef.current = es;
    es.onmessage = (msg) => {
      let event: EventPayload;
      try {
        event = JSON.parse(msg.data) as EventPayload;
      } catch {
        return;
      }
      const payload = event.payload as { agent?: AgentKey; reason?: string; lines?: number };

      if (event.type === "generation.started") {
        setHud((h) => ({ ...h, startedAt: new Date(event.ts).getTime() }));
      } else if (event.type === "agent.started" && payload.agent) {
        setAgentStates((s) => ({ ...s, [payload.agent!]: { ...s[payload.agent!], status: "working" } }));
      } else if (event.type === "agent.completed" && payload.agent) {
        setAgentStates((s) => ({ ...s, [payload.agent!]: { ...s[payload.agent!], status: "done" } }));
      } else if (event.type === "agent.failed" && payload.agent) {
        setAgentStates((s) => ({ ...s, [payload.agent!]: { ...s[payload.agent!], status: "failed" } }));
      } else if (event.type === "agent.file_created" && payload.agent) {
        setAgentStates((s) => ({
          ...s,
          [payload.agent!]: {
            ...s[payload.agent!],
            fileCount: s[payload.agent!].fileCount + 1,
          },
        }));
        setHud((h) => ({ ...h, totalFiles: h.totalFiles + 1 }));
      } else if (event.type === "generation.completed") {
        es.close();
        setTimeout(() => router.push(`/reveal/${generationId}`), 800);
      } else if (event.type === "generation.failed") {
        const reason = typeof payload.reason === "string" ? payload.reason : "(unknown)";
        setHud((h) => ({ ...h, failureReason: reason }));
        es.close();
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; we don't need to do anything.
    };
    return () => {
      es.close();
    };
  }, [generationId, router]);

  const nodes = useMemo<Node<AgentNodeData>[]>(
    () =>
      AGENT_ORDER.map((agent) => ({
        id: agent,
        type: "agent",
        position: POSITIONS[agent],
        data: {
          label: LABELS[agent],
          agent,
          status: agentStates[agent].status,
          fileCount: agentStates[agent].fileCount,
        },
      })),
    [agentStates],
  );

  const elapsedSec =
    hud.startedAt === null ? 0 : Math.max(0, Math.floor((now - hud.startedAt) / 1000));

  return (
    <div className="relative h-[calc(100dvh-3.5rem)] w-full bg-zinc-950">
      {/* HUD */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between border-b border-zinc-900/80 bg-zinc-950/60 px-6 py-2 text-xs text-zinc-400 backdrop-blur">
        <div className="flex items-center gap-4 font-mono">
          <span>generation {generationId.slice(0, 8)}…</span>
          <span>files {hud.totalFiles}</span>
          <span>
            elapsed {Math.floor(elapsedSec / 60)
              .toString()
              .padStart(2, "0")}
            :{(elapsedSec % 60).toString().padStart(2, "0")}
          </span>
        </div>
      </div>

      {hud.failureReason ? (
        <div className="absolute bottom-4 left-1/2 z-20 w-[min(640px,90%)] -translate-x-1/2 rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          <div className="font-medium text-red-100">La generación falló</div>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-red-300/80">
            {hud.failureReason}
          </pre>
        </div>
      ) : null}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#27272a" />
        <Controls
          showInteractive={false}
          className="!bg-zinc-900 !text-zinc-300 [&_button]:!border-zinc-800 [&_button]:!bg-zinc-900 [&_button]:!fill-zinc-300 [&_button:hover]:!bg-zinc-800"
        />
      </ReactFlow>
    </div>
  );
}
