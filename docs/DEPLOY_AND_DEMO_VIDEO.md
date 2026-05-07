# Deploy a Vercel + vídeo de respaldo (Bloques E + F)

Estos dos bloques del FINAL_STRETCH_PROMPT requieren acceso interactivo
(login OAuth + grabación de pantalla) que el agente autónomo NO tiene.
Quedan documentados aquí siguiendo el fallback explícito del spec.

## Bloque E — Deploy a Vercel

### Estado

- ✅ `vercel.json` listo en la raíz (regiones, función timeouts, env defaults)
- ✅ `pnpm build` corre limpio en local (verificado al final del sprint)
- ❌ `vercel deploy --prod` no se corrió — necesita `vercel login` interactivo

### Caveat de los agentes en producción

El runner spawnea `claude.exe` (CLI). Vercel Edge functions NO permiten
subprocess; serverless functions (Node.js) tampoco van a tener `claude` en
PATH. Implicación: el endpoint `/api/discovery/stream` y `/api/generate/start`
**no van a generar de verdad en Vercel**. Tres caminos:

1. **Más simple (recomendado para TFG)**: deploy del frontend a Vercel con
   un toast en `/discover` que diga "Demo en vivo solo en local. Para
   probar la generación real, clona el repo y corré `pnpm agents:test` o
   `pnpm dev`". Las demos cacheadas SÍ funcionan en Vercel porque solo
   leen `out/demo-cache/*` y replayean Events a la DB.
2. **Modo híbrido**: env var `ATELIER_AGENT_BACKEND=api` habilita un
   runner alternativo basado en `@anthropic-ai/sdk` con API key (no Max).
   Implementación pendiente. Sería un `lib/agents/runner-api.ts` con la
   misma firma que `runGeneratorAgent` pero usando el SDK directo.
3. **Self-host**: deploy en una VM (Railway/Fly/Hetzner) con `claude`
   instalado y autenticado. Más fricción, pero el motor entero funciona
   tal cual.

### Cómo hacer el deploy ahora (manual, ~5 min)

```bash
cd C:\Users\alexs\Downloads\projecto
pnpm dlx vercel login          # interactivo, OAuth en navegador
pnpm dlx vercel link            # asocia el repo con un proyecto Vercel
pnpm dlx vercel env add DATABASE_URL              # paste el DSN de Neon
pnpm dlx vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
pnpm dlx vercel env add CLERK_SECRET_KEY
pnpm dlx vercel env add NEXT_PUBLIC_CLERK_SIGN_IN_URL  # /sign-in
pnpm dlx vercel env add NEXT_PUBLIC_CLERK_SIGN_UP_URL  # /sign-up
pnpm dlx vercel deploy --prod
```

URL final será del estilo `https://atelier-<hash>.vercel.app`.

## Bloque F — Vídeo de respaldo

### Estado

- ❌ No grabado — requiere acceso a navegador + grabación de pantalla,
  ninguno disponible en este entorno autónomo
- ✅ El "guion" del vídeo está definido más abajo y todas las pantallas
  están listas para grabar

### Cómo grabarlo (recomendado: OBS o el grabador de Windows)

Duración objetivo: 3-5 minutos. Compresión final a MP4 H.264, ~1080p.
Salida en `docs/demo-video.mp4`.

### Guion sugerido

1. **0:00–0:15** — Abrir `/discover`. Mostrar el HUD inicial, la barra de
   madurez del PRD a 0%, el botón "El agente sigue analizando…".
2. **0:15–0:30** — Click en la demo "Estudio de yoga ▶". Replay arranca.
3. **0:30–2:30** — Studio con animaciones: HUD timer corriendo, agentes
   pasando de IDLE → WORKING → DONE, signature animations (compass,
   cubos, gears, escudo, grid, scanner). Ronda de fix loop al final con
   FIX badge ámbar.
4. **2:30–2:40** — Big-bang fade al Reveal.
5. **2:40–4:00** — Reveal: navegar el árbol de archivos en Monaco
   (mostrar prisma/schema.prisma, una use case, una page Next), copiar
   las credenciales demo, leer el QA summary.
6. **4:00–4:30** — Volver a `/discover` con "Re-generar otra app",
   comenzar conversación rápida en el chat real (15-20s) para mostrar el
   typing indicator + maturity bar subiendo.
7. **4:30–5:00** — Cierre con un screenshot del workDir y el commit log
   (`git log --oneline | head -10`) para evidencia técnica.

Si el live recording falla, **screenshots de cada estado** valen para la
defensa. La paleta + animaciones se ven en cuanto montás el dev server.
