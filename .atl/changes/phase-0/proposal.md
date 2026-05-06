# Phase 0 — Foundation

**Source**: `KICKOFF_PROMPT.md` (binding) and `PRD_BUILDER.md` §10 (Phase 0).
**Status**: in progress (engram mode, no openspec/).
**Acceptance**: `pnpm dev` shows `/sign-in` for guests, `/discover` (empty) for signed-in users, and `/studio/<id>` renders an empty React Flow canvas with 6 placeholder agent nodes.

## Why

Atelier needs a working scaffold before any agent logic, chat, or sandbox work. Phase 0 unblocks Phase 1 (Discovery) and Phase 2 (agent engine) without committing to any actual product behavior. Everything in this phase is **plumbing**: routes, auth, DB schema, dashboard chrome, empty studio canvas. No business logic.

## Scope (what changes)

1. **Scaffold** Next.js 15 (App Router, TS strict) + Tailwind 4 + ESLint, via `create-next-app` (pnpm).
2. **shadcn/ui** initialized with the neutral palette, dark-by-default. Install only the primitives we use this phase (`button`).
3. **Prisma + PostgreSQL** with the exact schema from PRD §5 — `User`, `Project`, `Generation`, `AgentRun`, `Event`. Generate the initial migration but **do not run it** (no DB yet — placeholder `DATABASE_URL`).
4. **Clerk** auth via `@clerk/nextjs`: `ClerkProvider`, `middleware.ts`, `/sign-in/[[...sign-in]]` and `/sign-up/[[...sign-up]]` routes, placeholder env vars in `.env.local` and `.env.example`.
5. **Dashboard layout** at `app/(dashboard)/layout.tsx`: dark theme close to `bg-zinc-950`, Inter font, Tabler icons (`@tabler/icons-react`), Linear-inspired chrome. Top nav with Clerk's `<UserButton>` and a "New project" CTA → `/discover`.
6. **Three route stubs**:
   - `app/(dashboard)/discover/page.tsx` — centered "Discover" placeholder.
   - `app/(dashboard)/studio/[id]/page.tsx` — `<ReactFlow>` canvas with 6 grey idle nodes (Architect, Domain & Persistence, Use Cases, Auth & RBAC, API & Frontend, QA Reviewer). No interactions.
   - `app/(dashboard)/reveal/[id]/page.tsx` — three-pane placeholder (code | preview | summary).
7. **Landing** at `app/page.tsx` — server component that redirects to `/discover` if signed in, else `/sign-in`.
8. **Folder skeleton** per PRD §4: `lib/agents/prompts/`, `lib/db/`, `lib/sandbox/`, `lib/skeleton/` — empty with `.gitkeep`.

## Out of scope

- Discovery chat / SSE (Phase 1).
- Agent prompts, orchestrator, runner (Phase 2).
- Animations, particles, mini terminals (Phase 3).
- WebContainers, Monaco, Reveal logic beyond the three-pane placeholder (Phase 4).
- Any deploy.
- Running `prisma migrate dev` — the user has no DB yet.
- **No commits** — KICKOFF says produce the working scaffold and stop.

## Stack decisions (from PRD §3, no bikeshedding)

- Next.js 15 (App Router), TS strict + `noUnusedLocals` + `noUnusedParameters`
- Tailwind 4 + shadcn/ui (neutral, dark)
- React Flow (canvas), Tabler icons, Inter
- Prisma + PostgreSQL (Neon eventually)
- Clerk (`@clerk/nextjs`)
- Package manager: pnpm

## Risks and how I'll handle them

| Risk | Handling |
|---|---|
| `create-next-app` refuses to run in a non-empty dir (the three MD files are already there) | Scaffold into a temp subdir, then move/merge files back |
| Prisma `init` overwrites schema | Use `pnpm dlx prisma init --datasource-provider postgresql` then replace schema with PRD §5 verbatim |
| Clerk middleware conflicts with `/sign-in` route | Use the standard `clerkMiddleware()` matcher, exclude static assets only |
| React Flow + Server Components mismatch | The studio page is a thin Server Component that imports a Client Component `<StudioCanvas />` |
| Dark theme drift | Use `dark` class on `<html>` and rely on shadcn's neutral CSS variables; no manual theme toggle this phase |
| pnpm + create-next-app version drift on Node 24 | Pin to `create-next-app@latest`; if scaffolding fails, fall back to npm |

## Folder structure produced

```
projecto/
├── ARCHITECTURE_BLUEPRINT.md     ← unchanged
├── KICKOFF_PROMPT.md             ← unchanged
├── PRD_BUILDER.md                ← unchanged
├── .atl/
│   ├── skill-registry.md
│   └── changes/phase-0/proposal.md
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── discover/page.tsx
│   │   ├── studio/[id]/page.tsx
│   │   └── reveal/[id]/page.tsx
│   ├── sign-in/[[...sign-in]]/page.tsx
│   ├── sign-up/[[...sign-up]]/page.tsx
│   ├── layout.tsx
│   ├── page.tsx                  ← landing redirect
│   └── globals.css
├── components/
│   ├── ui/                       ← shadcn primitives
│   ├── builder/.gitkeep
│   └── nav/top-nav.tsx
├── lib/
│   ├── agents/
│   │   ├── prompts/.gitkeep
│   │   └── .gitkeep
│   ├── db/.gitkeep
│   ├── sandbox/.gitkeep
│   ├── skeleton/.gitkeep
│   └── utils.ts                  ← shadcn cn()
├── prisma/
│   ├── schema.prisma
│   └── migrations/0000_init/...  ← generated, not applied
├── middleware.ts                 ← Clerk
├── .env.local                    ← placeholders
├── .env.example
├── package.json
├── tsconfig.json
├── tailwind.config.ts (or v4 inline in globals.css)
├── postcss.config.mjs
├── next.config.ts
└── README.md
```

## Definition of done

- [ ] `pnpm dev` boots without errors on http://localhost:3000.
- [ ] `/` → redirects (to `/sign-in` if no Clerk keys, to `/discover` if signed in).
- [ ] `/sign-in` and `/sign-up` render Clerk's components.
- [ ] `/discover` renders the centered placeholder.
- [ ] `/studio/abc` renders a React Flow canvas with 6 grey nodes.
- [ ] `/reveal/abc` renders the three-pane placeholder.
- [ ] `tsc --noEmit` passes.
- [ ] No commits created.

## Why this is the right shape (vs. /sdd-explore + /sdd-spec)

The KICKOFF and PRD are already prescriptive. Doing exploration would just re-read them. Doing a full spec would describe behavior we've already pinned down. This proposal is the contract — apply directly.
