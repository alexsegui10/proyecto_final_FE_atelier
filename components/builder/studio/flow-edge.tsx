"use client";

import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

import { studioColors, withAlpha } from "@/lib/styles/studio-tokens";

type FlowEdgeData = {
  active?: boolean;
};

/**
 * Custom React Flow edge with an animated gradient flowing along the path
 * when `data.active === true` (i.e. the source node has just completed and
 * we're handing off to the target). Falls back to a thin neutral line in
 * the resting state.
 */
export function FlowEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, id, markerEnd } = props;
  const data = props.data as FlowEdgeData | undefined;
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const isActive = data?.active ?? false;
  const gradientId = `flow-${id}`;

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={studioColors.accentPrimary} stopOpacity="0" />
          <stop offset="50%" stopColor={studioColors.accentPrimary} stopOpacity="1" />
          <stop offset="100%" stopColor={studioColors.accentSecondary} stopOpacity="0" />
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: isActive
            ? `url(#${gradientId})`
            : withAlpha(studioColors.borderSubtle.replace("rgba(31, 41, 55, ", "#1f2937"), 0.5),
          strokeWidth: isActive ? 2 : 1,
          opacity: isActive ? 1 : 0.6,
          transition: "stroke-width 0.4s, opacity 0.4s",
        }}
      />
      {isActive ? (
        <path
          d={path}
          fill="none"
          stroke={studioColors.accentPrimary}
          strokeWidth="2.5"
          strokeDasharray="4 8"
          strokeLinecap="round"
          opacity={0.6}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="24"
            to="0"
            dur="0.8s"
            repeatCount="indefinite"
          />
        </path>
      ) : null}
    </>
  );
}
