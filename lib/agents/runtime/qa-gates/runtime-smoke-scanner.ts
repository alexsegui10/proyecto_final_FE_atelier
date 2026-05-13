/**
 * runtime-smoke QA gate (Gate 5).
 *
 * Pre-wave check that lives BEFORE wave-7-runtime-qa. Opens HTTP probes
 * against an already-running app and asserts that the basic shape responds
 * (home renders, auth pages exist, private routes redirect/401, public
 * listings load). Cheap, fast, deterministic.
 *
 * The scanner does NOT spawn the app — it assumes `appUrl` is up. That
 * responsibility belongs to the wave-7 runtime hook (future) that owns
 * the app lifecycle.
 *
 * Two public functions:
 *   - `buildDefaultProbes(architect)`: pure inference from architect.json,
 *     produces the 5 default probes per ROADMAP § 5.1.
 *   - `runSmokeProbes(opts)`: side-effecting probe runner with `_fetch`
 *     test seam for unit tests.
 */
import type { QaViolationV3 } from "../../orchestrator-v3";
import type {
  RuntimeSmokeReport,
  RuntimeSmokeViolation,
  SmokeProbe,
  SmokeProbeResult,
} from "../../contracts-v3/runtime-smoke.schema";

// ─── Probe inference ─────────────────────────────────────────────────

/**
 * Build the default 5-probe suite from an `architect.json` artifact.
 *
 * Permissive about the architect shape — reads what it can and skips
 * probes that depend on missing data. The minimum produced suite is 3
 * (root, sign-in, sign-up) so the scanner ALWAYS has something to check.
 */
export function buildDefaultProbes(architectArtifact: unknown): SmokeProbe[] {
  const probes: SmokeProbe[] = [
    {
      id: "root-ok",
      method: "GET",
      path: "/",
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      intent: "Home renders without crashing",
      derivedFrom: "default",
    },
    {
      id: "sign-in-ok",
      method: "GET",
      path: "/sign-in",
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      intent: "Sign-in page renders",
      derivedFrom: "default",
    },
    {
      id: "sign-up-ok",
      method: "GET",
      path: "/sign-up",
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      intent: "Sign-up page renders",
      derivedFrom: "default",
    },
  ];

  const privatePath = extractFirstRoute(architectArtifact, "privateRoutes")
    ?? extractFirstRoute(architectArtifact, "adminRoutes");
  if (privatePath) {
    probes.push({
      id: "private-redirects",
      method: "GET",
      path: privatePath,
      // Accept anything in [301-308] (redirect) OR exactly 401. We model
      // that as a min-max plus a comment in `intent`; the gate logic
      // treats this probe specially below.
      expectedStatusMin: 301,
      expectedStatusMax: 401,
      intent: "Private route redirects unauthenticated users or returns 401",
      derivedFrom: "architect.privateRoutes",
    });
  }

  const publicListPath = extractPublicListRoute(architectArtifact);
  if (publicListPath) {
    probes.push({
      id: "public-list-ok",
      method: "GET",
      path: publicListPath,
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      intent: "Public listing route renders",
      derivedFrom: "architect.publicRoutes",
    });
  }

  return probes;
}

function extractFirstRoute(
  architect: unknown,
  key: "publicRoutes" | "privateRoutes" | "adminRoutes",
): string | null {
  if (!architect || typeof architect !== "object") return null;
  const features = (architect as { features?: unknown }).features;
  if (!Array.isArray(features)) return null;
  for (const f of features) {
    if (!f || typeof f !== "object") continue;
    const list = (f as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      if (typeof r === "string" && r.startsWith("/")) return r;
    }
  }
  return null;
}

/**
 * Heuristic: a "public list route" is a publicRoute that doesn't end in
 * `/sign-in` / `/sign-up` / `/` and doesn't contain a `[slug]` parameter.
 * Yoga: `/shop` ; tutorias: `/tutors` ; restaurant: `/menu`.
 */
