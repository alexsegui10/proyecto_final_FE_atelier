/**
 * stitch-fixture-helper — materialises a recorded Stitch fixture to
 * `workDir/.atelier/` so the Layout Architect agent can consume real
 * files instead of invoking the Stitch MCP. Used by `STITCH_MODE=fixture`
 * runs of the first-run mini-pipeline.
 *
 * Three concerns:
 *
 *   1. Per-attempt materialisation. The fixture declares an array of
 *      `attempts`; the preparer picks the entry whose `attempt` matches
 *      the current `stitchAttempt` (read from `.atelier/run-state.json`)
 *      and writes its screens to disk. This is what lets the Stitch
 *      reprompt loop converge across attempts (attempt 0 = HTML with a
 *      gap, attempt 1 = HTML corrected).
 *
 *   2. File layout. For each screen:
 *        `.atelier/stitch-html/<slug>.html`        ← rawHtml
 *        `.atelier/stitch-mockups/<slug>.png`     ← decoded mockupBase64Png
 *                                                   OR a 1×1 transparent
 *                                                   placeholder
 *      Plus:
 *        `.atelier/stitch-design.md`              ← fixture.designMd
 *        `.atelier/stitch-fixture-state.json`     ← metadata for the agent
 *                                                   (projectId, vibe,
 *                                                   attempt, screen index)
 *
 *   3. PreWaveGate wrapping. `createStitchFixturePreparerGate(path)`
 *      returns a `PreWaveGate` ready to register on `wave-2-design`. The
 *      gate reads the current attempt from run-state and prepares the
 *      fixture before Layout Architect runs. On every reprompt the gate
 *      fires again with the next attempt.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PreWaveGate, QaViolationV3 } from "../orchestrator-v3";
import {
  validateStitchFixture,
  type StitchFixture,
} from "../contracts-v3/stitch-fixture.schema";

// ─── Public types ───────────────────────────────────────────────────

export interface PrepareStitchFixtureOptions {
  /** Workspace directory (same `workDir` passed to runGenerationV3). */
  workDir: string;
  /** Absolute path to the fixture JSON file. */
  fixturePath: string;
  /** Which attempt of the fixture to materialise (0, 1, or 2). */
  attempt: number;
  /** Test seam — replaces fs.readFile when loading the fixture JSON. */
  _readFile?: (path: string) => Promise<string>;
  /** Test seam — replaces fs.writeFile when persisting prepared files. */
  _writeFile?: (path: string, data: string | Buffer) => Promise<void>;
  /** Test seam — replaces fs.mkdir. */
  _mkdir?: (path: string, opts: { recursive: true }) => Promise<void>;
}

export interface PrepareStitchFixtureResult {
  /** The attempt actually materialised (may differ from requested if clamped). */
  attempt: number;
  /** When true, the requested attempt was above the max declared and we
   *  fell back to the highest available — see preparer JSDoc. */
  clampedFromMissing: boolean;
  filesWritten: string[];
  fixtureStatePath: string;
}

/**
 * Companion metadata file that the Layout Architect agent reads instead
 * of invoking the Stitch MCP. Shape kept narrow on purpose — the agent
 * only needs the path of each pre-written file plus the project-level
 * fields it would have gotten from Stitch.
 */
export interface StitchFixtureState {
  mode: "fixture";
  attempt: number;
  stitchProjectId: string;
  designVibe: "Linear" | "Stripe" | "Notion" | "Vercel" | "Calm";
  designMdPath: string;
  screens: ReadonlyArray<{
    screenId: string;
    pageRoute: string;
    routeSlug: string;
    rawHtmlPath: string;
    mockupPath: string;
  }>;
}

// ─── Preparer ───────────────────────────────────────────────────────

const PLACEHOLDER_PNG_1x1 = Buffer.from(
  // 1×1 transparent PNG, 67 bytes.
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64",
);

