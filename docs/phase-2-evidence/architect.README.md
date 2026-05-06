# Estudio de Yoga

Aplicación de gestión para un estudio de yoga. El alumno reserva clases con
cupo limitado consumiendo créditos de su membresía mensual o trimestral, el
profesor consulta y administra su agenda de clases, y el admin gestiona el
catálogo de clases, las membresías de los alumnos y puede invalidar reservas
cuando hace falta. Las cancelaciones cierran 2 horas antes del inicio y
devuelven el crédito; los borrados son siempre lógicos (`status='eliminado'`).

## Getting started

```bash
pnpm install
cp env.example.template .env.local   # or rename if your shell allows
# fill in DATABASE_URL and BETTER_AUTH_SECRET
pnpm prisma migrate dev
pnpm dev
```

Open http://localhost:3000.

## QA gates

```bash
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm deps:check     # dependency-cruiser (Clean Architecture boundaries)
pnpm test           # vitest run
pnpm qa             # all of the above in series
pnpm test:e2e       # playwright (optional; needs the dev server up)
```

## Architecture

```
src/
├── domain/              ← entities, DTOs, repository interfaces (no Prisma, no Next)
├── application/         ← use cases (services), application mappers
├── infrastructure/      ← Prisma repos, mappers, external integrations
└── presentation/        ← server components, client components, route handlers

app/
├── (dashboard)/         ← authenticated routes — wrapped by the dashboard layout
├── api/                 ← route handlers
└── …
```

The Clean Architecture boundaries are enforced by `dependency-cruiser`. Run
`pnpm deps:check` after every change.

## Design rules

The 32 generation rules live in [the Atelier blueprint](https://atelier.example).
The most important shortcuts:

- Every user-facing entity has `id` (cuid), `slug` (UNIQUE), `isActive`, `status`.
- Status is a `String` column with documented allowed values; never an enum.
- Soft delete by default — set `status = 'eliminado'` and `isActive = false`.
- All UI strings are in Castilian Spanish. Code identifiers stay in English.

---

This README is a placeholder — the generator agents will customize it for the
specific app domain.
