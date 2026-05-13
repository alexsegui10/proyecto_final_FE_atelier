/**
 * Thin wrapper around the Stitch MCP / SDK that Layout Architect (v3 wave 2)
 * uses. Provides 4 high-level operations matching the official Google
 * skills workflow (enhance-prompt → stitch-design → design-md → image
 * download), plus auth handling and retry-with-backoff.
 *
 * The actual MCP invocation goes through `_invokeStitch` — a test seam
 * that we mock in unit tests and replace with real Stitch CLI / SDK calls
 * in production (the wiring lives in the future Layout Architect runtime).
 *
 * Auth: reads `STITCH_API_KEY` env var. If missing, every operation throws
 * `StitchAuthError`. Layout Architect maps that to the `stitch-unavailable`
 * violation per R3 of its prompt.
 */

// ─── Public types ───────────────────────────────────────────────────

export interface StitchScreen {
  /** Stable Stitch screen id used for re-fetching. */
  screenId: string;
  /** Suggested route slug (e.g. "home", "sign-in"). */
  routeSlug: string;
  /** Raw HTML produced by Stitch — parser in Layout Architect handles this. */
  rawHtml: string;
  /** Public URL to the screenshot PNG. */
  imageUrl: string;
}

export interface StitchClientOptions {
  /** Defaults to process.env.STITCH_API_KEY. Throws if missing. */
  apiKey?: string;
  /** Max attempts per operation. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms between retries. Default 1000 (then 3000, then 9000). */
  baseBackoffMs?: number;
  /** Test seam — replaces the real MCP/SDK transport. */
  _invokeStitch?: InvokeStitch;
  /** Test seam — replaces sleep (for fast unit tests). */
  _sleep?: (ms: number) => Promise<void>;
}

/**
 * Low-level invocation signature. Mirrors `stitch.callTool(name, params)`
 * from the official SDK. Returns a plain object whose shape depends on the
 * tool. The client only depends on a small subset documented per method.
 */
export type InvokeStitch = (
  tool: StitchTool,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type StitchTool =
  | "enhance_prompt"
  | "design_screens"
  | "fetch_design_md"
  | "get_screen_image";

// ─── Errors ─────────────────────────────────────────────────────────

export class StitchAuthError extends Error {
  readonly kind = "auth" as const;
  constructor(msg = "STITCH_API_KEY missing — set it in .env.local") {
    super(msg);
    this.name = "StitchAuthError";
  }
}

export class StitchUnavailableError extends Error {
  readonly kind = "unavailable" as const;
  constructor(
    readonly tool: StitchTool,
    readonly attempts: number,
    readonly cause: unknown,
  ) {
    super(`Stitch tool '${tool}' failed after ${attempts} attempts: ${describe(cause)}`);
    this.name = "StitchUnavailableError";
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── Client ─────────────────────────────────────────────────────────

export class StitchClient {
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly invoke: InvokeStitch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: StitchClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env["STITCH_API_KEY"];
    if (!apiKey || apiKey.length === 0) {
      throw new StitchAuthError();
    }
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1000;
    this.invoke = opts._invokeStitch ?? defaultInvoke;
    this.sleep =
      opts._sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  }

  /**
   * Skill: `enhance-prompt`. Optionally invoked before `designScreens`
   * when the caller's prompt is sparse (Layout Architect decides — see
   * skip-enhance-prompt heuristic in its prompt).
   */
  async enhancePrompt(input: { rawPrompt: string }): Promise<{ refinedPrompt: string }> {
    const result = await this.withRetry("enhance_prompt", {
      prompt: input.rawPrompt,
    });
    const refined = (result as { refinedPrompt?: unknown }).refinedPrompt;
    if (typeof refined !== "string" || refined.length === 0) {
      throw new StitchUnavailableError("enhance_prompt", 1, "missing refinedPrompt in response");
    }
    return { refinedPrompt: refined };
  }

  /**
   * Skill: `stitch-design`. Generates one screen per page in `pages[]`.
   * Returns the project id + an entry per screen.
   */
  async designScreens(input: {
    refinedPrompt: string;
    designVibe: string;
    pages: ReadonlyArray<{ route: string; purpose: string }>;
  }): Promise<{ projectId: string; screens: StitchScreen[] }> {
    const result = await this.withRetry("design_screens", {
      prompt: input.refinedPrompt,
      designVibe: input.designVibe,
      pages: input.pages,
    });
    const r = result as { projectId?: unknown; screens?: unknown };
    if (typeof r.projectId !== "string" || !Array.isArray(r.screens)) {
      throw new StitchUnavailableError("design_screens", 1, "malformed response shape");
    }
    const screens: StitchScreen[] = r.screens.map((s: unknown) => {
      const e = s as Partial<StitchScreen>;
      if (
        typeof e.screenId !== "string" ||
        typeof e.routeSlug !== "string" ||
        typeof e.rawHtml !== "string" ||
        typeof e.imageUrl !== "string"
      ) {
        throw new StitchUnavailableError("design_screens", 1, "malformed screen entry");
      }
      return e as StitchScreen;
    });
    return { projectId: r.projectId, screens };
  }

  /**
   * Skill: `design-md`. Fetches the semantic design system documentation
   * Stitch generates for the project.
   */
  async fetchDesignMd(input: { projectId: string }): Promise<{ markdown: string }> {
    const result = await this.withRetry("fetch_design_md", {
      projectId: input.projectId,
    });
    const md = (result as { markdown?: unknown }).markdown;
    if (typeof md !== "string" || md.length === 0) {
      throw new StitchUnavailableError("fetch_design_md", 1, "empty design.md");
    }
    return { markdown: md };
  }

  /**
   * Downloads the PNG bytes for a screen. Layout Architect persists them to
   * `.atelier/stitch-mockups/<route-slug>.png`.
   */
  async getScreenImage(input: { screenId: string }): Promise<{ bytes: Buffer }> {
    const result = await this.withRetry("get_screen_image", {
      screenId: input.screenId,
    });
    const bytes = (result as { bytes?: unknown }).bytes;
    if (!(bytes instanceof Buffer)) {
      throw new StitchUnavailableError("get_screen_image", 1, "missing PNG bytes");
    }
    return { bytes };
  }

  // ─── Retry plumbing ───────────────────────────────────────────────

  private async withRetry(tool: StitchTool, params: Record<string, unknown>): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.invoke(tool, params);
      } catch (err) {
        lastError = err;
        if (attempt < this.maxAttempts) {
          await this.sleep(this.baseBackoffMs * Math.pow(3, attempt - 1));
        }
      }
    }
    throw new StitchUnavailableError(tool, this.maxAttempts, lastError);
  }
}

// ─── Default invoke (placeholder until real SDK wiring) ─────────────

const defaultInvoke: InvokeStitch = async () => {
  throw new Error(
    "StitchClient defaultInvoke is a placeholder. " +
      "The real Stitch MCP wiring lands when the Layout Architect runtime is built. " +
      "Until then, pass `_invokeStitch` explicitly (tests do this).",
  );
};