export async function prepareStitchFixtureForAttempt(
  opts: PrepareStitchFixtureOptions,
): Promise<PrepareStitchFixtureResult> {
  const readFn = opts._readFile ?? ((p: string) => readFile(p, "utf8"));
  const writeFn =
    opts._writeFile ?? ((p: string, d: string | Buffer) => writeFile(p, d));
  const mkdirFn = opts._mkdir ?? ((p: string, o: { recursive: true }) => mkdir(p, o).then(() => undefined));

  // 1. Load + validate fixture.
  const raw = await readFn(opts.fixturePath);
  const parsed: unknown = JSON.parse(raw);
  const err = validateStitchFixture(parsed);
  if (err) {
    throw new Error(`Invalid Stitch fixture at '${opts.fixturePath}': ${err}`);
  }
  const fixture = parsed as StitchFixture;

  // 2. Pick the right attempt — with graceful degradation (B8 fix).
  //
  // The orchestrator's reprompt loop can request up to attempt=2 (after
  // 2 reprompts). A fixture is allowed to declare fewer attempts (e.g.
  // the recorder default produces only attempts 0 and 1). When the
  // requested attempt exceeds what the fixture declares, we clamp to
  // the highest available — the recorded "best Stitch could do" content
  // is the same regardless of how many times we'd re-prompt the real
  // service. This is NOT silent: the result records the clamp so the
  // caller can surface it in logs / run-state.
  let attemptEntry = fixture.attempts.find((a) => a.attempt === opts.attempt);
  let effectiveAttempt = opts.attempt;
  let clampedFromMissing = false;
  if (!attemptEntry) {
    const declared = fixture.attempts.map((a) => a.attempt).sort((a, b) => a - b);
    const maxDeclared = declared[declared.length - 1];
    if (maxDeclared === undefined) {
      throw new Error(`Stitch fixture declares zero attempts; cannot materialise.`);
    }
    if (opts.attempt > maxDeclared) {
      // Clamp.
      effectiveAttempt = maxDeclared;
      attemptEntry = fixture.attempts.find((a) => a.attempt === maxDeclared);
      clampedFromMissing = true;
    } else {
      // Requested attempt is below the highest declared — that's an
      // actual gap (e.g. fixture has [0, 2] but not 1). Fail loudly;
      // it's not a degradation, it's a malformed fixture.
      throw new Error(
        `Stitch fixture has no entry for attempt=${opts.attempt}; declared attempts: ${declared.join(", ")}.`,
      );
    }
  }
  if (!attemptEntry) {
    throw new Error(`Could not resolve attempt entry for ${opts.attempt}`);
  }

  // 3. Ensure target directories exist.
  const atelierDir = join(opts.workDir, ".atelier");
  const htmlDir = join(atelierDir, "stitch-html");
  const mockupsDir = join(atelierDir, "stitch-mockups");
  await mkdirFn(htmlDir, { recursive: true });
  await mkdirFn(mockupsDir, { recursive: true });

  const filesWritten: string[] = [];

  // 4. Materialise each screen.
  const stateScreens: Array<{
    screenId: string;
    pageRoute: string;
    routeSlug: string;
    rawHtmlPath: string;
    mockupPath: string;
  }> = [];
  for (const screen of attemptEntry.screens) {
    const htmlRel = `.atelier/stitch-html/${screen.routeSlug}.html`;
    const mockupRel = `.atelier/stitch-mockups/${screen.routeSlug}.png`;
    const htmlAbs = join(opts.workDir, htmlRel);
    const mockupAbs = join(opts.workDir, mockupRel);

    await writeFn(htmlAbs, screen.rawHtml);
    filesWritten.push(htmlRel);

    const pngBytes = screen.mockupBase64Png
      ? Buffer.from(screen.mockupBase64Png, "base64")
      : PLACEHOLDER_PNG_1x1;
    await writeFn(mockupAbs, pngBytes);
    filesWritten.push(mockupRel);

    stateScreens.push({
      screenId: screen.screenId,
      pageRoute: screen.pageRoute,
      routeSlug: screen.routeSlug,
      rawHtmlPath: htmlRel,
      mockupPath: mockupRel,
    });
  }

  // 5. Persist designMd.
  const designMdRel = ".atelier/stitch-design.md";
  const designMdAbs = join(opts.workDir, designMdRel);
  await writeFn(designMdAbs, fixture.designMd);
  filesWritten.push(designMdRel);

  // 6. Persist state file the agent reads.
  const state: StitchFixtureState = {
    mode: "fixture",
    attempt: effectiveAttempt,
    stitchProjectId: fixture.stitchProjectId,
    designVibe: fixture.designVibe,
    designMdPath: designMdRel,
    screens: stateScreens,
  };
  const stateRel = ".atelier/stitch-fixture-state.json";
  const stateAbs = join(opts.workDir, stateRel);
  await mkdirFn(dirname(stateAbs), { recursive: true });
  await writeFn(stateAbs, JSON.stringify(state, null, 2));
  filesWritten.push(stateRel);

  return {
    attempt: effectiveAttempt,
    clampedFromMissing,
    filesWritten,
    fixtureStatePath: stateRel,
  };
}

