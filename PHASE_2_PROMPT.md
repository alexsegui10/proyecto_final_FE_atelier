# Atelier — Phase 2 kickoff: el motor de agentes

Phase 1 está cerrada y validada en navegador (Discovery chat funciona, PRD se guarda en DB, "Build it" redirige a /studio/[id]). Ahora construimos **Phase 2 — Agent engine** según `PRD_BUILDER.md` sección 10.

Lee antes de empezar: `PRD_BUILDER.md` secciones 4 (arquitectura), 5 (data model), 6 (agentes), 7 (skeleton), 8 (runner), 9 (event protocol), 10 (Phase 2). Y `ARCHITECTURE_BLUEPRINT.md` entero — las 32 reglas son la constitución de los agentes generadores.

## Acceptance criterion

Un script `pnpm agents:test` toma un PRD JSON fijo (fixture: app de yoga con 3 roles, 4 entidades, 6 use cases) y produce los 6 artifacts más una app Next.js completa en un temp dir. La app pasa `tsc --noEmit`, `eslint`, `dependency-cruiser` y al menos un test de `vitest run` en verde. Por separado: clicar "Build it" en /discover crea una `Generation` row, lanza el orchestrator en background, y los 6 nodos del Studio cambian visualmente de IDLE → working → done conforme avanzan los agentes (sin animaciones bonitas todavía, solo el cambio de estado y un pequeño label de progreso).

## Arquitectura de la fase

### 1. Skeleton template

Crea `lib/skeleton/` — un proyecto Next.js mínimo pero completo que los agentes RELLENAN, no construyen desde cero. Incluye:

- `package.json` con dependencies pinned: next 16, react 19, prisma 7 + adapter-pg, better-auth (auth ligera, no Clerk), @casl/ability, zod, tailwind 4, shadcn primitives, vitest, playwright, dependency-cruiser
- `tsconfig.json` strict + noUnusedLocals + paths `@/*`
- Estructura de carpetas Clean Architecture conforme al `ARCHITECTURE_BLUEPRINT.md`:
  - `src/domain/` — entidades, DTOs, repositorios (interfaces). Forbidden: imports de `infrastructure` o de prisma.
  - `src/application/` — use cases (services), application mappers
  - `src/infrastructure/` — implementaciones de repos con Prisma, mappers de infra
  - `src/presentation/` — server components, client components, route handlers
- `.dependency-cruiser.cjs` con reglas que impongan los boundaries (`domain` no puede importar de `infrastructure` ni de `prisma`, etc.)
- `eslint.config.js` extendiendo next + boundaries
- `vitest.config.ts` configurado
- `playwright.config.ts` configurado pero sin tests
- `prisma/schema.prisma` con solo el modelo `User` placeholder
- `app/` con layout root + página de login básica + dashboard layout vacío
- `.env.example` con todas las vars necesarias
- `README.md` template que los agentes completarán

El skeleton debe `tsc + eslint + dependency-cruiser + vitest run` verde de salida (sin tests, pero los configs no rompen).

### 2. Los 6 system prompts

Crea `lib/agents/prompts/` con 6 archivos `.md`:

- `architect.md`
- `domain-persistence.md`
- `use-cases.md`
- `auth-rbac.md`
- `api-frontend.md`
- `qa-reviewer.md`

Estructura de cada archivo:

```
# <Nombre del agente>

## Role
Una frase clara: qué hace y qué no hace.

## Inputs
Qué artifacts de agentes anteriores lee. Path concreto.

## Output
Schema JSON exacto que produce. Path donde lo escribe (.atelier/<agente>.json + ficheros del skeleton).

## Rules from blueprint
SOLO las reglas que aplican a su capa según la tabla en PRD §6:
- Architect → reglas 1, 2, 3, 4
- Domain & Persistence → reglas 4, 5, 6, 7, 8
- Use Cases → reglas 9, 10, 11, 12
- Auth & RBAC → reglas 14, 15, 16, 17
- API & Frontend → reglas 20, 21, 23, 24, 25
- QA Reviewer → 22, 32 + valida TODAS las demás contra el código generado

Cita la regla copiada literal del ARCHITECTURE_BLUEPRINT.md, NO inventes paráfrasis. NO le pases las 32 reglas a cada uno — es lo que infla el contexto y degrada el output. Inyectar SOLO el subset.

## Process
Pasos numerados de qué hacer en orden. Concretos. Castellano.

## Stop conditions
Qué señaliza que terminó. Cuándo emitir el JSON final.
```

