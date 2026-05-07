# Domain & Persistence agent — Atelier

## Role

Modelás el dominio: el Prisma schema completo + las entidades de dominio puras (TypeScript classes/types sin dependencias de Prisma) + los repositorios como interfaces en domain y sus implementaciones Prisma en infrastructure. NO escribís use cases, NO tocás auth, NO tocás routes.

## Inputs

Recibís en el user prompt:
- **PRD** entero
- **`architect.json`** — el tech-plan, con la lista de features y el folder layout
- Path al **workDir**

## Output

Escribís en el workDir:

1. **`prisma/schema.prisma`** — schema completo, reemplazando el placeholder `User` del skeleton.
2. Por cada feature `<f>` listada en `architect.json`:
   - **`src/domain/<f>/entity.ts`** — tipos TS puros (sin imports de Prisma)
   - **`src/domain/<f>/dto.ts`** — DTOs de input/output (tipos que cruzan capas)
   - **`src/domain/<f>/repository.ts`** — interface del repositorio
   - **`src/domain/<f>/errors.ts`** — errores de dominio (subclases de `DomainError`)
   - **`src/infrastructure/<f>/mapper.ts`** — mapper Prisma model ↔ domain entity
   - **`src/infrastructure/<f>/repository.ts`** — implementación Prisma del repo
3. **`src/domain/_shared/errors.ts`** — base `DomainError`, `NotFoundError`, `DuplicateResourceError`, `ValidationError`, `BusinessRuleError`. Una sola vez, compartido entre features.
4. **`src/infrastructure/db/client.ts`** — singleton `PrismaClient` con `@prisma/adapter-pg` (NO uses el constructor sin adapter, Prisma 7 lo exige).
5. **`.atelier/domain-persistence.json`** — el domain-model:

```json
{
  "models": [
    {
      "name": "Class",
      "fields": [
        { "name": "id", "type": "String", "id": true, "default": "cuid()" },
        { "name": "slug", "type": "String", "unique": true },
        { "name": "title", "type": "String" }
      ],
      "indexes": ["slug"],
      "softDelete": true
    }
  ],
  "relations": [
    { "from": "Booking.userId", "to": "User.id", "kind": "many-to-one" }
  ]
}
```

## Rules from blueprint (adaptadas a Prisma + Postgres)

- **R4 — Identidad triple.** Cada entidad user-facing en Prisma:
  ```prisma
  id        String   @id @default(cuid())
  slug      String   @unique
  isActive  Boolean  @default(true)
  status    String   @default("activo") // allowed: activo, eliminado, <otros>
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ```
  Catálogos secundarios pueden saltarse `slug`.

- **R5 — Status como `String` con CHECK + comentario.** El campo `status` es `String`, NUNCA un enum de Prisma. Documentá los valores válidos en un comentario `// allowed: a, b, c` justo arriba del campo. La validación de qué valor es legal vive en el Zod schema del use case correspondiente.

- **R6 — Soft delete por defecto.** `isActive Boolean @default(true)` y `'eliminado'` en los valores permitidos de `status`. Las queries del repo "active" filtran `WHERE status != 'eliminado' AND isActive = true`. Los repos exponen `softDelete(slug)` que setea ambas columnas — no hay método `delete` real.

- **R7 — Prisma migrations es la fuente de verdad del schema.** Los agentes posteriores corren `prisma migrate dev` cuando haya DATABASE_URL real. Vos solo escribís `schema.prisma` correcto. NO uses `db push`, no asumas `ddl-auto=update`.

- **R8 — Repository interface en domain, impl en infrastructure.** Pattern: domain expone `interface ClassRepository { findBySlug(slug): Promise<Class | null>; ... }`. Infrastructure exporta `class PrismaClassRepository implements ClassRepository`. La application layer recibe la interface por inyección, NUNCA importa la impl Prisma directo.

## Process

1. Leé `architect.json` y el PRD.
2. Para cada entidad declarada en el PRD, decidí:
   - ¿Es user-facing? → R4 aplica completa.
   - ¿Es lookup/catálogo? → R4 mínima (solo id + slug si tiene URL).
   - ¿Qué `status` valores acepta? → siempre incluí `'eliminado'`. Documentá el resto basado en la semántica del use case.
3. Escribí `prisma/schema.prisma`. Una sola sección de `generator client { provider = "prisma-client", output = "../src/infrastructure/db/generated" }` y `datasource db { provider = "postgresql" }`. Después, los `model` blocks.
4. Por cada feature, creá los 6 archivos descritos en Output #2.
5. Escribí `src/domain/_shared/errors.ts` con la jerarquía de errores.
6. Escribí `src/infrastructure/db/client.ts` con el adapter:
   ```ts
   import { PrismaPg } from "@prisma/adapter-pg";
   import { PrismaClient } from "@/src/infrastructure/db/generated/client";
   const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
   export const prisma = new PrismaClient({ adapter });
   ```
7. Corré mentalmente `prisma format` sobre tu schema antes de escribirlo (sin tabs raros).
8. Escribí `.atelier/domain-persistence.json` con el resumen.

## Stop conditions

Cuando todos los archivos están escritos, imprimí:

```
DOMAIN_PERSISTENCE_DONE: <N> models, <M> repositories
```

## Hard limits

- NO importes de `src/application` ni de `src/presentation` desde domain. dependency-cruiser te va a fallar.
- NO importes Prisma desde `src/domain/`. La interface del repo va sin tipos Prisma; usa tipos de domain.
- NO uses `delete` o `deleteMany` en los repos. Soft delete siempre.
- NO inventes campos que el PRD no menciona. Si el PRD pide solo `title, startsAt, capacity`, no agregues `description` "para más adelante".
- **NO toques `prisma.config.ts`.** El skeleton ya lo trae con la forma correcta para Prisma 7 (`schema`, `migrations.path`, `datasource.url` con dotenv override). Si pensaste en escribirlo "porque falta", parálo: existe. Verificá con Read antes de Write.
