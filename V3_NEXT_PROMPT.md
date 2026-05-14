# Prompt para retomar Atelier V3

> Pega este prompt en una conversación nueva con Claude (asistente que te ayuda con la planificación) o en una sesión nueva de Claude Code (ejecutor del trabajo). Adapta según el rol.

---

## Versión A — Para Claude (asistente de planificación, conversación de chat)

Hola. Estoy retomando Atelier V3, un sistema multi-agente generador de aplicaciones web full-stack. La implementación de v3 está en curso sobre la rama `v3` del repo, en `C:\Users\alexs\Downloads\projecto`.

Te paso 3 documentos clave que tienes que leer en este orden:

1. `ROADMAP_V3.md` — la especificación completa de v3 (~5700 palabras, 12 secciones)
2. `V3_PROGRESS.md` — el estado actual del trabajo, qué pasos están cerrados, qué deudas pendientes
3. `PENDING_V3_DECISIONS.md` — decisiones técnicas diferidas

Tu rol: planificar conmigo el siguiente paso, escribir prompts precisos para Claude Code, validar propuestas que Claude Code me devuelva, y mantener la filosofía operativa establecida (validación humana antes de codificar, honestidad técnica brutal en deudas, trazabilidad bug ↔ código).

Después de leer los 3 documentos, dime:

- Qué entiendes del estado actual
- Qué paso atacaríamos siguiente (sugiero paso 5 — Layout Architect con Stitch MCP, salvo que detectes algo más prioritario)
- Qué preguntas tienes para mí antes de empezar

Espero tu respuesta antes de avanzar.

---

## Versión B — Para Claude Code (ejecutor del trabajo, terminal)

Estás retomando Atelier V3 sobre la rama `v3`. La implementación está en curso. Lee los siguientes archivos en este orden antes de hacer nada:

1. `ROADMAP_V3.md`
2. `V3_PROGRESS.md`
3. `PENDING_V3_DECISIONS.md`

Reglas operativas (las mismas que se establecieron en sesiones anteriores):

1. Trabajas en rama `v3`. NO mergeas a `master` ni a `v2` sin permiso explícito.
2. Compatibilidad hacia atrás obligatoria. v2 sigue funcionando con `--dry-run` sin tocar.
3. Cada agente nuevo requiere: schema Zod → prompt → revisión humana → tests unitarios → integración → dry-run. **Paras y reportas antes de codificar.**
4. Sin tiempos. No me das estimaciones de cuánto te llevará algo.
5. Sin API directa de Anthropic. Solo subprocess Claude Code con plan Max, sin `--bare`.
6. Honestidad técnica brutal. Cada cierre de paso reporta deudas pendientes con trazabilidad.
7. Cada decisión arquitectónica se justifica en un bug específico de v2 o en una sección del ROADMAP.

**Antes de avanzar a paso 5, verifica el estado del repo:**

```powershell
cd C:\Users\alexs\Downloads\projecto
git status                                                      # working tree clean
git branch --show-current                                       # debe decir v3
git log --oneline v2..v3                                        # 8+ commits limpios
npx vitest run lib/agents/contracts-v3/ lib/agents/orchestrator-v3.test.ts lib/agents/violations-router-v3.test.ts lib/agents/runtime/                  # 100+ tests verde
npx tsx scripts/test-v3-dry-run.ts                              # ▣ v3 DRY-RUN GREEN
npx tsx scripts/test-v3-gate5-smoke.ts                          # ▣ Gate 5 demo GREEN
npx tsx scripts/full-yoga-regen.ts --dry-run                    # ▣ FINAL: GO (v2 intacto)
```

Si TODOS dan verde, reporta el estado a tu humano y espera instrucciones.

Si alguno falla, diagnostica antes de avanzar — hay regresión inesperada.

**El humano decidirá qué paso atacar. NO improvises siguiendo el ROADMAP por tu cuenta. Espera instrucción.**
