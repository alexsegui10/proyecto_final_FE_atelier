/**
 * Unit tests for `runDeterministicFormat` (B-w6-1 D2).
 *
 * The helper is intentionally pure-ish: a single subprocess against
 * `cwd = workDir`. Tests inject a fake spawn via `_spawn` so we never
 * touch the host pnpm/prettier — we only verify orchestration logic
 * around the child (exit codes, timeout, stderr capture).
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { runDeterministicFormat } from "./format-rescue";

// ─── Fake child_process plumbing ────────────────────────────────────

interface FakeChild extends EventEmitter {
  stderr: EventEmitter;
  killed: boolean;
  kill: (signal?: NodeJS.Signals | number) => boolean;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = (_signal?: NodeJS.Signals | number) => {
    child.killed = true;
    return true;
  };
  return child;
}

/**
 * Tiny spawn fake that returns a fresh fake child and lets the test
 * drive it (`close`, `error`, `stderr`) — sidesteps the real binary.
 */
function makeFakeSpawn(): {
  spawn: (cmd: string, args: string[], opts: { cwd: string; shell?: boolean }) => FakeChild;
  lastCall: { cmd?: string; args?: string[]; cwd?: string; shell?: boolean };
  child: FakeChild;
} {
  const child = makeFakeChild();
  const lastCall: { cmd?: string; args?: string[]; cwd?: string; shell?: boolean } = {};
  // Cast: _spawn signature in the helper accepts the real typeof spawn,
  // but the helper only uses the narrow subset we expose here.
  const spawn = (cmd: string, args: string[], opts: { cwd: string; shell?: boolean }) => {
    lastCall.cmd = cmd;
    lastCall.args = args;
    lastCall.cwd = opts.cwd;
    lastCall.shell = opts.shell;
    return child;
  };
  return { spawn, lastCall, child };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("runDeterministicFormat — happy path", () => {
  it("resolves when the child exits with code 0", async () => {
    const { spawn, child } = makeFakeSpawn();
    const p = runDeterministicFormat("/tmp/fake-workdir", {
      _spawn: spawn as unknown as Parameters<typeof runDeterministicFormat>[1] extends {
        _spawn?: infer S;
      }
        ? NonNullable<S>
        : never,
    });
    // Fire close on next tick to model the subprocess returning.
    setImmediate(() => child.emit("close", 0));
    await expect(p).resolves.toBeUndefined();
  });

  it("invokes pnpm format with workDir cwd and shell:true (Windows compat)", async () => {
    const { spawn, lastCall, child } = makeFakeSpawn();
    const p = runDeterministicFormat("/tmp/somewhere", {
      _spawn: spawn as unknown as Parameters<typeof runDeterministicFormat>[1] extends {
        _spawn?: infer S;
      }
        ? NonNullable<S>
        : never,
    });
    setImmediate(() => child.emit("close", 0));
    await p;
    expect(lastCall.cmd).toBe("pnpm");
    expect(lastCall.args).toEqual(["format"]);
    expect(lastCall.cwd).toBe("/tmp/somewhere");
    expect(lastCall.shell).toBe(true);
  });
});

describe("runDeterministicFormat — failure modes", () => {
  it("rejects with a descriptive error on non-zero exit", async () => {
    const { spawn, child } = makeFakeSpawn();
    const p = runDeterministicFormat("/tmp/fake-workdir", {
      _spawn: spawn as unknown as Parameters<typeof runDeterministicFormat>[1] extends {
        _spawn?: infer S;
      }
        ? NonNullable<S>
        : never,
    });
    setImmediate(() => {
      child.stderr.emit("data", Buffer.from("prettier: parser error in some/file.ts\n"));
      child.emit("close", 1);
    });
    await expect(p).rejects.toThrow(/pnpm format exit 1/);
    await expect(p).rejects.toThrow(/parser error/);
  });

  it("rejects with the spawn error when the child fails to start", async () => {
    const { spawn, child } = makeFakeSpawn();
    const p = runDeterministicFormat("/tmp/fake-workdir", {
      _spawn: spawn as unknown as Parameters<typeof runDeterministicFormat>[1] extends {
        _spawn?: infer S;
      }
        ? NonNullable<S>
        : never,
    });
    setImmediate(() => child.emit("error", new Error("spawn ENOENT")));
    await expect(p).rejects.toThrow(/spawn ENOENT/);
  });
});

describe("runDeterministicFormat — timeout", () => {
  it("kills the child and rejects when the timeout expires", async () => {
    vi.useFakeTimers();
    const { spawn, child } = makeFakeSpawn();
    const p = runDeterministicFormat("/tmp/fake-workdir", {
      timeoutMs: 50,
      _spawn: spawn as unknown as Parameters<typeof runDeterministicFormat>[1] extends {
        _spawn?: infer S;
      }
        ? NonNullable<S>
        : never,
    });
    // Advance fake timers past the timeout; the helper kills the child
    // (SIGTERM in real code) and we model that by emitting close after.
    vi.advanceTimersByTime(60);
    expect(child.killed).toBe(true);
    // Real subprocess emits close after SIGTERM; mirror that.
    child.emit("close", null);
    await expect(p).rejects.toThrow(/timed out after 50ms/);
    vi.useRealTimers();
  });
});
