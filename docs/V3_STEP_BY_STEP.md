# Atelier v3 — Step-by-Step Mode

> Validation protocol for generating a brand-new domain with Atelier v3.
> Pauses at every wave boundary, surfaces what was produced, and waits for a
> human decision before moving on.

## Why this exists

v2 taught us that running the full 16-agent pipeline end-to-end and
inspecting the result at the end is **the most expensive way to find bugs**.
A single wrong architectural choice in Wave 1 can invalidate hours of
downstream work. Step-by-step mode flips the loop: the human validates each
wave's output before paying tokens for the next one.

The trade-off is wall-clock time. Use auto mode for re-runs of a domain
you've already validated; use step-by-step when generating a domain for the
first time, or when validating Atelier itself against a new fixture
(restaurant, vet clinic, e-commerce, etc.).

## Conceptual model

The orchestrator runs in one terminal, the `atelier` CLI in another. They
communicate via two JSON files inside the workDir:

```
<workDir>/.atelier/_pending-approval-<wave>.json
  ↳ written by the orchestrator at every wave boundary
<workDir>/.atelier/_decision-<wave>.json
  ↳ written by you via the CLI; consumed by the orchestrator
```

The orchestrator polls for the decision file every second. When it appears,
the orchestrator reads it, deletes both files (except in the `inspect` case —
see below), and either proceeds, re-runs the wave, or pauses again.

## Workflow

### Terminal 1 — Start the orchestrator

```bash
# (Once the v3 pipeline is complete and you can run --real with --v3,
# the invocation is:)
pnpm tsx scripts/full-restaurant-regen.ts --real --v3 --step-by-step
```

The orchestrator runs Wave 1 (Discovery → Bootstrap → Architect), then
pauses with a message like:

```
[orchestrator] ✓ wave-1-discovery (62s) — discovery:ok
[orchestrator] ⏸ Wave "wave-1-discovery" paused. Waiting for decision via the atelier CLI.
[orchestrator]    Run: atelier approve wave-1-discovery
                  | atelier reject wave-1-discovery --reason "..."
                  | atelier inspect wave-1-discovery
```

### Terminal 2 — Decide

```bash
# See what the orchestrator wants you to look at
pnpm tsx scripts/atelier.ts waiting

# Inspect: see the agents that ran, with results
pnpm tsx scripts/atelier.ts inspect wave-1-discovery

# Approve: the orchestrator unblocks and runs the next wave
pnpm tsx scripts/atelier.ts approve wave-1-discovery

# Reject: the orchestrator strips this wave's artifacts and re-runs it
#         with your feedback injected as humanFeedback into every agent
pnpm tsx scripts/atelier.ts reject wave-1-discovery --reason "I want a B2C marketplace, not yoga-style booking"
```

## The three decisions

### `approve`

Final. The orchestrator marks the wave as accepted, deletes the
pending/decision files, and proceeds to the next wave. The next wave will
NOT receive `humanFeedback` — the green light wipes the slate.

### `reject --reason "..."`

Re-runs the wave from scratch. The orchestrator:

1. **Strips the artifacts** the wave produced from its in-memory map.
2. **Threads your reason** into every agent of the wave as
   `AgentRunInputV3.humanFeedback`, so the runner adapter can prepend it to
   the agent's user prompt.
3. **Re-invokes the runner** for each agent, in parallel as usual.
4. **Re-pauses** at the same wave boundary so you can decide again.

You can reject the same wave multiple times. Each cycle burns the LLM
tokens of that wave only — strictly less than waiting until the end to find
out it was wrong.

> **On-disk artifacts**: the orchestrator only clears its in-memory state.
> The runner adapter is responsible for purging on-disk artifacts produced
> by the rejected wave. The v3 runner adapter (when wired) does this by
> removing every `.atelier/<artifact>.json` declared by the rejected wave's
> agents AND any source files those agents own.

### `inspect`

Non-binding. The orchestrator emits a `wave.paused` event but does NOT
proceed and does NOT re-run. The CLI prints the wave summary, and the
orchestrator immediately re-polls for a new decision. Use `inspect` when
you want to explore the on-disk artifacts before committing to approve or
reject.

## Compatibility with auto mode

If you launch the orchestrator without `--step-by-step`, behaviour is
identical to v2: all waves run back-to-back, fix loop runs at the end,
`pnpm qa` runs at the very end. The step-by-step hook is a no-op when the
caller doesn't pass an `approvalResolver`.

This matters for CI/CD: nightly regenerations of yoga and tutorias should
stay on auto mode. Reserve step-by-step for first-time generations of new
fixtures.

## Restaurant-fixture protocol (per ROADMAP § 9)

When `restaurant-prd.json` lands, the validation playbook is:

1. Auto mode is **disallowed** for the first run. Always launch with
   `--step-by-step`.
2. The human (you) approves **wave by wave**, looking at the artifacts
   produced under `out/restaurant-regen-v3-<ts>/.atelier/`.
3. If any wave needs a reject, the reason gets reused for subsequent
   reruns until the wave passes.
4. The session continues until `FINAL: GO` is emitted or the human aborts.

## Implementation notes (for maintainers)

The pause / resume contract lives in:

- `lib/agents/orchestrator-v3.ts::runGenerationV3` — calls
  `approvalResolver` after every wave when set; loops the inner ask-block
  on `inspect`; re-runs the outer wave-loop on `reject`.
- `lib/agents/runtime/file-based-approval.ts::createFileBasedApprovalResolver`
  — implements the resolver against `<workDir>/.atelier/_*` files.
- `scripts/atelier.ts` — the CLI that writes the decision JSON.

Cross-process timing nuance: the resolver clears the pending file on
approve/reject but **leaves it on inspect** so the next poll sees the same
wave state. The decision file is always deleted after reading. The CLI
warns if you decide on a wave that isn't actually paused, but writes the
file anyway — when the wave eventually finishes the orchestrator will see
it. That's intentional so a human can pre-approve a fast wave that they
already know the answer to.

## Limits

- One paused wave at a time. The orchestrator is single-threaded across
  waves; running waves are parallel within themselves only.
- The pending/decision files are NOT a queue. Stale files from a prior run
  are cleared at the start of each new wave pause.
- The CLI assumes the workDir is locatable from `out/`. If multiple recent
  v3 workDirs exist, pass `--workdir <path>` explicitly.
- Timeouts: the resolver waits up to 24h by default. If the orchestrator
  needs to be left overnight, that's fine; longer than that, restart with
  `--resume`.
