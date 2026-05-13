import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  createFileBasedApprovalResolver,
  decisionPath,
  parseDecision,
  pendingApprovalPath,
  readPendingApproval,
  writeDecision,
} from "./file-based-approval";
import { runGenerationV3, type ApprovalResolver, type AgentRunnerV3 } from "../orchestrator-v3";

const FIXTURE_ROOT = resolve(tmpdir(), "atelier-v3-approval-tests");

async function freshWorkDir(name: string): Promise<string> {
  const wd = join(FIXTURE_ROOT, name + "-" + Math.random().toString(36).slice(2));
  await mkdir(wd, { recursive: true });
  return wd;
}

afterEach(async () => {
  if (existsSync(FIXTURE_ROOT)) {
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
  }
});

describe("parseDecision", () => {
  it("parses an approve decision", () => {
    expect(parseDecision(JSON.stringify({ kind: "approve" }))).toEqual({ kind: "approve" });
  });

  it("parses a reject decision with reason", () => {
    expect(parseDecision(JSON.stringify({ kind: "reject", reason: "wrong palette" })))
      .toEqual({ kind: "reject", reason: "wrong palette" });
  });

  it("parses an inspect decision", () => {
    expect(parseDecision(JSON.stringify({ kind: "inspect" }))).toEqual({ kind: "inspect" });
  });

  it("returns null for reject without reason", () => {
    expect(parseDecision(JSON.stringify({ kind: "reject" }))).toBeNull();
  });

  it("returns null for unknown kind", () => {
    expect(parseDecision(JSON.stringify({ kind: "veto" }))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseDecision("not json")).toBeNull();
    expect(parseDecision("null")).toBeNull();
    expect(parseDecision('""')).toBeNull();
  });
});

describe("writeDecision / readPendingApproval", () => {
  it("writeDecision writes a parseable file", async () => {
    const wd = await freshWorkDir("write");
    const file = await writeDecision(wd, "wave-1-bootstrap", { kind: "approve" });
    expect(existsSync(file)).toBe(true);
    const raw = await readFile(file, "utf-8");
    expect(parseDecision(raw)).toEqual({ kind: "approve" });
  });

  it("readPendingApproval returns null when no pending file", async () => {
    const wd = await freshWorkDir("nopending");
    const p = await readPendingApproval(wd, "wave-2-design");
    expect(p).toBeNull();
  });

  it("readPendingApproval returns the parsed payload", async () => {
    const wd = await freshWorkDir("withpending");
    await mkdir(join(wd, ".atelier"), { recursive: true });
    const payload = {
      wave: "wave-2-design",
      agents: ["ux-ui-designer"],
      results: [{ agent: "ux-ui-designer", status: "ok" }],
      hint: "type atelier approve wave-2-design",
      createdAt: new Date().toISOString(),
    };
    await writeFile(pendingApprovalPath(wd, "wave-2-design"), JSON.stringify(payload), "utf-8");
    const p = await readPendingApproval(wd, "wave-2-design");
    expect(p?.wave).toBe("wave-2-design");
    expect(p?.agents).toEqual(["ux-ui-designer"]);
  });
});

