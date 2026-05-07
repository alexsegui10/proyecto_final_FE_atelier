# Atelier — Final stretch: Sprint 2B + Phase 4 combinados

Sprint 2A está cerrado. **GO ALL GREEN, 4/4 gates, 0 violations, app generada compila y respeta Clean Architecture.** El motor está sólido. Ahora es el momento del espectáculo y del Reveal funcional.

Lee antes de empezar: `PHASE_3_PROMPT.md` (Sprint 2B specs), `PRD_BUILDER.md` §10 (Phase 4), y la memoria en engram `sdd/projecto/phase-3/sprint-2A`.

## Acceptance criterion combinado

1. **Visual cinematográfico** en el Studio durante una generación: cada agente con su personalidad visual distinta, HUD animado, transiciones bonitas
2. **Reveal funcional**: el usuario ve el código generado con syntax highlight (Monaco) y la app generada arranca **en directo dentro del navegador** vía WebContainers, con credenciales de demo visibles
3. **Demos pre-cacheadas**: 2 generaciones completas guardadas en disco (yoga + otra), reproducibles instantáneamente
4. **Mejoras al Discovery**: umbral más exigente, botón "quiero seguir hablando", barra de madurez del PRD
5. **Deploy a Vercel** del builder
6. **Vídeo de respaldo** grabado mostrando una generación end-to-end

## Tiempo aproximado: 3-5 horas

Tienes 6 horas. Todo lo de aquí es prioritario, pero si te quedas sin tiempo, el orden de sacrificio es: **sonido último, code rain penúltimo, big bang antepenúltimo**. El resto NO se sacrifica.

## Bloque A — Visual cinematográfico (~2h)

Implementa lo que está en `PHASE_3_PROMPT.md` sección "Personalidad de cada agente" + "Detalles cinematográficos transversales", con la paleta violeta + azul oscuro que ya está documentada.

**Orden de implementación dentro del bloque visual:**

1. **Tokens de paleta y tipografía** primero. Un único archivo `lib/styles/studio-tokens.ts` que centraliza todos los colores, fuentes, easings, durations. Todo lo demás referencia desde aquí.

2. **HUD superior** con timer + contadores slot-machine. Es lo más visible y rápido de implementar. 30 min.

3. **Estados base de los 6 nodos** (idle/working/done/fixing/failed) con bordes, glow y mini-terminal por nodo. 30 min.

4. **Animación firma de cada agente** uno a uno, en este orden de impacto:
   - **QA Reviewer scanner** (el más impresionante, hazlo primero) — la línea láser recorriendo todos los nodos, badges de validación apareciendo
   - **Architect compass** girando + líneas de blueprint dibujándose
   - **Domain cubos 3D** ensamblándose
   - **Use Cases engranajes** girando en cadena
   - **Auth escudo** con anillos por rol
   - **API & Frontend rejilla** tejiéndose
   
   Si te atascas en alguno, déjalo con la animación base (pulse + glow) y sigue. Mejor 4 brutales y 2 simples que 6 a medias.

5. **Edges con flow + partículas** en handoffs. 30 min.

6. **Glow ambiental** que sigue al agente activo. 15 min.

7. **Big bang transition** al Reveal. 20 min. (Si te quedas corto, fade simple basta.)

8. **Code rain ambiental** en background. 20 min. (Sacrificable si vas justo.)

9. **Sonido** con toggle. 30 min. (Sacrificable. Si lo metes, freesound.org bajo CC0 o tonos sintéticos con Web Audio API.)

**Constraints visuales:**
- 60fps en hardware moderno. Si una animación tira frames, simplificarla
- `prefers-reduced-motion` deshabilita decorativas pero mantiene funcionales (cambios de estado)
- Todas las animaciones cancelables al navegar
- Tipos estrictos, sin `any`

## Bloque B — Reveal funcional (~1.5h)

`app/(dashboard)/reveal/[id]/page.tsx` rediseñado completo. Tres paneles:

### Panel izquierdo (40%): Monaco editor
- Lista de archivos del workDir en árbol colapsable
- Click en archivo → abre en Monaco con syntax highlight según extensión
- Tema oscuro Monaco que combine con la paleta del Studio (`vs-dark` modificado)
- Search bar arriba para filtrar archivos por nombre
- Use `@monaco-editor/react` (peso aceptable, soporta lazy loading)

### Panel central (40%): WebContainers preview
- Iframe con la app generada corriendo
- Loading state bonito mientras WebContainers monta el FS, instala deps y arranca el dev server
- Status indicator: "Mounting filesystem... Installing dependencies... Starting dev server... Ready"
- Botón "Open in new tab" para verla a pantalla completa
- Si WebContainers falla (StackBlitz CDN caído, navegador no compatible), fallback a una captura estática del workDir + mensaje claro

**Cómo arrancar la app generada en WebContainers:**
- WebContainer.boot() al cargar la página
- Mount del filesystem leyendo recursivamente el workDir vía un endpoint nuevo `app/api/generate/[id]/files/route.ts` que devuelve un árbol de archivos
- `npm install` (o `pnpm install` si está disponible)
- `pnpm prisma migrate deploy` con sqlite en lugar de Postgres (en WebContainers no hay Postgres, usar adapter sqlite o `@libsql/client` con archivo local)
- `pnpm seed` para crear el admin de demo
- `pnpm dev` para arrancar
- Iframe apunta al puerto que expone WebContainers

**Importante para que el demo en navegador funcione:**
- El skeleton tiene que tener una variante "demo" con SQLite en lugar de Postgres. Añadir env `ATELIER_DEMO_MODE=1` que cambia el datasource del schema.prisma a sqlite y el adapter en `lib/db/client.ts`. El skeleton existente debería compilar igual con sqlite.
- Si esto te parece demasiado yak shave, **simplifica radicalmente**: mock visual del preview con una serie de capturas pre-renderizadas que rotan, mientras avisas al usuario "Demo en vivo disponible al desplegar". Para la entrega del TFG es suficiente.

