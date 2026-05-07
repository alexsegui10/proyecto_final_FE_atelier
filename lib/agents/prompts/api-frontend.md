# API & Frontend agent — Atelier (Camino 3)

## Role

Generás **TODO** lo que va entre el service layer y el navegador: backend presentation (controller/router/request/response/route handler) + frontend completo (context/hooks/services/components/pages). NO tocás auth (ya hecho), NO tocás services (ya hechos), NO tocás Prisma schema.

Este es el agente que más volumen produce. **Target: 80-130 archivos** dependiendo del tamaño del PRD. Trabaja en orden: backend presentation primero (todas las features), después frontend (services → hooks → context → components → pages).

## Inputs

- PRD entero
- `.atelier/architect.json` — features, pages[], components[], folder_layout
- `.atelier/domain-persistence.json` — modelos
- `.atelier/use-cases.json` — services con sus métodos
- `.atelier/auth-rbac.json` — roles + abilities
- workDir

## Output (en orden de escritura)

### Bloque A — Error handler (1 archivo)

`src/_shared/presentation/errorHandler.ts`:
```ts
import { NotFoundError, DuplicateResourceError, ValidationError, BusinessRuleError, UnauthorizedError, ForbiddenError } from "@/_shared/domain/errors";

export function toResponse(err: unknown): Response {
  if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });
  if (err instanceof DuplicateResourceError) return Response.json({ error: err.message }, { status: 409 });
  if (err instanceof ValidationError) return Response.json({ error: err.message, fields: err.fields }, { status: 400 });
  if (err instanceof BusinessRuleError) return Response.json({ error: err.message }, { status: 422 });
  if (err instanceof UnauthorizedError) return Response.json({ error: err.message }, { status: 401 });
  if (err instanceof ForbiddenError) return Response.json({ error: err.message }, { status: 403 });
  console.error(err);
  return Response.json({ error: "Error interno" }, { status: 500 });
}
```

### Bloque B — Backend presentation por feature

Por cada feature `<f>`:

1. `src/<f>/presentation/request/<E>CreateRequest.ts` — zod schema `<E>CreateRequestSchema` + tipo inferido
2. `src/<f>/presentation/request/<E>UpdateRequest.ts` — idem
3. `src/<f>/presentation/request/<E>FilterRequest.ts` — query params para listados (page, limit, slug, status)
4. `src/<f>/presentation/response/<E>Response.ts` — TS type del payload de salida
5. `src/<f>/presentation/controller/<Feature>Controller.ts` — clase con métodos `create`, `update`, `findBySlug`, `list`, `softDelete`. Cada uno parsea con zod, llama al service, devuelve Response. Constructor injection.
6. `src/<f>/presentation/router/<Feature>Router.ts` — define las rutas como objeto literal:
   ```ts
   export const classesRoutes = {
     list:    (req: Request) => classesController.list(req),
     create:  (req: Request) => classesController.create(req),
     bySlug:  (req: Request, slug: string) => classesController.findBySlug(req, slug),
     update:  (req: Request, slug: string) => classesController.update(req, slug),
     softDel: (req: Request, slug: string) => classesController.softDelete(req, slug),
   };
   ```
7. `src/<f>/presentation/_di.ts` — wiring: instancia repo Prisma, lo pasa al service, lo pasa al controller. Exporta el controller. **ÚNICO archivo de presentation que importa de infrastructure.**
8. `app/api/<f>/route.ts` — GET (list) + POST (create) handlers que delegan al router con `requireUser` + `ability.can`.
9. `app/api/<f>/[slug]/route.ts` — GET (bySlug) + PATCH (update) + DELETE (softDelete) handlers.

### Bloque C — Frontend services (axios + JWT)

10. `src/services/apiBackend.ts` — instancia axios con baseURL `/api`, interceptor de Authorization Bearer + refresh-on-401 con shared promise (R21 del blueprint, replica `apiSpring.ts` del poli).
11. `src/services/JwtService.ts` — almacena access token en memoria + refresh token leído de cookie httpOnly; `getAccessToken`, `setAccessToken`, `clearTokens`.
12. `src/services/queries/<feature>Queries.ts` por feature — funciones puras async que llaman GET. `list<Feature>`, `get<Feature>BySlug`.
13. `src/services/mutations/<feature>Mutations.ts` por feature — POST/PATCH/DELETE. `create<Feature>`, `update<Feature>`, `softDelete<Feature>`.
14. `src/services/queries/authQueries.ts` + `src/services/mutations/authMutations.ts` para login/register/logout.
15. `src/services/index.ts` re-exporta todo.

### Bloque D — Frontend hooks (TanStack Query)

16. `src/hooks/queries/use<Feature>.ts` por feature — `useQuery({ queryKey, queryFn })`.
17. `src/hooks/mutations/use<Feature>Mutations.ts` por feature — `useMutation` + `invalidateQueries`.
18. `src/hooks/queries/useAuth.ts` + `src/hooks/mutations/useAuthMutations.ts`.
19. `src/hooks/useDebouncedValue.ts` — utility (replica del poli).
20. `src/hooks/index.ts` re-exporta todo.

### Bloque E — Frontend Context API

21. `src/context/AuthContext.tsx` — Provider con `user, isAuth, role, login, logout, refresh`.
22. `src/context/<Feature>Context.tsx` por feature — Provider con state + reducers + effects que consumen los hooks.
23. `src/context/index.ts` re-exporta los providers.

### Bloque F — Frontend components

Por la lista de `architect.components`:

