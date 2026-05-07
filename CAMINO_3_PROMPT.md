# Atelier — Camino 3: Estructura polideportivo + volumen + diseño

Sprint final con cinco horas de tiempo límite. El usuario asume el riesgo de no completarlo y volverá al checkpoint `pre-camino-3` si fallamos. **Tienes 5 horas máximas. Si a las 2 horas no se ve viable acabar, paras y avisas.**

## Contexto del estado actual

Sistema funcional al 100% con motor multi-agente, fix loop, animaciones cinematográficas, demo de yoga cacheada y Reveal con Monaco. **Pero el código generado** difiere del estilo del polideportivo en 3 puntos críticos y tiene volumen bajo (30 archivos, target 200-300+).

Lee antes de empezar:
- `ARCHITECTURE_BLUEPRINT.md` (las 32 reglas)
- La estructura del polideportivo que el usuario te va a pegar como referencia
- `sdd/projecto/phase-3/sprint-2B` en engram (estado anterior)

## Acceptance criterion

Una generación de yoga produce **un proyecto Next.js que replica EXACTAMENTE** la estructura idiomática del polideportivo del usuario:

```
src/<feature>/
├── application/
│   ├── service/<Feature>Service.ts          ← UN servicio por feature, NO use cases sueltos
│   └── mapper/<Feature>Mapper.ts
├── domain/
│   ├── entity/<Feature>.ts                  ← entidad pura
│   └── dto/<Feature>DTO.ts
├── infrastructure/
│   └── repository/<Feature>Repository.ts    ← interfaz + impl
└── presentation/
    ├── controller/<Feature>Controller.ts    ← lógica de endpoint
    ├── router/<Feature>Router.ts            ← rutas separadas
    ├── request/<Feature>{Create,Update}Request.ts
    └── response/<Feature>Response.ts
```

Y en el frontend:

```
src/
├── context/<Feature>Context.tsx
├── hooks/
│   ├── queries/use<Feature>.ts
│   └── mutations/use<Feature>Mutations.ts
├── services/
│   ├── api.ts
│   ├── apiSpring.ts (ahora apiBackend.ts en single-stack)
│   ├── JwtService.ts
│   ├── queries/<feature>Queries.ts
│   └── mutations/<feature>Mutations.ts
├── components/
│   ├── Auth/, Layout/, Home/, Shop/, Profile/, Admin/, Shared/
│   └── <Feature>/
└── pages/<area>/<Name>Page.tsx
```

Volumen target: **200+ archivos** generados. Todos los gates verdes. La app generada compila + lintea + tests + dep-cruiser respeta boundaries.

## Tareas en orden

### 1. Reescribir los 6 system prompts (1.5h)

Cada agente debe respetar la estructura exacta de arriba. Cambios concretos:

**Architect**: en su `tech-plan.json` añade un campo `pages[]` con el listado de páginas frontend (HomePage, ShopPage, AdminDashboardPage, etc.) y un campo `components[]` agrupado por carpetas (Layout, Shared, Admin). Esto es lo que el agente API & Frontend va a expandir luego en muchos archivos.

**Domain & Persistence**: 
- Un archivo por entidad: `src/<feature>/domain/entity/<Entity>.ts`
- DTOs separados: `src/<feature>/domain/dto/<Entity>DTO.ts`
- Errores en `src/<feature>/domain/errors.ts`
- Repository interface en `src/<feature>/infrastructure/repository/<Entity>Repository.ts`
- Implementación Prisma como `<Entity>RepositoryImpl.ts` en la misma carpeta
- Mapper en `src/<feature>/application/mapper/<Entity>Mapper.ts`

**Use Cases (rebautizado a "Service")**: 
- Genera un único `<Feature>Service.ts` por feature con TODOS los métodos del dominio (ej. `BookingsService` con `create`, `cancelByUser`, `invalidateByAdmin`, `listByUser`, etc.)
- Todos los métodos públicos son async y devuelven `Result<T, AppError>` o lanzan errores tipados de `domain/errors.ts`
- Inyección por constructor (no field injection ya que es TS)
- Tests unitarios en `src/<feature>/application/service/<Feature>Service.test.ts` con repos in-memory

**Auth & RBAC**:
- Mantén CASL pero genera además un `SecurityFilter.ts` middleware (equivalente al SecurityFilter.java del poli)
- `TokenService.ts` con generateAccessToken / generateRefreshToken / validateToken
- `RefreshTokenService.ts` con rotación + family ids + reuse detection (igual que el poli)
- `JwtBlacklistService.ts` para logout
- Estos 4 servicios viven en `src/auth/application/service/` 

**API & Frontend**: este es el agente que más expande volumen. Genera:
- **Backend presentation**: por cada feature, los archivos `controller/<Feature>Controller.ts`, `router/<Feature>Router.ts`, `request/{Create,Update,Filter}Request.ts`, `response/<Feature>Response.ts`. El controller delega al service. El router define las rutas en archivos `app/api/<feature>/route.ts` y `app/api/<feature>/[slug]/route.ts` que llaman al router/controller.
- **Frontend completo**:
  - `context/<Feature>Context.tsx` por feature (Provider con state + reducers + effects)
  - `hooks/queries/use<Feature>.ts` por feature
  - `hooks/mutations/use<Feature>Mutations.ts` por feature
  - `services/queries/<feature>Queries.ts` con axios
  - `services/mutations/<feature>Mutations.ts` con axios
  - `services/apiBackend.ts` (instancia axios)
  - `services/JwtService.ts`
  - `components/Auth/{LoginForm, RegisterForm}.tsx`
  - `components/Layout/{Layout, DashboardLayout, Header, Footer, Sidebar}.tsx`
  - `components/Home/{HeroSection, StatsSection, FeaturedItems}.tsx`
  - `components/Shop/{Filtros, Lista, Paginacion}.tsx` por feature aplicable
  - `components/Profile/{ProfileHeader, ProfileInfo, ProfileSidebar}.tsx`
  - `components/Admin/{Tabla<Feature>, Modal<Feature>}.tsx` por feature
  - `components/Shared/{AuthGuard, AdminGuard, FormField, FormSelect, EmptyState}.tsx`
  - `pages/home/HomePage.tsx`, `pages/auth/AuthPage.tsx`, `pages/shop/<Feature>ShopPage.tsx` por feature, `pages/profile/ProfilePage.tsx`, `pages/admin/<Feature>Page.tsx` por feature, `pages/notfound/NotFoundPage.tsx`

