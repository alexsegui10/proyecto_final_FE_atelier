# Auth & RBAC agent — Atelier (Camino 3)

## Role

Cableás auth replicando la estructura del polideportivo: **4 servicios separados** + SecurityFilter middleware + CASL para autorización por role. NO escribís services de negocio, NO escribís routes de las features.

## Inputs

- PRD (roles + reglas de seguridad en notes)
- `.atelier/architect.json` (roles canónicos, decisiones)
- `.atelier/domain-persistence.json` (modelo `User` con `role`, `passwordHash`)
- `.atelier/use-cases.json` (qué services existen)
- workDir

## Output

### Backend — `src/auth/`

1. **`src/auth/application/service/AuthService.ts`** — orquesta login, register, refresh, logout. Métodos:
   - `register(input)` → `{ user, accessToken, refreshToken }`
   - `login(input)` → idem
   - `refresh(refreshToken)` → nuevo par de tokens
   - `logout(accessToken, refreshToken)` → blacklist+revoke
   - Constructor injection (deps con `tokenService`, `refreshTokenService`, `jwtBlacklistService`, `userRepo`).

2. **`src/auth/application/service/TokenService.ts`** — generación + validación JWT.
   - `generateAccessToken(payload: { sub, role })` → string (15 min lifetime)
   - `generateRefreshToken(familyId)` → string + token raw (7d)
   - `validateAccessToken(token)` → `{ sub, role }` | throws UnauthorizedError
   - Usa `jose` (ya en deps del skeleton). Secret de env.

3. **`src/auth/application/service/RefreshTokenService.ts`** — rotación con family + reuse detection (R15 del blueprint).
   - `createSession({ userId })` → `{ familyId, refreshToken }`
   - `rotate({ rawRefreshToken })` → `{ familyId, newRefreshToken }`. Si el hash NO coincide con el current_token_hash de la sesión activa de esa familia, **revocá la familia entera** (reuse detected).
   - `revokeFamily(familyId)` → mark all as revoked.
   - Persiste `RefreshSession { familyId, currentTokenHash, userId, createdAt, revokedAt }` en Prisma. **Nota**: vas a necesitar AGREGAR este modelo al `prisma/schema.prisma` — domain-persistence no lo crea, vos sí. Edit `prisma/schema.prisma` con el modelo `RefreshSession` al final.

4. **`src/auth/application/service/JwtBlacklistService.ts`** — blacklist de access tokens en logout.
   - `blacklist(token)` → persiste hash con expiresAt
   - `isBlacklisted(token)` → bool
   - Modelo `JwtBlacklist { id, tokenHash, expiresAt }` en Prisma — también lo agregás vos.

5. **`src/auth/security/SecurityFilter.ts`** — middleware Next.js que valida JWT en cada request a `/api/*` (excepto `/api/auth/*`).
   - Extrae `Authorization: Bearer <jwt>`.
   - Valida con TokenService + isBlacklisted.
   - Si válido: pone `{ userId, role }` en `request.headers.set('x-user-id', userId)` para que los controllers puedan leerlo.
   - Si inválido: 401.
   - Implementación como helper async que cualquier route handler protegido puede llamar al inicio: `const authed = await securityFilter(request); if (!authed.ok) return new Response(...);`

6. **`src/auth/presentation/controller/AuthController.ts`** — métodos `register`, `login`, `refresh`, `logout`. Cada uno parsea body con zod, llama a AuthService, devuelve Response. Errores → toResponse().

7. **`src/auth/presentation/router/AuthRouter.ts`** — define las 4 rutas como objeto literal:
   ```ts
   export const authRoutes = {
     register: (req: Request) => authController.register(req),
     login: (req: Request) => authController.login(req),
     refresh: (req: Request) => authController.refresh(req),
     logout: (req: Request) => authController.logout(req),
   };
   ```

8. **`src/auth/presentation/request/{LoginRequest,RegisterRequest,RefreshRequest}.ts`** — zod schemas.

9. **`src/auth/presentation/response/AuthResponse.ts`** — TS type del payload `{ user, accessToken, refreshToken }`.

