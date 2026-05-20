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
import type { AgentNameV3 } from "@/lib/agents/contracts-v3/agent-names";
import { WAVES_V3 } from "@/lib/agents/contracts-v3/waves";

import { StudioHud } from "@/components/builder/studio/hud";
import {
  AgentNode,
  AGENT_LABELS,
  type AgentKey,
  type AgentNodeData,
} from "@/components/builder/studio/agent-node";
import { FlowEdge } from "@/components/builder/studio/flow-edge";

// ─── Layout constants ─────────────────────────────────────────────────
//
// Horizontal layout: each sub-wave is a column, agents in the same
// sub-wave stack vertically. 14 sub-waves → 14 columns.
// Node size: 200×72. Column stride 260px, row stride 100px.

const COL_STRIDE = 260;
const ROW_STRIDE = 100;

function computePositions(): Record<AgentKey, { x: number; y: number }> {
  const positions: Partial<Record<AgentKey, { x: number; y: number }>> = {};
  WAVES_V3.forEach((wave, colIndex) => {
    const agents = wave.agents as readonly AgentNameV3[];
    const count = agents.length;
    agents.forEach((agent, rowIndex) => {
      const x = colIndex * COL_STRIDE;
      const y = (rowIndex - (count - 1) / 2) * ROW_STRIDE;
      positions[agent] = { x, y };
    });
  });
  return positions as Record<AgentKey, { x: number; y: number }>;
}

const POSITIONS = computePositions();

// ─── Edge definitions (one edge per wave dependency pair) ─────────────
//
// For each wave, for each of its agents, create an edge from every agent
// in the predecessor wave. This faithfully mirrors the WAVES_V3 dependsOn
// structure without hardcoding.

function buildEdgeDefinitions(): Array<{ id: string; source: AgentKey; target: AgentKey }> {
  const waveByName = new Map(WAVES_V3.map((w) => [w.name, w]));
  const edges: Array<{ id: string; source: AgentKey; target: AgentKey }> = [];

  for (const wave of WAVES_V3) {
    for (const dep of wave.dependsOn) {
      const depWave = waveByName.get(dep);
      if (!depWave) continue;
      for (const src of depWave.agents) {
        for (const tgt of wave.agents) {
          edges.push({
            id: `${src}->${tgt}`,
            source: src as AgentKey,
            target: tgt as AgentKey,
          });
        }
      }
    }
  }
  return edges;
}

const EDGE_DEFINITIONS = buildEdgeDefinitions();

// ─── All agent keys in canonical order ───────────────────────────────

const ALL_AGENTS: readonly AgentKey[] = WAVES_V3.flatMap(
  (w) => w.agents as AgentKey[],
);

// ─── Types ────────────────────────────────────────────────────────────

type EventPayload = {
  type: string;
  payload: Record<string, unknown>;
  ts: string;
};

type StudioState = {
  agents: Record<AgentKey, AgentNodeData>;
  startedAt: number | null;
  totalFiles: number;
  totalLines: number;
  totalTests: number;
  failureReason: string | null;
  phase: "DESIGN" | "BUILD" | "VALIDATE" | "FIX" | "DONE" | "FAILED";
  fixRound: number | undefined;
  // Tracks which target agents have an active working state — used for edge highlights
  workingAgents: Set<AgentKey>;
  bigBang: boolean;
  // v3 HUD extensions
  currentWaveIndex: number;
  agentsDone: number;
  formatRescueActive: boolean;
  formatRescueFailed: boolean;
};

const nodeTypes = { agent: AgentNode };
const edgeTypes = { flow: FlowEdge };

function makeInitialAgents(): Record<AgentKey, AgentNodeData> {
  return Object.fromEntries(
    ALL_AGENTS.map((a) => [
      a,
      { label: AGENT_LABELS[a], agent: a, status: "idle", fileCount: 0 },
    ]),
  ) as Record<AgentKey, AgentNodeData>;
}

// ─── Phase inference ──────────────────────────────────────────────────

function phaseFromAgent(agent: AgentKey): StudioState["phase"] {
  // wave-1 agents → DESIGN
  if (
    agent === "discovery" ||
    agent === "bootstrap-devops" ||
    agent === "architect" ||
    agent === "ux-ui-designer" ||
    agent === "layout-architect" ||
    agent === "brand-identity"
  )
    return "DESIGN";
  // wave-6 and wave-7 → VALIDATE
  if (agent === "qa-reviewer" || agent === "visual-qa") return "VALIDATE";
  return "BUILD";
}

// ─── Canvas ───────────────────────────────────────────────────────────

