import { z } from "zod";

import { AGENT_NAMES_V3 } from "./agent-names";

/**
 * Schemas for the Bootstrap & DevOps Agent (v3 wave 1).
 *
 * The agent emits ONE primary artifact, `.atelier/bootstrap-output.json`, plus
 * a handful of physical files in the workDir (`.env.example`, `.env.local`,
 * `docker-compose.yml`, `scripts/setup.{ps1,sh}`, `src/_shared/config/env.ts`,
 * `src/_shared/config/check-environment.ts`, `README.md`).
 *
 * The artifact captures:
 *   - The `envManifest`: single source of truth for every environment variable
 *     the generated app uses. Downstream agents that need `process.env.X` MUST
 *     register `X` here; if they don't, the QA Reviewer emits a BLOCKER.
 *   - The Docker services declared in docker-compose.
 *   - The setup steps (cross-platform, idempotent) the README documents.
 *   - The `check-environment` rules wired into the boot path of the generated
 *     app.
 *   - The list of physical files produced + a few load-bearing invariants the
 *     QA Reviewer can verify without re-parsing the artifact.
 *
 * Authoritative reference: `ROADMAP_V3.md` § 3.1.
 */

// ─── env-manifest.json ───────────────────────────────────────────────

export const ENV_VAR_CATEGORIES = [
  "database",
  "auth",
  "runtime",
  "third-party",
  "feature-flag",
  "observability",
  "email",
  "storage",
  "cache",
  "queue",
  "payment",
  "telemetry",
] as const;

const envVarSchema = z
  .object({
    /** SCREAMING_SNAKE_CASE name — matches process.env access syntax exactly. */
    name: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/, "env var name must be SCREAMING_SNAKE_CASE"),
    /** Whether the app refuses to start when the var is missing. */
    required: z.boolean(),
    /**
     * Suggested value for local dev. Sensitive vars MUST NOT have a default
     * checked in (see refine below); they're seeded as empty string in
     * `.env.example` and the human fills them in.
     */
    defaultValue: z.string().optional(),
    description: z.string().min(10, "describe the var in at least 10 chars"),
    category: z.enum(ENV_VAR_CATEGORIES),
    /**
     * If `true`, the env validator never logs the value, masks it in error
     * messages, and refuses to expose it via `console.log` / serializers.
     * Examples: JWT secrets, API keys, DB passwords.
     */
    sensitive: z.boolean(),
    /** Realistic-looking placeholder for `.env.example` (not the real value). */
    example: z.string().optional(),
    /**
     * Validation hint consumed by the runtime env validator. Common values:
     * `"url"`, `"port"`, `"email"`, `"non-empty-string"`, or a raw regex
     * like `^pk_test_[A-Za-z0-9]+$`. Free-form so future categories work.
     */
    validation: z.string().optional(),
    /**
     * The v3 agents that READ this variable (by name). Used by the QA Reviewer
     * to verify cross-agent contracts. At least one entry required — an env
     * var with zero consumers shouldn't exist.
     */
    consumedBy: z
      .array(z.enum(AGENT_NAMES_V3 as readonly [string, ...string[]]))
      .min(1, "at least one consuming agent (zero-consumer vars must be removed)"),
    /**
     * Single TS file that VALIDATES the variable at runtime. Convention:
     * always `src/_shared/config/env.ts`. The single-source-of-truth invariant
     * is checked at the manifest level.
     */
    producedBy: z.string().regex(/^src\//, "producedBy must be a src/ TS file path"),
  })
  .strict()
  .refine(
    (v) => !v.sensitive || v.defaultValue === undefined,
    "sensitive vars must NOT have a defaultValue (security: never commit secret defaults)",
  );

export const envManifestSchema = z
  .object({
    variables: z.array(envVarSchema).min(1, "manifest must declare at least one env var"),
    /**
     * Path to the single TS module that imports and validates every variable
     * in the manifest at runtime. Every `envVarSchema.producedBy` must match
     * this path — that's the `singleSourceOfTruth` invariant.
     */
    validatorPath: z
      .string()
      .regex(/^src\//, "validatorPath must live under src/"),
  })
  .strict()
  .refine(
    (m) => m.variables.every((v) => v.producedBy === m.validatorPath),
    "every variable's producedBy must equal manifest.validatorPath (single source of truth)",
  )
  .refine(
    (m) => {
      const names = m.variables.map((v) => v.name);
      return new Set(names).size === names.length;
    },
    "duplicate env var name in manifest",
  );

export type EnvVar = z.infer<typeof envVarSchema>;
export type EnvManifest = z.infer<typeof envManifestSchema>;

// ─── bootstrap-output.json (primary artifact) ────────────────────────

const dockerServiceSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_-]*$/, "service name must be kebab/snake lowercase"),
    image: z.string().min(3),
    ports: z.array(z.string()),
    /** Env var NAMES referenced by this service (must exist in the manifest). */
    envVars: z.array(z.string()),
    volumes: z.array(z.string()).optional(),
    healthcheck: z.string().optional(),
  })
  .passthrough(); // allow per-image extras (command, depends_on, restart, etc.)

