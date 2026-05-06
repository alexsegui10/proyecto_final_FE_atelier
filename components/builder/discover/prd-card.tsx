"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  IconTarget,
  IconUsersGroup,
  IconBox,
  IconChecklist,
  IconNotes,
  IconRocket,
} from "@tabler/icons-react";

import type { PRDState } from "@/lib/agents/prd-state";

const ACCENT = "#8b5cf6";
const PULSE_BG = "rgba(139, 92, 246, 0.18)";
const PULSE_DURATION = 0.6;

/**
 * Bumps a counter every time `value` changes (compared by string equality).
 * Returns 0 on first render so the consumer can skip the initial animation.
 * Uses an effect so the comparison runs once per committed render — safe in
 * StrictMode and across re-renders.
 */
function useChangeKey(value: string): number {
  const [counter, setCounter] = useState(0);
  const prevRef = useRef(value);
  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      setCounter((c) => c + 1);
    }
  }, [value]);
  return counter;
}

type SectionProps = {
  icon: React.ReactNode;
  title: string;
  pulseKey: number;
  empty: string;
  children?: React.ReactNode;
};

function Section({ icon, title, pulseKey, empty, children }: SectionProps) {
  return (
    <motion.div
      key={pulseKey}
      initial={pulseKey === 0 ? false : { backgroundColor: PULSE_BG }}
      animate={{ backgroundColor: "rgba(0, 0, 0, 0)" }}
      transition={{ duration: PULSE_DURATION, ease: "easeOut" }}
      className="border-t border-zinc-900/80 px-5 py-4 first:border-t-0"
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-500">
        <span style={{ color: ACCENT }}>{icon}</span>
        {title}
      </div>
      <div className="mt-2 text-sm text-zinc-200">
        {children ?? <span className="text-zinc-500">{empty}</span>}
      </div>
    </motion.div>
  );
}

type PRDCardProps = {
  state: PRDState;
  ready: boolean;
  onBuild: () => void;
  building: boolean;
};

export function PRDCard({ state, ready, onBuild, building }: PRDCardProps) {
  const objectiveKey = useChangeKey(state.objective);
  const rolesKey = useChangeKey(JSON.stringify(state.roles));
  const entitiesKey = useChangeKey(JSON.stringify(state.entities));
  const useCasesKey = useChangeKey(JSON.stringify(state.useCases));
  const notesKey = useChangeKey(JSON.stringify(state.notes));

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
      <header className="flex items-center justify-between border-b border-zinc-900/80 px-5 py-3">
        <div className="flex items-center gap-2 text-sm text-zinc-200">
          <IconRocket size={16} style={{ color: ACCENT }} />
          PRD en vivo
        </div>
        <span className="text-[11px] uppercase tracking-widest text-zinc-500">
          {ready ? "listo" : "en construcción"}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <Section
          icon={<IconTarget size={14} />}
          title="Objetivo"
          pulseKey={objectiveKey}
          empty="Escribí qué app querés generar."
        >
          {state.objective ? (
            <p className="leading-relaxed">{state.objective}</p>
          ) : null}
        </Section>

        <Section
          icon={<IconUsersGroup size={14} />}
          title="Roles"
          pulseKey={rolesKey}
          empty="Aún sin roles."
        >
          {state.roles.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {state.roles.map((r) => (
                <li
                  key={r}
                  className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 font-mono text-xs text-zinc-200"
                >
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section
          icon={<IconBox size={14} />}
          title="Entidades"
          pulseKey={entitiesKey}
          empty="Sin entidades del dominio todavía."
        >
          {state.entities.length > 0 ? (
            <ul className="space-y-2">
              {state.entities.map((e) => (
                <li
                  key={e.name}
                  className="rounded-md border border-zinc-900 bg-zinc-950/60 p-2"
                >
                  <div className="font-mono text-xs text-zinc-100">{e.name}</div>
                  {e.fields.length > 0 ? (
                    <div className="mt-1 font-mono text-[11px] text-zinc-400">
                      {e.fields.join(", ")}
                    </div>
                  ) : null}
                  {e.notes ? (
                    <div className="mt-1 text-xs text-zinc-500">{e.notes}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section
          icon={<IconChecklist size={14} />}
          title="Casos de uso"
          pulseKey={useCasesKey}
          empty="Sin casos de uso todavía."
        >
          {state.useCases.length > 0 ? (
            <ul className="space-y-1 text-sm text-zinc-300">
              {state.useCases.map((u) => (
                <li key={u} className="flex gap-2">
                  <span className="text-zinc-600">·</span>
                  {u}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section
          icon={<IconNotes size={14} />}
          title="Notas"
          pulseKey={notesKey}
          empty="Reglas de negocio aparecerán aquí."
        >
          {state.notes.length > 0 ? (
            <ul className="space-y-1 text-sm text-zinc-400">
              {state.notes.map((n) => (
                <li key={n} className="flex gap-2">
                  <span className="text-zinc-600">·</span>
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      </div>

      <AnimatePresence>
        {ready ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="border-t border-zinc-900/80 p-4"
          >
            <button
              type="button"
              onClick={onBuild}
              disabled={building}
              className="w-full rounded-md py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {building ? "Creando…" : "Build it"}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </aside>
  );
}
