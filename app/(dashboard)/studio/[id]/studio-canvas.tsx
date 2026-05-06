"use client";

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
  IconCircleDashed,
  IconCompass,
  IconDatabase,
  IconCpu,
  IconLock,
  IconLayoutDashboard,
  IconChecks,
} from "@tabler/icons-react";
import "@xyflow/react/dist/style.css";

type AgentKey =
  | "architect"
  | "domain"
  | "use-cases"
  | "auth"
  | "api-frontend"
  | "qa";

type AgentNodeData = {
  label: string;
  agent: AgentKey;
};

const ICONS: Record<AgentKey, typeof IconCompass> = {
  architect: IconCompass,
  domain: IconDatabase,
  "use-cases": IconCpu,
  auth: IconLock,
  "api-frontend": IconLayoutDashboard,
  qa: IconChecks,
};

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const Icon = ICONS[data.agent];
  return (
    <div className="group flex w-56 flex-col gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/70 px-4 py-3 shadow-sm">
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-zinc-700 !bg-zinc-800"
      />
      <div className="flex items-center gap-2 text-zinc-300">
        <Icon size={16} className="text-zinc-500" />
        <span className="text-sm font-medium">{data.label}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <IconCircleDashed size={12} />
        <span className="uppercase tracking-wide">Idle</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-zinc-700 !bg-zinc-800"
      />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

const nodes: Node<AgentNodeData>[] = [
  { id: "architect", type: "agent", position: { x: 0, y: 0 }, data: { label: "Architect", agent: "architect" } },
  { id: "domain", type: "agent", position: { x: 280, y: 0 }, data: { label: "Domain & Persistence", agent: "domain" } },
  { id: "use-cases", type: "agent", position: { x: 560, y: 0 }, data: { label: "Use Cases", agent: "use-cases" } },
  { id: "auth", type: "agent", position: { x: 140, y: 180 }, data: { label: "Auth & RBAC", agent: "auth" } },
  { id: "api-frontend", type: "agent", position: { x: 420, y: 180 }, data: { label: "API & Frontend", agent: "api-frontend" } },
  { id: "qa", type: "agent", position: { x: 700, y: 180 }, data: { label: "QA Reviewer", agent: "qa" } },
];

const edges: Edge[] = [
  { id: "e1", source: "architect", target: "domain" },
  { id: "e2", source: "domain", target: "use-cases" },
  { id: "e3", source: "use-cases", target: "auth" },
  { id: "e4", source: "auth", target: "api-frontend" },
  { id: "e5", source: "api-frontend", target: "qa" },
];

export function StudioCanvas() {
  return (
    <div className="h-[calc(100dvh-3.5rem)] w-full bg-zinc-950">
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
