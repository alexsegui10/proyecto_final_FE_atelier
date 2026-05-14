# Atelier V3 — Estado del Trabajo

> Documento de traspaso. Captura el estado de la implementación de Atelier v3 al cierre del paso 5. Si retomas el trabajo en una conversación nueva, lee este documento entero antes de hacer nada.

---

## Resumen ejecutivo

Atelier v3 es la siguiente iteración del sistema multi-agente Atelier, motivada por 5 clases de bugs detectados en la validación end-to-end de v2 con yoga y tutorías. El roadmap completo está en `ROADMAP_V3.md` en la raíz del repo.

V3 se implementa **paso a paso, con validación humana entre pasos**, en la rama `v3` (creada desde `v2`). La rama `v2` queda intacta como referencia.

Hasta el momento (cierre paso 5): **233 tests verde, 14 commits limpios en v3, dry-run impecable, v2 sin regresiones**.

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