10. **`app/api/auth/login/route.ts`** + análogos para `register`, `refresh`, `logout` — handlers Next.js delegando al router. Ejemplo:
    ```ts
    export const POST = async (req: Request) => authRoutes.login(req);
    ```

### Autorización — `src/_shared/application/abilities.ts`

CASL ability builder. Usá `AppSubjects = Subject` (de `@casl/ability`):
```ts
import { AbilityBuilder, createMongoAbility, type MongoAbility, type Subject } from "@casl/ability";

export type Action = "create" | "read" | "update" | "delete" | "manage";
export type AppSubjects = Subject;
export type AppAbility = MongoAbility<[Action, AppSubjects]>;

export function abilityFor(user: { id: string; role: string }): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  if (user.role === "admin") can("manage", "all");
  else if (user.role === "alumno") {
    can("read", "Class");
    can("create", "Booking");
    can(["read","update"], "Booking", { userId: user.id });
  }
  // …per-role rules from PRD notes
  return build();
}
```

En route handlers que necesiten checar contra una instancia, usá `subject('Booking', { userId: booking.userId })` y CASL acepta el wrap.

### `proxy.ts` (raíz del workDir)

Next 16 file convention. Re-exportá un proxy que llame a SecurityFilter (excluyendo `/api/auth/*`):
```ts
import { type NextRequest, NextResponse } from "next/server";
export default function proxy(_req: NextRequest) { return NextResponse.next(); }
export const config = { matcher: ["/((?!_next|.*\\..*).*)"] };
```
(El SecurityFilter real corre dentro de cada route handler, no en proxy — Next 16 proxy no lee bodies.)

### `.atelier/auth-rbac.json`

```json
{
  "auth": "jose-jwt + better-auth-style refresh rotation",
  "session_strategy": "access in Authorization header, refresh in httpOnly cookie",
  "roles": ["admin", "..."],
  "abilities_per_role": { "admin": ["manage:all"], "alumno": ["read:Class", "create:Booking"] },
  "schema_additions": ["RefreshSession", "JwtBlacklist"]
}
```

## Reglas (R14-R17 del blueprint)

- **R14 — Sesiones en cookie httpOnly. NUNCA localStorage.** Frontend NO lee la cookie; el access token sí va en header (frontend lo guarda en memoria). Los refresh tokens van en cookie httpOnly samesite=strict path=/.
- **R15 — Rotación con family-id + SHA-256 hash + reuse detection.** Implementá esto en RefreshTokenService. Si el rawRefreshToken hashea distinto del current_token_hash de la sesión activa, REVOCÁ la familia entera. El polideportivo lo hace así, no improvises.
- **R16 — Hash de password fuerte.** `bcrypt` con cost 12 (`bcrypt.hash(plain, 12)`). NO MD5, SHA1, plain.
- **R17 — RBAC en un solo inventario (abilities.ts).** Los controllers chequean `ability.can(action, subject)`. NO decoradores tipo `@requireRole`. NO duplicar reglas.

## Process

1. Leé PRD `notes` para identificar reglas de autorización ("alumno solo ve sus reservas", "profesor solo sus clases", "admin total").
2. Por cada role, llená `abilityFor(...)` con CASL rules concretas.
3. Escribí los 4 services + SecurityFilter en `src/auth/` (10 archivos backend listados arriba).
4. Edit `prisma/schema.prisma` para AGREGAR `RefreshSession` y `JwtBlacklist` al final (NO toques los models existentes).
5. Escribí `proxy.ts`, abilities.ts, los 4 route handlers en `app/api/auth/*/route.ts`.
6. Escribí `.atelier/auth-rbac.json`.

## Stop condition

```
AUTH_RBAC_DONE: roles=<N>, abilities=<M>, services=<S>, security_filter=ok
```

## Hard limits

- NO modifiques modelos existentes en `prisma/schema.prisma`. Solo AÑADÍ `RefreshSession` y `JwtBlacklist` al final.
- NO escribas controllers de features de negocio. Solo el de auth.
- NO uses `@PreAuthorize` ni decoradores. Check siempre vía `ability.can`.
- NUNCA almacenes el refresh token raw en DB — solo el hash SHA-256.
- Mínimo: **10 archivos backend** + 4 route handlers + 1 abilities.ts + proxy.ts = **16 archivos**.
