---
name: runtime-diagnostics
description: Patterns for detecting and resolving common boot-time and runtime problems in generated Atelier apps. Trigger when implementing the Bootstrap & DevOps Agent or the Visual QA Agent — both need to recognize the same fault library.
---

# Runtime Diagnostics

A taxonomy of the most common failures that prevent an Atelier-generated app from booting or running cleanly, paired with detection logic and actionable fixes.

This skill is consumed by:

- **Bootstrap & DevOps Agent** (writes `check-environment.ts`).
- **Visual QA Agent** (interprets failures it observes through Playwright).

The taxonomy is the lingua franca: when Visual QA reports `db-unreachable`, the fix loop routes the violation to Bootstrap by `id`, and the suggested remediation flows back to the human verbatim.

## Fault library

Each fault has the same shape:

```ts
interface Fault {
  id: string;                          // kebab-case stable id
  category: "env" | "service" | "build" | "runtime" | "auth" | "data";
  symptom: string;                     // what the user sees
  detect: string;                      // how to confirm it's THIS fault
  rootCauses: string[];                // typical culprits
  fixSuggestion: string;               // copy-pasteable action
  preventiveCheck?: string;            // what check-environment.ts should do
}
```

### env / service category

#### `db-unreachable`

- **Symptom**: API returns 500 with "Can't reach database server". Boot fails with `ECONNREFUSED 127.0.0.1:5433`.
- **Detect**: open TCP connection to the host:port parsed from `DATABASE_URL`. Timeout 2s.
- **Root causes**: Docker Desktop not running, Postgres container down, wrong `POSTGRES_HOST_PORT`, firewall.
- **Fix**: `docker compose up -d postgres && docker compose exec postgres pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`. If that fails, suggest switching to Neon: set `NEON_DATABASE_URL` in `.env.local`.
- **Preventive**: `check-environment.ts` opens the TCP probe at boot.

#### `port-conflict`

- **Symptom**: `bind: address already in use` on 3000 or 5433.
- **Detect**: probe the port; if already bound, identify the process via `lsof -i :3000` (mac/linux) or `Get-NetTCPConnection -LocalPort 3000` (windows).
- **Fix**: kill the offending process OR change `PORT` / `POSTGRES_HOST_PORT` in `.env.local`.

#### `env-var-missing`

- **Symptom**: `AUTH_JWT_SECRET is not configured` or similar, app exits 1 at boot.
- **Detect**: Zod schema in `src/_shared/config/env.ts` `safeParse(process.env)` returns failure.
- **Fix**: Copy `.env.example` to `.env.local` and fill in the missing vars. For secrets, run `openssl rand -hex 32`.
- **Preventive**: env validator runs `process.exit(1)` with the unknown var name highlighted.

#### `env-var-typo` (the original bug A from yoga v2)

