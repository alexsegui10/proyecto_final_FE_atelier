---
name: stitch-bridge
description: Thin adapter for invoking Google Stitch MCP from Layout Architect and parsing its HTML response into Atelier's structured artifacts. References the 7 official Stitch Agent Skills instead of reimplementing them. Trigger when Layout Architect needs to call enhance-prompt / stitch-design / design-md / get-screen-image, or when parsing Stitch HTML into stitch-analysis.json.
---

# stitch-bridge

**Layered on top of the 7 official Google Stitch Agent Skills**. We do NOT reinvent prompting or HTML parsing — those skills already do it well. What we add is the **Atelier contract**: how Layout Architect maps Discovery + Architect inputs to Stitch tool calls, and how the Stitch HTML output collapses into our `stitch-analysis.json` schema.

## Official Stitch skills we orchestrate

| Official skill (Google) | When Layout Architect uses it |
|---|---|
| `enhance-prompt` | CONDITIONAL — only when the raw arch-prompt is `< 200 chars` or has `< 3 elements` (see heuristic below) |
| `stitch-design` | ALWAYS — the primary screen generation call |
| `design-md` | ALWAYS — produce the semantic DESIGN.md persisted to `.atelier/stitch-design.md` |
| `get-screen-image` (via MCP `get_screen_image` tool) | ALWAYS — one call per page to download the mockup PNG |
| `stitch-loop` | NEVER — we want explicit page-by-page control |
| `react-components` | NEVER — Atelier UI Components owns React output, not Stitch |
| `remotion` | NEVER — out of scope for v3 |
| `shadcn-ui` | NEVER — Atelier UI Components already targets shadcn |

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

## Mapping the raw HTML to `stitch-analysis.json`

Stitch returns HTML per screen (rich Tailwind classes + semantic markup). We DO NOT use it literally. We parse it with **cheerio** (`^1.0.0`, already a devDep of the repo root) into our `Section` recursive tree.

### Heuristics for `layoutPrimitive`

Inspect the root element of a section. Map class strings to primitives:

| Tailwind class pattern | `layoutPrimitive` |
|---|---|
| `flex flex-col` (no `gap-` or with `gap-y-*`) | `stack` |
| `grid grid-cols-N` | `grid` + `columns: N` |
| `flex flex-row` or `flex` with `items-*` no direction | `flex-row` |
| `flex flex-col` with explicit `gap-*` | `flex-col` |
| `relative` + child `absolute` siblings | `absolute` |
| (fallback) | `stack` |

Use cheerio:

```ts
import { load } from "cheerio";

function classifyPrimitive($el: cheerio.Cheerio<cheerio.Element>): LayoutPrimitive {
  const classes = ($el.attr("class") ?? "").split(/\s+/);
  if (classes.includes("grid")) {
    const colsClass = classes.find((c) => /^grid-cols-(\d+)$/.test(c));
    const m = colsClass?.match(/^grid-cols-(\d+)$/);
    return "grid"; // columns: m ? Number(m[1]) : undefined
  }
  if (classes.includes("flex") && classes.includes("flex-row")) return "flex-row";
  if (classes.includes("flex") && classes.includes("flex-col")) {
    const hasGap = classes.some((c) => c.startsWith("gap-"));
    return hasGap ? "flex-col" : "stack";
  }
  if (classes.includes("relative") && $el.find("> .absolute").length > 0) return "absolute";
  return "stack";
}
```

### Heuristics for `gapPx` and `paddingPx`

Tailwind's spacing scale: `0=0, 1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40, 12=48`. Multiply by 4 to get px (Tailwind's default).

```ts
function gapPx(classes: string[]): number | undefined {
  const g = classes.find((c) => /^gap-\d+$/.test(c));
  if (!g) return undefined;
  return Number(g.slice(4)) * 4;
}

function paddingPx(classes: string[]): SectionPadding | undefined {
  // Look for p-N, px-N, py-N, pt-N, pr-N, pb-N, pl-N and compose.
  // (Simplified — full implementation in stitch-bridge helper code.)
}
```

### Heuristics for color tokens

Walk every element. Collect `style="color: #..."` + classes like `bg-emerald-600` + `text-slate-900`. Tailwind classnames don't carry the hex; map them via a static lookup table (cheerio + a built-in Tailwind palette JSON).

Assign roles by frequency + semantic position:

- Most frequent `bg-*` on `<body>` / outer wrapper → `background`.
- Most frequent `text-*` on `<body>` / main wrapper → `foreground`.
- Color used by primary CTA buttons (largest `<button>` with prominent contrast) → `primary`.
- Borders + dividers → `border`.
- Subtle backgrounds (cards) → `muted`.

### Heuristics for typography tokens

```ts
// From the rendered CSS of the largest <h1>:
{ role: "heading-1", family: extractFontFamily, sizePx: parseTailwindSize, weight: parseTailwindWeight }
// From <p> with the most frequent classes:
{ role: "body", ... }
```

Tailwind `text-base` = 16px, `text-lg` = 18px, `text-xl` = 20px, `text-2xl` = 24px, `text-4xl` = 36px, `text-5xl` = 48px. `font-normal` = 400, `font-medium` = 500, `font-semibold` = 600, `font-bold` = 700.

## What NOT to do

- **Don't copy the HTML literally** into any artifact. UI Components (v3 future rework) emits its own JSX consuming `stitch-analysis.rootSection`; pasting Stitch's HTML bypasses the Atelier architecture.
- **Don't trust Stitch's `data-testid` (if any)**. Our `test-id-contract.json` is authoritative. UI Components will add the right test-ids regardless of what Stitch emitted.
- **Don't invoke `stitch-loop`**. It generates entire sites in one shot; we want explicit page-by-page control to match `layout-tree.pages[]`.
- **Don't store the rawHtml in `stitch-analysis.json`**. Discard it after parsing. The DESIGN.md (`.atelier/stitch-design.md`) is the only human-readable trace.

## Failure modes

| Failure | Action |
|---|---|
| `STITCH_API_KEY` missing | Layout Architect emits `stitch-unavailable` severity error agent layout-architect, ABORTS |
| Stitch 5xx 3 times in a row | `StitchClient` throws `StitchUnavailableError`. Layout Architect emits the same violation, ABORTS |
| Stitch returns malformed response | `StitchClient` throws on shape mismatch. Layout Architect emits `stitch-malformed-response` severity error, ABORTS |
| HTML parse fails on one screen | Skip that screen, emit `stitch-parse-failure-partial` severity warn agent layout-architect, continue with the rest |
| One page's mockup PNG is corrupt | Skip that page from `stitch-analysis.pages[]`, emit `stitch-image-decode-failure` severity warn |

The runner's fix loop knows how to re-invoke Layout Architect on `stitch-unavailable` (after the human adds the key) but **not** on real Stitch outages — those need human intervention.

## When this skill is the wrong answer

- Pre-paso-5 work: don't reach for stitch-bridge until Layout Architect is part of the wave list.
- Generating React/JSX from Stitch directly: out of scope. UI Components reads `stitch-analysis.rootSection` and emits its own components consuming the Atelier patterns.
- Cross-page visual coherence checks: that's `visual-regression-scanner` (Gate 6), not this skill.