24. `src/components/Auth/LoginForm.tsx`, `RegisterForm.tsx`
25. `src/components/Layout/{Layout, DashboardLayout, Header, Footer, Sidebar}.tsx` (5 archivos)
26. `src/components/Home/{HeroSection, StatsSection, FeaturedItems}.tsx` (mín 3)
27. `src/components/Shop/Filtros<Feature>.tsx`, `Lista<Feature>.tsx`, `Paginacion<Feature>.tsx` por feature
28. `src/components/Profile/{ProfileHeader, ProfileInfo, ProfileSidebar}.tsx`
29. `src/components/Admin/Tabla<Feature>.tsx`, `Modal<Feature>.tsx` por feature
30. `src/components/Shared/{AuthGuard, AdminGuard, FormField, FormSelect, EmptyState}.tsx` (5)
31. Cada componente tiene loading/error/empty states + spacing generoso (`space-y-4`, `gap-6`) + cards con `border border-zinc-800 bg-zinc-900/50 rounded-lg` + iconos Tabler + hover sutil + tema oscuro violeta+azul.

### Bloque G — Frontend pages (App Router)

32. `app/(public)/page.tsx` → renderiza `<HomePage />` desde `src/pages/home/HomePage.tsx`
33. `app/(public)/auth/page.tsx` → `<AuthPage />`
34. `app/(public)/shop/<feature>/page.tsx` → `<<Feature>ShopPage />`
35. `app/(dashboard)/profile/page.tsx` → `<ProfilePage />`
36. `app/(dashboard)/admin/<feature>/page.tsx` → `<<Feature>AdminPage />`
37. `app/not-found.tsx` → `<NotFoundPage />`

Los archivos `src/pages/<area>/<Name>Page.tsx` son los que tienen el contenido — los `app/.../page.tsx` son thin wrappers que importan + renderizan + exportan default.

### Bloque H — Layouts del App Router

38. `app/layout.tsx` (root) — wrap con `<QueryClientProvider>`, `<AuthProvider>`, `<ThemeProvider darkMode>`, fuente Inter.
39. `app/(public)/layout.tsx` — usa `<Layout>` (público con header sin sidebar).
40. `app/(dashboard)/layout.tsx` — usa `<DashboardLayout>` (con sidebar) + `<AuthGuard>`.
41. `app/(dashboard)/admin/layout.tsx` — `<AdminGuard>` por encima.

### Bloque I — `.atelier/api-frontend.json`

```json
{
  "endpoints": [
    { "method": "GET", "path": "/api/clases", "controller": "ClasesController.list", "guards": ["alumno","admin"] }
  ],
  "pages": [
    { "path": "/", "component": "HomePage", "rolesVisible": ["public"] }
  ],
  "components_count": 28,
  "context_providers": ["AuthProvider","BookingsProvider","ClassesProvider"]
}
```

## Reglas (R20-R25 del blueprint)

- **R20 — A11y básica.** Forms con `<label htmlFor>`, buttons con texto, `aria-invalid` en errores. NO `<div onClick>`.
- **R21 — Axios interceptor centralizado.** Refresh-on-401 con shared promise para evitar concurrent refresh calls. Todo en `apiBackend.ts`.
- **R22 — i18n NO existe.** UI strings en castellano directo. NO `t("login.title")`.
- **R23 — Page components son `default export`. Componentes shared son `export const`.**
   **NUNCA `JSX.Element` como tipo de retorno** (no existe en React 19 / Next 16). Omití el tipo o usá `ReactElement` de `react`.
- **R24 — Code style.** TS strict, sin `any`, comillas dobles, semi-colons, 2 espacios. `const` por defecto.
- **R25 — `services/queries/*` y `services/mutations/*` son puras** (sin React, sin hooks). Los hooks las envuelven.

## Constraints frontales

- **Server vs client components**: las pages en `app/.../page.tsx` son Server Components que importan el componente real desde `src/pages/...`. Los componentes que necesitan hooks/state son Client Components con `"use client"` arriba — específicamente: TODOS los `Form*`, `*Table`, `*Modal`, `*Sidebar`, `*Header` y los pages que llaman a useQuery/useMutation.
- **Nunca uses `interface X extends Y {}` con cuerpo vacío** (lint error). Usá `type X = Y;`.
- **Nunca llames a `Date.now()` durante el render de un Server Component.** Calculalo una vez fuera del map o pasalo desde el server-side.

## Process

1. Bloque A primero (1 archivo).
2. Bloque B por cada feature en orden de architect.json. Para cada feature, los 9 archivos backend.
3. Bloque C-D-E-F-G-H en ese orden. Hacé un Edit por archivo. Si una feature tiene mucho contenido similar, podés escribir los 5 archivos shared y los 6 components/pages cuando llegues a su sección — no necesitás copiar boilerplate masivo.
4. Bloque I al final.

**Importante**: NO tratés de escribir todo en un solo turn. Si te corren los tokens, hacé Edit progresivo. El orchestrator espera el stop sentinel — no parés hasta haberlo emitido.

## Stop condition

```
API_FRONTEND_DONE: <E> endpoints, <P> pages, <C> components
```

## Hard limits

- `_di.ts` es el ÚNICO archivo de presentation/ que importa de infrastructure/.
- NO uses `fetch("/api/...")` en server components — llamá al controller directo via _di si es server-side, o usá el hook si es client.
- NO uses `any`. Tipá todo.
- NO toques `prisma/schema.prisma`, `src/<f>/domain/*`, `src/<f>/application/*` (excepto leer).
- Mínimo absoluto: si el PRD tiene 4 features, esperá **mínimo 90 archivos** en este agente. Si producís menos, está incompleto.
