import { describe, it, expect } from "vitest";

import { validateStitchFixture, type StitchFixture } from "./stitch-fixture.schema";

function attempt0Screens() {
  return [
    {
      screenId: "scr-001",
      routeSlug: "home",
      pageRoute: "/",
      rawHtml: "<!doctype html><html><body><header><nav><a href='/'>Home</a></nav></header><main><section><h1>Welcome</h1></section></main></body></html>",
    },
    {
      screenId: "scr-002",
      routeSlug: "sign-in",
      pageRoute: "/sign-in",
      rawHtml: "<!doctype html><html><body><h1>Sign in</h1></body></html>",
    },
  ];
}

function attempt1Screens() {
  return [
    {
      screenId: "scr-001-v2",
      routeSlug: "home",
      pageRoute: "/",
      rawHtml: "<!doctype html><html><body><header><nav><a href='/'>Home</a></nav></header><main><section><h1>Welcome (v2)</h1></section></main></body></html>",
    },
    {
      screenId: "scr-002-v2",
      routeSlug: "sign-in",
      pageRoute: "/sign-in",
      rawHtml: "<!doctype html><html><body><header><nav>x</nav></header><main><form aria-label='signin'><input type='email'/><input type='password'/><button>Sign in</button></form></main></body></html>",
    },
  ];
}

function fixture(over: Partial<StitchFixture> = {}): StitchFixture {
  return {
    stitchProjectId: "fixture-test-001",
    designVibe: "Calm",
    designMd: "# Synthetic Stitch design — yoga\n\nPages: /, /sign-in.",
    attempts: [
      { attempt: 0, screens: attempt0Screens() },
      { attempt: 1, screens: attempt1Screens() },
    ],
    ...over,
  };
}

describe("stitchFixtureSchema — happy path", () => {
  it("accepts a two-attempt yoga-shaped fixture", () => {
    expect(validateStitchFixture(fixture())).toBeNull();
  });

  it("accepts a single-attempt fixture", () => {
    expect(
      validateStitchFixture(
        fixture({ attempts: [{ attempt: 0, screens: attempt0Screens() }] }),
      ),
    ).toBeNull();
  });

  it("accepts the home page with routeSlug='home'", () => {
    const f = fixture();
    expect(f.attempts[0]!.screens[0]!.pageRoute).toBe("/");
    expect(f.attempts[0]!.screens[0]!.routeSlug).toBe("home");
    expect(validateStitchFixture(f)).toBeNull();
  });
});

describe("stitchFixtureSchema — refinements", () => {
  it("rejects non-consecutive attempt numbers (0, 2 — skipping 1)", () => {
    expect(
      validateStitchFixture(
        fixture({
          attempts: [
            { attempt: 0, screens: attempt0Screens() },
            { attempt: 2, screens: attempt1Screens() },
          ],
        }),
      ),
    ).toMatch(/consecutive/);
  });

  it("rejects attempt outside [0, 2]", () => {
    expect(
      validateStitchFixture(
        fixture({
          attempts: [{ attempt: 3 as never, screens: attempt0Screens() }],
        }),
      ),
    ).toMatch(/attempt/);
  });

  it("rejects screen.routeSlug that does not match pageRoute", () => {
    expect(
      validateStitchFixture(
        fixture({
          attempts: [
            {
              attempt: 0,
              screens: [
                {
                  screenId: "scr-x",
                  routeSlug: "not-home" as never,
                  pageRoute: "/",
                  rawHtml: attempt0Screens()[0]!.rawHtml,
                },
              ],
            },
          ],
        }),
      ),
    ).toMatch(/routeSlug/);
  });

  it("rejects routeSlug with uppercase letters", () => {
    expect(
      validateStitchFixture(
        fixture({
          attempts: [
            {
              attempt: 0,
              screens: [
                {
                  screenId: "scr-x",
                  routeSlug: "Sign-In" as never,
                  pageRoute: "/sign-in",
                  rawHtml: "<html><body>x</body></html>",
                },
              ],
            },
          ],
        }),
      ),
    ).toMatch(/routeSlug/);
  });

  it("rejects rawHtml shorter than 20 chars", () => {
    expect(
      validateStitchFixture(
        fixture({
          attempts: [
            {
              attempt: 0,
              screens: [
                {
                  screenId: "scr-x",
                  routeSlug: "home",
                  pageRoute: "/",
                  rawHtml: "<html/>",
                },
              ],
            },
          ],
        }),
      ),
    ).toMatch(/rawHtml/);
  });

  it("rejects duplicate pageRoute within the same attempt", () => {
    expect(
      validateStitchFixture(
        fixture({
          attempts: [
            {
              attempt: 0,
              screens: [
                ...attempt0Screens(),
                {
                  screenId: "scr-dup",
                  routeSlug: "home",
                  pageRoute: "/",
                  rawHtml: attempt0Screens()[0]!.rawHtml,
                },
              ],
            },
          ],
        }),
      ),
    ).toMatch(/unique pageRoutes/);
  });

  it("rejects designVibe not in canonical set", () => {
    expect(
      validateStitchFixture(fixture({ designVibe: "Brutalist" as never })),
    ).toMatch(/designVibe/);
  });
});
