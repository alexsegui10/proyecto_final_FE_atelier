"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { studioColors, studioEasings } from "@/lib/styles/studio-tokens";

import { StudioHud } from "@/components/builder/studio/hud";
import {
  AgentNode,
  type AgentKey,
  type AgentNodeData,
} from "@/components/builder/studio/agent-node";
import { FlowEdge } from "@/components/builder/studio/flow-edge";

const AGENT_ORDER: readonly AgentKey[] = [
  "architect",
  "domain-persistence",
  "use-cases",
  "auth-rbac",
  "api-frontend",
  "qa-reviewer",
] as const;

const LABELS: Record<AgentKey, string> = {
  architect: "Architect",
  "domain-persistence": "Domain & Persistence",
  "use-cases": "Use Cases",
  "auth-rbac": "Auth & RBAC",
  "api-frontend": "API & Frontend",
  "qa-reviewer": "QA Reviewer",
};

const POSITIONS: Record<AgentKey, { x: number; y: number }> = {
  architect: { x: 0, y: 80 },
  "domain-persistence": { x: 320, y: 0 },
  "use-cases": { x: 640, y: -60 },
  "auth-rbac": { x: 640, y: 100 },
  "api-frontend": { x: 960, y: 20 },
  "qa-reviewer": { x: 1240, y: 80 },
};

type EventPayload = {
  type: string;
  payload: Record<string, unknown>;
  ts: string;
};

type AgentState = AgentNodeData;

type StudioState = {
  agents: Record<AgentKey, AgentState>;
  startedAt: number | null;
  totalFiles: number;
  totalLines: number;
  totalTests: number;
  failureReason: string | null;
  phase: "DESIGN" | "BUILD" | "VALIDATE" | "FIX" | "DONE" | "FAILED";
  fixRound: number | undefined;
  activeHandoff: { from: AgentKey; to: AgentKey } | null;
  bigBang: boolean;
};

const nodeTypes = { agent: AgentNode };
const edgeTypes = { flow: FlowEdge };

const initialAgents: Record<AgentKey, AgentState> = Object.fromEntries(
  AGENT_ORDER.map((a) => [
    a,
    { label: LABELS[a], agent: a, status: "idle", fileCount: 0 },
  ]),
) as Record<AgentKey, AgentState>;

function phaseFromAgent(agent: AgentKey): StudioState["phase"] {
  if (agent === "architect") return "DESIGN";
  if (agent === "qa-reviewer") return "VALIDATE";
  return "BUILD";
}

