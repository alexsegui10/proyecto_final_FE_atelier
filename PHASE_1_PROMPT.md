# Atelier — Phase 1 kickoff: Discovery

You finished Phase 0. The Next.js 16 scaffold is in place, Clerk auth works in keyless mode, the empty studio canvas renders. Now we build **Phase 1 — Discovery** as defined in `PRD_BUILDER.md` section 10.

Read `PRD_BUILDER.md` sections 4 (Screen 1), 5 (data model), and 10 (phase 1 scope) before starting. Also re-read your `.atl/changes/phase-0/proposal.md` for context. Do not skip ahead to Phase 2.

## Acceptance criterion

A two-minute conversation with the Discovery agent produces a structured PRD (JSON) saved as a `Project` row in the database. The "Build it" CTA appears when the agent considers the PRD complete. Clicking it creates the project and redirects to `/studio/<id>`.

## What you must build

### 1. Database connection

- Wire `lib/db/client.ts` using `@prisma/adapter-pg`.
- Apply the existing initial migration to a real database. The user will provide a real `DATABASE_URL` in `.env.local` (Neon Postgres). Run `pnpm prisma migrate deploy` after the user confirms the env var is set.
- Add a `lib/db/repositories/projects.ts` with a thin repository: `createProject({ userId, name, prd })`, `getProjectById(id)`, `listProjectsByUser(userId)`. Plain async functions, no class.

### 2. Discovery agent definition

- Create `lib/agents/prompts/discovery.md` with the Discovery agent's system prompt. The agent must:
  - Greet the user and ask what they want to build
  - Ask adaptive follow-ups (roles, key entities, business rules, must-have features)
  - Never ask everything at once; one or two questions per turn
  - Keep a running structured state (objective, roles[], entities[], useCases[], notes[]) that gets richer each turn
  - When state feels complete (≥3 entities, ≥2 roles, ≥6 use cases) emit a recap and a `READY_TO_BUILD` token
  - Speak in Castilian Spanish, friendly, professional
  - Never invent details the user did not give — ask instead
  - Stick to web app domains; politely refuse mobile-only, blockchain, or AI-research topics (out of scope)

### 3. Streaming chat endpoint

Create `app/api/discovery/stream/route.ts` (Next 16 App Router):

- Accepts `POST` with `{ messages: ChatMessage[] }`
- Spawns Claude Code as a subprocess inside a fresh temp dir using the discovery prompt
- Streams its response back as Server-Sent Events
- Each SSE event is one of:
  - `{ type: "delta", text: string }` (token-level text)
  - `{ type: "state", state: PRDState }` (every time the agent updates the live state, send the full snapshot)
  - `{ type: "ready", state: PRDState }` (when the agent emits READY_TO_BUILD)
  - `{ type: "done" }`
- Use the `child_process` `spawn` API. Do NOT use the Anthropic API SDK; use the Claude Code CLI subprocess so we keep the Max plan billing.
- Handle backpressure correctly: do not buffer the entire response, flush each chunk as it arrives.

Add a typed wrapper in `lib/agents/runner.ts`:

```ts
export async function* runDiscoveryAgent(
  messages: ChatMessage[]
): AsyncGenerator<DiscoveryEvent>
```

### 4. The Discover screen

`app/(dashboard)/discover/page.tsx` — server component that renders the client component below.

`components/builder/discover/DiscoverChat.tsx` — client component:

- Two-column layout: chat (60%) on the left, live PRD card (40%) on the right.
- Chat: ChatGPT-style bubble list, streaming text rendering, input at the bottom with submit on Enter.
- Use `react-markdown` to render assistant messages.
- The PRD card on the right has sections: **Objetivo**, **Roles**, **Entidades**, **Casos de uso**, **Notas**. Each section animates a soft pulse when it gets new content (Framer Motion).
- When the SSE emits a `ready` event, a "Build it" CTA fades in at the bottom of the PRD card.
- Clicking "Build it" calls `POST /api/projects` with `{ name, prd }`, gets back the project id, and `router.push('/studio/' + id)`.

`app/api/projects/route.ts` — POST handler that calls `createProject`.

### 5. Visual style

- Dark mode only. Background near `bg-zinc-950`. Text near `zinc-100`.
- Chat bubbles: assistant left-aligned, transparent background, just text. User right-aligned, soft `zinc-800` background, rounded corners.
- PRD card: subtle border `zinc-800`, generous padding, monospace font for entity names.
- Use Tabler icons only.
- One accent color throughout the discover screen — pick a violet `#8b5cf6` and use it sparingly.

## Constraints

- All new code must respect rules 1, 2, 3 from your PRD-anchored skill registry (SDD).
- TypeScript strict. No `any`. If you need an escape hatch, use `unknown` and narrow.
- Server components by default. The chat and PRD card are the only client components in this phase.
- Use `react-hook-form` only if forms appear (none planned in this phase, the chat is just a textarea).
- Add Vitest now: `pnpm add -D vitest @vitest/ui`. Write at minimum one unit test for the PRD state reducer (the function that merges agent updates into the live state).
- Save key decisions to engram via `mem_save` (project: `projecto`).

## Out of scope for Phase 1

- The studio screen wiring (still placeholder, that's Phase 3)
- Any agent except Discovery (Architect, Domain etc. are Phase 2)
- WebContainers (Phase 4)
- Persisting messages history beyond the current generation (one-shot per session is enough)

## Process

1. Run `/sdd-new phase-1` with this kickoff as the proposal source.
2. Implement in this order to keep the demo testable end-to-end as early as possible:
   1. Database wiring + projects repo
   2. Discovery prompt file + runner skeleton (returning fake events)
   3. SSE endpoint with the fake runner
   4. The chat UI consuming SSE
   5. Wire the real Claude Code subprocess into the runner
   6. The PRD card animations
   7. The "Build it" CTA + project creation
   8. The Vitest test
3. After every meaningful chunk, save a `mem_save` with what was decided.

## When you're done

- Show the SSE wire format with one example payload of each event type.
- Show the Discovery prompt file (`lib/agents/prompts/discovery.md`).
- Run a real conversation end-to-end and paste the final saved PRD JSON.
- List any deviations with justification.

Then stop. Phase 2 (the agent engine) comes in a separate prompt.

Begin.
