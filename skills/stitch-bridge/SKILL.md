---
name: stitch-bridge
description: Thin adapter for invoking Google Stitch MCP from Layout Architect, downloading the HTML/CSS literal as an artifact, and extracting minimal theming tokens. References the 7 official Stitch Agent Skills instead of reimplementing them. Trigger when Layout Architect needs to call enhance-prompt / stitch-design / design-md / get-screen-image / get-screen-html.
---

# stitch-bridge

**Layered on top of the 7 official Google Stitch Agent Skills**. We do NOT reinvent prompting or HTML parsing — those skills already do it well. What we add is the **Atelier contract**: how Layout Architect maps Discovery + Architect inputs to Stitch tool calls, and how the Stitch output collapses into our `stitch-analysis.json` manifest + literal HTML files on disk.

## Architectural posture (post-rework)

**The HTML Stitch returns IS the canonical look of the generated app.** We persist it literally to `.atelier/stitch-html/<slug>.html` and the Visual Adapter (wave-4-frontend) reads it directly, preserving CSS. We do NOT decompose it into a semantic tree, and we do NOT re-author it in shadcn.

The minimal extraction we still do (color + typography tokens, linked fonts) exists for two specific purposes:
1. **Theming**: tematizar los pocos primitivos shadcn que el Visual Adapter inyecte como último recurso (no para reconstruir un Tailwind config canonical).
2. **Font preservation**: capturar los `<link rel="stylesheet">` de fuentes que Stitch embebió, para que el Adapter los copie al `app/layout.tsx` y no se rompan en runtime.

## Official Stitch skills we orchestrate

| Official skill (Google) | When Layout Architect uses it |
|---|---|
| `enhance-prompt` | CONDITIONAL — only when the raw arch-prompt is `< 200 chars` or has `< 3 elements` (see heuristic below) |
| `stitch-design` | ALWAYS — the primary screen generation call. Returns `screens[]` with `{ screenId, routeSlug, rawHtml, imageUrl }`. **`rawHtml` is the source of `.atelier/stitch-html/<slug>.html`** — no separate `get_screen` call needed |
| `design-md` | ALWAYS — produce the semantic DESIGN.md persisted to `.atelier/stitch-design.md` |
| `get-screen-image` (via MCP `get_screen_image` tool) | ALWAYS — one call per page to download the mockup PNG |
| `stitch-loop` | NEVER — we want explicit page-by-page control |
| `react-components` | NEVER — Atelier Visual Adapter owns React output, not Stitch |
| `remotion` | NEVER — out of scope for v3 |
| `shadcn-ui` | NEVER — Visual Adapter injects shadcn primitives only as last resort |

The `StitchClient` wrapper in `lib/agents/runtime/stitch-client.ts` is what your subprocess calls. Auth via `STITCH_API_KEY`. Three retries with exponential backoff (1s, 3s, 9s). All operations have a `_invokeStitch` test seam.

## The enhance-prompt decision (preserves your 350 free designs/month)

Stitch's free tier is 350 generations/month. `enhance-prompt` counts as ONE call. Always invoking it doubles your monthly cost. Use this deterministic decision tree:

```
const promptLen = rawPrompt.length;
const elements = countElements(discovery, architect);
  // elements = roles + entities + (publicRoutes ∪ privateRoutes ∪ adminRoutes)

if (promptLen < 200 || elements < 3) {
  // SPARSE input — Stitch will benefit from refinement.
  call enhance-prompt → use refinedPrompt.
} else if (promptLen > 500 && countPages(architect) > 5) {
  // RICH input — Stitch can work directly.
  skip enhance-prompt → use rawPrompt.
} else {
  // BORDERLINE — opt for skip to preserve quota; rawPrompt is "good enough".
  skip enhance-prompt → use rawPrompt.
}
```

### Example: yoga full Discovery (skip enhance-prompt)

```
"You are designing a Calm-style yoga application.
 Functional context:
   - Plataforma para gestionar un estudio de yoga: alumnos reservan ...
   - Roles: admin, teacher, student
   - Primary entities: User, Class, Booking, Membership
 Pages to design:
   - /: home with marketing hero
   - /shop: public catalogue of upcoming classes
   - /shop/[slug]: class detail
   - /sign-in: sign-in form
   - /sign-up: sign-up form
   - /my/classes: student's booked classes
   - /admin/classes: admin CRUD on classes
   - /admin/memberships: admin CRUD on memberships
 ..."
```

Length: ~720 chars, 8 pages, 4 entities. **Skip enhance-prompt.**

### Example: barebones Discovery (call enhance-prompt)

```
"Design a notes app. Roles: user. Entities: Note.
 Pages: /, /sign-in, /sign-up."
```

Length: ~80 chars, 1 entity, 3 routes. **Call enhance-prompt** — too sparse to give Stitch enough context.

## Hint enrichment from Brand Identity (reduced)

When the orchestrator has already produced `.atelier/brand-identity.json` (paso 6 reducido), Layout Architect concatenates these hints to the Stitch prompt right after the page list:

```
Visual hints (tentative, Stitch may override):
- primarySeed: {brand-identity.tentativePaletteHints.primarySeed}
- vibeMood: {brand-identity.tentativePaletteHints.vibeMood}
- voice: {brand-identity.brand.voice} / tone: {brand-identity.brand.tone}
- sansSuggestion: {brand-identity.tentativeFontHints.sansSuggestion}
- displaySuggestion: {brand-identity.tentativeFontHints.displaySuggestion}
- rationale: {brand-identity.tentativePaletteHints.rationale}

These are HINTS, not constraints. Choose a coherent design.
```

