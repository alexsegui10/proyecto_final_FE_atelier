/**
 * env-leak QA gate (Wave 6).
 *
 * Enforces R0 of the Bootstrap & DevOps Agent contract: every read of
 * `process.env.X` in the generated app must go through
 * `src/_shared/config/env.ts` (the single source of truth). Reading
 * `process.env.X` directly anywhere else is a violation of contract that
 * caused the bug class A in yoga v2 (one agent emitted `AUTH_JWT_SECRET`,
 * another tried to read `JWT_SECRET` → 500 at runtime).
 *
 * This is a PROGRAMMATIC gate, not an LLM one. The future Wave 6 runtime
 * will invoke `scanProcessEnvLeaks(workDir)` BEFORE invoking the qa-reviewer
 * LLM and merge the resulting violations into `qa-report.violations[]`.
 * Each hit is routed to `bootstrap-devops` by the v3 fix loop.
 *
 * Trade-offs (intentional, documented):
 *   - We do NOT parse TS/TSX with an AST. We strip line / block comments
 *     line-by-line and then run a regex over the surviving code. Template
 *     literals are NOT stripped — that means `${process.env.X}` inside a
 *     backtick string is correctly flagged (it IS a real read), and
 *     `\`process.env.${KEY}\`` is correctly ignored because the regex
 *     requires `[A-Z]` after the dot (and `$` doesn't match).
 *   - We do NOT support `--fix`. The `recommendedFix` field is human prose;
 *     Bootstrap LLM applies it during the fix loop.
 *   - Allowlist is path-based (POSIX, relative to workDir). Globs are not
 *     supported on purpose — keep the configuration trivial.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { QaViolationV3 } from "../../orchestrator-v3";

/** Files where `process.env.X` is legitimate (single source of truth + Next config). */
export const DEFAULT_ALLOWLIST: readonly string[] = [
  "src/_shared/config/env.ts",
  "next.config.ts",
  "next.config.mjs",
  "next.config.js",
] as const;

/** Directories we never scan (huge or auto-generated). */
const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".next",
  ".turbo",
  ".cache",
  "out",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  "generated", // Prisma client
]);

export interface ScanProcessEnvLeaksOptions {
  /** Workspace root. */
  workDir: string;
  /** POSIX paths relative to workDir where process.env.* is allowed. */
  allowlist?: readonly string[];
  /** Test seam — replaces the file walker. Used by unit tests. */
  _walk?: (root: string) => AsyncIterable<{ relPath: string; abs: string }>;
  /** Test seam — replaces fs.readFile. */
  _readFile?: (abs: string) => Promise<string>;
}

const PROCESS_ENV_REGEX = /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g;

export async function scanProcessEnvLeaks(
  opts: ScanProcessEnvLeaksOptions,
): Promise<QaViolationV3[]> {
  const allowlist = new Set(opts.allowlist ?? DEFAULT_ALLOWLIST);
  const walk = opts._walk ?? defaultWalk;
  const read = opts._readFile ?? ((p: string) => readFile(p, "utf-8"));

  const violations: QaViolationV3[] = [];

  for await (const { relPath, abs } of walk(opts.workDir)) {
    if (allowlist.has(relPath)) continue;
    if (!isScannable(relPath)) continue;

    let source: string;
    try {
      source = await read(abs);
    } catch {
      continue; // unreadable file — skip silently
    }

    const lineHits = scanSource(source);
    for (const hit of lineHits) {
      violations.push({
        rule: "env-leak",
        severity: "error",
        agent: "bootstrap-devops",
        file: relPath,
        line: hit.line,
        message: `Direct read of process.env.${hit.varName} — env vars must go through src/_shared/config/env.ts (R0).`,
        recommendedFix:
          `Replace \`process.env.${hit.varName}\` with \`env.${hit.varName}\` and add ` +
          `\`import { env } from "@/_shared/config/env"\` at the top of the file. ` +
          `If \`${hit.varName}\` is not yet declared in the env manifest, ` +
          `Bootstrap adds it during the fix loop.`,
      });
    }
  }
  return violations;
}

// ─── Source scanner (pure, exported for direct unit testing) ──────────

export interface SourceHit {
  line: number; // 1-based
  varName: string;
}

/**
 * Scan a single source string. Strips line/block comments line-by-line so
 * `process.env.X` inside comments doesn't false-positive. The regex's
 * `[A-Z]` start-anchor naturally filters out interpolation placeholders
 * like `process.env.${KEY}`.
 */
export function scanSource(source: string): SourceHit[] {
  const hits: SourceHit[] = [];
  const lines = source.split(/\r?\n/);
  const state = { inBlock: false };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const stripped = stripComments(raw, state);
    PROCESS_ENV_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PROCESS_ENV_REGEX.exec(stripped)) !== null) {
      hits.push({ line: i + 1, varName: m[1] ?? "" });
    }
  }
  return hits;
}

/**
 * Strip line + block comments from a single line, threading the
 * `inBlock` flag across lines. Conservative: does NOT strip string
 * literals (interpolated templates count as real code, which is what
 * we want — `${process.env.X}` is a real read).
 */
function stripComments(line: string, state: { inBlock: boolean }): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];
    if (state.inBlock) {
      if (ch === "*" && next === "/") {
        state.inBlock = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      // line comment — rest of line is a comment.
      break;
    }
    if (ch === "/" && next === "*") {
      state.inBlock = true;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// ─── File-system walking ──────────────────────────────────────────────

function isScannable(relPath: string): boolean {
  if (relPath.endsWith(".d.ts")) return false;
  return relPath.endsWith(".ts") || relPath.endsWith(".tsx");
}

async function* defaultWalk(
  root: string,
): AsyncIterable<{ relPath: string; abs: string }> {
  yield* walkInner(root, root);
}

async function* walkInner(
  root: string,
  dir: string,
): AsyncIterable<{ relPath: string; abs: string }> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    if (DEFAULT_SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkInner(root, abs);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const s = await stat(abs);
      if (!s.isFile()) continue;
    } catch {
      continue;
    }
    const rel = relative(root, abs).split(sep).join("/");
    yield { relPath: rel, abs };
  }
}