function extractPublicListRoute(architect: unknown): string | null {
  if (!architect || typeof architect !== "object") return null;
  const features = (architect as { features?: unknown }).features;
  if (!Array.isArray(features)) return null;
  for (const f of features) {
    if (!f || typeof f !== "object") continue;
    const list = (f as Record<string, unknown>).publicRoutes;
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      if (typeof r !== "string") continue;
      if (r === "/" || r === "/sign-in" || r === "/sign-up") continue;
      if (r.includes("[")) continue; // dynamic segments need a slug we don't have
      if (r.startsWith("/")) return r;
    }
  }
  return null;
}

// ─── Probe runner ────────────────────────────────────────────────────

export interface RunSmokeProbesOptions {
  appUrl: string;
  probes: readonly SmokeProbe[];
  /** Per-probe timeout. Default 5000ms. */
  probeTimeoutMs?: number;
  /** Test seam — replaces global fetch with a deterministic stub. */
  _fetch?: SmokeFetch;
  /** Test seam — replaces Date.now for timing. */
  _now?: () => number;
}

export type SmokeFetch = (
  url: string,
  init: { method: string; signal?: AbortSignal },
) => Promise<{ status: number }>;

export async function runSmokeProbes(
  opts: RunSmokeProbesOptions,
): Promise<RuntimeSmokeReport> {
  const timeout = opts.probeTimeoutMs ?? 5000;
  const fetchFn = opts._fetch ?? (defaultFetch as SmokeFetch);
  const now = opts._now ?? Date.now;
  const start = now();

  const results: SmokeProbeResult[] = [];
  const violations: RuntimeSmokeViolation[] = [];
  let appCrashedMidSuite = false;

  for (let i = 0; i < opts.probes.length; i++) {
    const probe = opts.probes[i]!;
    const probeStart = now();
    let actualStatus: number | null = null;
    let failure: string | undefined;

    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeout);
      try {
        const res = await fetchFn(opts.appUrl + probe.path, {
          method: probe.method,
          signal: ac.signal,
        });
        actualStatus = res.status;
      } finally {
        clearTimeout(t);
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }

    const passed = checkProbePassed(probe, actualStatus);
    const durationMs = now() - probeStart;

    if (failure !== undefined) {
      results.push({ probe, actualStatus: null, passed: false, durationMs, failure });
      // First network failure on root-ok → app not running.
      // Any network failure later → app crashed mid-suite.
      if (probe.id === "root-ok" || i === 0) {
        violations.push({
          rule: "app-not-running",
          severity: "critical",
          agent: "bootstrap-devops",
          probeId: probe.id,
          message:
            `App did not respond at ${opts.appUrl}${probe.path}: ${failure}. ` +
            "App is not running or the URL is wrong.",
          recommendedFix:
            "Confirm `pnpm dev` is running and listening on the configured PORT. " +
            "If you are on Windows + Docker Desktop, see runtime-diagnostics " +
            "`db-unreachable` for the Postgres connectivity fallback.",
        });
      } else {
        appCrashedMidSuite = true;
        violations.push({
          rule: "app-crashed-during-smoke",
          severity: "critical",
          agent: "bootstrap-devops",
          probeId: probe.id,
          message:
            `App stopped responding partway through smoke (probe '${probe.id}' at ${probe.path}). ` +
            "Earlier probes succeeded.",
          recommendedFix:
            "Inspect dev server logs for the crash. Likely an unhandled exception in a route handler. " +
            "Re-run after diagnosing.",
        });
      }
      continue;
    }

    results.push({ probe, actualStatus, passed, durationMs });

    // Per-probe routing of typed violations.
    if (!passed && actualStatus !== null) {
      const v = mapStatusToViolation(probe, actualStatus);
      if (v) violations.push(v);
    }

    // Slow probe → warn (still passes).
    if (passed && durationMs > 5000) {
      violations.push({
        rule: "probe-slow",
        severity: "warn",
        agent: "api-backend",
        probeId: probe.id,
        message: `Probe '${probe.id}' responded in ${durationMs}ms (>5s). Acceptable but slow.`,
        recommendedFix:
          "Profile the route handler. Likely an N+1 query, an unindexed lookup, or a synchronous external call.",
      });
    }
  }

  const decision =
    appCrashedMidSuite || violations.some((v) => v.severity === "error" || v.severity === "critical") || results.some((r) => !r.passed)
      ? "fail"
      : "pass";

  return {
    generatedAt: new Date(now()).toISOString(),
    appUrl: opts.appUrl,
    probes: [...opts.probes],
    results,
    violations,
    decision,
    totalDurationMs: now() - start,
  };
}