// ─── Attempt reader (from .atelier/run-state.json) ──────────────────

/**
 * Reads `stitchAttempt` from `.atelier/run-state.json`. The orchestrator
 * persists this file before each wave run; in `wave-2-design` it
 * includes the current value of `stitchRepromptAttempts`. Default 0
 * when the file does not exist (first wave-2-design run, pre-reprompt).
 */
export async function readStitchAttemptFromRunState(workDir: string): Promise<number> {
  const path = join(workDir, ".atelier", "run-state.json");
  if (!existsSync(path)) return 0;
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "stitchAttempt" in parsed &&
      typeof (parsed as { stitchAttempt: unknown }).stitchAttempt === "number"
    ) {
      const n = (parsed as { stitchAttempt: number }).stitchAttempt;
      if (Number.isInteger(n) && n >= 0 && n <= 2) return n;
    }
  } catch {
    // Malformed JSON or io error — fall back to 0 silently. The fixture
    // preparer will then materialise the first attempt, which is the
    // safest default.
  }
  return 0;
}

// ─── PreWaveGate adapter ────────────────────────────────────────────

export interface CreateStitchFixturePreparerGateOptions {
  /** Absolute path to the fixture JSON. */
  fixturePath: string;
  /** Optional override for the attempt source (defaults to run-state.json). */
  _resolveAttempt?: (workDir: string) => Promise<number>;
}

/**
 * Registers as a `PreWaveGate` on `wave-2-design`. On every wave-2-design
 * run (first + each reprompt) the gate:
 *   1. Reads the current attempt from `.atelier/run-state.json`.
 *   2. Re-materialises the fixture for that attempt to disk.
 *   3. Returns zero violations on success; a single `error`-severity
 *      violation if the fixture is missing or malformed (which blocks
 *      the wave — Layout Architect cannot run blind).
 */
export function createStitchFixturePreparerGate(
  opts: CreateStitchFixturePreparerGateOptions,
): PreWaveGate {
  const resolveAttempt = opts._resolveAttempt ?? readStitchAttemptFromRunState;
  return {
    name: "stitch-fixture-preparer",
    async run(ctx) {
      let attempt = 0;
      try {
        attempt = await resolveAttempt(ctx.workDir);
      } catch {
        // Treated as fresh first run.
        attempt = 0;
      }
      try {
        await prepareStitchFixtureForAttempt({
          workDir: ctx.workDir,
          fixturePath: opts.fixturePath,
          attempt,
        });
        return [];
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const violation: QaViolationV3 = {
          rule: "stitch-fixture-preparer-failed",
          severity: "error",
          agent: "layout-architect",
          file: opts.fixturePath,
          message: `Could not prepare Stitch fixture for attempt=${attempt}: ${message}`,
          recommendedFix:
            "Verify the fixture path is absolute and the JSON validates against stitchFixtureSchema. If the fixture exists, check filesystem write permissions on workDir/.atelier/.",
        };
        return [violation];
      }
    },
  };
}
