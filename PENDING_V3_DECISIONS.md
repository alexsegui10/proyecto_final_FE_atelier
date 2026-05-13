# Pending v3 Decisions

Decisiones que aparecieron durante la implementación de v3 y que requieren
clarificación humana antes de avanzar. Sin estas decisiones, el sistema
funciona con la interpretación documentada acá, pero podría requerir refactor.

---

<!-- D1 (api-contract) resuelta: el `api-backend` agente único se mantiene; el
artifact `api-contract.json` que produce sigue llamándose así. La cuenta
17 v2 + 6 nuevos = 23 cuadra. (Confirmado por el usuario.) -->

## D3 — Gate 6 (visual regression) bloqueado por integración Stitch

**Fecha**: 2026-05-13 (Paso 4, gates 5/6/7)

Gate 6 del ROADMAP § 5.2 hace pixel diff entre screenshots de la app generada
y mockups producidos por Stitch (vía Layout Architect del paso 5). Sin
Layout Architect + Stitch MCP, no hay mockups contra los que diferir.

**Estado: BLOQUEADO hasta paso 5.**

Cuando llegue paso 5:

- Layout Architect produce `stitch-analysis.json` + screenshots PNG en
  `.atelier/stitch-mockups/`.
- Gate 6 se implementa como módulo paralelo a `runtime-smoke-scanner`:
  `lib/agents/runtime/qa-gates/visual-regression-scanner.ts`.
- Usa `pixelmatch` (npm) + `pngjs` para diff PNG-vs-PNG con tolerancia
  configurable.
- Probes: cada pantalla declarada en `screens-map.json` con su mockup
  correspondiente.
- Violations: `visual-regression` severity `warn` (no bloquea — la
  divergencia visual es subjetiva); routea a `ui-components` o
  `layout-architect` según el área afectada.

Hasta entonces, Visual QA captura screenshots pero NO los compara con
mockups. El humano puede revisar `.atelier/screenshots/` durante
step-by-step.

## D2 — Contrato test-id entre Layout Architect y UI Components

**Fecha**: 2026-05-13 (Paso 3, Visual QA Agent kickoff)

**Origen**: Visual QA selecciona elementos del DOM con jerarquía
`data-testid → getByRole → getByLabel → getByText`. Sin `data-testid` en
elementos críticos, los flows Playwright son frágiles: rompen cuando UI
Components cambia microcopy o estructura.

**Propuesta**: Layout Architect produce artifact `test-id-contract.json`
declarando los selectors críticos que UI Components debe añadir como
`data-testid` en su output. Visual QA lo consume para generar el script
Playwright robusto.

**Resolución**: cuando construyamos Layout Architect (paso 5 del orden de
implementación de § 9 del ROADMAP), formalizamos:
- Schema `test-id-contract.json` con `{ selectorId, semanticRole, requiredOn: <component-name> }`.
- Regla en UI Components: cada componente listado en el contrato debe
  llevar `data-testid={selectorId}` en su elemento root.
- Regla en QA Reviewer: gate programático que verifica la presencia de
  todos los `data-testid` esperados; cada miss = violation routada a
  `ui-components` o `layout-architect` según ownership.

Hasta entonces, Visual QA usa selectores fallback (`getByRole` /
`getByLabel` / `getByText`) — más frágiles pero funcionales. Las
violations de Visual QA por flakiness de selector NO se rutean a
`ui-components` mientras esta deuda esté abierta; se documentan como
`selector-flaky` con `severity: warn` (no bloquean go/no-go).

**Impacto si NO se decide**: ninguno hasta paso 5. Visual QA funciona con
selectores fallback. La deuda se cierra en su momento.