describe("createFileBasedApprovalResolver — end-to-end through runGenerationV3", () => {
  it("blocks until a decision is written and then resumes", async () => {
    const wd = await freshWorkDir("e2e-approve");
    const resolver: ApprovalResolver = createFileBasedApprovalResolver({
      workDir: wd,
      pollMs: 20,
      timeoutMs: 5_000,
    });

    const runner: AgentRunnerV3 = async (input) => ({
      artifact: input.agent === "qa-reviewer"
        ? { decision: "go", violations: [] }
        : { agent: input.agent },
      filesCreated: [],
      summary: `${input.agent}_DONE`,
    });

    // Use a tiny waves list so the test stays fast: only the first wave.
    const minimalWaves = [
      { name: "wave-1-discovery" as const, agents: ["discovery" as const], dependsOn: [] as const },
    ];

    // Start the orchestrator (will pause after wave-1-discovery).
    const runPromise = runGenerationV3({
      generationId: "test-approve",
      prd: {},
      workDir: wd,
      runner,
      emit: async () => {},
      approvalResolver: resolver,
      waves: minimalWaves,
    });

    // Wait until the pending file appears.
    await waitForFile(pendingApprovalPath(wd, "wave-1-discovery"), 2_000);

    // Write the approve decision.
    await writeDecision(wd, "wave-1-discovery", { kind: "approve" });

    const result = await runPromise;
    expect(result.failedAt).toBeUndefined();
    expect(result.lastApproval?.decision.kind).toBe("approve");

    // Both files cleaned up.
    expect(existsSync(pendingApprovalPath(wd, "wave-1-discovery"))).toBe(false);
    expect(existsSync(decisionPath(wd, "wave-1-discovery"))).toBe(false);
  });

  it("re-runs the wave when reject is written", async () => {
    const wd = await freshWorkDir("e2e-reject");
    const resolver = createFileBasedApprovalResolver({
      workDir: wd,
      pollMs: 20,
      timeoutMs: 5_000,
    });

    const calls: Array<{ agent: string; humanFeedback?: string }> = [];
    const runner: AgentRunnerV3 = async (input) => {
      calls.push({
        agent: input.agent,
        ...(input.humanFeedback ? { humanFeedback: input.humanFeedback } : {}),
      });
      return {
        artifact: { agent: input.agent },
        filesCreated: [],
        summary: `${input.agent}_DONE`,
      };
    };

    const minimalWaves = [
      { name: "wave-1-discovery" as const, agents: ["discovery" as const], dependsOn: [] as const },
    ];

    const runPromise = runGenerationV3({
      generationId: "test-reject",
      prd: {},
      workDir: wd,
      runner,
      emit: async () => {},
      approvalResolver: resolver,
      waves: minimalWaves,
    });

    // First pause → write reject.
    await waitForFile(pendingApprovalPath(wd, "wave-1-discovery"), 2_000);
    await writeDecision(wd, "wave-1-discovery", { kind: "reject", reason: "redo with more entities" });

    // Wait for the runner to be invoked a second time — the most reliable
    // signal that the reject was consumed, artifacts were stripped, and the
    // outer loop re-ran the wave. Filesystem-level signals are racy because
    // the resolver deletes + recreates the pending file very quickly.
    await waitForCondition(() => calls.length === 2, 3_000);

    // Wait for the second pause (after rerun) and approve.
    await waitForFile(pendingApprovalPath(wd, "wave-1-discovery"), 2_000);
    // Small grace window to avoid the resolver's start-time cleanup of any
    // stale decision file racing against our writeDecision.
    await new Promise<void>((r) => setTimeout(r, 100));
    await writeDecision(wd, "wave-1-discovery", { kind: "approve" });

    const result = await runPromise;
    expect(result.lastApproval?.decision.kind).toBe("approve");

    // The runner saw the wave twice — second time with humanFeedback.
    expect(calls.length).toBe(2);
    expect(calls[1]?.humanFeedback).toBe("redo with more entities");
  });

  it("inspect keeps polling without re-running the wave", async () => {
    const wd = await freshWorkDir("e2e-inspect");
    const resolver = createFileBasedApprovalResolver({
      workDir: wd,
      pollMs: 20,
      timeoutMs: 5_000,
    });

    let runnerCalls = 0;
    const runner: AgentRunnerV3 = async (input) => {
      runnerCalls++;
      return {
        artifact: { agent: input.agent },
        filesCreated: [],
        summary: `${input.agent}_DONE`,
      };
    };

    const minimalWaves = [
      { name: "wave-1-discovery" as const, agents: ["discovery" as const], dependsOn: [] as const },
    ];

    const runPromise = runGenerationV3({
      generationId: "test-inspect",
      prd: {},
      workDir: wd,
      runner,
      emit: async () => {},
      approvalResolver: resolver,
      waves: minimalWaves,
    });

    // First pause → inspect.
    await waitForFile(pendingApprovalPath(wd, "wave-1-discovery"), 2_000);
    await writeDecision(wd, "wave-1-discovery", { kind: "inspect" });

    // Wait for the resolver to consume the inspect decision. The decision
    // file disappears; the pending file does NOT — inspect leaves it so the
    // re-prompt sees the same wave state.
    await waitForFileToDisappear(decisionPath(wd, "wave-1-discovery"), 2_000);
    // Give the resolver time to start its second iteration (the inner loop
    // in runGenerationV3 re-calls us; the new poll() begins). Without this
    // small grace window, our next writeDecision could race with the
    // resolver's startup-time cleanup of stale decision files.
    await new Promise<void>((r) => setTimeout(r, 100));

    // Now write approve.
    await writeDecision(wd, "wave-1-discovery", { kind: "approve" });

    await runPromise;
    // Wave ran exactly once.
    expect(runnerCalls).toBe(1);
  });
});

async function waitForFile(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) return;
    await new Promise<void>((r) => setTimeout(r, 10));
  }
  throw new Error(`file did not appear in ${timeoutMs}ms: ${file}`);
}

async function waitForFileToDisappear(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(file)) return;
    await new Promise<void>((r) => setTimeout(r, 10));
  }
  throw new Error(`file did not disappear in ${timeoutMs}ms: ${file}`);
}

async function waitForCondition(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((r) => setTimeout(r, 10));
  }
  throw new Error(`condition not satisfied in ${timeoutMs}ms`);
}

beforeEach(async () => {
  if (existsSync(FIXTURE_ROOT)) {
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
  }
  await mkdir(FIXTURE_ROOT, { recursive: true });
});
