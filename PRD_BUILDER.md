# Atelier — Product Requirements Document

> Multi-agent web application generator with Clean Architecture output. Final-year project (DAW). Built with Claude Code on a Max plan.

---

## 0. Vision in one paragraph

Atelier is a web app that generates production-ready web applications from a natural-language description. A user describes the app they need; a discovery agent interviews them in chat until requirements are crisp; then six specialized agents work in parallel — visualised in a cinematic "studio" view — to produce a fully working, Clean Architecture, RBAC-enforced, type-safe Next.js application. The differentiator vs Lovable / v0 / Bolt is that the generated code mirrors the conventions of a real reference codebase (the developer's own polideportivo project) — so the output is reviewable, extendable, and looks like an experienced developer wrote it.

---

## 1. Goals

1. Generate a working Next.js + Prisma + PostgreSQL CRUD multi-role app from a 2-minute conversation.
2. The generated code must respect the 32 generation rules extracted from the reference codebase (`ARCHITECTURE_BLUEPRINT.md`).
3. Demo end-to-end live in front of a teacher: the teacher dictates an app domain, the system delivers a working preview within ~5 minutes.
4. Every step must be visible: chat, agents working in parallel, code being written, tests passing, app booting.

## 2. Non-goals

- Not a SaaS for external users; auth + multi-tenant is single-user simple.
- Not multi-stack; only one opinionated stack is supported (Next.js + Prisma + PostgreSQL + Tailwind + shadcn).
- Not iterative editing of generated apps; each generation is one-shot.
- No real deploy of the generated app; preview in WebContainers is enough.
- No payments / billing on Atelier itself.

---

## 3. Tech stack (decided, do not bikeshed)

### Atelier itself (the builder)

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Full-stack TS, server actions, streaming SSR |
| Language | TypeScript strict | Non-negotiable |
| Styling | Tailwind 4 + shadcn/ui | shadcn for primitives, custom for studio |
| UI for canvas | React Flow | Nodes + edges + animated handoffs |
| Animations | Framer Motion | Transitions between phases, agent state pulses |
| Code editor view | Monaco editor | The VSCode editor as a React component |
| Code highlighting | Shiki | Server-side syntax highlighting |
| Auth | Clerk | Fastest to wire; multi-rol by default |
| ORM | Prisma | Same as the reference codebase logic-wise |
| DB | PostgreSQL (Neon free tier) | Zero ops |
| Streaming | Server-Sent Events | Simpler than WebSocket for one-way push |
| Sandbox | WebContainers (StackBlitz SDK) | Run generated app fully in browser |
| Agent engine | Claude Code CLI subprocess | Uses Max plan, no API key required |
| Persistent agent memory | Engram (already installed) | Cross-session for builder dev only, NOT inside generated apps |
| Deploy | Vercel | Atelier itself, not the generated apps |

### What the generator produces

Generated apps always use this exact stack — never change it:

| Concern | Choice |
|---|---|
| Framework | Next.js 15 App Router |
| Language | TypeScript strict |
| ORM | Prisma + PostgreSQL |
| Auth | Better Auth (lightweight, doesn't need Clerk for sandbox) |
| RBAC | CASL |
| Validation | Zod |
| UI | Tailwind 4 + shadcn/ui |
| Forms | React Hook Form + Zod resolver |
| State | TanStack Query for server state, Zustand for client state |
| Tests | Vitest + Playwright |

---

## 4. Architecture

### High-level

```
┌─────────────────────────────────────────────────────┐
│              Atelier (Next.js 15)                   │
├─────────────────────────────────────────────────────┤
│  app/                                                │
│   ├── (dashboard)/discover     ← Screen 1: Chat     │
│   ├── (dashboard)/studio/[id]  ← Screen 2: Studio   │
│   ├── (dashboard)/reveal/[id]  ← Screen 3: Reveal   │
│   └── api/                                           │
│       ├── discovery/stream     ← SSE chat           │
│       ├── generate/start       ← Kicks off agents   │
│       └── generate/stream/[id] ← SSE for studio     │
├─────────────────────────────────────────────────────┤
│  lib/                                                │
│   ├── agents/                                        │
│   │   ├── prompts/             ← One .md per agent  │
│   │   ├── orchestrator.ts      ← The graph          │
│   │   ├── runner.ts            ← Spawns claude code │
│   │   └── events.ts            ← Event schema       │
│   ├── db/                                            │
│   ├── sandbox/                 ← WebContainers glue │
│   └── skeleton/                ← The base template  │
├─────────────────────────────────────────────────────┤
│              PostgreSQL (Neon)                       │
└─────────────────────────────────────────────────────┘
```

### The three screens

#### Screen 1 — Discover (the interview)

- Full-screen chat, dark theme, single column, centered.
- Right rail: a "PRD card" that fills in live as the conversation progresses (objective, roles, entities, use cases).
- Discovery agent asks adaptive questions; never a fixed form.
- When the agent considers the PRD complete it shows a recap card and a "Build it" CTA.
- "Build it" → POST `/api/generate/start` with the PRD → redirects to `/studio/[id]`.

#### Screen 2 — Studio (the cinematic part)

- Dark canvas (close to `bg-zinc-950`).
- Six agent nodes laid out by React Flow: Architect → Domain & Persistence → Use Cases → Auth & RBAC → API & Frontend → QA Reviewer.
- Each node has an avatar (Tabler icon), a name, a status (idle/thinking/working/done), and a mini terminal that streams what the agent is producing.
- Edges between nodes animate when there's a handoff; particles travel along.
- Top bar: timer, file count, line count, tests count. Numbers tick up live.
- Bottom rail: a global feed of important events (decisions, completions).
- Auto-transition to Screen 3 when QA marks green.

#### Screen 3 — Reveal

- Three-pane layout: Monaco code viewer on the left, WebContainers preview on the right, summary card on top.
- Summary card lists the generated entities, the roles, the use cases and the rules applied.
- Buttons: "Download zip", "Re-generate", "Back to studio".

---

## 5. Data model

```prisma
model User {
  id        String   @id            // Clerk id
  email     String   @unique
  projects  Project[]
}

model Project {
  id          String     @id @default(cuid())
  slug        String     @unique
  userId      String
  name        String
  prd         Json       // generated by Discovery agent
  createdAt   DateTime   @default(now())
  generations Generation[]
  user        User       @relation(fields: [userId], references: [id])
}

model Generation {
  id         String     @id @default(cuid())
  projectId  String
  status     String     // pending | running | complete | failed
  startedAt  DateTime   @default(now())
  finishedAt DateTime?
  result     Json?      // path to generated files, summary
  agentRuns  AgentRun[]
  events     Event[]
  project    Project    @relation(fields: [projectId], references: [id])
}

model AgentRun {
  id            String     @id @default(cuid())
  generationId  String
  agent         String     // architect | domain | use-cases | auth | api-frontend | qa
  status        String     // idle | working | done | failed
  startedAt     DateTime?
  finishedAt    DateTime?
  output        Json?      // structured artifact
  generation    Generation @relation(fields: [generationId], references: [id])
}

model Event {
  id            String   @id @default(cuid())
  generationId  String
  ts            DateTime @default(now())
  type          String   // agent.started | agent.thinking | agent.file | agent.handoff | agent.completed | qa.fail | done
  payload       Json
  generation    Generation @relation(fields: [generationId], references: [id])
}
```

The `Event` table is what feeds the studio screen. Every meaningful thing that happens in a generation lands here, and the SSE endpoint streams the deltas.

---

## 6. The six agents

Each agent lives at `lib/agents/prompts/<name>.md` and has:

- **Role** — one paragraph
- **Inputs** — which artifacts from prior agents it reads
- **Output** — the JSON schema it must produce
- **Rules** — the SUBSET of the 32 rules in `ARCHITECTURE_BLUEPRINT.md` that applies to its layer (never inject all 32)
- **Process** — step by step

| Agent | Reads | Produces | Rules from blueprint |
|---|---|---|---|
| Architect | PRD | `tech-plan.json` (entities, roles, use cases, decisions) | 1, 2, 3, 4 |
| Domain & Persistence | PRD, tech-plan | `domain-model.json` + Prisma schema | 4, 5, 6, 7, 8 |
| Use Cases | PRD, tech-plan, domain-model | `use-cases.json` + service files | 9, 10, 11, 12 |
| Auth & RBAC | PRD, tech-plan, domain-model, use-cases | `auth-policy.json` + auth code | 14, 15, 16, 17 |
| API & Frontend | All prior | `api-contract.json` + route handlers + frontend files | 20, 21, 23, 24, 25 |
| QA Reviewer | All prior + final code | Test report + go/no-go | 22, 32 (and validates ALL others) |

Discovery agent is separate (lives in screen 1, not in studio) and produces the PRD that all the others consume.

---

## 7. The skeleton template

`lib/skeleton/` contains a minimal but complete Next.js + Prisma project that already has:

- App Router layout configured
- Tailwind + shadcn primitives installed
- Auth boilerplate
- Domain / application / infrastructure / presentation folder structure
- Empty `prisma/schema.prisma` with just the User table
- Empty `app/` with just login + dashboard layout
- ESLint + dependency-cruiser configured to enforce layer boundaries
- Vitest + Playwright configured but no tests
- `.env.example` with all needed vars

When a generation starts, the skeleton is copied to a temp dir, agents fill it in, and the result is the deliverable.

---

## 8. Agent runner

```ts
// lib/agents/runner.ts
//
// Spawns Claude Code as a subprocess in the temp dir,
// feeds it the agent prompt + context, captures stdout JSON events,
// emits them onto the Event table.

async function runAgent(opts: {
  agent: AgentName
  generationId: string
  workDir: string
  context: Record<string, unknown>
}): Promise<AgentArtifact>
```

Each agent invocation is a fresh Claude Code subprocess in the work dir, given:
- The agent's system prompt (from `lib/agents/prompts/<agent>.md`)
- The relevant artifacts produced by prior agents (NOT the PRD, NOT the entire history)
- The skeleton path
- A strict instruction to write its artifact to `<workDir>/.atelier/<agent>.json`

This mirrors Gentleman's pattern: orchestrator coordinates, sub-agents work with fresh context, artifacts persist between phases.

---

## 9. Event protocol

The orchestrator emits events that the studio screen consumes:

| Event | Payload |
|---|---|
| `agent.started` | `{ agent, ts }` |
| `agent.thinking` | `{ agent, text }` (token-level when possible) |
| `agent.file_created` | `{ agent, path, lines }` |
| `agent.handoff` | `{ from, to, artifact }` |
| `agent.completed` | `{ agent, summary }` |
| `qa.check` | `{ name, status: pass\|fail, detail }` |
| `qa.fix_requested` | `{ targetAgent, reason }` |
| `done` | `{ summary, deliverable }` |

These are stored in the `Event` table and pushed via SSE to all clients on `/api/generate/stream/[id]`.

---

## 10. Phases (sprints)

### Phase 0 — Foundation (today, ~3-4h)

- Scaffold Next.js 15 + TS + Tailwind + shadcn
- Configure Prisma + Neon
- Wire Clerk auth
- Build shared layout (dark theme, Linear-inspired)
- Create the empty studio canvas with React Flow showing 6 placeholder nodes
- Acceptance: `npm run dev` shows login → dashboard → empty studio canvas

### Phase 1 — Discovery (today, ~3-4h)

- Build Discover screen (chat + live PRD card)
- Implement Discovery agent prompt + SSE streaming endpoint
- Wire "Build it" CTA → creates a `Project` row → redirects to studio
- Acceptance: a 2-minute conversation produces a structured PRD JSON saved in DB

### Phase 2 — Agent engine (day 2 morning, ~4h)

- Skeleton template directory with all the boilerplate
- Six agent prompt files
- Orchestrator + runner that spawns Claude Code subprocesses
- Hardcoded test: invoke from CLI with a fixed PRD, see all six artifacts produced
- Acceptance: `npm run agents:test` generates a full app in a temp dir

### Phase 3 — Studio screen wired up (day 2 afternoon, ~3-4h)

- Connect SSE events to the React Flow nodes
- Animate node states (idle / working / done)
- Mini terminal inside each node showing streaming text
- Edge animations on handoffs (particles)
- Live counters at the top
- Acceptance: clicking "Build it" on a real PRD shows the full studio in action

### Phase 4 — Reveal + polish + demo (day 2 evening, ~3-4h)

- Reveal screen: Monaco viewer + WebContainers preview + summary card
- Cache 2-3 demo runs as fallback
- Deploy to Vercel
- Record backup video

---

## 11. End-to-end example

Teacher says: *"Una app de gestión de clases de yoga con admin, profesores y alumnos. Los alumnos reservan clases, los profesores ven sus clases, el admin gestiona todo."*

1. User pastes that into Discover. Discovery agent asks 4-5 clarifying questions (cancellation rules? capacity per class? payment yes/no?) and produces a PRD with 3 roles, 4 entities (User, Class, Booking, Membership), 12 use cases.
2. "Build it" → redirects to `/studio/<id>`.
3. Architect runs first → produces `tech-plan.json`. Node 1 turns green.
4. Domain & Persistence runs → produces Prisma schema and entity classes. Node 2 turns green. Particles fly to Node 3.
5. Use Cases produces 12 service classes. Node 3 turns green.
6. Auth & RBAC produces CASL policy and middleware. Node 4 turns green.
7. API & Frontend produces routes, controllers, dashboards (3 different ones, one per role). Node 5 turns green.
8. QA Reviewer runs TS check + lint + dependency-cruiser + Vitest + Playwright smoke. If everything passes, Node 6 turns green and the screen transitions to Reveal.
9. Reveal shows the working app in WebContainers. Teacher logs in as admin, creates a class, logs in as student, books it. Done.

Target time: 4-7 minutes from prompt to working app.

---

## 12. Demo plan

The demo on presentation day must NOT depend on a live generation working flawlessly. Two safety nets:

1. **Three pre-generated demo runs** stored in DB with all events, so we can replay one in studio mode if a live run fails.
2. **A recorded video** of a successful run as last resort.

But aim to do it live. The wow factor is non-negotiable.

---

## 13. Definition of done

- A logged-in user can describe an app, see agents work, see the result run in WebContainers.
- The generated code passes TypeScript strict, ESLint, dependency-cruiser, and Vitest unit tests, all in CI inside the sandbox.
- The studio screen shows real-time progress with no stalls > 30 s.
- Three "kitchen demos" (yoga classes, vet clinic, language school) reliably generate working apps.

---

## 14. Out-of-scope kill list (do not start any of these)

- Stripe / payments inside Atelier
- Multi-stack support (Vue, Svelte, Angular)
- Iterative editing of generated apps via more prompts
- Real production deploy of generated apps
- Mobile responsive of Atelier itself (desktop-only is fine for the demo)
- i18n
- A free / paid tier
- Anything not listed in section 10

If a tempting feature appears mid-build, write it down in `BACKLOG.md` and move on.
