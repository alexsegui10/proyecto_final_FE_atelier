# Atelier — Phase 0 kickoff

You are working in a fresh, empty directory. Read `PRD_BUILDER.md` and `ARCHITECTURE_BLUEPRINT.md` from the project root before doing anything else. They are the source of truth for this project.

## What you're building

Atelier is a multi-agent web application generator. Right now we are in **Phase 0 — Foundation** as defined in section 10 of the PRD. Do NOT skip ahead. Phase 0 has a single, narrow acceptance criterion: `npm run dev` shows login → dashboard → empty studio canvas.

## Your responsibilities for Phase 0

1. Scaffold a Next.js 15 project with the App Router, TypeScript strict, Tailwind 4, and shadcn/ui. Use `npx create-next-app@latest` and `npx shadcn@latest init`. Pick the dark theme.
2. Configure Prisma with PostgreSQL. Use Neon for the connection (the user will provide a `DATABASE_URL` — for now use a placeholder in `.env.local` and `.env.example`).
3. Wire up Clerk for authentication. Use the standard `@clerk/nextjs` setup with sign-in / sign-up routes. Use placeholder env vars.
4. Define the Prisma schema EXACTLY as specified in section 5 of the PRD: `User`, `Project`, `Generation`, `AgentRun`, `Event`. Generate the initial migration but do NOT run it (the user has no DB yet).
5. Build the shared dashboard layout: dark theme close to `bg-zinc-950`, Tabler icons (`@tabler/icons-react`), Inter font. Linear-inspired, sober, generous whitespace.
6. Create the three route stubs:
   - `/discover` — empty for now, just a centered "discover" placeholder
   - `/studio/[id]` — empty React Flow canvas with six placeholder nodes for the six agents (Architect, Domain & Persistence, Use Cases, Auth & RBAC, API & Frontend, QA Reviewer). Use grey idle styling. No interactions yet.
   - `/reveal/[id]` — empty for now, three-pane layout placeholder
7. Add a top nav inside `(dashboard)` with the user's avatar (Clerk's `<UserButton>`) and a "New project" button that links to `/discover`.
8. Add a `/` landing page that redirects to `/discover` if signed in, or to `/sign-in` if not.

## Constraints

- Use `pnpm` if available, else `npm`. Never `yarn`.
- TypeScript strict mode is non-negotiable. Set `"strict": true` in `tsconfig.json` plus `noUnusedLocals` and `noUnusedParameters`.
- Folder structure must match what's shown in section 4 of the PRD (`app/(dashboard)/...`, `lib/agents/`, `lib/db/`, `lib/sandbox/`, `lib/skeleton/`). Create the folders empty if you're not filling them yet, with a `.gitkeep`.
- Do not install any dependency that isn't justified by the PRD. No "just in case" libraries.
- All components in `app/(dashboard)/` and `components/builder/` must be Server Components by default; opt into client components only when needed.
- Commit nothing yet. Just produce the working scaffold.

## Out of scope for Phase 0

- The actual chat in /discover (that's Phase 1)
- Any agent prompts or orchestrator logic (that's Phase 2)
- Any animations on the studio canvas beyond default React Flow (that's Phase 3)
- WebContainers integration (that's Phase 4)
- Any deploy

## Process

Follow the SDD workflow gentle-ai installed:

1. Run `/sdd-init` first if you haven't.
2. Treat this kickoff as the proposal phase. Generate a brief `proposal.md` in `.atl/changes/phase-0/` summarizing the plan as a sanity check.
3. Then proceed: `/sdd-continue` for each subsequent phase.
4. Save important decisions to engram via `mem_save` (project: `"atelier"`).

## When you're done

Reply with:
- The exact `pnpm dev` (or `npm run dev`) command output showing the server up
- A tree of the generated structure (just the top three levels)
- The list of npm packages added with their versions
- Any deviations from the PRD with justification

Then stop. Do not start Phase 1. The user will give the go for Phase 1 in a separate prompt.

Begin.