### Panel derecho (20%): Summary card
- Decision badge: GO ✅ verde
- Métricas: archivos, líneas, tiempo, agentes ejecutados, fix rounds
- **Credenciales de demo destacadas**:
  ```
  Email:    admin@demo.atelier
  Password: demo1234
  ```
  Con botón "Copiar" en cada uno. Datos generados por el seed que ejecuta el orchestrator al final
- Botón "Descargar zip" (zip del workDir)
- Botón "Re-generar"

## Bloque C — Demos pre-cacheadas + seed (~30min)

1. **Genera 2 apps completas** ahora vía `pnpm agents:test`:
   - Yoga (la fixture que ya existe)
   - Una segunda: "Sistema de tutorías académicas" con profesores, alumnos, sesiones, materiales (cambiar la fixture)
   
2. **Guarda los workDirs** en `out/demo-cache/<slug>/` (yoga, tutorias) con todos los archivos
   
3. **Endpoint** `app/api/demos/route.ts` que lista las demos disponibles, y `app/api/demos/[slug]/play/route.ts` que crea una Generation+Events sintéticas a partir del Event log guardado, y replays los eventos al frontend con timing similar al real (acelerado 4x para no aburrir)
   
4. En `/discover`, antes del chat, un selector compacto: **"O elige una demo: Yoga ▶ | Tutorías ▶"**. Click → directo a `/studio/<id>` con replay

5. **Seed automático** dentro de `runGeneration`: tras el QA OK, ejecutar dentro del workDir un script `scripts/seed-demo.ts` que crea el admin demo con email/password fijos y datos realistas (5 clases, 3 profes, 10 alumnos, 20 reservas en distintos estados). Ese script lo añades al skeleton.

## Bloque D — Mejoras al Discovery (~30min)

- Subir umbral READY_TO_BUILD: 4 entidades, 2+ roles, 8 use cases, **3+ fields documentados por entidad**
- En el system prompt de Discovery añadir bloques obligatorios:
  - "Antes de READY pregunta por reglas de cancelación, refunds, ventanas de tiempo"
  - "Pregunta explícitamente quién puede ver/editar/borrar cada entidad"
- Botón "Quiero seguir hablando" gris junto al "Build it" cuando aparezca READY
- Barra de madurez del PRD (0-100%) calculada por: porcentaje de campos rellenos vs ideal. Visible siempre. El "Build it" solo aparece cuando llega a 100%, antes está el botón gris

## Bloque E — Deploy a Vercel (~20min)

- `vercel.json` con la config necesaria
- `vercel deploy --prod` desde la carpeta del proyecto
- Confirma que las env vars están: `DATABASE_URL` (Neon), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- Comprueba que `/api/discovery/stream` funciona en producción. Si Claude CLI no está disponible en runtime de Vercel (Edge functions no permiten subprocess), **fallback a usar `@anthropic-ai/sdk` con API key** para producción solamente, manteniendo Max para local. Pasa la decisión por env var: `ATELIER_AGENT_BACKEND=cli|api`
- Si esto pinta complicado, deploy del frontend a Vercel pero los agentes solo corren en local. Documenta claramente: **"En producción la pantalla `/discover` está activa pero la generación real solo corre en mi máquina por requerimientos del CLI de Claude Code"**. Para la entrega es suficiente.

## Bloque F — Vídeo de respaldo (~20 min)

Graba con `puppeteer-screen-recorder` o equivalente:
- Conversación en `/discover` (puede ser una de las demos cacheadas para no esperar)
- Click en "Build it"
- Studio entero con todas las animaciones
- Transición al Reveal
- Login en la app generada con las credenciales de demo
- Crear un recurso en la app generada (una clase de yoga, p.ej.)

3-5 minutos de vídeo, comprimido a MP4 H.264. Guarda en `docs/demo-video.mp4`.

Si `puppeteer-screen-recorder` no funciona o se complica, déjalo y dime para que lo grabe yo manualmente con OBS o el grabador de Windows.

## Constraints transversales

- TS strict
- Aprueba operaciones no destructivas automáticamente
- Si te bloqueas más de 20 min en algo concreto, **ese sub-bloque se queda con la versión simplificada documentada como fallback** y sigues. NO te quedes pegado.
- Mantén el motor existente intacto. Sprint 2A lo dejó funcional, no lo toques salvo lo que pide explícitamente Bloque D (Discovery).
- Cada commit grande con mensaje descriptivo. Al final, push a `main`.

## Process

1. Crea una rama `phase-3-2B-phase-4-final` antes de empezar para protegerme de meter mierda en main si algo se cae
2. Trabaja por bloques en el orden A → B → C → D → E → F
3. Al final de cada bloque, commit con tag y `mem_save`
4. Después de Bloque B, ejecuta una generación end-to-end de prueba para verificar que las animaciones nuevas se enganchan bien con los eventos reales
5. Después del Bloque C, prueba ambas demos cacheadas en `/discover`
6. Antes del Bloque E (deploy), verifica que `pnpm build` funciona local sin errores
7. Si todo va bien, merge a `main`. Si algo se cae, déjalo en la rama y avísame

## When you're done

Reply con:
- Tiempo total invertido
- Bloques completados / con fallback / saltados
- URL de Vercel si el deploy fue
- Path del vídeo de respaldo
- Capturas (descripción textual) de los 6 agentes con sus animaciones firma activas
- Cualquier desviación con justificación
- **Y una sección "Cómo demostrar a la profe en 5 minutos"** con el orden recomendado de qué enseñar

Begin.