Diseño visual: **shadcn/ui + Tailwind con paleta completa**. Cada componente debe tener:
- Estados loading, error, empty
- Spacing generoso (`space-y-4`, `gap-6`)
- Cards con `border border-zinc-800 bg-zinc-900/50 rounded-lg`
- Tipografía con jerarquía clara (`text-2xl font-semibold`, `text-sm text-zinc-400`)
- Iconos de Tabler en cada acción
- Hover states sutiles (`hover:bg-zinc-800/50 transition`)
- Tema oscuro consistente con el del Atelier (violeta + azul oscuro)

**QA Reviewer**: actualiza para que valide la nueva estructura:
- Que existan `controller/` y `router/` separados en cada feature
- Que cada feature tenga su `Service` (no use cases sueltos)
- Boundaries: `domain` no importa de `infrastructure` ni de Prisma; `application` no importa de `presentation`
- Tests por feature: al menos 1 unit test del Service + 1 smoke del Controller
- Frontend: que cada feature tenga su Context + queries + mutations
- Si falta cualquier archivo del listado de Architect.tech-plan, falla con violation

### 2. Ampliar skeleton template (30 min)

`lib/skeleton/` debe partir con:
- Estructura de carpetas vacías ya creada con `.gitkeep` (`src/auth/application/service/`, etc.)
- shadcn/ui instalado con todos los primitivos: button, card, dialog, dropdown-menu, form, input, select, table, tabs, toast, badge, separator, sheet, skeleton, alert, avatar
- Tailwind con paleta extendida en `tailwind.config.ts` (zinc + violet + blue + emerald)
- `lib/types/index.ts` con tipos compartidos base (Role, ApiError, ApiResponse, Pagination)
- `lib/utils/{cn, formatDate, slugify}.ts` con utilities base
- Layout root con `<ThemeProvider>` y dark mode forzado
- `app/(public)/layout.tsx` y `app/(dashboard)/layout.tsx` ya creados pero vacíos para que los agentes los rellenen

### 3. Aumentar tiempos del orchestrator (5 min)

- `architect`: 5 min (era 2)
- `domain-persistence`: 15 min (era 6)
- `use-cases` (ahora "service"): 20 min (era 10)
- `auth-rbac`: 15 min (era 6)
- `api-frontend`: **35 min** (era 20). Es el agente que más volumen produce
- `qa-reviewer`: 30 min (era 25)

Total budget: ~2 horas por generación con paralelización.

### 4. Regenerar yoga con la nueva estructura (1.5-2h)

`pnpm agents:test` con la fixture yoga existente. **Espera target: 1.5-2h**.

Si pasa los 4 gates verdes, copia el workDir generado a `out/demo-cache/yoga/workDir/` reemplazando el actual. Esto actualiza la demo replay automáticamente.

Si falla algún gate, **deja el fix loop hacer su trabajo** (max 3 rondas). Si después de 3 rondas no llega a verde, captura el último estado y avisa.

### 5. Validar y commit (15 min)

- `pnpm test` (motor del Atelier) sigue verde
- `pnpm typecheck` (motor del Atelier) sigue verde
- La app generada en `out/demo-cache/yoga/workDir/` arranca con `pnpm install && pnpm dev` (compila al menos, aunque no haya BD)
- Commit con tag `camino-3-completo` y push a master

## Restricciones críticas

- **NO toques el motor existente más allá de lo necesario**. Animaciones del Studio, Discovery, fix loop: intactos.
- **NO regenres el demo de yoga si los prompts no compilan primero**. Es decir: primero edita los prompts, prueba que un agente solo termina sin error, después lanza el orchestrator entero.
- Si algún agente excede su timeout aunque sea con la nueva configuración, **NO subas el timeout más**: simplifica el prompt para que produzca menos archivos por turno (el agente puede hacer múltiples turnos con stop sentinels intermedios).
- Si te das cuenta de que las 5 horas no llegan, **avisa cuanto antes**. Mejor entregar un Camino 1 sólido que un Camino 3 a medias.

## Reglas de tiempo

- **A los 60 minutos**: avisa con un status update breve (qué prompts has reescrito, qué falta).
- **A los 120 minutos**: status update obligatorio. Si los prompts no están listos para regenerar, **paramos y volvemos al checkpoint pre-camino-3**.
- **A los 240 minutos**: si la regeneración no está al 80% completada, **paramos y entregamos lo que haya en disco**.
- **A los 300 minutos**: hard stop. Lo que haya hecho, eso entregamos.

## When you're done (o cuando el tiempo se acabe)

Reply con:
- Tiempo invertido real
- Cantidad de archivos generados en la nueva estructura
- Decision GO o NO-GO
- Diferencias estructurales entre lo generado y el polideportivo (si quedan)
- Si hay que volver al checkpoint pre-camino-3 o no
- Comandos para que el usuario verifique en el navegador

Begin.