Idioma del output de los agentes: castellano. Pero los nombres de variables, clases, archivos, columnas: inglés (matching el blueprint).

### 3. El orchestrator

`lib/agents/orchestrator.ts`:

```ts
export async function runGeneration(opts: {
  generationId: string
  projectId: string
  prd: PRD
  workDir: string  // temp dir donde está el skeleton copiado
}): Promise<GenerationResult>
```

Ejecución **en serie** (Architect → Domain & Persistence → Use Cases → Auth & RBAC → API & Frontend → QA Reviewer). Nada de paralelo todavía — Phase 3 si acaso.

Estado compartido: `lib/agents/shared-state.ts` con un objeto que va creciendo:
- `prd` (input inmutable)
- `techPlan` (Architect)
- `domainModel` (Domain & Persistence)
- `useCases` (Use Cases)
- `authPolicy` (Auth & RBAC)
- `apiContract` (API & Frontend)
- `qaReport` (QA Reviewer)

Cada agente recibe SOLO los slices que necesita según la tabla de Inputs. No le pases todo el shared state.

### 4. El runner extendido

Extiende `lib/agents/runner.ts` para soportar invocación de los 6 generadores. NO es Discovery (Discovery se queda como está). Cada agente generador:

```ts
export async function runGeneratorAgent(opts: {
  agent: GeneratorAgentName
  systemPromptPath: string  // lib/agents/prompts/<agent>.md
  context: AgentContext     // los artifacts previos relevantes
  workDir: string           // donde escribe ficheros y .atelier/<agent>.json
  generationId: string      // para emitir Events a la DB
}): Promise<AgentArtifact>
```

Mantén el subprocess de claude **sin --bare** (Max plan, no API). Mantén `--output-format text` por simplicidad (mismo trade-off que Discovery: respuestas se ven al final del turno, no token-por-token; refinable luego).

Cada agente lo ejecutas en `workDir` con `cwd = workDir`. Así Claude Code ve los archivos del skeleton como contexto natural y puede leerlos/escribirlos.

### 5. Event streaming a la DB

Cada vez que un agente:
- empieza → insertar `Event{type: "agent.started", payload: {agent}}`
- escribe un archivo → `Event{type: "agent.file_created", payload: {agent, path, lines}}` (puedes detectar esto leyendo el filesystem antes/después o parseando el output)
- termina → `Event{type: "agent.completed", payload: {agent, summary}}`
- pasa al siguiente → `Event{type: "agent.handoff", payload: {from, to}}`

QA emite además:
- `Event{type: "qa.check", payload: {name, status, detail}}` por cada validación (tsc, eslint, dep-cruiser, vitest)
- `Event{type: "qa.fix_requested", payload: {targetAgent, reason}}` si algo falla (Phase 2 NO loopea — solo registra y termina con `failed`; Phase 3+ hará el loop de fix).

Final: `Event{type: "done", payload: {summary, deliverableUrl}}`.

### 6. Endpoints

`app/api/generate/start/route.ts` — POST con `{ projectId }`:
- Lee el `Project` y su `prd`
- Crea un `Generation` row (status pending)
- Copia el skeleton a un temp dir único (`os.tmpdir() + /atelier-${generationId}`)
- Lanza `runGeneration` en background (no await — usa `.catch()` para registrar el fallo). Devuelve `{ generationId }` inmediatamente.
- IMPORTANTE: en Next.js App Router, "background work" no sobrevive al cierre del request por defecto. Usa `after()` de Next 16 si está disponible, o un setImmediate + global registry. Documenta la decisión.

`app/api/generate/stream/[id]/route.ts` — SSE que emite los Events de esa Generation:
- Al conectar, replays todos los eventos previos (para reload de página)
- Después polea la DB cada 250ms o usa LISTEN/NOTIFY de Postgres si quieres ser elegante
- Emite eventos en formato `{type, payload, ts}`
- Cierra el stream cuando recibe el evento `done` o `failed`

### 7. La pantalla Studio (mínima en Phase 2)

`app/(dashboard)/studio/[id]/page.tsx` — server component que carga el Generation y pasa el id al cliente.