- **Symptom**: code reads `process.env.JWT_SECRET` but `.env.local` has `AUTH_JWT_SECRET`. The validator can't catch it because the agent that USES the var read the wrong name.
- **Detect**: scan the codebase for `process.env\.[A-Z]` outside the canonical allowlist (`src/_shared/config/env.ts`, `next.config.{ts,mjs,js}`). The implementation lives in `lib/agents/runtime/qa-gates/env-leak-scanner.ts` (function `scanProcessEnvLeaks`) and is invoked by the Wave 6 runtime BEFORE the qa-reviewer LLM; the hits are merged into `qa-report.violations[]` with `rule: "env-leak"`, `severity: "error"`, `agent: "bootstrap-devops"`.
- **Fix**: replace direct `process.env` access with `import { env } from "@/_shared/config/env"`; if the var is missing from the manifest, the fix loop re-invokes Bootstrap to add it (see R0 in `prompts-v3/bootstrap-devops.md`).
- **Preventive**: the env-leak gate is permanent in Wave 6. The scanner skips line/block comments (so `// process.env.X` notes don't false-positive) and the regex's `[A-Z]` start anchor naturally rejects interpolation placeholders like `process.env.${KEY}`.

### build category

#### `prisma-client-missing`

- **Symptom**: `Cannot find module '@prisma/client'` or `Cannot find module '@/_shared/infrastructure/db/generated/client'`.
- **Detect**: try `pnpm prisma generate`; if it fails, the schema is broken.
- **Fix**: `pnpm prisma generate` (idempotent). If still failing, inspect `prisma/schema.prisma`.

#### `migrations-not-applied`

- **Symptom**: API returns 500 with `relation "User" does not exist`.
- **Detect**: connect to the DB and check `information_schema.tables` for a known model.
- **Fix**: `pnpm prisma migrate dev`. Idempotent — no-op if already applied.

### runtime category

#### `hydration-mismatch` (the original bug C from yoga v2)

- **Symptom**: React console warns about hydration mismatch on a specific component; the component resets state on every render.
- **Detect**: open the page in Playwright, listen for `console.error` events, look for the "Hydration failed" string.
- **Root cause**: a Client Component reading `window` / `document` / `navigator` / `localStorage` in its initial render.
- **Fix**: wrap the offending code in `useEffect`, or use `useSyncExternalStore`, or guard with `typeof window !== "undefined"` AND mark the component `"use client"`.

#### `unhandled-promise-rejection`

- **Symptom**: vitest reports "1 unhandled error" even when tests pass. Visual QA sees unhandled rejection in browser console.
- **Detect**: vitest output ends with `Unhandled Rejection` block; Playwright `page.on("pageerror")` fires.
- **Fix**: locate the `await` that lacks `try/catch`. Usually a fire-and-forget mutation (logout, prefetch).

### auth category

#### `jwt-secret-too-short`

- **Symptom**: HS256 / HS512 signs fine but `jose` throws on the verify side.
- **Detect**: validator enforces `AUTH_JWT_SECRET.length >= 32`.
- **Fix**: regenerate with `openssl rand -hex 32`.

#### `cors-block`

- **Symptom**: browser console logs CORS error; requests succeed in curl.
- **Detect**: Playwright captures `XMLHttpRequest error` event with `request.failure().errorText === "net::ERR_FAILED"`.
- **Fix**: ensure `NEXT_PUBLIC_APP_URL` matches the actual origin; check Next.js `headers()` for incorrect `Access-Control-*`.

### data category

#### `seed-missing`

- **Symptom**: admin demo cannot list any entity; Shop shows empty state forever.
- **Detect**: query `SELECT count(*) FROM "User"`; if `0`, seed didn't run.
- **Fix**: `pnpm prisma:seed`. The seed must be idempotent (use `upsert`).

#### `demo-credentials-broken` (Bug D shape from yoga, partial)

- **Symptom**: admin demo login fails with `INVALID_CREDENTIALS`.
- **Detect**: visual QA tries `admin@demo.<domain> / demo1234`; server returns 401.
- **Root causes**: seed hashed with the wrong algorithm (bcrypt vs argon2id mismatch), email mistyped in seed, password too weak for `minLength` policy.
- **Fix**: regenerate seed with the platform-specific hasher (argon2id on linux, bcrypt on win32 if argon2 not available); verify in the validator that `passwordPolicy.backend` matches `passwordHasher` actually used.

## Heuristics for the Bootstrap Agent

When deciding which `checkEnvironmentRules` to emit:

1. **Always**: `db-unreachable`, `env-var-missing` (covered implicitly by the Zod validator), `jwt-secret-too-short`.
2. **If payments in domain**: `stripe-key-set` (verify `STRIPE_SECRET_KEY` is present and matches `sk_(test|live)_` regex).
3. **If emails in domain**: `email-provider-reachable` (POST to provider health endpoint).
4. **If multi-tenant**: `tenant-isolation-set` (verify `TENANT_DEFAULT` is set).

Keep the rules **fast** — they run at every boot. Anything > 500ms total is too slow.

## Heuristics for the Visual QA Agent

When Playwright observes an error, map it to a fault id:

| Playwright observation | Fault id |
|---|---|
| `pageerror` with "Hydration failed" | `hydration-mismatch` |
| Response 500 with "Can't reach database server" | `db-unreachable` |
| Response 401 on admin login flow | `demo-credentials-broken` |
| Empty list rendered when seed expected data | `seed-missing` |
| Network request blocked by CORS | `cors-block` |
| `console.error` with "process.env" or "is not configured" | `env-var-missing` or `env-var-typo` |

Each fault id is routed to the agent that owns its fix:

- `db-unreachable`, `port-conflict`, `env-var-missing`, `env-var-typo`, `migrations-not-applied`, `jwt-secret-too-short` → **bootstrap-devops**
- `hydration-mismatch` → **ui-components**
- `cors-block` → **api-backend**
- `seed-missing`, `demo-credentials-broken` → **seeds-fixtures**

## Example: structuring a `check-environment.ts`

```ts
import { env } from "./env";

interface CheckResult { passed: boolean; message?: string }
type Check = () => Promise<CheckResult>;

const checks: Record<string, Check> = {
  "postgres-reachable": async () => {
    const url = new URL(env.DATABASE_URL);
    const host = url.hostname;
    const port = Number(url.port || "5432");
    try {
      const net = await import("node:net");
      await new Promise<void>((res, rej) => {
        const s = net.connect({ host, port, timeout: 2000 }, () => { s.end(); res(); });
        s.on("error", rej);
        s.on("timeout", () => { s.destroy(); rej(new Error("timeout")); });
      });
      return { passed: true };
    } catch (e) {
      return { passed: false, message: `Postgres unreachable at ${host}:${port} — ${(e as Error).message}` };
    }
  },
  "jwt-secret-set": async () => {
    return env.AUTH_JWT_SECRET.length >= 32
      ? { passed: true }
      : { passed: false, message: "AUTH_JWT_SECRET shorter than 32 chars" };
  },
};

export async function checkEnvironment(): Promise<void> {
  for (const [id, check] of Object.entries(checks)) {
    const result = await check();
    if (!result.passed) {
      console.error(`[boot] check '${id}' failed: ${result.message}`);
      console.error(`[boot] fix: see README troubleshooting`);
      process.exit(1);
    }
  }
}
```

## When to add a new fault

Add a new entry when **all three** apply:

1. The fault has occurred at least once during a real generation.
2. It's not transient (will recur unless fixed).
3. There's a clear, copy-pasteable remediation.

Don't add speculative faults. The list is short on purpose — Bootstrap and Visual QA should be able to enumerate it from memory.
