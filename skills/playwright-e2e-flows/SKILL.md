---
name: playwright-e2e-flows
description: Robust patterns for Playwright headless E2E flows (signup, login, CRUD, console error capture, dev-server lifecycle). Trigger when generating Visual QA Agent scripts that drive a Next.js + auth stack with seed-derived demo data.
---

# Playwright E2E flows — robust patterns

A short, opinionated playbook for the patterns Visual QA Agent v3 needs.
Optimised for Atelier-generated apps: Next.js App Router + Better Auth +
Postgres + seed-manifest with stable demo identifiers.

## Browser + dev-server lifecycle (R1 + R8 of the Visual QA prompt)

The agent OWNS the lifecycle. Spawn, probe, run, kill — every time.

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { chromium, type Browser } from "@playwright/test";

async function bootApp(workDir: string): Promise<{ proc: ChildProcess; appUrl: string }> {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  // Bootstrap-produced script is idempotent.
  const setup = spawn("pnpm", ["setup"], { cwd: workDir, stdio: "inherit", shell: true });
  await new Promise<void>((res, rej) => {
    setup.once("close", (code) => (code === 0 ? res() : rej(new Error(`setup exit ${code}`))));
  });

  const dev = spawn("pnpm", ["dev"], { cwd: workDir, stdio: "pipe", shell: true });

  // Poll /; bail at 90s.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(appUrl + "/");
      if (r.ok) return { proc: dev, appUrl };
    } catch { /* not up yet */ }
    await wait(500);
  }
  dev.kill();
  throw new Error("app did not boot within 90s");
}

async function shutdown(proc: ChildProcess, browser: Browser): Promise<void> {
  await browser.close().catch(() => undefined);
  proc.kill("SIGTERM");
  // Verify the port is free
  await wait(500);
}
```

R8 demands cleanup even on error. Always wrap your flows in `try / finally`
that calls `shutdown(proc, browser)` regardless of outcome.

## Listener boilerplate (R3)

Set this up immediately after `await context.newPage()`:

```ts
const consoleEvents: ConsoleEvent[] = [];
const networkEvents: NetworkEvent[] = [];

page.on("console", (msg) => {
  const level = msg.type();
  if (level !== "error" && level !== "warning") return;
  consoleEvents.push({
    level: level as "error" | "warning",
    text: msg.text(),
    pageUrl: page.url(),
    flow: currentFlow,
  });
});

page.on("pageerror", (err) => {
  consoleEvents.push({
    level: "error",
    text: `Uncaught: ${err.message}`,
    pageUrl: page.url(),
    flow: currentFlow,
  });
});

page.on("response", (resp) => {
  const status = resp.status();
  if (status < 400) return;
  const url = resp.url();
  if (!url.includes("/api/") && !url.includes("/_next/")) return;
  networkEvents.push({
    method: resp.request().method() as NetworkEvent["method"],
    url, status, triggeredByStep: currentStepName, flow: currentFlow,
  });
});

page.on("requestfailed", (req) => {
  networkEvents.push({
    method: req.method() as NetworkEvent["method"],
    url: req.url(),
    failure: req.failure()?.errorText ?? "unknown",
    triggeredByStep: currentStepName, flow: currentFlow,
  });
});
```

The `currentFlow` and `currentStepName` are agent-managed locals. Update
them BEFORE entering each step body so events get attributed correctly.

## Sign-up flow

```ts
async function signUp(page: Page, opts: { email: string; password: string; name?: string }) {
  await page.goto("/sign-up");
  await page.getByLabel(/email/i).fill(opts.email);
  await page.getByLabel(/password/i).fill(opts.password);
  if (opts.name) await page.getByLabel(/name/i).fill(opts.name);
  await page.getByRole("button", { name: /sign up|create account/i }).click();
  // Sign-up usually redirects to /my or /dashboard
  await page.waitForURL(/\/(my|dashboard|sign-in)/, { timeout: 5_000 });
}
```

Randomise the email so re-runs don't collide with the previous run's user:
`const email = \`qa-\${Date.now()}@demo.local\`;`. Reuse it across the
session — the same email signs up then signs in in the same flow.

## Sign-in flow

```ts
async function signIn(page: Page, opts: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(opts.email);
  await page.getByLabel(/password/i).fill(opts.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForLoadState("networkidle", { timeout: 5_000 });
  // Sanity: cookie or session header is set
  const cookies = await page.context().cookies();
  if (cookies.length === 0) {
    throw new Error("sign-in completed but no cookies were set");
  }
}
```

If the sign-in submit gives 401 with seed-manifest creds → fault id
`demo-credentials-broken`, agent `seeds-fixtures`.