function checkProbePassed(probe: SmokeProbe, actual: number | null): boolean {
  if (actual === null) return false;
  return actual >= probe.expectedStatusMin && actual <= probe.expectedStatusMax;
}

function mapStatusToViolation(
  probe: SmokeProbe,
  actualStatus: number,
): RuntimeSmokeViolation | null {
  switch (probe.id) {
    case "root-ok":
      if (actualStatus >= 500) {
        return {
          rule: "home-500",
          severity: "error",
          agent: "pages-routing",
          probeId: probe.id,
          message: `Home '/' returned ${actualStatus}. The root layout or page is broken.`,
          recommendedFix:
            "Inspect `app/page.tsx` and `app/layout.tsx`. Common causes: unhandled exception in a server component, missing data fetcher, or a `use client` hook called from a server component.",
        };
      }
      return {
        rule: "home-unexpected-status",
        severity: "error",
        agent: "pages-routing",
        probeId: probe.id,
        message: `Home '/' returned ${actualStatus} (expected 2xx).`,
        recommendedFix: "Inspect the root route handler.",
      };
    case "sign-in-ok":
    case "sign-up-ok":
      return {
        rule: "auth-page-missing",
        severity: "error",
        agent: "pages-routing",
        probeId: probe.id,
        message: `Auth page ${probe.path} returned ${actualStatus} (expected 2xx).`,
        recommendedFix:
          `Add the missing route under \`app${probe.path}/page.tsx\`. The Pages & Routing agent owns this — verify against architect.publicRoutes.`,
      };
    case "private-redirects":
      // Probe failed because it returned 200 (we expected redirect or 401)
      if (actualStatus >= 200 && actualStatus < 300) {
        return {
          rule: "route-not-protected",
          severity: "error",
          agent: "auth-security",
          probeId: probe.id,
          message: `Private route ${probe.path} returned ${actualStatus} for an unauthenticated request. The auth guard is missing or misconfigured.`,
          recommendedFix:
            "Verify middleware.ts or the route's layout guards. Auth & Security agent owns the protection contract.",
        };
      }
      return null;
    case "public-list-ok":
      if (actualStatus >= 500) {
        return {
          rule: "public-list-broken",
          severity: "error",
          agent: "api-backend",
          probeId: probe.id,
          message: `Public listing ${probe.path} returned ${actualStatus}. Likely a service or persistence failure feeding the page.`,
          recommendedFix:
            "Inspect server logs for the rendering error. Check `service-layer` and `api-backend` for the data fetcher used by this route.",
        };
      }
      return {
        rule: "public-list-broken",
        severity: "error",
        agent: "api-backend",
        probeId: probe.id,
        message: `Public listing ${probe.path} returned ${actualStatus} (expected 2xx).`,
        recommendedFix: "Inspect the route handler + the service it calls.",
      };
    default:
      return {
        rule: "probe-unexpected-status",
        severity: "error",
        agent: "api-backend",
        probeId: probe.id,
        message: `Probe '${probe.id}' at ${probe.path} returned ${actualStatus} (expected [${probe.expectedStatusMin}-${probe.expectedStatusMax}]).`,
        recommendedFix: "Inspect the route handler.",
      };
  }
}

// ─── Conversion to orchestrator violation shape ──────────────────────

/**
 * Adapt a runtime-smoke violation to the orchestrator's `QaViolationV3` shape
 * so the wave-6/qa-reviewer pipeline can merge it transparently.
 */
export function toQaViolation(v: RuntimeSmokeViolation): QaViolationV3 {
  return {
    rule: v.rule,
    severity: v.severity === "warn" ? "warn" : "error", // critical → "error" in QaViolationV3
    agent: v.agent,
    message: v.message,
    recommendedFix: v.recommendedFix,
  };
}

// ─── Default fetch wrapper ───────────────────────────────────────────

const defaultFetch: SmokeFetch = async (url, init) => {
  // `fetch` is global in Node 20+. Wrap to return only what we care about.
  const res = await fetch(url, { method: init.method, signal: init.signal });
  return { status: res.status };
};
