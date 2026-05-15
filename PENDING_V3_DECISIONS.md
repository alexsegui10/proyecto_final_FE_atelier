# Pending v3 Decisions

Decisiones que aparecieron durante la implementación de v3 y que requieren
clarificación humana antes de avanzar. Sin estas decisiones, el sistema
funciona con la interpretación documentada acá, pero podría requerir refactor.

---

<!-- D1 (api-contract) resuelta: el `api-backend` agente único se mantiene; el
artifact `api-contract.json` que produce sigue llamándose así. La cuenta
17 v2 + 6 nuevos = 23 cuadra. (Confirmado por el usuario.) -->

<!-- D2 (contrato test-id) RESUELTA en paso 5 (commit 7d140ac + 5b5cc80):
- Schema `lib/agents/contracts-v3/test-id-contract.schema.ts` declara la
  shape canonical (selector kebab-case, requiredOn { component | layoutGroup },
  criticality enum critical/recommended/optional, consumedByFlow narrowed
  to the 3 v3 flows).
- Prompt `lib/agents/prompts-v3/layout-architect.md` R5 enumera los 8
  selectors críticos por defecto que el agente DEBE emitir.
- Visual QA Agent (prompt paso 3) ya hereda el fallback role/label/text
  cuando un test-id es flaky, emitiendo `selector-flaky` severity warn. -->

<!-- D3 (Gate 6 visual regression) RESUELTA en paso 5 (commit 7d140ac):
- `lib/agents/runtime/qa-gates/visual-regression-scanner.ts` implementa
  el diff PNG-vs-PNG via pixelmatch + pngjs.
- Postwave gate de `wave-7-runtime-qa`: necesita screenshots de Visual QA.
- Routing: diff > 25% → visual-regression-major agent layout-architect,
  10-25% → visual-regression-minor agent ui-components warn, ≤10% no
  violation. -->

## D4 — Rework UI Components v3 para consumir contratos visuales **[OBSOLETA]**

> ⚠️ **OBSOLETA por rework Stitch (commit ea94c19).** Visual Adapter (NUEVO agente, `lib/agents/prompts-v3/visual-adapter.md`) tomó la responsabilidad de inyectar test-ids (R4), microcopy (R3) y preservar font links (R2) directamente sobre el HTML literal de Stitch. UI Components solo emite primitivos shadcn para el "último recurso" del Adapter (R5 INVERTED: preservar `<input>`/`<select>`/`<textarea>` de Stitch por default, swap a shadcn solo cuando el elemento original genuinamente no cumple). El rework v3 original descrito abajo (UI Components consume 4 contratos visuales) ya NO aplica: stitch-analysis no se decompone para re-síntesis de JSX. Decisión queda como referencia histórica.

**Fecha**: 2026-05-14 (Paso 5, Layout Architect kickoff)

Hoy UI Components v2 genera JSX sin consumir contratos visuales explícitos.
En v3, debe leer:
- `.atelier/test-id-contract.json` (D2 cerrada en paso 5)
- `.atelier/stitch-analysis.json` (paso 5)
- `.atelier/brand-identity.json` (paso 6, futuro)
- `.atelier/animations.json` (paso 7, futuro)

**Estado: BLOQUEADO hasta paso 10 (rework UI Components v3).**

**Razón**: hace falta que Brand Identity (paso 6) y Animation Choreographer
(paso 7) existan para definir el contrato completo de inputs.

Cuando llegue paso 10:

- Nuevo prompt en `lib/agents/prompts-v3/ui-components.md`.
- Schema componentSpecs ampliado con consumo de los 4 contratos
  (test-id, stitch-analysis, brand-identity, animations).
- Tests cross-artifact que validan que cada test-id `critical` aparece
  en el JSX emitido por UI Components.
- v2 ui-components queda intacto.

**Impacto si NO se decide**: ninguno hasta paso 10. Mientras tanto:

- Visual QA usa fallback role/label/text (emite `selector-flaky` warn).
- Visual regression scanner compara screenshots vs stitch-mockups con la
  divergencia esperada (la UI generada hoy no respeta exactamente lo que
  Stitch propuso porque UI Components v2 no consume `stitch-analysis`).

Estos warnings + minor regressions están aceptados como deuda transitoria
hasta cerrar D4.

---

_Sin más decisiones pendientes. D1, D2, D3 RESUELTAS. D4 OBSOLETA por rework Stitch (Visual Adapter absorbió las responsabilidades)._
