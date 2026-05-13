import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  StitchAuthError,
  StitchClient,
  StitchUnavailableError,
  type InvokeStitch,
} from "./stitch-client";

const ORIGINAL_API_KEY = process.env["STITCH_API_KEY"];

beforeEach(() => {
  process.env["STITCH_API_KEY"] = "test-api-key";
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env["STITCH_API_KEY"];
  } else {
    process.env["STITCH_API_KEY"] = ORIGINAL_API_KEY;
  }
});

describe("StitchClient — auth", () => {
  it("throws StitchAuthError when STITCH_API_KEY is missing", () => {
    delete process.env["STITCH_API_KEY"];
    expect(() => new StitchClient()).toThrow(StitchAuthError);
  });

  it("accepts an explicit apiKey option, overriding env", () => {
    delete process.env["STITCH_API_KEY"];
    expect(() => new StitchClient({ apiKey: "explicit-key", _invokeStitch: vi.fn() })).not.toThrow();
  });
});

describe("StitchClient — happy paths", () => {
  it("enhancePrompt returns the refined prompt from the MCP response", async () => {
    const invoke: InvokeStitch = vi.fn(async () => ({ refinedPrompt: "Refined yoga prompt" }));
    const client = new StitchClient({ _invokeStitch: invoke });
    const out = await client.enhancePrompt({ rawPrompt: "yoga app" });
    expect(out.refinedPrompt).toBe("Refined yoga prompt");
    expect(invoke).toHaveBeenCalledWith("enhance_prompt", { prompt: "yoga app" });
  });

  it("designScreens returns projectId + parsed screens", async () => {
    const invoke: InvokeStitch = vi.fn(async () => ({
      projectId: "proj-001",
      screens: [
        {
          screenId: "scr-001",
          routeSlug: "home",
          rawHtml: "<div>home</div>",
          imageUrl: "https://stitch.googleapis.com/img/scr-001.png",
        },
      ],
    }));
    const client = new StitchClient({ _invokeStitch: invoke });
    const out = await client.designScreens({
      refinedPrompt: "Refined yoga prompt",
      designVibe: "Calm",
      pages: [{ route: "/", purpose: "Home page" }],
    });
    expect(out.projectId).toBe("proj-001");
    expect(out.screens).toHaveLength(1);
    expect(out.screens[0]?.routeSlug).toBe("home");
  });

  it("fetchDesignMd returns the design.md markdown", async () => {
    const invoke: InvokeStitch = vi.fn(async () => ({ markdown: "# Design System\n..." }));
    const client = new StitchClient({ _invokeStitch: invoke });
    const out = await client.fetchDesignMd({ projectId: "proj-001" });
    expect(out.markdown).toContain("Design System");
  });

  it("getScreenImage returns the PNG buffer", async () => {
    const fakeBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG signature
    const invoke: InvokeStitch = vi.fn(async () => ({ bytes: fakeBytes }));
    const client = new StitchClient({ _invokeStitch: invoke });
    const out = await client.getScreenImage({ screenId: "scr-001" });
    expect(out.bytes.equals(fakeBytes)).toBe(true);
  });
});

describe("StitchClient — retry behaviour", () => {
  it("retries 3 times with exponential backoff and surfaces StitchUnavailableError on persistent failure", async () => {
    const invoke: InvokeStitch = vi.fn(async () => {
      throw new Error("503 Service Unavailable");
    });
    const sleeps: number[] = [];
    const client = new StitchClient({
      _invokeStitch: invoke,
      _sleep: async (ms) => void sleeps.push(ms),
      baseBackoffMs: 1000,
    });
    await expect(client.enhancePrompt({ rawPrompt: "x" })).rejects.toThrow(StitchUnavailableError);
    expect(invoke).toHaveBeenCalledTimes(3);
    // Backoffs: 1000 (after attempt 1), 3000 (after attempt 2). No backoff after attempt 3.
    expect(sleeps).toEqual([1000, 3000]);
  });

  it("does NOT retry on a successful first attempt", async () => {
    const invoke: InvokeStitch = vi.fn(async () => ({ refinedPrompt: "ok" }));
    const sleeps: number[] = [];
    const client = new StitchClient({
      _invokeStitch: invoke,
      _sleep: async (ms) => void sleeps.push(ms),
    });
    await client.enhancePrompt({ rawPrompt: "x" });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("retries then succeeds — returns the late success value", async () => {
    let attempt = 0;
    const invoke: InvokeStitch = vi.fn(async () => {
      attempt++;
      if (attempt < 3) throw new Error("transient");
      return { refinedPrompt: "got it on attempt 3" };
    });
    const client = new StitchClient({
      _invokeStitch: invoke,
      _sleep: async () => undefined, // no real waiting
    });
    const out = await client.enhancePrompt({ rawPrompt: "x" });
    expect(out.refinedPrompt).toBe("got it on attempt 3");
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});

describe("StitchClient — response shape validation", () => {
  it("rejects designScreens response missing projectId", async () => {
    const invoke: InvokeStitch = vi.fn(async () => ({ screens: [] }));
    const client = new StitchClient({ _invokeStitch: invoke });
    await expect(
      client.designScreens({
        refinedPrompt: "x",
        designVibe: "Calm",
        pages: [{ route: "/", purpose: "Home" }],
      }),
    ).rejects.toThrow(StitchUnavailableError);
  });

  it("rejects designScreens response with a malformed screen entry", async () => {
    const invoke: InvokeStitch = vi.fn(async () => ({
      projectId: "proj-001",
      screens: [{ screenId: "scr-001" /* missing routeSlug, rawHtml, imageUrl */ }],
    }));
    const client = new StitchClient({ _invokeStitch: invoke });
    await expect(
      client.designScreens({
        refinedPrompt: "x",
        designVibe: "Calm",
        pages: [{ route: "/", purpose: "Home" }],
      }),
    ).rejects.toThrow(StitchUnavailableError);
  });

  it("rejects getScreenImage when bytes is not a Buffer", async () => {
    const invoke: InvokeStitch = vi.fn(async () => ({ bytes: "not-a-buffer" }));
    const client = new StitchClient({ _invokeStitch: invoke });
    await expect(client.getScreenImage({ screenId: "scr-001" })).rejects.toThrow(StitchUnavailableError);
  });
});