const setupStepSchema = z
  .object({
    order: z.number().int().positive(),
    description: z.string().min(5),
    /** Shell command. May reference variables defined in the manifest. */
    command: z.string().min(1),
    required: z.boolean(),
    /** Platforms where this step runs. "all" = everywhere. */
    os: z.enum(["all", "win32", "darwin", "linux"]).default("all"),
  })
  .strict();

const checkEnvironmentRuleSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, "rule id must be kebab-case"),
    description: z.string().min(5),
    /** Human description of HOW to detect the condition (the impl is in the validator). */
    detect: z.string().min(5),
    /** Message surfaced to the user when the check fails. */
    whenFails: z.string().min(5),
    /** Actionable next step (command, doc link, alternative service). */
    fixSuggestion: z.string().min(5),
  })
  .strict();

const filesProducedSchema = z
  .object({
    envExample: z.string().default(".env.example"),
    envLocal: z.string().default(".env.local"),
    dockerCompose: z.string().default("docker-compose.yml"),
    setupPs1: z.string().default("scripts/setup.ps1"),
    setupSh: z.string().default("scripts/setup.sh"),
    readme: z.string().default("README.md"),
    checkEnvironment: z
      .string()
      .default("src/_shared/config/check-environment.ts"),
    envValidator: z.string().default("src/_shared/config/env.ts"),
  })
  .strict();

const invariantsSchema = z
  .object({
    /** All `producedBy` fields point to `filesProduced.envValidator`. */
    singleSourceOfTruth: z.boolean(),
    /** Both .ps1 and .sh setup scripts produced. */
    crossPlatformScripts: z.boolean(),
    /** docker-compose declares at least one healthcheck. */
    healthcheckPresent: z.boolean(),
  })
  .strict();

export const bootstrapOutputSchema = z
  .object({
    envManifest: envManifestSchema,
    dockerServices: z.array(dockerServiceSchema),
    setupSteps: z
      .array(setupStepSchema)
      .min(3, "at least 3 setup steps (e.g. docker up, migrate, seed, dev)"),
    checkEnvironmentRules: z
      .array(checkEnvironmentRuleSchema)
      .min(1, "at least one check-environment rule"),
    filesProduced: filesProducedSchema,
    invariants: invariantsSchema,
    notes: z.array(z.string()).optional(),
  })
  .strict()
  .refine(
    (a) => a.invariants.singleSourceOfTruth === (a.envManifest.validatorPath === a.filesProduced.envValidator),
    "invariant.singleSourceOfTruth must match (validatorPath === filesProduced.envValidator)",
  )
  .refine(
    (a) => {
      // Every envVars reference in dockerServices must exist in the manifest.
      const declared = new Set(a.envManifest.variables.map((v) => v.name));
      return a.dockerServices.every((s) => s.envVars.every((name) => declared.has(name)));
    },
    "dockerServices reference env vars that aren't declared in the manifest",
  )
  // crossPlatformScripts ⟺ ambos paths terminan en .ps1 y .sh
  .refine(
    (a) => a.invariants.crossPlatformScripts ===
      (a.filesProduced.setupPs1.endsWith(".ps1") && a.filesProduced.setupSh.endsWith(".sh")),
    "invariant.crossPlatformScripts must match (setupPs1.endsWith(.ps1) && setupSh.endsWith(.sh))",
  )
  // healthcheckPresent ⟺ al menos un service tiene healthcheck non-empty
  .refine(
    (a) => a.invariants.healthcheckPresent ===
      a.dockerServices.some((s) => typeof s.healthcheck === "string" && s.healthcheck.length > 0),
    "invariant.healthcheckPresent must match (dockerServices has at least one non-empty healthcheck)",
  );

export type DockerService = z.infer<typeof dockerServiceSchema>;
export type SetupStep = z.infer<typeof setupStepSchema>;
export type CheckEnvironmentRule = z.infer<typeof checkEnvironmentRuleSchema>;
export type BootstrapOutput = z.infer<typeof bootstrapOutputSchema>;

// ─── Validators (orchestrator surface) ───────────────────────────────

export function validateEnvManifest(input: unknown): string | null {
  const r = envManifestSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}

export function validateBootstrapOutput(input: unknown): string | null {
  const r = bootstrapOutputSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
