# Atelier V3 — Estado del Trabajo

> Documento de traspaso. Captura el estado de la implementación de Atelier v3 al cierre del paso 5. Si retomas el trabajo en una conversación nueva, lee este documento entero antes de hacer nada.

---

## Resumen ejecutivo

Atelier v3 es la siguiente iteración del sistema multi-agente Atelier, motivada por 5 clases de bugs detectados en la validación end-to-end de v2 con yoga y tutorías. El roadmap completo está en `ROADMAP_V3.md` en la raíz del repo.

V3 se implementa **paso a paso, con validación humana entre pasos**, en la rama `v3` (creada desde `v2`). La rama `v2` queda intacta como referencia.

Hasta el momento (cierre paso 5): **233 tests verde, 14 commits limpios en v3, dry-run impecable, v2 sin regresiones**.

Hasta el momento (cierre F3-run-9 — extensión wave-1-3): **slice wave-1-3 verificado end-to-end con LLMs reales (wave-1 → wave-2-design → wave-2-domain → wave-3-app-security), B1-B13 cerrados, F3-run-9 limpio honesto (`requiresHumanReview=no`, `failedAt=—`, única residual = warn `component-deferred` aceptado por precedente). R2/R4 registradas como categoría de deuda latente _race-but-survive_. Listo para extender a wave-4-presentation (decidir antes animation-choreographer fantasma).**

---

## Estado por pasos

### ✅ Paso 1 — Bootstrap & DevOps Agent (CERRADO)

**Qué hace**: garantiza que el proyecto generado arranca sin intervención humana. Es la autoridad única sobre variables de entorno.

**Artifacts producidos**:
- `lib/agents/contracts-v3/bootstrap.ts` — Schemas Zod (envManifest, bootstrapOutput) con refinements para 3 invariantes (singleSourceOfTruth, crossPlatformScripts, healthcheckPresent)
- `lib/agents/prompts-v3/bootstrap-devops.md` — System prompt con regla R0 (autoridad única, BLOCKER) que cierra el bug clase A de yoga
- `skills/runtime-diagnostics/SKILL.md` — Taxonomía de 12 faults runtime con detección y prevención
- `lib/agents/runtime/qa-gates/env-leak-scanner.ts` — Gate programático que enforza R0 mediante regex sobre código generado, función pura sin LLM

**Tests**: 17 schema + 4 scanSource pure + 13 env-leak file = 34 tests

**Commits**: 7dd8da5, 732d537, f8e0f20, 0fe4ca6, caa7c68, 90ac0d5, 669d793, f0091ef

**Decisión D1 resuelta**: api-contract NO es agente separado de api-backend. 17 v2 + 6 nuevos = 23 cuadra.

---

### ✅ Paso 2 — Step-by-step y CLI atelier (CERRADO)

**Qué hace**: permite validar wave-por-wave con intervención humana opcional.

**Artifacts producidos**:
- Flag `--step-by-step` en orchestrator-v3
- `createFileBasedApprovalResolver` mecanismo de pausa/aprobación
- `scripts/atelier.ts` con 4 comandos: approve, reject --reason, inspect, waiting
- `docs/V3_STEP_BY_STEP.md` con protocolo de uso
- Regeneración granular en reject (descarta artifact de wave rechazada, conserva anteriores, regenera con humanFeedback)

**Tests**: 12 tests file-based-approval

**Commit**: 762dba9

---

### ✅ Paso 3 — Visual QA Agent Wave 7 Playwright-only (CERRADO)

**Qué hace**: agente Visual QA con Playwright headless que ejecuta suites cliente y admin con clicks reales, captura screenshots, detecta errores runtime.

**Artifacts producidos**:
- `lib/agents/contracts-v3/visual-qa.schema.ts` — visualQaReportSchema con 4 refinements (every flow has step, decision=go requires zero error/critical, decision=no-go requires evidence, critical FORCES no-go)
- `lib/agents/prompts-v3/visual-qa.md` — System prompt con R1-R10, tabla R4 de routing por fault id (8 mappings), algoritmo paso a paso para inferencia del flujo principal del dominio
- `skills/playwright-e2e-flows/SKILL.md` — Patrones probados de signup/login/CRUD

**Decisión arquitectónica**: UN agente Visual QA (no dos sub-agentes). Justificación en el reporte original.

**Tests**: 18 visual-qa tests

**Commit**: 44cf78d

**Severity `critical` añadido**: para violations que requieren intervención humana, bypassan fix loop.

---

### ✅ Paso 4 — Gate 5 Runtime Smoke + cableado preWaveGate (CERRADO)

**Qué hace**: gate programático sin LLM que arranca app (asumida levantada por el orchestrator), ejecuta 5 probes HTTP, emite violations routadas al agente correspondiente.

**Artifacts producidos**:
- `lib/agents/contracts-v3/runtime-smoke.schema.ts` — runtimeSmokeReportSchema con 3 refinements
- `lib/agents/runtime/qa-gates/runtime-smoke-scanner.ts` — Función pura con `_fetch` test seam + `buildDefaultProbes(architect)` con escarbado defensivo
- `lib/agents/orchestrator-v3.ts` — Añadido PreWaveGate interface + PreWaveGateContext + RunGenerationV3Options.preWaveGates + 3 eventos nuevos (gate.started, gate.completed, wave.skipped) + gateViolations y skippedWaves en GenerationV3Result
- `scripts/test-v3-gate5-smoke.ts` — Demo end-to-end con node:http minimal servers (happy / broken-home / auth-guard-missing)

**Decisión arquitectónica**: una sola instancia de app (opción B). Gate 5 NO arranca la app, recibe appUrl y asume up. El lifecycle owner es el wave-7 runtime hook (futuro).

**Tests**: 12 scanner + 4 cableado orchestrator = 16 tests

**Demo end-to-end**: 3 escenarios contra HTTP real, exit 0, sin libuv crashes.

**Commit**: 561855e

---

### ✅ Paso 5 — Layout Architect + Stitch MCP + Gate 6 + postWaveGate (CERRADO)

**Qué hace**: agente Layout Architect que diseña la arquitectura visual global de la app usando Stitch MCP como motor de diseño. Cierra los bugs E (home huérfana) y el contrato test-id entre Layout Architect y Visual QA. Implementa Gate 6 (visual regression con pixelmatch) y la abstracción simétrica `postWaveGate` en el orchestrator.

**Artifacts producidos** (3 commits secuenciales: 7d140ac, 5b5cc80, b6c702b):

**Commit A — 7d140ac (schemas + scanners + StitchClient + postWaveGate)**

- `lib/agents/contracts-v3/layout-tree.schema.ts` (12 tests) — refinement R0 cierra bug clase E al nivel del schema (`home '/' must NOT be standalone`). 4 refinements totales.
- `lib/agents/contracts-v3/stitch-analysis.schema.ts` (11 tests) — recursive Section con `z.ZodType<Section>` explícito para type-safety en consumers. 3 refinements (token coverage, typography body+heading, no duplicate pageRoute).
- `lib/agents/contracts-v3/test-id-contract.schema.ts` (7 tests) — kebab-case selectors, criticality enum (critical/recommended/optional), consumedByFlow narrowed a los 3 v3 flows.
- `lib/agents/runtime/stitch-client.ts` (12 tests) — wrapper de 4 ops (enhancePrompt, designScreens, fetchDesignMd, getScreenImage), retry 3x con backoff exponencial (1s/3s/9s), auth via STITCH_API_KEY, `_invokeStitch` test seam, errores tipados (StitchAuthError, StitchUnavailableError).
- `lib/agents/runtime/qa-gates/cross-artifact-coherence-scanner.ts` (9 tests, 3 adverse-case suites) — valida invariantes que cruzan schemas (layout-tree ⊆ architect, stitch-analysis ⊆ layout-tree, test-id-contract.flow ⊆ valid flows).
- `lib/agents/runtime/qa-gates/visual-regression-scanner.ts` (6 tests) — pixel-diff con pixelmatch + pngjs entre stitch-mockups/ y screenshots de Visual QA. Routing: diff>25% major → layout-architect; 10-25% minor → ui-components warn; ≤10% no violation. `_diff` test seam.
- `lib/agents/orchestrator-v3.ts` (3 tests nuevos del cableado postWaveGate) — `PostWaveGate` interface simétrica al preWaveGate, runs DESPUÉS del wave con results disponibles en el contexto.

