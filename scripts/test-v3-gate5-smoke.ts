/**
 * Atelier v3 — Gate 5 (runtime-smoke) end-to-end demo.
 *
 * Spins up a minimal `node:http` server with 5 routes returning pre-configured
 * status codes, runs `runSmokeProbes` against it, and asserts the report.
 * Validates the scanner against REAL HTTP (no fetch mocks) without needing
 * the full Atelier-generated app stack.
 *
 * Two scenarios:
 *   - "happy": all 5 routes respond with the expected status → decision='pass'.
 *   - "broken-home": `/` returns 500 → decision='fail' + violation home-500.
 *
 * Usage:
 *   tsx scripts/test-v3-gate5-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import {
  buildDefaultProbes,
  runSmokeProbes,
} from "../lib/agents/runtime/qa-gates/runtime-smoke-scanner";
import { validateRuntimeSmokeReport } from "../lib/agents/contracts-v3/runtime-smoke.schema";

const ARCHITECT_FIXTURE = {
  features: [
    {
      name: "shop",
      publicRoutes: ["/", "/shop"],
      privateRoutes: ["/profile"],
      adminRoutes: [],
    },
  ],
};

interface ServerScript {
  [path: string]: number; // path → status code
}

function startServer(script: ServerScript): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const status = script[req.url ?? "/"] ?? 404;
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(`${req.method} ${req.url} → ${status}`);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((res) => server.close(() => res()));
}

async function runScenario(name: string, script: ServerScript, expect: "pass" | "fail"): Promise<boolean> {
  const { server, port } = await startServer(script);
  const appUrl = `http://127.0.0.1:${port}`;
  try {
    const probes = buildDefaultProbes(ARCHITECT_FIXTURE);
    const report = await runSmokeProbes({ appUrl, probes });

    const schemaErr = validateRuntimeSmokeReport(report);
    if (schemaErr) {
      console.error(`[${name}] ✗ report fails schema: ${schemaErr}`);
      return false;
    }
    if (report.decision !== expect) {
      console.error(`[${name}] ✗ expected decision=${expect}, got ${report.decision}`);
      console.error(`    violations: ${JSON.stringify(report.violations.map((v) => v.rule))}`);
      return false;
    }
    console.log(
      `[${name}] ✓ decision=${report.decision} ` +
      `probes=${report.results.length} ` +
      `violations=${report.violations.length} ` +
      `(${report.violations.map((v) => v.rule).join(", ") || "none"})`,
    );
    return true;
  } finally {
    await closeServer(server);
  }
}

async function main(): Promise<number> {
  console.log("▶ Gate 5 smoke demo — using node:http minimal servers");

  let allPass = true;

  // Scenario 1: happy path. All 5 probes get the expected status.
  allPass = await runScenario(
    "happy",
    {
      "/": 200,
      "/sign-in": 200,
      "/sign-up": 200,
      "/profile": 401,
      "/shop": 200,
    },
    "pass",
  ) && allPass;

  // Scenario 2: home returns 500 → fail + home-500 violation.
  allPass = await runScenario(
    "broken-home",
    {
      "/": 500,
      "/sign-in": 200,
      "/sign-up": 200,
      "/profile": 401,
      "/shop": 200,
    },
    "fail",
  ) && allPass;

  // Scenario 3: private route returns 200 instead of redirect/401.
  allPass = await runScenario(
    "auth-guard-missing",
    {
      "/": 200,
      "/sign-in": 200,
      "/sign-up": 200,
      "/profile": 200, // BUG
      "/shop": 200,
    },
    "fail",
  ) && allPass;

  console.log(allPass ? "\n▣ Gate 5 demo GREEN — scanner works against real HTTP" : "\n✗ Gate 5 demo FAIL");
  return allPass ? 0 : 1;
}

main().then(
  async (code) => {
    // Drain pending I/O before exiting (Node 20 + Windows + node:http close()
    // race condition: process.exit() during async close triggers a libuv
    // assertion in src/win/async.c. A 50ms grace window is enough.)
    await new Promise<void>((r) => setTimeout(r, 50));
    process.exit(code);
  },
  async (err) => {
    console.error(err);
    await new Promise<void>((r) => setTimeout(r, 50));
    process.exit(99);
  },
);
