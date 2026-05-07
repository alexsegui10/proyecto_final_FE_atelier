import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Regression for: GET /api/generate/<id>/files returning 410 when the id
 * came from a cached demo replay. Root cause: the demo-play route did not
 * persist `result.workDir`. Fix: it now writes the absolute path to
 * `out/demo-cache/<slug>/workDir/` so the files endpoint can walk it.
 *
 * This test pins the fixture's existence and structure so the runtime
 * never silently falls back to "no workDir" again. If someone deletes the
 * yoga cache, this fails before any user sees a 410.
 */
describe("demo cache fixture for yoga", () => {
  const cwd = process.cwd();
  const cachedWorkDir = join(cwd, "out", "demo-cache", "yoga", "workDir");

  it("the cached yoga workDir directory exists at the path the play route uses", () => {
    expect(existsSync(cachedWorkDir)).toBe(true);
  });

  it("ships the 6 .atelier/<agent>.json artifacts so the Reveal can load them", async () => {
    const expected = [
      "architect.json",
      "domain-persistence.json",
      "use-cases.json",
      "auth-rbac.json",
      "api-frontend.json",
      "qa-reviewer.json",
    ];
    for (const name of expected) {
      const path = join(cachedWorkDir, ".atelier", name);
      expect(existsSync(path), `missing ${name}`).toBe(true);
      const raw = await readFile(path, "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });

  it("ships prisma/schema.prisma so Monaco has something representative to render", async () => {
    const schemaPath = join(cachedWorkDir, "prisma", "schema.prisma");
    expect(existsSync(schemaPath)).toBe(true);
    const s = await stat(schemaPath);
    expect(s.size).toBeGreaterThan(500);
    const text = await readFile(schemaPath, "utf-8");
    expect(text).toMatch(/model\s+\w+/);
  });

  it("the events.json next to the workDir parses and references real models", async () => {
    const eventsPath = join(cwd, "out", "demo-cache", "yoga", "events.json");
    expect(existsSync(eventsPath)).toBe(true);
    const data = JSON.parse(await readFile(eventsPath, "utf-8")) as {
      events: Array<{ type: string; payload: { agent?: string; path?: string } }>;
    };
    expect(data.events.length).toBeGreaterThan(20);
    const agents = new Set(
      data.events
        .map((e) => e.payload.agent)
        .filter((a): a is string => typeof a === "string"),
    );
    // All 6 generator agents should appear at least once in the timeline.
    for (const a of [
      "architect",
      "domain-persistence",
      "use-cases",
      "auth-rbac",
      "api-frontend",
      "qa-reviewer",
    ]) {
      expect(agents.has(a), `events.json missing agent ${a}`).toBe(true);
    }
  });
});