**Commit B — 5b5cc80 (prompts + skill)**

- `lib/agents/prompts-v3/layout-architect.md` (220 LOC) — R0-R10 con workflow Stitch 4-step + heurística skip-enhance-prompt (preserva cuota 350/mes) + tabla R5 con 8 selectors test-id críticos por defecto.
- `skills/stitch-bridge/SKILL.md` (187 LOC) — thin adapter, NO reimplementa los 7 skills oficiales de Google. Refs `enhance-prompt`, `stitch-design`, `design-md`, `get_screen_image`. Documenta heurística skip-enhance con 2 ejemplos worked (yoga full = skip, notes app barebones = call). Cheerio parsing patterns para layoutPrimitive + tokens. Failure modes table.
- `lib/agents/prompts-v3/ux-ui-designer.md` (108 LOC, 40% reducción vs v2 que tenía 180) — slim a un solo artifact (design-system.json con tokens base + designVibe canonical). Tabla explícita de qué se descompuso a Layout Architect / Brand Identity / Animation Choreographer / Accessibility / UI Components.

**Commit C — b6c702b (PENDING + dry-run E2E)**

- `PENDING_V3_DECISIONS.md` — D1/D2/D3 marcadas RESUELTAS con refs a los commits que las cierran. D4 añadida.
- `scripts/test-v3-dry-run.ts` extendido con 3 fixtures yoga-realistas (paleta salvia coherente #4a7c59 + Inter typography + rootSection con hero/feature-grid/footer + los 8 test-ids críticos canónicos). 3 nuevas validaciones post-run.

**Tests añadidos**: 60 nuevos (12+11+7 schemas + 12 StitchClient + 9 cross-artifact + 6 visual-regression + 3 postWaveGate cableado).

**Decisiones D2 + D3 cerradas**:
- D2 (contrato test-id) — `test-id-contract.json` schema + 8 selectors críticos canónicos en prompt R5 + Visual QA del paso 3 ya consume con fallback role/label/text.
- D3 (Gate 6 visual regression) — `visual-regression-scanner.ts` con pixelmatch + pngjs; conectable como postWaveGate de wave-7 cuando el runtime real se construya.

**Decisión D4 abierta**: Rework UI Components v3 para consumir los 4 contratos visuales (test-id + stitch-analysis + brand-identity + animations). Bloqueada hasta paso 10 (necesita Brand Identity del paso 6 y Animation Choreographer del paso 7 primero).

**Deps añadidas al `package.json` raíz (NO al skeleton)**: cheerio@^1.0.0, pixelmatch@^7.2.0, pngjs@^7.0.0, @types/pngjs.

---

### ✅ F3 — Primer run real wave-1-2-design (CERRADO)

**Qué hace**: ejercitar el slice wave-1-discovery → wave-1-bootstrap → wave-1-planning → wave-2-design contra LLMs reales (Anthropic + Stitch via fixture cacheado), con todos los gates (cross-artifact-coherence + stitch-completeness) corriendo, y verificar end-to-end que el orquestador convierte un PRD coherente en `.atelier/` poblado sin reportar éxito falso.

**Pipeline ejercitado**:
1. `scripts/record-stitch-yoga-fixture.ts` — graba el fixture Stitch UNA vez: corre architect agent, deriva pages, genera 8-15 screens via `@google/stitch-sdk`, persiste `fixtures/stitch-yoga.json` (attempt-aware) + `fixtures/stitch-yoga.architect.json` (sibling cacheado).
2. `scripts/full-yoga-regen-v3.ts --real --stitch-mode fixture --stitch-fixture fixtures/stitch-yoga.json` — corre el slice contra el fixture. Architect agent se saltea (B11) usando el sibling cacheado; las 3 agentes de wave-2-design corren con LLM real.
3. Pre-wave gate `stitch-fixture-preparer` materialises HTMLs del fixture a `<workDir>/.atelier/stitch-html/<slug>.html` por attempt.
4. Post-wave gates `cross-artifact-coherence-scanner` + `stitch-completeness-scanner` ejercitan el contrato.

**Bugs encontrados y cerrados (B1-B13)**:

| ID | Commit | Qué cerró |
|----|--------|-----------|
| B1 | b080a7b | `requiredOn.component` causaba silent-skip en stitch-completeness check 2 — ahora emite warn-summary explícita al cierre del scan. |
| B2 | b080a7b | `requiredOn` ahora three-variant (`layoutGroup` \| `pageRoute` \| `component`) con precedencia explícita pageRoute>layoutGroup>component. |
| B3 | 3bd2a9f | Recorder derivaba pages de memoria del PRD (rutas obsoletas). Ahora corre architect agent y deriva pages de su output verbatim. |
| B4 | 3bd2a9f | `layout-architect.json` summary file se absorbe en el bundle de orchestrator cuando existe (no es error si no se emite). |
| B5/B6 | 6b4b8d2 | `canonicalRouteSlug` exportado como única fuente de verdad — recorder, scanner y preparer dejaron de mantener variantes paralelas. |
| B7 | e0ca12f | Cap del Stitch reprompt loop: budget exhaust path ya no termina en `skippedWaves`; plan B (`requiresHumanReview=true`) es el outcome correcto. |
| B8 | e0ca12f | Preparer clampea al `max declared attempt` del fixture si la attempt solicitada excede — no falla, no skip-with-violation. |
| B9 | e0ca12f | `hasExpectedElementRelaxed()` para entries `requiredOn.pageRoute` — el matcher ya sabe qué página inspecciona, no necesita keyword paranoia. |
| B10 | 0e4afd8 | Shell DECLARATION (layoutCompositions) se verifica en wave-2 via stitch-completeness check 4; shell RENDERING se difiere a wave-4. |
| B11 | f6f3eae | Recorder persiste `<fixture>.architect.json` adyacente al fixture; regen lo seedea via nueva opción `seedArtifacts` del orquestador. Modo fixture genuinamente determinista: architect agent NO se invoca; ahorra ~1 min LLM por run + elimina drift architect-vs-fixture. |
| B12 | 87cb220 | Honesty escalation en orchestrator-v3 end-of-slice: si quedan `severity:error` en `gateViolations` de la iteración FINAL de cualquier wave, `requiresHumanReview = true`. Cierra el patrón "DONE silencioso con errors latentes" que F3-run-4 mostró. Contador per-iteración (no acumulativo) — Stitch reprompt convergente lo deja en 0. |
| B13 | 49dbf05 | Stitch-completeness check 3 (thin sections) ahora acepta chrome=`<header>` O `<nav>/<aside>` para `admin`+`dashboard`. Stitch suele embeber nav DENTRO del header para CRUD pages, exigir sibling era ruido. `public` mantiene exigencia estricta de header explícito. |

**Verificación end-to-end (F3-run-4 → F3-run-7)**:

| | F3-run-4 (2026-05-14) | F3-run-5 | F3-run-6 | F3-run-7 (2026-05-15) |
|---|---|---|---|---|
| duration | 838s | 802s | 1919s | 861s |
| agents | 6 | 5 (architect skipped, B11) | 6 | 5 |
| reprompts stitch | 1 (converge) | 1 (converge) | 2 (plan B) | 1 (converge) |
| coherence errors final | 2 (silentes) | 2 (B12 los expone) | 0 | 0 |
| stitch errors final | 0 | 0 | 5 (plan B) | 0 |
| **requiresHumanReview** | **no (mentira)** | **YES** (B12 catch-all) | **YES** (plan B) | **no (honesto)** |
| **failedAt** | — | — | — | — |
| sentencia | falso success | escalado | escalado | **CLEAN** |

**Lección recurrente capturada en B11 + B13**: cada vez que un fixture es la fuente de verdad de algo, el invariante exacto del fixture importa. B11 surgió porque el fixture Stitch y el architect.json venían de runs distintos del architect agent (incoherentes). B13 surgió porque la heurística del scanner asumía un perfil de página (sibling nav) que pages reales CRUD legítimamente no cumplen. Ambos son la misma clase de bug: modelo del verificador desalineado del modelo del subject. La solución estructural es la misma: hacer el modelo más explícito (B11: seed determinístico; B13: thresholds-by-layoutGroup), no más estricto.

**Tests añadidos** (cumulativo F3): 
- `lib/agents/orchestrator-v3.test.ts` — +1 test B11 (seedArtifacts auto-skip) + 3 tests B12 (residual error flips flag, warnings-only no, Stitch convergence no) + 1 viejo actualizado (no reprompt + sí escalada honesta).
- `lib/agents/runtime/qa-gates/stitch-completeness-scanner.test.ts` — +3 tests B13 (admin header-embedded nav pasa, chromeless falla, public requiere header explícito).

**Artifacts agregados en F3**:
- `fixtures/stitch-yoga.json` (recorder output, attempt-aware)
- `fixtures/stitch-yoga.architect.json` (recorder sibling, alimenta seedArtifacts en regen)
- `scripts/record-stitch-yoga-fixture.ts` (recorder Stitch)
- `scripts/full-yoga-regen-v3.ts` (regen orchestrator-v3 sobre slice wave-1-2-design)

**Lo que NO se ejercitó en F3** (queda para slices posteriores):
- Wave 2 domain (api-backend, ui-components, domain-modeler)
- Waves 3 (content), 4 (presentation con visual-adapter), 5 (accessibility), 6 (static-qa con qa-reviewer), 7 (runtime-qa con visual-qa).
- Gate 5 runtime-smoke en wave-7 (requiere app levantada — no aplica al slice F3).
- Gate 6 visual-regression (requiere screenshots de Visual QA — wave-7).
- Fix-loop con qa-reviewer real (el qa-reviewer agent no corre en este slice).

---

### ✅ F3-run-9 — extensión wave-1-3 (CERRADO)

**Qué hace**: extiende el slice F3 verificado a `wave-1-3` = wave-1-discovery → wave-1-bootstrap → wave-1-planning → wave-2-design → wave-2-domain → **wave-3-app-security**. Añade los 3 agentes v2-reused (service-layer, auth-security, rbac-authorization) y verifica que el orquestador los conduce contra LLMs reales sin éxito falso. Scaffolding del slice + slots en commits `582437c` (wave-1-2-full + wave-2-domain) y `e24b580` (wave-1-3 + wave-3-app-security).

**Pre-run**: dry-run del slice extendido (`out/yoga-regen-v3-2026-05-15T14-23-33`, synthetic) limpio — 6 waves, 11 agents, 0 gateViolations, los 3 agentes de wave-3 invocables sin error de schema/contrato. Race R4 anticipada y documentada ANTES del run real (deuda #14).

**Run real (F3-run-9)** — `out/yoga-regen-v3-2026-05-15T14-23-45`, `--real --stitch-mode fixture`, mismo fixture cacheado:

| | F3-run-9 (2026-05-15) |
|---|---|
| mode / slice | real / wave-1-3 (stitch=fixture) |
| duration | **1835.81s** (~30 min) |
| waves | 7 (wave-2-design corre 2× por reprompt) |
| agents efectivos | 11 (architect skipped B11; wave-3 los 3 v2-reused `ok`, 712s) |
| files | 194 |
| reprompts stitch | 1 (converge en attempt 1) |
| gateViolations (crudas) | **3** acumuladas: attempt 0 wave-2-design = 2 (pageFailures reales → ✗ → reprompt); attempt 1 = 1 residual |
| violation residual | `stitch-completeness-component-deferred` · **severity `warn`** · scan-summary (no per-page) · 3 selectors de shell `header-root`/`nav-primary`/`signout-button` diferidos a wave-4 por `requiredOn.component` |
| coherence errors final | 0 |
| **failedAt** | **—** |
| **requiresHumanReview** | **no (honesto)** |
| sentencia | **CLEAN** |

**Triage de la residual**: patrón `component-deferred` conocido — es el cierre B1 funcionando (silent-skip era el modo de fallo; el warn hace visible el diferimiento). No bloqueante, aceptado por precedente: los selectors transversales de shell sin ruta fija se verifican en el futuro wave-4 scanner. No es regresión ni hallazgo nuevo. Reconstruido deterministicamente contra `test-id-contract.json` del workdir (10 criticals, 3 `requiredOn.component`).

**Sorpresas**: ninguna funcional. R4 (rbac↔service-layer intra-wave) anticipada y NO explotó en yoga (deuda #14). Lo único "inesperado" fue de proceso: A y B ya estaban ejecutadas por una sesión previa que no dejó session summary.

**Cierre explícito**: **wave-1-3 verificado end-to-end con LLMs reales. Slice listo para extender a wave-4-presentation.** Antes de arrancar wave-4 hay que decidir qué hacer con animation-choreographer (agente fantasma) — pendiente para el próximo turno.

---

## Cambios arquitecturales no-bug

Pivots arquitecturales aplicados después del cierre de paso 5, NO motivados por bugs F3. Conviven con la línea principal del ROADMAP pero la divergen materialmente. Ver `ROADMAP_V3 (2).md` sección **Deviations** para citas exactas.

- **Stitch pivot — parse-and-rebuild → preserve literal HTML.** Stitch genera HTML que se conserva en `.atelier/stitch-html/<slug>.html`; un agente Visual Adapter (NUEVO, ver abajo) lo transforma a JSX preservando look. Cierra el bug arquitectónico de v2 donde UI Components re-autoría diseño y Visual QA encontraba 25%+ de regresión visual contra mockups. Commits ea94c19, 4a2f10e, e8f5bc0.
- **Brand Identity REDUCED.** Schema `brand-identity.schema.ts` ya NO declara paleta canonical de 17 slots ni tipografía canonical (`fontFamilies`, `scale`, `weights`). Solo `tentativePaletteHints` (seed + vibeMood) + `tentativeFontHints` (sansSuggestion + displaySuggestion opcional) + microcopy. Stitch decide paleta y tipografía en el HTML; el Visual Adapter las preserva. Prompt titulado *"REDUCED post-rework"*. Commit ea94c19.
- **Visual Adapter — agente NUEVO en wave-4-presentation.** `lib/agents/prompts-v3/visual-adapter.md` + `lib/agents/contracts-v3/page-adaptation.schema.ts`. Total agentes ahora 24, no 23 (ver `orchestrator-v3.test.ts:88`). Commit ea94c19.
- **Font loading — 4 capas de defensa.** (1) Stitch embebe `<link>` web fonts; (2) Layout Architect declara URLs en `stitch-analysis.pages[].linkedFonts[]`; (3) Visual Adapter preserva en `app/layout.tsx`; (4) runtime-smoke-gate verifica HTTP 200 (pendiente cableado). Documentado en `visual-adapter.md:75`. Commit ea94c19.
- **ui-components port-reducido a v3-native (solo shadcn primitives).** Pre-flight wave-4 + inspección de prompts mostró que el Bloque B de ui-components v2 (~60-90 componentes por área desde `screens-map.componentSpecs`) es exactamente el bug arquitectónico que el rework cierra (visual-adapter R0 renderiza desde HTML Stitch literal, no compone árbol semántico). Nuevo `prompts-v3/ui-components.md` slim + `contracts-v3/components-catalog.schema.ts` reducido (solo `primitives[]`, `components` opcional) + slot v3 con boundary validator (B-w4-5b). Conserva solo Bloque A (17 primitives, que visual-adapter R5 necesita en disco). **Cierra B-w4-6 para ui-components**: ya no lee `screens-map.json`, solo `design-system.json` (que v3 ux-ui-designer sí emite) → sin necesidad de aliasing compositional. El gap del alias y la redundancia tenían el mismo fix. Commit 0c08cc07.
- **pages-routing eliminado; rol App Router absorbido por visual-adapter.** Inspección mostró overlap conflictivo: pages-routing y visual-adapter escribían los mismos `app/<route>/page.tsx` y `app/(group)/layout.tsx` en paralelo en wave-4d con semántica opuesta (**B-w4-7**, colisión de escritura, no race-but-survive). pages-routing eliminado de `WAVES_V3` (wave-4d queda `[forms-validations ‖ visual-adapter]`), del union `AgentNameV3` + array (conteo **23 → 22**; es uno de los 17 v2 heredados, no un fantasma net-new — v2 lo conserva, solo v3 lo dropea: **16 v2 + 6 net-new**), docstrings de runner-generator-v3. visual-adapter extendido con R11 (metadata SEO por page), R12 (special files `not-found`/`error`/`loading`), R13 (política RSC/CC + Suspense/ErrorBoundary); `page-adaptation.schema.ts` + `injected-metadata` + `generated-special-file` change types, `metadata?`/`renderMode?` per-page, `specialFiles?` top-level. `violations-router-v3.ts` + reglas v3 `app/**/page.tsx|layout.tsx` + special files → visual-adapter (override del fallthrough v2 que aún mapea a pages-routing inexistente). **B-w4-7 cerrado por construcción**: single owner de `app/*`. Commit cf51f01c.
- **wave-4-presentation sub-dividida en 4a/4b/4c/4d.** El pre-flight de wave-4 (antes de F3-run-10) descubrió drift estructural: los 5 agentes v2-reused tienen una cadena productor→consumidor genuina de 5 niveles (`api-contract.json` ← api-backend → `frontend-architecture.json` ← frontend-architect → `components-catalog.json` ← ui-components → pages-routing) que corría **concurrente** en el slot único `wave-4-presentation` (Promise.allSettled, sin ordering intra-wave) → cada consumidor leía un artefacto inexistente (B-w4-2). Además `screens-map.json` (artifact v2 de ux-ui-designer) se decomposó en v3 sin actualizar ni aliasear los 3 consumidores v2 (B-w4-1), y el runner no tenía slots wave-4 (B-w4-3). Solución (Opción A): `wave-4-presentation` → 4 sub-waves secuenciales `wave-4a-api` (api-backend) → `wave-4b-frontend-arch` (frontend-architect) → `wave-4c-components` (ui-components) → `wave-4d-routing-forms-adapter` (pages-routing ‖ forms-validations ‖ visual-adapter, estos 3 sí paralelizan con deps ya asentadas). Conteo de agentes intacto (23; 6 redistribuidos). `WAVES_V3` 10 → 13 slices. aliasFile `screens-map.json` → `layout-tree.json` añadido como **primer intento** (puede no alcanzar para componentSpecs detallados de ui-components; escalable en B-series si F3-run-10 lo muestra). 6 slots wave-4 + slices progresivas `wave-1-4a/4b/4c/4d` + `wave-1-4` añadidos. Validación: tsc 0 nuevos, vitest 314/314, dry-run wave-1-4 plumbing verde. Commit e7a5bd3.
- **animation-choreographer eliminado por redundancia.** Agente fantasma (nunca tuvo prompt ni schema v3): Stitch + shadcn + Tailwind ya cubren animaciones. Su única responsabilidad irrenunciable —respetar `prefers-reduced-motion`— se movió a `bootstrap-devops` (`globals.css`, archivo físico #9 + R11, append-or-create, 7 líneas CSS deterministas, sin LLM). Conteo de agentes: **24 → 23** (`AgentNameV3` union + `AGENT_NAMES_V3` + `AGENT_CONFIG_V3` + `WAVES_V3` wave-4 ahora 6 agentes). Motion violations (`client/motion/`, `useMotion*.ts`) re-ruteadas a `ui-components` (función ya cubierta por shadcn+Tailwind+Stitch; ui-components es el dueño funcional). `app/globals.css` NO se registra en `filesProduced` (schema `.strict()`, solo cubre archivos env/devops). Commit 63d0f4b.
- **Schemas nuevos/modificados.** `layout-tree.schema.ts` añade `layoutCompositions` (B10, commit 0e4afd8). `stitch-analysis.schema.ts` añade `linkedFonts`, `stitchHealth`, `stitchAttempt`. `test-id-contract.schema.ts` `requiredOn` three-variant (B2, commit b080a7b). `page-adaptation.schema.ts` y `stitch-fixture.schema.ts` NUEVOS. Commits varios.
- **B-w4-9 cerrado — re-estructura wave-4 + R6 carve-out (forms canónicos montados, no hand-rolled).** El run `2026-05-16T16-15-35` (F3-run-10d, ya ejecutado) reveló que la vieja `wave-4d-routing-forms-adapter` corría `[forms-validations ‖ visual-adapter]` en paralelo SIN arista de dependencia: visual-adapter no podía leer `forms-validations.json` y terminaba hand-rolleando submit handlers (`querySelector` scraping en `SignInClient.tsx`), dejando el `LoginForm` canónico (rhf+zod, 24 tests) **huérfano** — montado en ninguna route. Bug arquitectónico, no warn benigno. **Fix (Commit A, plumbing):** `wave-4c-components` → `wave-4c-components-forms = [ui-components ‖ forms-validations]` (genuinamente independientes: ambos consumen solo artefactos de 4a/4b; forms-validations referencia `@client/components/ui/*` por convención de path, no lee `components-catalog.json` en generación). `wave-4d-routing-forms-adapter` → `wave-4d-adapter = [visual-adapter]` solo, como convergencia downstream. `dependsOn` actualizados (4d→4c, wave-5→4d). Rename del union `WaveNameV3` + 5 archivos (orchestrator-v3.ts, full-yoga-regen-v3.ts, atelier.ts, ui-components.md, orchestrator-v3.test.ts); `WAVES_V3` 13 → 13 (slots reorganizados, no añadidos). **Fix (Commit B, semántica):** R6 de `visual-adapter.md` reescrito como **carve-out explícito a R0** — para regiones `<form>` que mapean a un form canónico en `forms-validations.json`, visual-adapter **importa y monta** `client/components/forms/<Name>` reemplazando el `<form>` Stitch y preservando contenedor/estilos circundantes; NO hand-rollea `value/onChange/submit`. Nuevo change type `mounted-canonical-form` en `page-adaptation.schema.ts` (simetría con `injected-metadata`/`generated-special-file` de db47e859 — cada responsabilidad nueva de visual-adapter tiene su change type para observabilidad). api-contract wiring permanece para listas/data no-form. Validación: tsc 0 nuevos (2 pre-existentes deuda #18 sin cambio), vitest `lib/agents` 706/6 estable 3×, dry-run wave-1-4 plumbing verde. Deudas #20 (drift validFrom), #21 (vitest scope), #22 (docstring 23→22) registradas. Commits 8ad5e760 (A) + 70760dbe (B).
- **B-w4-11 + B-w4-12 cerrados — defensas R5 aplicadas a visual-adapter (pin + boundary + regresión).** F3-run-11 (`2026-05-18T09-18-29`) validó el carve-out R6 **funcionalmente** (5 `mounted-canonical-form`, 7 forms canónicos montados, cero hand-roll, container Stitch preservado — B-w4-9 cerrado e2e), PERO `page-adaptations.json` salió **schema-inválido**: `outputPath` en vez de `generatedPagePath`, `adaptationStatus: "adapted"` (enum inválido), 58/73 changes sin `rationale`, keys top-level inventadas (`agent/summary/preservedDesignStrategy/rootLayout/layouts/notes`). **B-w4-11**: regresión de prompt — 10d (visual-adapter prompt viejo) pasaba el MISMO schema (0/116 changes sin rationale); el rewrite de R6 de Commit B desestabilizó la estructura del artifact (el prompt nunca tuvo skeleton JSON explícito, la conformidad era suerte del LLM). **B-w4-12**: el slot `visual-adapter` no tenía `validators` → artifact inválido producía `visual-adapter:ok` + `failedAt=—` = **falso-verde** silencioso río abajo. Fix (single commit, defensas inseparables): (1) skeleton JSON anotado + bloque de prohibiciones explícitas en `visual-adapter.md` sección "Artifact JSON" (capa pin); (2) `validators: { "page-adaptations.json": validatePageAdaptations }` wired al slot vía `assertArtifactsValid` — drift ahora falla el agente (reprompt/B12) en vez de falso-verde, simétrico con ui-components/layout-architect (capa boundary); (3) test de regresión field-specific en `page-adaptation.schema.test.ts` que sintetiza la shape exacta de run-11 y asserta rechazo por `generatedPagePath`/`adaptationStatus`/`rationale`/strict (capa regresión). Scope tight: solo sección Output del prompt, R0-R14/R6 intactos. Deuda #23 (audit de boundary validators en todos los v3 agents) registrada. Nota: la eficacia del pin solo se prueba en F3-run-12 real (tsc/vitest/dry-run validan wiring+regresión, no comportamiento LLM). Commit ab97abd9. **Resultado F3-run-12 (`2026-05-18T11-07-50`)**: B-w4-11/12 VALIDADO (page-adaptations.json pasa schema, 0/84 changes sin rationale, sin reprompt/B12, sin falso-verde). Pero destapó B-w4-13 (abajo).
- **B-w4-13 cerrado — contrato `mountHint` (forms-validations promovido v2→v3) + R6b dialog en visual-adapter.** F3-run-12 mostró que con el MISMO prompt el LLM monta forms de forma no-determinista: run-11 (lectura liberal de R6) montó 5 forms canónicos; run-12 (lectura literal "regiones `<form>`") solo 2 — CreateBooking/CreateClass/EditClass/CreateMembership/EditMembership quedaron **huérfanos** (forms-validations los produjo, visual-adapter los dejó como `static-to-interactive`). NO era hand-roll (B-w4-9) ni schema-inválido (B-w4-11): era ambigüedad arquitectónica — visual-adapter no tenía contrato de DÓNDE/CÓMO montar cada form. **Fix (single commit, contrato bidireccional inseparable):** (1) NUEVO `contracts-v3/forms-validations.schema.ts` (v2 intacto — el v2 es `.passthrough()` y lo usan 4 scripts v2 vivos) con `mountHint` **required** por form (`{pageRoute, mountPattern: enum[inline|trigger-dialog], triggerHint?}`, sub-objeto `.strict()` + refinement `triggerHint required si trigger-dialog`); (2) NUEVO `prompts-v3/forms-validations.md` (promoción v2→v3) con skeleton anotado + ejemplos de derivación de mountHint + prohibiciones copy-paste; (3) slot `forms-validations` → prompt v3 + `validators:{forms-validations.json:validateFormsValidationsV3}`; (4) `visual-adapter.md` R6 ahora ramifica por `mountHint.mountPattern`: R6 inline (reemplaza `<form>`), **R6b trigger-dialog** (envuelve el trigger Stitch en shadcn `Dialog` con el form canónico dentro, trigger preservado vía `DialogTrigger asChild`), **R6c post-condition obligatoria** (`count(mounted-canonical-form) === len(forms.forms)` o ERROR antes de emitir); (5) test v3 nuevo `contracts-v3/forms-validations.schema.test.ts` (happy inline+trigger-dialog + rechazos field-specific + regresión shape-v2-sin-mountHint). Cierra deuda #23 para el slot forms-validations. Scope: R0-R5/R7-R14 de visual-adapter intactos. Nota: eficacia prompt v3+R6b solo se prueba en F3-run-13 (offline valida wiring+schema+regresión, no comportamiento LLM); si el LLM no respeta el contrato → validator forms-validations o post-condition R6c → reprompt/B12, no falso-verde. Commit (este pase).
- **B-w4-11/12 confirmado e2e post-F3-run-13 + observabilidad del boundary validator corregida.** F3-run-13 (`2026-05-18T14-23-04`, HEAD `c568b32a`) cerró limpio (`failedAt=—`, `requiresHumanReview=no`, gateViolations=3 todas en `stitch-completeness`/wave-2-design, sin reprompt de forms-validations ni R6c) pero el `_orchestration.log` no tenía traza `[gate]`/`[boundary]` del validator de `visual-adapter` → ambigüedad: ¿no corrió, o corrió mudo? **Diagnóstico (read-only):** (1) `validatePageAdaptations()` corrido a mano contra el `page-adaptations.json` de run-13 (15 páginas) → `null` = **VÁLIDO**, B-w4-12 cerrado de facto; (2) **ningún** slot deja traza en éxito — `assertArtifactsValid` (`artifact-boundary.ts`) no tenía una sola llamada a log, el path de éxito era totalmente mudo por diseño (solo `throw` ante error); confirmado para los 4 slots wired (layout-architect/ui-components/forms-validations/visual-adapter), no era bug de wiring de visual-adapter sino patrón arquitectónico; (3) wiring confirmado correcto (`full-yoga-regen-v3.ts` slot visual-adapter `validators:{page-adaptations.json:validatePageAdaptations}`, invocado genérico). **Fix (este pase):** `assertArtifactsValid` acepta callback opcional `onValid(agent,file)` invocado una vez por artifact que pasa schema; el runner lo cablea a `log("boundary", "✓ {agent} {file} schema ok")` → toda validación exitosa ahora deja traza en `_orchestration.log`. Path de error intacto (sigue lanzando). Test de regresión en `artifact-boundary.test.ts` (onValid llamado 1×/artifact válido; NO llamado ante violación). Backward-compatible (param opcional). Verde 3× en `artifact-boundary.test.ts` (6/6). Nota: `tsc` y `vitest lib/agents` tienen rojos PRE-EXISTENTES ajenos a este cambio (orchestrator-v3.test.ts `QaSeverityV3`; wave4-agents/rbac `.toMatch(object)`) — confirmados presentes en HEAD limpio con el cambio stasheado; fuera de scope de este commit. Commit c4553bb6.
- **accessibility eliminado por redundancia (pre-flight wave-5).** Mismo playbook que `animation-choreographer` y `pages-routing`: agente sin prompt (`prompts-v2/` ni `prompts-v3/` tenían `accessibility.md`) ni schema v3 ni slot en `full-yoga-regen-v3.ts`. Su responsabilidad (`prefers-reduced-motion`, ARIA, contraste) ya está cubierta: shadcn primitives son accesibles por construcción, `bootstrap-devops` emite el CSS de `prefers-reduced-motion` (heredado del cierre de animation-choreographer), y Stitch genera markup semántico que visual-adapter preserva (R0). Conteo de agentes **22 → 21** (`AgentNameV3` union + `AGENT_NAMES_V3` en `contracts-v3/agent-names.ts` — NO en orchestrator-v3.ts; `AGENT_CONFIG_V3` que es `Record<AgentNameV3>` **no-Partial**, la entry era acople de tipo obligatorio; regla de routing `docs/accessibility-audit.md` en `violations-router-v3.ts`; docstrings de orchestrator-v3/runner-generator-v3/violations-router-v3; tests orchestrator-v3.test.ts + violations-router-v3.test.ts). Cierra **deuda #22** de paso (docstring `orchestrator-v3.ts:2` decía "23 agents", ahora "21"). Commit (este pase).
- **wave-5 sub-dividida en 5a/5b anticipativa (cierra clase B-w4-9 sin esperar manifestación).** El pre-flight de wave-5 detectó que `wave-5-data-tests` corría `[seeds-fixtures ‖ tests-writer]` en paralelo PERO `tests-writer` consume `seeds-fixtures.json` (declarado en su prompt: *"Wave 5, ya corrió antes que vos"*) → exactamente el bug productor→consumidor intra-wave de B-w4-9 (visual-adapter ‖ forms-validations), aún no manifestado solo porque ningún run real llegó a wave-5. Fix preventivo simétrico con la bisección wave-4: `wave-5a-seeds = [seeds-fixtures]` (dependsOn `wave-4d-adapter`) → `wave-5b-tests = [tests-writer]` (dependsOn `wave-5a-seeds`). `WaveNameV3` union + `WAVES_V3` + `dependsOn` de wave-6 (`wave-5-data-tests` → `wave-5b-tests`). `WAVES_V3` 13 → 14 slices (7 logical waves intactas). Slots `seeds-fixtures`/`tests-writer` wirados con prompts v2 reusados, **sin validators** (schema/validator de wave-5 = TBD post-F3-run-14, deuda #23). Slice `wave-1-5` añadida a `SLICE_DEFS` (para hasta wave-5b, no llega a wave-6/7). Validación: tsc 0 nuevos, vitest `lib/agents` 3× estable, dry-run `--slice wave-1-5` plumbing verde. Commit (este pase).

---

## Deudas técnicas pendientes — cableado al runtime real

Los módulos del paso 5 están **escritos, testeados y dry-run-validados**, pero como en pasos anteriores, hay capas de cableado al runtime real que aún no existen. Cuando un paso futuro construya el "wave-N runtime hook" (que arranca subprocess `claude.exe`, gestiona ciclo de vida de la app, llama a los gates programáticos), todas estas deudas se cierran juntas.

Inventario actual de deudas de cableado:

1. **Bootstrap & DevOps Agent NO se ejecuta en `--real` todavía**. Prompt + schemas + env-leak gate están listos; el subprocess real con MCP de la app generada se cableará después.

2. **env-leak gate NO está cableado a wave-6 runtime real**. Existe como módulo invocable; cuando wave-6 runtime real se construya, llamará a `scanProcessEnvLeaks(workDir)` antes del qa-reviewer LLM.

3. **Visual QA Agent NO se ejecuta en `--real` todavía**. Prompt + schema + skill listos; cableado al subprocess claude.exe con Playwright pendiente.

4. **runtime-smoke gate (Gate 5) NO está cableado al wave-7 runtime**. Listo para invocarse como preWaveGate de wave-7-runtime-qa cuando ese runtime exista.

5. **Layout Architect Agent NO se ejecuta en `--real` todavía** (cierre paso 5). Prompt + 3 schemas + StitchClient listos; cableado al subprocess con Stitch MCP configurado pendiente.

6. **cross-artifact-coherence-scanner cableado como postWaveGate de wave-2-design** — CERRADO en F2.1 (`scripts/full-yoga-regen-v3.ts`).

7. **visual-regression-scanner (Gate 6) NO está cableado como postWaveGate de wave-7**. Mismo patrón: necesita el wave-7 runtime que owns el ciclo de vida.

8. **StitchClient.defaultInvoke cableado al SDK real con caveat** — PARCIALMENTE CERRADO en F2 PARTE 1. `defaultInvoke` ahora lazy-inicializa `StitchToolClient` del `@google/stitch-sdk@^0.3.5` y reenvía `callTool(tool, params)` AS-IS. **Caveat trazado como deuda #11 abajo.**

9. **UI Components v3 SIGUE siendo v2**. Va a leer `test-id-contract.json` cuando llegue paso 10 (D4). Mientras tanto, Visual QA cae a fallback selectors (warn) y visual-regression scanner reporta minor regressions (warn) por la divergencia esperada entre Stitch propone y UI Components v2 emite.

10. **Severity `critical` implementada en orchestrator-v3** — CERRADO en F1.1. El orchestrator emite `generation.failed` con `failedAt` poblado al detectar `severity: "critical"` en preWaveGate, postWaveGate o qa-reviewer output, bypassando el fix loop.

11. **StitchClient envuelve nombres de tool ficticios que NO existen en el MCP real de Stitch** — NUEVA DEUDA, descubierta en F2 PARTE 1.

    **El problema**. `lib/agents/runtime/stitch-client.ts` declara los `StitchTool` literals `"enhance_prompt" | "design_screens" | "fetch_design_md" | "get_screen_image"` y los métodos públicos (`enhancePrompt()`, `designScreens()`, `fetchDesignMd()`, `getScreenImage()`) los pasan a `_invokeStitch()` como nombres de tool a invocar contra el MCP. **Esos 4 nombres NO existen en el MCP real de Stitch.** Los reales (inspeccionados en `node_modules/@google/stitch-sdk/dist/generated/src/tool-definitions.js`):
    - `create_project`, `get_project`, `list_projects`
    - `list_screens`, `get_screen`
    - `generate_screen_from_text`, `edit_screens`, `generate_variants`
    - `create_design_system`, `update_design_system`, `list_design_systems`, `apply_design_system`

    **Tests verdes, realidad rota.** El módulo tiene 12 tests verdes, pero todos inyectan `_invokeStitch` mock y NUNCA verifican la concordancia con el MCP real. Tests verdes a nivel de contract interno; código roto a nivel de integración productiva. Es exactamente el patrón de bug que v3 viene a cazar y se nos coló dentro de v3 mismo.

    **Impacto operativo actual: BAJO.** `StitchClient` SOLO se importa desde su propio test (verificado con grep en F2 PARTE 1) — no hay path productivo que lo invoque. Layout Architect agent en producción habla con el MCP via claude.exe, no via TypeScript. El script `scripts/record-stitch-yoga-fixture.ts` (F2.2) usa el SDK directamente con los nombres reales, no via `StitchClient`.

    **Decisión pendiente** — diferida hasta tener evidencia del primer run real:
    - **Opción A — reescribir** `StitchClient` contra los nombres reales del SDK. Esto requiere mapear las 4 operaciones del contract actual a la API real:
      - `enhancePrompt()` → no hay equivalente directo; eliminar o reimaginar.
      - `designScreens()` → composición de `create_project` + `generate_screen_from_text` por cada page.
      - `fetchDesignMd()` → aproximar con `list_design_systems`/`get_project`.
      - `getScreenImage()` → `get_screen` + extraer `imageUrl`/`getImage()`.
      - Tests reescritos contra nombres reales.
    - **Opción B — eliminar**: si el script F2.2 demuestra que el acceso directo al SDK (`stitch.createProject(...)`, `screen.generate(...)`) basta para el uso productivo del proyecto, `StitchClient` es redundante. En ese caso eliminar el archivo + los 12 tests + las referencias en `skills/stitch-bridge/SKILL.md` y `lib/agents/prompts-v3/layout-architect.md`.

    **Trigger de resolución**: después de F3 (primer run real), evaluar si en algún momento del pipeline había necesidad legítima de un cliente TypeScript de Stitch para producción. Si la respuesta es no → Opción B. Si hay un caller productivo plausible (e.g. recorder script más sofisticado, gate que verifica disponibilidad de Stitch antes de wave-2) → Opción A.

12. **seeds-fixtures rework pendiente (ROADMAP §3.7).** El ROADMAP §3.7 describe ampliación del agente con volumen realista (50/30/200), casos edge explícitos por enum, distribución temporal, y `seed-manifest.json` para coordinar con Visual QA. Código actual: el agente está en `wave-5-data-tests` pero NO tiene schema v3 (`lib/agents/contracts-v3/seeds-fixtures.*` no existe) ni prompt v3 (`lib/agents/prompts-v3/seeds-fixtures.md` no existe). Es v2-reused. La ampliación del §3.7 sigue pendiente.

13. **R2 race wave-2-domain: seeds-shape y domain-modeler paralelos; dependencia declarada pero aspiracional (seeds-shape deriva de discovery+architect, no necesita domain-model.json hoy). Benigno actualmente, frágil ante futuras refactorizaciones. Referencia: F3-run-8, out/yoga-regen-v3-2026-05-15T13-43-48.**

14. **R4 race wave-3-app-security: rbac-authorization lee `services.json` que service-layer produce en la MISMA wave (intra-wave, los 3 agentes corren en paralelo). Dependencia declarada pero el run real no la respeta ordenadamente. Análoga a R2. En F3-run-9 NO explotó: los 3 v2-reused (service-layer, auth-security, rbac-authorization) cerraron `ok`, output coherente. service-layer y auth-security ambos leen `persistence.json` (de wave-2-domain, ya asentado) → safe; el race real es solo rbac↔service-layer. Benigno actualmente, frágil ante futuras refactorizaciones. Referencia: F3-run-9, out/yoga-regen-v3-2026-05-15T14-23-45.**

> **R2 y R4 forman una categoría: _declared intra-wave dependencies that race-but-survive_.** Ambas son dependencias declaradas entre agentes de la misma wave que el runtime real no serializa, pero que sobreviven porque el consumidor no necesita realmente el artefacto del productor en este dominio (yoga). Vigilar nuevas instancias en waves futuras; si aparece una **tercera**, dejar de tratarlas caso-a-caso y revisar la categoría como bloque (¿el runtime debe respetar `dependsOn` intra-wave, o se acepta el patrón como invariante del diseño?).

> **R5 — _LLM emite shape wrong → cascade silencioso_.** Clase distinta a R2/R4 (no es race; es no-determinismo de forma). Un agente LLM (incluso en fixture-mode, p.ej. layout-architect por B11) emite un artifact con la forma equivocada (F3-run-10a: `{ "selectors": [...] }` en vez de `{ "entries": [...] }`). Si fluye downstream, un gate que itera el campo tira excepción no capturada → `generation.failed` fatal en vez de fallo de agente manejable. **Tres defensas en capas**: (1) **schema pin en el prompt** — el prompt del agente muestra el shape canónico exacto y declara que cualquier sinónimo de campo es rechazado; (2) **validate at boundary** — `assertArtifactsValid` (`lib/agents/runtime/artifact-boundary.ts`) valida los artifacts emitidos contra su schema zod justo después del runner, antes de cualquier gate; un fallo lanza → el orquestador trata al agente como fallido (reprompt / B12); (3) **gate defensive** — `expectArray` (`lib/agents/runtime/qa-gates/_artifact-guard.ts`) hace que todo gate emita una violation `*-malformed` (severity error) en vez de tirar excepción ante shape inválido. **R5-1 (test-id-contract) cerrado en commit 50ee5703**: boundary validator wirado en el slot de layout-architect + prompt reforzado + cross-artifact-coherence / stitch-completeness / visual-regression scanners defensivos. **Pendiente**: extender la validación de boundary a los demás artifacts v3 (`layout-tree.json`, `stitch-analysis.json`, `brand-identity.json`, `page-adaptations.json`) como pase futuro — el mecanismo es genérico (un par `filename → validator` por slot), solo falta wirar el resto.

15. **`app/globals.css` emitido por bootstrap-devops pero NO registrado en `filesProduced` del schema.** `filesProducedSchema` (`lib/agents/contracts-v3/bootstrap.schema.ts`) es `.strict()`; añadir la clave `globalsCss` rompería la validación del artifact en runs reales. Decisión consciente: el schema permanece strict por trazabilidad del resto del sistema (env/devops files con gates específicos); `globals.css` es un archivo pequeño sin gates propios, se emite igual fuera del inventario. Si en el futuro necesitamos validar el contenido de `globals.css` (e.g. gate que verifique que el bloque `prefers-reduced-motion` sobrevivió), ampliar el schema con un campo opcional. Origen: commit 27b5e17.

16. **Bug latente pre-existente en `lib/agents/orchestrator-v3.test.ts:869/887`.** Compara `severity: "warning"` contra el tipo `QaSeverityV3` (`"error" | "warn"`) — sin overlap. Pasa en vitest (no typechequea) pero la lógica del test está rota: `tsc --noEmit` reporta 2 errores (TS2322 + TS2367), o sea el v3 suite NO compila limpio en HEAD. Pre-existente, descubierto durante el removal de animation-choreographer (27b5e17), NO causado por él. Arreglo acotado: cambiar el literal `"warning"` → `"warn"`, o revisar si la intención original del test era otra (en cuyo caso reescribir el assert). No urgente, no bloqueante.

17. **Self-reference de hash en docs (cosmético).** Las entradas de `V3_PROGRESS.md` "Cambios arquitecturales no-bug" y `ROADMAP_V3 (2).md` Deviations #10 citan el commit `63d0f4b` (pre-amend) en lugar de `27b5e17` (HEAD final). Contenido idéntico — `63d0f4b` es el objeto previo al `--amend` que rellenó el hash en los docs (paradoja inevitable del hash auto-referenciado en single-commit). Corregir en el próximo pase de docs reemplazando `63d0f4b` → `27b5e17` en ambos archivos.

18. **6 tests pre-existentes fallan en suite `lib/agents/` (schemas).** auth-security (2: rejects unknown JWT algorithms, rejects rate-limit keys non api/app), rbac-authorization (1: rejects abilities entries for unknown roles), phase1-complete/tests-writer (2: rejects test files outside tests/, counts.total === unit+integration+e2e), wave4-agents/forms-validations (1: rejects mutation names non use*-style). Confirmado **pre-existente vía stash en HEAD** (fallan idénticos sin ningún cambio aplicado). El comportamiento de los agentes en los F3-runs es verde — NO son bugs reales, solo tests de schema desalineados con el schema actual. Análogo a deuda #16. Arreglo acotado en sesión de limpieza futura, no urgente, no bloqueante para F3-run-10. Descubierto durante la validación post-sub-division de wave-4 (commit 3e56fe47).

19. **B-w4-6 latente para tests-writer (wave-5) y visual-qa (wave-7).** El alias `screens-map.json` → `layout-tree.json` (byte-idéntico, sin `componentSpecs`/`screens[]` del shape v2 original) se mantiene porque lo consumen 3 agentes v2-reused: `frontend-architect` (wave-4b — validado OK en F3-run-10b, solo usa rutas), `tests-writer` (wave-5) y `visual-qa` (wave-7). B-w4-6 quedó **cerrado solo para ui-components** (al eliminar su Bloque B). Para tests-writer y visual-qa el mismo patrón "alias parcial — agente v2 espera campos que el v3-source no emite" sigue **latente**: puede degradar output o fallar si esos agentes necesitan campos v2 de screens-map que `layout-tree.json` no tiene. No evaluado aún (la bisección no llegó a waves 5/7). Cuando la bisección llegue, mismas 3 opciones que se discutieron para ui-components (aliasing compositional / port focal v3 / wrapper sintetizador). No bloqueante para wave-4. Origen: inspección post-F3-run-10b, commits 0c08cc07/cf51f01c.

20. **Drift v2→v3: `validFrom` falta en el DTO frontend.** `client/types/index.ts CreateMembershipRequest` NO declara `validFrom`, pero el backend zod `CreateMembershipRequest` lo requiere. forms-validations lo mitiga enviando el payload completo con type assertion + comentario, y flagea que **frontend-architect** debe añadir el campo al DTO. Detectado en el run `2026-05-16T16-15-35` (forms-validations.json `notes[]`). Mismo patrón B-w4-1 (decomposición de artifact v2 sin actualizar consumidor). Owner: frontend-architect. Latente, no bloqueante (el form funciona vía assertion). Origen: análisis B-w4-9.

21. **vitest scope bug: `exclude` apunta a `lib/skeleton/` pero el skeleton vive en `lib/skeleton-v2/`.** `vitest.config.ts` `exclude: ["node_modules", "lib/skeleton/**"]` no captura `lib/skeleton-v2/**` ni los `node_modules` nested (`lib/skeleton-v2/node_modules`, `out/**/node_modules`), por lo que `vitest run` sin scope barre ~14065 tests (97 files / 44 fails, todos third-party/generados). La validación con scope `vitest run lib/agents` reproduce el baseline limpio (706/6 = deuda #18) y es la que se usa como gate. Fix futuro: corregir el glob a `lib/skeleton-v2/**` + excluir `out/**`. No urgente (workaround = scopear), no bloqueante. Descubierto durante validación de B-w4-9 (Commit A).

22. ✅ **CERRADA (pre-flight wave-5).** ~~Docstring stale `orchestrator-v3.ts:2` dice "23 agents".~~ Corregida junto con la eliminación de accessibility (conteo real ahora 21, docstring actualizado a "7 logical waves (14 slices), 21 agents"). El cambio de conteo de este commit la arrastró naturalmente.

23. **Audit boundary validators en todos los v3 agents.** Slots con validator wired: `visual-adapter` (`page-adaptations.json`, B-w4-12), `forms-validations` (`forms-validations.json` v3, ✅ **B-w4-13**), `layout-architect` (`test-id-contract.json`), `ui-components` (`components-catalog.json`). **Sin auditar (pendiente)**: `bootstrap-devops`, `ux-ui-designer`, `brand-identity`, y el resto de v2-reused con schema v3 (`api-backend`, `frontend-architect`, `domain-modeler`, `persistence`, etc.). Sin validator = falso-verde ante drift LLM (clase B-w4-12). Pase futuro de hardening. Origen: B-w4-11/12; slot forms-validations cerrado en B-w4-13. **Update (pre-flight wave-5):** slots `seeds-fixtures`/`tests-writer` wirados SIN validators — no existe `contracts-v3/seeds-fixtures.schema.ts` ni `tests-writer.schema.ts`. Schema + validator de los outputs wave-5 = **TBD post-F3-run-14** (decidir tras ver la shape real que emiten los prompts v2 reusados, mismo método que B-w4-11/12 → B-w4-13).

---

## Estado pendiente — pasos 6 a 13

Según el orden de implementación del ROADMAP V3:

| Paso | Trabajo | Estado |
|------|---------|--------|
| 6 | Brand Identity Agent | ⏸️ Pendiente |
| 7 | Animation Choreographer Agent | ⏸️ Pendiente |
| 8 | Accessibility Agent | ⏸️ Pendiente |
| 9 | Visual QA Agent con Claude Vision integrada + Seeds & Fixtures ampliado | ⏸️ Pendiente (paso sobrecargado, subdividir cuando se llegue) |
| 10 | Rework UI Components v3 (cierre D4) | ⏸️ Pendiente |
| 11 | Skills custom restantes en paralelo | ⏸️ Pendiente |
| 12 | Validación E2E con fixture restaurant en --step-by-step | ⏸️ Pendiente |
| 13 | Re-validación de yoga y tutorías para asegurar no-regresión | ⏸️ Pendiente |

**Paso 9 está sobrecargado**. Se apunta para subdividir cuando se llegue.

**Paso 10 (Rework UI Components v3) es la pieza más grande pendiente** porque cierra D4 y permite que el visual-regression-scanner deje de reportar minor regressions transitorias.

---

## Cómo retomar el trabajo

### Si retomas con la misma sesión de Claude Code

Probablemente NO. La sesión actual lleva mucho contexto. Mejor abrir sesión nueva siguiendo el protocolo abajo.

### Si abres sesión nueva de Claude Code

1. Abre Claude Code en nueva terminal sobre `C:\Users\alexs\Downloads\projecto`
2. Asegúrate de estar en rama `v3` (`git checkout v3 && git status`)
3. Pega el contenido de `V3_NEXT_PROMPT.md` (el otro documento que viene con este)
4. Claude Code va a:
   - Leer este `V3_PROGRESS.md`
   - Leer el `ROADMAP_V3.md`
   - Leer `PENDING_V3_DECISIONS.md`
   - Verificar estado con `git log --oneline v2..v3`
   - Correr tests para verificar no-regresión
   - Reportarte qué encontró
   - Esperar tu instrucción de qué paso atacar

---

## Comandos de verificación rápida

Para validar que el repo está en estado bueno antes de retomar:

```powershell
cd C:\Users\alexs\Downloads\projecto
git status                                     # working tree clean (solo docs externos untracked)
git branch --show-current                      # v3
git log --oneline v2..v3                       # 14 commits limpios al cierre paso 5
npx vitest run lib/agents/contracts-v3/ lib/agents/orchestrator-v3.test.ts lib/agents/violations-router-v3.test.ts lib/agents/runtime/                  # 216 v3 tests verde (de los 233 totales, 17 son v2)
npx tsx scripts/test-v3-dry-run.ts              # ▣ v3 DRY-RUN GREEN — 23/23 agents, 10/10 waves
npx tsx scripts/test-v3-gate5-smoke.ts          # ▣ Gate 5 demo GREEN — 3/3 escenarios HTTP
npx tsx scripts/full-yoga-regen.ts --dry-run    # ▣ FINAL: GO (v2 intacto)
```

Si TODOS dan verde → repo OK, listo para retomar.
Si alguno falla → diagnostica antes de avanzar. Hay regresión.

---

## Filosofía operativa que se ha establecido y debe mantenerse

1. **Validación humana ANTES de codificar.** Cada agente nuevo: schema → prompt → review humano → tests unitarios → integración → dry-run. No improvisaciones.

2. **Honestidad técnica brutal.** Cada cierre de paso reporta deudas pendientes con trazabilidad: qué falta, dónde se cierra, por qué se diferió.

3. **Trazabilidad bug ↔ código.** Cada decisión arquitectónica en v3 se justifica en un bug específico observado en v2. Sin esa cadena no entra cambio.

4. **No tocar v2.** v2 queda intacto como referencia y como motor productivo. Cambios mínimos al runner v2 (escape hatches opcionales, configOverride) solo si son inevitables.

5. **Funciones puras + DI test seams.** Los gates programáticos (`env-leak-scanner`, `runtime-smoke-scanner`, `cross-artifact-coherence-scanner`, `visual-regression-scanner`) son funciones puras con inyección de dependencias (`_fetch`, `_walk`, `_readFile`, `_diff`, `_invokeStitch`). Tests rápidos, deterministas, sin red ni filesystem real.

6. **Severity crítica reservada.** `critical` solo cuando interviene el humano, no el fix loop. Diferenciación importante para terminal failures vs fixable ones.

7. **Step-by-step para primera generación de dominio.** Modo `--auto` solo para iteraciones rápidas o CI. Validación humana entre waves cuando se genera dominio nuevo.

8. **Commits temáticos cuando el trabajo es grande.** Paso 5 se dividió en 3 commits (schemas + scanners, prompts + skill, dry-run + PENDING) para auditabilidad. Paso 4 fue un commit porque era más acotado.

9. **3 capas independientes para cerrar un bug clase A.** Bootstrap declara R0 → schema valida → env-leak scanner enforza. El mismo patrón de defensa-en-profundidad aplica a bug clase E: schema R0 (layout-tree home no standalone) + prompt R0 + cross-artifact-coherence-scanner.

10. **Investigar antes de proponer.** Antes de diseñar Layout Architect, se investigó Stitch real. Descubrir que tiene MCP oficial + 7 skills cambió la implementación material (thin adapter vs reimplementación). Sin esa investigación, el resultado habría sido inferior.

---

## Decisiones documentadas en PENDING_V3_DECISIONS.md

- D1 — api-contract es UN agente, no dos. **RESUELTO** (paso 3).
- D2 — Contrato test-id entre Layout Architect y UI Components. **RESUELTO** (paso 5).
- D3 — Gate 6 visual regression bloqueado por integración Stitch. **RESUELTO** (paso 5).
- D4 — Rework UI Components v3 para consumir contratos visuales. **PENDIENTE hasta paso 10.**

---

## Cambios al ROADMAP V3 desde su versión original

1. **Sección 5.5** añadida: Protocolo de validación incremental wave-por-wave con flag `--step-by-step` y comandos `atelier approve|reject|inspect`.
2. **Sección 9** actualizada: orden de implementación cambió para que `--step-by-step` se implemente en el paso 2 (no al final), porque se usa durante el resto de la implementación.
3. **Paso 12** explicitado: validación E2E con restaurant en modo `--step-by-step`, wave por wave, sin pasar a la siguiente hasta aprobación humana.
4. **Sección 3.1** ampliada: nota al cierre que documenta el enforcement R0 via QA Reviewer regex sobre código generado (paso 1).
5. **Sección 3.6** consistente con paso 3: Visual QA es UN agente, no dos sub-agentes (decisión arquitectónica del paso 3).