export function StudioCanvas({ generationId }: { generationId: string }) {
  const router = useRouter();
  const [state, setState] = useState<StudioState>({
    agents: initialAgents,
    startedAt: null,
    totalFiles: 0,
    totalLines: 0,
    totalTests: 0,
    failureReason: null,
    phase: "DESIGN",
    fixRound: undefined,
    activeHandoff: null,
    bigBang: false,
  });
  const eventSourceRef = useRef<EventSource | null>(null);

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
      const payload = event.payload as {
        agent?: AgentKey;
        from?: AgentKey;
        to?: AgentKey;
        reason?: string;
        round?: number;
        lines?: number;
        path?: string;
      };

      setState((s) => {
        switch (event.type) {
          case "generation.started":
            return { ...s, startedAt: new Date(event.ts).getTime() };
          case "agent.started":
            if (!payload.agent) return s;
            return {
              ...s,
              activeHandoff: null,
              phase: phaseFromAgent(payload.agent),
              agents: {
                ...s.agents,
                [payload.agent]: { ...s.agents[payload.agent], status: "working" },
              },
            };
          case "agent.completed":
            if (!payload.agent) return s;
            return {
              ...s,
              agents: {
                ...s.agents,
                [payload.agent]: { ...s.agents[payload.agent], status: "done" },
              },
            };
          case "agent.failed":
            if (!payload.agent) return s;
            return {
              ...s,
              phase: "FAILED",
              agents: {
                ...s.agents,
                [payload.agent]: { ...s.agents[payload.agent], status: "failed" },
              },
            };
          case "agent.handoff":
            if (!payload.from || !payload.to) return s;
            return { ...s, activeHandoff: { from: payload.from, to: payload.to } };
          case "agent.file_created": {
            if (!payload.agent) return s;
            const lines = typeof payload.lines === "number" ? payload.lines : 0;
            const path = typeof payload.path === "string" ? payload.path : "";
            const isTest = /\.test\.[tj]sx?$/.test(path) || /(^|\/)tests?\//.test(path);
            return {
              ...s,
              totalFiles: s.totalFiles + 1,
              totalLines: s.totalLines + lines,
              totalTests: isTest ? s.totalTests + 1 : s.totalTests,
              agents: {
                ...s.agents,
                [payload.agent]: {
                  ...s.agents[payload.agent],
                  fileCount: s.agents[payload.agent].fileCount + 1,
                },
              },
            };
          }
          case "qa.fix_round":
            return {
              ...s,
              phase: "FIX",
              fixRound: typeof payload.round === "number" ? payload.round : undefined,
            };
          case "agent.fix_started":
            if (!payload.agent) return s;
            return {
              ...s,
              agents: {
                ...s.agents,
                [payload.agent]: { ...s.agents[payload.agent], status: "fixing" },
              },
            };
          case "agent.fix_completed":
            if (!payload.agent) return s;
            return {
              ...s,
              agents: {
                ...s.agents,
                [payload.agent]: { ...s.agents[payload.agent], status: "done" },
              },
            };
          case "generation.completed": {
            es.close();
            // Trigger big-bang fade then redirect.
            setTimeout(() => {
              setState((cs) => ({ ...cs, bigBang: true }));
            }, 400);
            setTimeout(() => router.push(`/reveal/${generationId}`), 1600);
            return { ...s, phase: "DONE" };
          }
          case "generation.failed": {
            const reason = typeof payload.reason === "string" ? payload.reason : "(unknown)";
            es.close();
            return { ...s, phase: "FAILED", failureReason: reason };
          }
          default:
            return s;
        }
      });
    };
    es.onerror = () => {
      // EventSource auto-reconnects; we don't need to do anything here.
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
        data: state.agents[agent],
      })),
    [state.agents],
  );

  const edges = useMemo<Edge[]>(() => {
    const base: Array<{ id: string; source: AgentKey; target: AgentKey }> = [
      { id: "e1", source: "architect", target: "domain-persistence" },
      { id: "e2-uc", source: "domain-persistence", target: "use-cases" },
      { id: "e2-ar", source: "domain-persistence", target: "auth-rbac" },
      { id: "e3-uc", source: "use-cases", target: "api-frontend" },
      { id: "e3-ar", source: "auth-rbac", target: "api-frontend" },
      { id: "e4", source: "api-frontend", target: "qa-reviewer" },
    ];
    return base.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "flow",
      data: {
        active:
          state.activeHandoff?.from === e.source &&
          state.activeHandoff?.to === e.target,
      },
    }));
  }, [state.activeHandoff]);

  return (
    <motion.div
      animate={{
        scale: state.bigBang ? 0 : 1,
        opacity: state.bigBang ? 0 : 1,
        rotate: state.bigBang ? 6 : 0,
      }}
      transition={{ duration: 1.6, ease: studioEasings.contractIn }}
      className="relative h-[calc(100dvh-3.5rem)] w-full"
      style={{ background: studioColors.bg }}
    >
      <StudioHud
        generationId={generationId}
        startedAt={state.startedAt}
        filesCount={state.totalFiles}
        linesCount={state.totalLines}
        testsCount={state.totalTests}
        phase={state.phase}
        fixRound={state.fixRound}
      />

      <AnimatePresence>
        {state.failureReason ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-4 left-1/2 z-20 w-[min(720px,90%)] -translate-x-1/2 rounded-md border px-4 py-3 text-sm"
            style={{
              borderColor: "rgba(239, 68, 68, 0.5)",
              background: "rgba(127, 29, 29, 0.3)",
              color: "#fecaca",
              backdropFilter: "blur(8px)",
            }}
          >
            <div className="font-medium">La generación falló</div>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs opacity-80">
              {state.failureReason}
            </pre>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.25, minZoom: 0.6, maxZoom: 1.3 }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="#1f2937"
        />
        <Controls
          showInteractive={false}
          className="!bg-zinc-900/60 !text-zinc-300 [&_button]:!border-zinc-800 [&_button]:!bg-zinc-900/80 [&_button]:!fill-zinc-300 [&_button:hover]:!bg-zinc-800"
        />
      </ReactFlow>
    </motion.div>
  );
}