## Sign-out

Always either click the explicit logout button OR clear cookies. The next
flow's sign-in must not inherit the previous flow's session.

```ts
async function signOut(page: Page) {
  // Try UI first (data-testid when D2 lands, fallback to role+name)
  const btn = page.getByRole("button", { name: /sign out|log out/i });
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForURL(/\/(sign-in|$)/, { timeout: 3_000 }).catch(() => undefined);
    return;
  }
  // Fallback: clear cookies
  await page.context().clearCookies();
}
```

## CRUD flow (admin)

```ts
async function adminCrud(page: Page, entity: string) {
  // 1. Navigate to /admin/<entity>
  await page.goto(`/admin/${entity.toLowerCase()}s`);

  // 2. Note the visible row count.
  const beforeRows = await page.getByRole("row").count();

  // 3. Click "New" / "Create"
  await page.getByRole("button", { name: /new|create|añadir|add/i }).click();
  // Fill fields by label (best-effort).
  await page.getByLabel(/name|title|nombre/i).first().fill(`QA ${entity} ${Date.now()}`);
  await page.getByRole("button", { name: /save|create|guardar/i }).click();
  await page.waitForLoadState("networkidle", { timeout: 5_000 });

  // 4. Verify row count grew.
  const afterCreate = await page.getByRole("row").count();
  if (afterCreate <= beforeRows) {
    throw new Error(`${entity} create did not add a row (before=${beforeRows} after=${afterCreate})`);
  }

  // 5. Edit the new row (most generated UIs put Edit on the row itself).
  await page.getByRole("button", { name: /edit|editar/i }).last().click();
  await page.getByLabel(/name|title|nombre/i).first().fill(`QA ${entity} EDITED`);
  await page.getByRole("button", { name: /save|guardar/i }).click();
  await page.waitForLoadState("networkidle", { timeout: 5_000 });

  // 6. Delete it.
  await page.getByRole("button", { name: /delete|borrar|eliminar/i }).last().click();
  // Confirm dialog if any
  const confirm = page.getByRole("button", { name: /confirm|sí|yes/i });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForLoadState("networkidle", { timeout: 5_000 });

  const afterDelete = await page.getByRole("row").count();
  if (afterDelete !== beforeRows) {
    throw new Error(`${entity} delete left ${afterDelete} rows, expected ${beforeRows}`);
  }
}
```

If create/edit/delete fails: fault depends on the symptom.
- 404 sobre `POST /api/admin/<entity>` → `endpoint-missing`, agent `api-backend`.
- 500 + console error mentioning "Prisma" → `migrations-not-applied`, agent `bootstrap-devops`.
- Validation always rejects → likely `forms-validations` issue; rule
  `form-blocked` agent `forms-validations`.

## Screenshot naming convention

`.atelier/screenshots/<flow>-<NNN>-<step-slug>.png` where:
- `<flow>` ∈ `client-anonymous` | `client-authenticated` | `admin`
- `<NNN>` is a zero-padded step counter, monotonically increasing per flow.
- `<step-slug>` is kebab-case derived from the step name.

Examples:
- `.atelier/screenshots/client-anonymous-001-home.png`
- `.atelier/screenshots/admin-004-edit-membership.png`

Always capture `await page.screenshot({ path, fullPage: false })` BEFORE
asserts. Full-page screenshots are big and slow — only enable for the home
of each flow.

## Failure-to-fault mapping (R4)

Always use the runtime-diagnostics fault ids when emitting violations.
Don't invent new ones. If you observe a symptom that isn't in the
taxonomy:

1. Try to map it to the nearest existing fault.
2. If genuinely new, propose to `runtime-diagnostics` in the violation
   `message` field with prefix `[new-fault-candidate]` and `severity: "warn"`.

This keeps the routing table stable across runs.

## Reproducibility (R9)

The agent must persist the `.spec.ts` it ran. Use this skeleton:

```ts
import { test, expect, type Page } from "@playwright/test";
// Generated by Visual QA Agent at <ISO timestamp>
// Domain: <domainSlug from seed-manifest>
// Re-run: npx playwright test .atelier/visual-qa-script.spec.ts --headed

test.describe("Visual QA — auto-generated", () => {
  test("client-anonymous", async ({ page }) => { /* ... */ });
  test("client-authenticated", async ({ page }) => { /* ... */ });
  test("admin", async ({ page }) => { /* ... */ });
});
```

The script may NOT be runnable as a literal Playwright test (the agent
orchestrates the browser itself), but it should be CLOSE — the human's
debugging path is to read it, copy chunks into a `pnpm playwright test`
invocation, and step through with `--headed --debug`.