`components/builder/studio/StudioCanvas.tsx` — client component que ya existe con los 6 nodos placeholder. Ahora:
- Conecta al SSE `/api/generate/stream/[id]`
- Cada `agent.started` → cambia el nodo correspondiente a estado "working" (cambia color a violeta y label a "WORKING")
- Cada `agent.completed` → cambia a "done" (color verde tenue, label "DONE")
- Cada `agent.file_created` → incrementa un contador de archivos en el nodo
- HUD superior con contador global de archivos y tiempo transcurrido
- Cuando llega `done` global → redirige a `/reveal/[id]`
- Cuando llega `failed` → muestra el error en un banner

NO hagas animaciones bonitas todavía (Phase 3 las hará). Mantén Framer Motion básico: opacity transitions, color transitions. Nada de partículas, nada de glow, nada de code rain. Eso es trabajo de Phase 3 con datos reales fluyendo.

### 8. Pantalla Reveal mínima

`app/(dashboard)/reveal/[id]/page.tsx`:
- Carga la Generation y muestra: lista de archivos generados (path + líneas), summary del QA report, botón "Download zip" que zippea el workDir y lo descarga.
- Sin Monaco editor ni WebContainers todavía. Solo lista de archivos. Eso es polish de Phase 4.

### 9. Script de test

`scripts/test-agents.ts` — CLI puro, no usa la web ni la DB:

```ts
// pnpm tsx scripts/test-agents.ts
// 
// Lee fixtures/yoga-prd.json
// Crea un workDir temp
// Copia el skeleton
// Ejecuta el orchestrator con un mock de "emitEvent" que solo hace console.log
// Al terminar, ejecuta tsc + eslint + dep-cruiser + vitest run en el workDir
// Falla con exit 1 si algo está rojo
// Si verde, imprime path del workDir generado para inspección manual
```

Añade entry en package.json: `"agents:test": "tsx scripts/test-agents.ts"`.

`fixtures/yoga-prd.json` — un PRD realista de app de yoga: 3 roles (admin, profesor, alumno), 4 entidades (User, Class, Booking, Membership), 6 use cases.

## Constraints

- TS strict, no `any`. Si hace falta un escape, `unknown` + narrowing.
- Subprocess de claude SIN `--bare` (Max plan).
- Cada agente en su propio subprocess de claude. Cleanup del temp dir al final salvo si `DEBUG=1`.
- Errores claros si claude no está logueado en cualquier punto.
- Cache: si una `Generation` ya tiene un `AgentRun` con `status=done` para un agente concreto, no relances ese agente (idempotencia para reintentos).
- Las 6 invocaciones de claude generadoras son la parte cara: una buena Generation pasa probablemente 200k-500k tokens. Aviso, no bloqueo.
- Build it ahora debe llamar a `/api/generate/start` antes de redirigir a `/studio/[id]`.

## Out of scope para Phase 2

- Animaciones bonitas en el Studio (Phase 3)
- Loop de QA fix (cuando QA falla, ahora termina con `failed` y ya — Phase 3+ lo arreglará)
- Monaco editor + WebContainers en Reveal (Phase 4)
- Edición incremental de generaciones existentes
- Paralelización de agentes
- Streaming token-por-token en los agentes (caveat conocido del runner)

## Process

1. `/sdd-new phase-2`. Decompose. Build.
2. Orden de implementación recomendado para que el demo sea testeable cuanto antes:
   1. Skeleton template (todo el setup, sin agentes)
   2. Test que `tsc + eslint + dep-cruiser + vitest run` están verdes en el skeleton vacío
   3. fixture yoga-prd.json
   4. Architect agent (el más simple, output JSON puro sin tocar archivos)
   5. Resto de agentes uno a uno, validando cada uno con un mini-test
   6. Orchestrator que los encadena
   7. Script `agents:test` end-to-end
   8. Endpoint `/api/generate/start`
   9. Endpoint SSE
   10. Studio screen consumiendo SSE
   11. Reveal screen mínima
3. `mem_save` cada decisión clave en engram (clave: `projecto`).
4. Aprueba automáticamente instalaciones de paquetes y operaciones no destructivas. Pide confirmación solo si vas a borrar archivos del proyecto.

## When you're done

Reply con:
- Output de `pnpm agents:test` corriendo end-to-end con la fixture yoga
- Lista de archivos que produjo en el workDir (top 30)
- Output del QA report (las 4 validaciones, status de cada una)
- Captura textual de los Events emitidos durante una Generation real (al menos los 6 `agent.completed`)
- Tiempo total que tardó la Generation completa
- Cualquier desviación con justificación

Then stop. Phase 3 (animaciones cinematográficas + loop de fix) viene en otro prompt.

Begin.