export function StudioCanvas({ generationId }: { generationId: string }) {
  const router = useRouter();
  const [state, setState] = useState<StudioState>({
    agents: makeInitialAgents(),
    startedAt: null,
    totalFiles: 0,
    totalLines: 0,
    totalTests: 0,
    failureReason: null,
    phase: "DESIGN",
    fixRound: undefined,
    workingAgents: new Set(),
    bigBang: false,
    currentWaveIndex: 0,
    agentsDone: 0,
    formatRescueActive: false,
    formatRescueFailed: false,
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
        wave?: string;
        reason?: string;
        round?: number;
        lines?: number;
        path?: string;
        results?: Array<{ agent: AgentKey; status: string }>;
      };

      setState((s) => {
        switch (event.type) {
          // ── generation lifecycle ──────────────────────────────────
          case "generation.started":
            return { ...s, startedAt: new Date(event.ts).getTime(), phase: "DESIGN" };

          case "generation.completed": {
            es.close();
            setTimeout(() => setState((cs) => ({ ...cs, bigBang: true })), 400);
            setTimeout(() => router.push(`/reveal/${generationId}`), 1600);
            return { ...s, phase: "DONE" };
          }

          case "generation.failed": {
            const reason =
              typeof payload.reason === "string" ? payload.reason : "(unknown)";
            es.close();
            return { ...s, phase: "FAILED", failureReason: reason };
          }

          // ── wave lifecycle ────────────────────────────────────────
          case "wave.started": {
            // Advance the current wave indicator using the wave name from payload
            const waveName = typeof payload.wave === "string" ? payload.wave : null;
            if (!waveName) return s;
            const waveIdx = WAVES_V3.findIndex((w) => w.name === waveName);
            return waveIdx >= 0 ? { ...s, currentWaveIndex: waveIdx } : s;
          }

          case "wave.completed": {
            // Mark all agents in the wave as done if not already failed/done
            if (!payload.results) return s;
            const next = { ...s.agents };
            const nextWorking = new Set(s.workingAgents);
            for (const r of payload.results) {
              if (r.agent && next[r.agent]) {
                const status = r.status === "ok" ? "done" : "failed";
                next[r.agent] = { ...next[r.agent], status };
                nextWorking.delete(r.agent);
              }
            }
            return { ...s, agents: next, workingAgents: nextWorking };
          }

          case "wave.paused":
          case "wave.skipped":
            return s; // minimal — no node-level visual needed in Phase 2

          case "wave.rejected": {
            // Mark the wave's agents' nodes with failed border — we don't have
            // the wave's agent list here without matching the wave name, so we
            // leave nodes as-is (they will already reflect individual agent states)
            return s;
          }

          case "wave.approved":
            return s;

          // ── gate lifecycle ────────────────────────────────────────
          case "gate.started":
          case "gate.completed":
            return s; // Phase 3a will add a dedicated indicator

          // ── agent lifecycle ───────────────────────────────────────
          case "agent.started": {
            if (!payload.agent) return s;
            const nextWorking = new Set(s.workingAgents);
            nextWorking.add(payload.agent);
            return {
              ...s,
              phase: phaseFromAgent(payload.agent),
              workingAgents: nextWorking,
              agents: {
                ...s.agents,
                [payload.agent]: { ...s.agents[payload.agent], status: "working" },
              },
            };
          }

          case "agent.completed": {
            if (!payload.agent) return s;
            const nextWorking = new Set(s.workingAgents);
            nextWorking.delete(payload.agent);
            return {
              ...s,
              agentsDone: s.agentsDone + 1,
              workingAgents: nextWorking,
              agents: {
                ...s.agents,
                [payload.agent]: { ...s.agents[payload.agent], status: "done" },
              },
            };
          }

          case "agent.failed": {
            if (!payload.agent) return s;
            const nextWorking = new Set(s.workingAgents);
            nextWorking.delete(payload.agent);
            return {
              ...s,
              phase: "FAILED",
              workingAgents: nextWorking,
              agents: {
                ...s.agents,
                [payload.agent]: { ...s.agents[payload.agent], status: "failed" },
              },
            };
          }

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

          case "agent.fix_started": {
            if (!payload.agent) return s;
            return {
              ...s,
              agents: {
                ...s.agents,
                [payload.agent]: { ...s.agents[payload.agent], status: "fixing" },
              },
            };
          }

          case "agent.fix_completed": {
            if (!payload.agent) return s;
            return {
              ...s,
              agents: {
                ...s.agents,
                [payload.agent]: { ...s.agents[payload.agent], status: "done" },
              },
            };
          }

          // ── qa fix loop ───────────────────────────────────────────
          case "qa.fix_round":
            return {
              ...s,
              phase: "FIX",
              fixRound: typeof payload.round === "number" ? payload.round : undefined,
            };

          // ── format rescue ─────────────────────────────────────────
          case "format_rescue.started":
            return { ...s, formatRescueActive: true, formatRescueFailed: false };

          case "format_rescue.completed":
            return { ...s, formatRescueActive: false, formatRescueFailed: false };

          case "format_rescue.failed":
            return { ...s, formatRescueActive: false, formatRescueFailed: true };

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
      ALL_AGENTS.map((agent) => ({
        id: agent,
        type: "agent",
        position: POSITIONS[agent],
        data: state.agents[agent],
      })),
    [state.agents],
  );

  const edges = useMemo<Edge[]>(() =>
    EDGE_DEFINITIONS.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "flow",
      data: {
        // Edge lights up when the target agent is actively working
        active: state.workingAgents.has(e.target),
      },
    })),
    [state.workingAgents],
  );

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
        currentWaveIndex={state.currentWaveIndex}
        agentsDone={state.agentsDone}
        formatRescueActive={state.formatRescueActive}
        formatRescueFailed={state.formatRescueFailed}
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
        fitViewOptions={{ padding: 0.15, minZoom: 0.3, maxZoom: 1.2 }}
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
