# Pending v3 Decisions

Decisiones que aparecieron durante la implementación de v3 y que requieren
clarificación humana antes de avanzar. Sin estas decisiones, el sistema
funciona con la interpretación documentada acá, pero podría requerir refactor.

---

## D1 — ¿`api-contract` es un agente separado de `api-backend`?

**Fecha**: 2026-05-13 (Paso 1, Bootstrap Agent kickoff)

**Origen**: Sección 6 del `ROADMAP_V3.md` lista en Wave 3:

```
Wave 3 — Backend Foundation
  - Persistence Agent (existente)
  - Auth Security Agent (existente)
  - RBAC Authorization Agent (existente)
  - Service Layer Agent (existente)
  - API Contract Agent (existente)
  - API Backend Agent (existente)
```

Lo cual sugiere **6 agentes** en wave 3, dos de ellos relacionados con la
API (Contract y Backend).

**Realidad en v2**:

- Hay un único agente `api-backend` que produce el artifact `.atelier/api-contract.json`.
- No existe `api-contract` como prompt/schema/agente independiente.
- v2 tiene en total **17 agentes** (confirmado por
  `lib/agents/orchestrator-v2.test.ts` → `includes all 17 agents exactly once`).

**Interpretación adoptada por defecto en v3**:

- `api-contract` **NO** es un agente separado. Sigue siendo el nombre del
  artifact que produce `api-backend`. En v3 wave 3 hay 5 agentes de v2
  (persistence, auth-security, rbac-authorization, service-layer,
  api-backend), no 6.
- `AgentNameV3` tiene 23 entradas: los 17 de v2 + 6 nuevos
  (bootstrap-devops, layout-architect, brand-identity, animation-choreographer,
  accessibility, visual-qa). 17 + 6 = 23 ✓ — la cuenta cuadra solo si NO
  separamos api-contract.

**Por qué creo que el ROADMAP es un error de redacción**:

- En v2 nunca existió como agente separado; nada en el ROADMAP justifica
  partirlo en dos.
- La sección 3 del ROADMAP (responsabilidades de los agentes nuevos) NO
  describe un "API Contract Agent" nuevo. Sólo describe Bootstrap, Layout
  Architect, Brand Identity, Animation Choreographer, Accessibility, Visual
  QA. Si fuera un agente nuevo, estaría descrito allí.

**Qué hacer si la interpretación está mal**:

Si en realidad `api-contract` SÍ debe ser agente separado:

1. Añadir entrada `api-contract` al union `AgentNameV3`.
2. Crear prompt `lib/agents/prompts-v3/api-contract.md`.
3. Crear schema `lib/agents/contracts-v3/api-contract.schema.ts` (probablemente
   migrar el actual `api-contract.schema.ts` de v2 a v3 sin cambios).
4. Re-numerar todos los wave counters que dicen "5 agentes" → "6 agentes".
5. Decidir el contrato: ¿api-contract produce solo la spec OpenAPI y
   api-backend la implementa? ¿O reparten todo el trabajo del actual
   api-backend?

**Impacto si NO se decide**:

Ninguno mientras solo trabajemos en Bootstrap. La decisión solo bloquea
el desarrollo de los agentes wave 3 en v3.