If `brand-identity.json` does not exist yet (Brand Identity hasn't run, e.g. first pass with parallel sub-waves), omit the hint block — Stitch can design without it.

## Downloading + persisting Stitch output

`stitch-design` returns `{ projectId, screens: [{ screenId, routeSlug, rawHtml, imageUrl }] }`. For each screen:

1. Take `rawHtml` from the screen object → write to `.atelier/stitch-html/<slug>.html`. **This is the canonical artifact**; nothing else stores HTML.
2. **`get_screen_image(screenId)`** → bytes → write to `.atelier/stitch-mockups/<slug>.png`.
3. Scan `rawHtml` for `<link rel="stylesheet" href="...">` and `<style>@import url(...)</style>` patterns. Collect URLs whose host matches `fonts.googleapis.com`, `fonts.gstatic.com`, or any `*.css` with `font-` / `family=` in path. Persist these as `pages[].linkedFonts[]` in `stitch-analysis.json`.

Slug convention (matches existing v2 + paso 5): `route.replace(/^\//, '').replace(/\//g, '-') || 'home'`. So `/` → `home`, `/admin/classes` → `admin-classes`.

## Extracting theming tokens (limited scope)

Tokens exist to theme injected shadcn primitives, NOT to reconstruct the app's CSS. Be minimal.

**Color tokens** — prefer `design-md` (Stitch's own semantic doc) if it declares colors with role labels. Fallback: cheerio scan of `rawHtml` for:
- Most frequent `bg-*` class on `<body>` or outer wrapper → `background`.
- Most frequent `text-*` on `<body>` → `foreground`.
- Color used by the largest `<button>` with high-contrast classes → `primary`.
- Borders + dividers (`border-*` classes) → `border`.
- Subtle backgrounds (cards, `bg-slate-50`, `bg-gray-100`) → `muted`.

Map Tailwind class names to hex via the bundled Tailwind palette JSON (already a devDep of the repo). If a class is non-standard (custom hex inline), read `style="color: #..."` directly.

**Typography tokens** — from the rendered CSS of the largest `<h1>` and the most frequent `<p>`:

```ts
{ role: "heading-1", family: extractFontFamily, sizePx: parseTailwindSize, weight: parseTailwindWeight }
{ role: "body", ... }
```

Tailwind: `text-base` = 16px, `text-lg` = 18px, `text-xl` = 20px, `text-2xl` = 24px, `text-4xl` = 36px, `text-5xl` = 48px. `font-normal` = 400, `font-medium` = 500, `font-semibold` = 600, `font-bold` = 700.

## What this skill no longer does (rework retired)

- **No semantic tree decomposition.** `Section` / `LayoutPrimitive` / `gapPx` / `paddingPx` heuristics were removed. The Visual Adapter reads the HTML literally — primitive classification was wasted work.
- **No `rootSection` field**. Replaced by `rawHtmlPath` in `stitch-analysis.pages[]`.

## What NOT to do

- **Don't paste rawHtml inline into `stitch-analysis.json`.** It lives in its own `.html` file. The manifest only stores the path.
- **Don't trust Stitch's `data-testid` (if any)**. Our `test-id-contract.json` is authoritative. The Visual Adapter injects the right test-ids on the right nodes regardless of what Stitch emitted.
- **Don't invoke `stitch-loop`**. It generates entire sites in one shot; we want explicit page-by-page control to match `layout-tree.pages[]`.
- **Don't use tokens to build a Tailwind config**. The Adapter preserves Stitch's CSS; tokens are theming-only for injected primitives.

## Failure modes

| Failure | Action |
|---|---|
| `STITCH_API_KEY` missing | Layout Architect emits `stitch-unavailable` severity error agent layout-architect, ABORTS |
| Stitch 5xx 3 times in a row | `StitchClient` throws `StitchUnavailableError`. Layout Architect emits the same violation, ABORTS |
| Stitch returns malformed response | `StitchClient` throws on shape mismatch. Layout Architect emits `stitch-malformed-response` severity error, ABORTS |
| `get_screen` returns empty/invalid HTML for one screen | Skip that page from `stitch-analysis.pages[]`, emit `stitch-html-missing-partial` severity warn; the `stitch-completeness-scanner` post-wave gate may trigger a reprompt |
| One page's mockup PNG is corrupt | Skip that page from `stitch-analysis.pages[]`, emit `stitch-image-decode-failure` severity warn |
| `linkedFonts` extraction returns 0 URLs but `<link rel=stylesheet>` exists | Emit `stitch-font-extraction-partial` severity warn; the Visual Adapter falls back to system stacks for that page |

## Reprompt support (paso C of the rework)

When the orchestrator re-invokes Layout Architect with `--stitch-reprompt --attempt=N --previous-failures=<path>`:

- Read the failures JSON (list of pages + what was missing per page).
- Re-build the prompt with explicit emphasis: `"The previous Stitch run missed: <X> on page <Y>. Re-generate with explicit focus on <X>."`
- Call `stitch-design` again — Stitch returns a new `projectId` (treated as a fresh run).
- Re-download HTML + PNG ONLY for the failing pages; pages that previously passed the completeness scanner are preserved (idempotent reuse from cached artifacts).
- Increment `stitchAttempt` in `stitch-analysis.json`. If `attempt === 2` and the scanner still flags gaps, set `stitchHealth: "degraded"` and let the run continue (plan B handled by orchestrator).

## When this skill is the wrong answer

- Pre-paso-5 work: don't reach for stitch-bridge until Layout Architect is part of the wave list.
- Generating React/JSX from Stitch directly: out of scope. The Visual Adapter (paso B of the rework) reads `.atelier/stitch-html/<slug>.html` and transforms it preserving the look.
- Cross-page visual coherence checks: that's `visual-regression-scanner` (Gate 6), not this skill.
