# Atelier — Phase 3 kickoff: el espectáculo

Phase 2 está validada con asterisco — el motor de agentes funciona end-to-end, genera 112 archivos de Clean Architecture en 40 min, y el QA Reviewer detecta violaciones correctamente. Ahora viene la fase que convierte esto en una demo cinematográfica.

Lee antes de empezar:
- `PRD_BUILDER.md` (especialmente §4 Screen 2 Studio, §10 Phase 3)
- `ARCHITECTURE_BLUEPRINT.md` para entender qué reglas se validan
- Todo lo guardado en engram bajo `sdd/projecto/phase-2/*` para entender el estado actual

## Acceptance criterion

Cuando un usuario pulsa "Build it" en /discover:

1. La generación tarda 10-15 minutos en lugar de 40, gracias a paralelización + modelos más baratos para tareas mecánicas
2. La pantalla Studio es **cinematográfica**: ningún momento de pausa visual aburrida, todo el tiempo hay algo pasando
3. Cada agente tiene **personalidad visual distintiva** que ayuda a entender qué hace
4. Cuando el QA Reviewer detecta violaciones, **vuelve atrás al agente culpable y le pide arreglar**, hasta 3 reintentos por ciclo
5. El estudio sigue siendo legible, no abrumador. Detalles por todas partes pero con jerarquía visual

## Paleta y dirección artística

```
Background base:      #0a0e1a   (negro azulado profundo)
Background elevated:  #0f1424   (cards, paneles)
Border subtle:        #1f2937 / 8% opacity
Border active:        #8b5cf6 / 60% opacity
Text primary:         #e5e7eb
Text secondary:       #9ca3af
Text muted:           #6b7280

Accent primary:       #8b5cf6   (violeta — agente activo, pulse, focus)
Accent secondary:     #3b82f6   (azul eléctrico — handoffs, conexiones)
Accent gradient:      linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)

Success:              #10b981   (verde menta — done states, QA OK)
Warning:              #f59e0b   (ámbar — fix loop activo)
Error:                #ef4444   (rojo — failed, abortado)

Glow effects:
  Active node:        radial-gradient(closest-side, #8b5cf640 0%, transparent 70%)
  Handoff trail:      radial-gradient(closest-side, #3b82f660 0%, transparent 60%)
  QA scanner:         linear-gradient(90deg, transparent 0%, #8b5cf680 50%, transparent 100%)

Typography:
  Body:               Inter
  Mono:               JetBrains Mono (para código, terminales, contadores)
  Display:            Inter tight (para HUD numerals)
```

**Filosofía visual:** menos Apple, más Vercel. Bordes finos, tipografía técnica, glow sutil en elementos activos. Profundidad por capas (`backdrop-blur` en paneles flotantes, sombras en cards activos), no por ornamento. Transiciones de easing custom (cubic-bezier), no `ease` por defecto.

## Personalidad de cada agente

Cada nodo del Studio es una `motion.div` con un **componente firma** que aparece cuando ese agente está activo. Cada uno con su animación característica.

### 1. Architect — el cartógrafo

- **Icono base:** `IconCompass` de Tabler
- **Cuando arranca:** la aguja del compass empieza a girar lentamente
- **Mientras trabaja:** alrededor del nodo aparecen líneas SVG dibujándose tipo blueprint técnico (rectángulos, conexiones, texto pequeño "ENTITY", "USE CASE"). Las líneas se dibujan con `stroke-dasharray` animado tipo "drawing path"
- **Mini-terminal:** estilo plano arquitectónico, fondo papel envejecido sutil, fuente JetBrains Mono. Texto: `> Identifying entities... 4 found`, `> Mapping use cases... 17 mapped`
- **Color firma:** violeta puro `#8b5cf6`
- **Sonido (si on):** suave "click" mecánico de instrumento de medición
- **Cuando termina:** el compass apunta hacia el siguiente nodo (Domain) y se queda fijo

### 2. Domain & Persistence — el constructor de cubos

- **Icono base:** `IconCube` o `IconDatabase` de Tabler
- **Cuando arranca:** sobre el nodo flotan 3-5 cubos translúcidos en wireframe que rotan en 3D (CSS `transform: rotateX rotateY`)
- **Mientras trabaja:** los cubos se ensamblan formando una estructura más compleja. Cuando se crea una entidad, un cubo nuevo aparece con un "snap" visual. Cuando se conectan, una línea las une. Visualmente tipo construir un grafo de entidades en directo
- **Mini-terminal:** fondo más oscuro tipo psql, fuente JetBrains Mono verde fósforo tenue. Texto: `CREATE TABLE bookings (...)`, `INDEX idx_bookings_user_id`
- **Color firma:** azul `#3b82f6` con glow violeta sutil
- **Sonido (si on):** "thunk" satisfactorio cada vez que un cubo encaja
- **Cuando termina:** la estructura de cubos se solidifica y queda como mini diagrama de entidades dentro del nodo

### 3. Use Cases — los engranajes

- **Icono base:** `IconSettings` o `IconCog`
- **Cuando arranca:** 2-3 engranajes empiezan a girar a velocidades distintas alrededor del nodo
- **Mientras trabaja:** por cada use case generado, un nuevo engranaje pequeño aparece y se conecta a los demás. Los engranajes giran en cadena (cuando uno gira, los conectados giran al revés)
- **Mini-terminal:** estilo terminal técnica clásica, prompt `$ `. Texto: `→ createBooking(userId, classId)`, `→ cancelMembership(membershipId)`
- **Color firma:** violeta-azul gradiente
- **Sonido (si on):** zumbido mecánico suave continuo
- **Cuando termina:** los engranajes desaceleran y quedan girando lentos, sincronizados

### 4. Auth & RBAC — el escudo

- **Icono base:** `IconShield` o `IconLock`
- **Cuando arranca:** un escudo SVG aparece con bordes translúcidos. Dentro del escudo, líneas geométricas tipo circuit board se iluminan
- **Mientras trabaja:** por cada rol detectado, un anillo concéntrico aparece dentro del escudo. Por cada ability, un punto de luz en el anillo correspondiente. Visualmente jerárquico
- **Mini-terminal:** estilo log de seguridad. Texto verde sobre negro: `[AUTH] role=admin abilities=14`, `[CASL] can('manage', 'all')`
- **Color firma:** violeta con destellos blancos
- **Sonido (si on):** "click" metálico de cerrojo cuando se asigna una ability
- **Cuando termina:** el escudo se sella con un flash blanco breve

### 5. API & Frontend — el tejedor

- **Icono base:** `IconLayout` o `IconLayoutGrid`
- **Cuando arranca:** una rejilla de líneas finas aparece sobre el nodo
- **Mientras trabaja:** por cada endpoint, una línea horizontal nueva en la rejilla. Por cada página, un rectángulo en una columna distinta. Tipo wireframe de pantallas montándose en directo. Las líneas tienen un sutil flow animado (gradient que se mueve)
- **Mini-terminal:** estilo navegador inspector. Texto: `POST /api/bookings — 200`, `GET /api/classes/[slug] — 200`
- **Color firma:** azul más cálido con violeta
- **Sonido (si on):** "tick" suave de máquina de escribir cada vez que aparece una línea
- **Cuando termina:** la rejilla queda como un mini wireframe estático del frontend generado

### 6. QA Reviewer — el escáner

- **Icono base:** `IconShieldCheck` o `IconChecks`
- **Cuando arranca:** una línea de luz horizontal (scanner laser) aparece en la parte superior del nodo
- **Mientras trabaja:** **el scanner recorre TODOS los demás nodos del Studio de izquierda a derecha**, dejando un trail violeta. Cada nodo escaneado parpadea brevemente. Encima de cada nodo aparecen badges con resultados: ✓ verde si OK, ⚠ ámbar si warning, ✗ rojo si error
- **Si encuentra error:** el scanner se detiene sobre el nodo culpable, pulsa rojo, y la pantalla del Studio entra en **modo Fix Loop** (ver siguiente sección)
- **Mini-terminal:** estilo report técnico. Texto: `tsc --noEmit ... ✓`, `eslint ... ✓`, `dependency-cruiser ... ✓`, `vitest run ... ✓`
- **Color firma:** verde menta cuando va bien, ámbar cuando detecta warnings, rojo si error
- **Sonido (si on):** zumbido del scanner suave + "ping" alto cuando completa

## El Fix Loop visual

Esto es **una de las cosas que mejor van a quedar** en la demo.

Cuando QA detecta un error y solicita fix:

1. **Zoom suave** del Studio hacia el nodo culpable. Los demás nodos se atenúan al 30%
2. Una **línea de "energía" roja-ámbar** dibuja un arco desde QA hasta el nodo culpable. Tipo rayo que va y viene
3. El nodo culpable cambia su estado a `FIXING` con borde ámbar pulsante
4. Aparece un sub-panel con la lista de violaciones específicas que tiene que arreglar (de la `qaReport`)
5. El nodo vuelve a "trabajar" con su animación firma, pero el aura es ahora ámbar en lugar de violeta
6. Cuando termina, vuelve a QA con otra animación de arco
7. QA re-escanea (animación scanner sobre el nodo) y o bien:
   - ✓ verde → vuelve al modo normal, pasa al siguiente check o termina
   - ✗ rojo otra vez → reintento (máximo 3). Si llega a 3, termina la generación con `failed` y muestra error claro

Cada ciclo de fix se registra como Event `qa.fix_round` con número de intento y los Studio events corresponden a `agent.started_fix`, `agent.completed_fix`.

## Optimizaciones de tiempo (de 40 min a 10-15 min)

### Paralelización

Modificar el orchestrator para que ejecute en paralelo cuando sea seguro:

```
Architect (1 min) → Domain & Persistence (5 min)
                        ↓
                ┌───────┴───────┐
        Use Cases (8 min)  Auth & RBAC (3 min)    ← paralelos, ambos consumen DomainModel
                ↓               ↓
                └───────┬───────┘
                        ↓
                API & Frontend (15 min)
                        ↓
                QA Reviewer (8 min)
```

Use Cases + Auth & RBAC en paralelo ahorra 3 minutos. Más tarde, en API & Frontend, podríamos partir en API + Frontend separados pero hoy no — depende mucho uno del otro y aumenta complejidad.

### Modelos más baratos

Los agentes que no requieren razonamiento complejo pueden usar Sonnet 4 en lugar de Opus 4.7:

- **Architect** → Opus (necesita razonar arquitectura)
- **Domain & Persistence** → Sonnet (mecánico una vez tienes el plan)
- **Use Cases** → Opus (lógica de negocio)
- **Auth & RBAC** → Sonnet (mecánico)
- **API & Frontend** → Sonnet (volumen alto, baja complejidad por archivo)
- **QA Reviewer** → Opus (necesita razonar sobre violaciones)

Estimación: baja de 40 min a ~22 min antes de paralelización, ~15 min con paralelización.

Implementación: añadir un campo `model` en cada `<agent>.md` y leerlo en el runner para pasarlo como flag al subprocess de claude. Si el flag no se soporta nativamente en `claude` CLI, mantén Opus en todos por defecto y documenta que esta optimización requiere el SDK API.

### Streaming de logs token-por-token (opcional, alta valor visual)

El parser de `--output-format stream-json` que se intentó en Phase 1 hay que terminarlo. El usuario verá texto fluyendo dentro de cada mini-terminal, lo cual es enormemente más vivo que ver "..." durante 5 minutos.

Si esto sale demasiado costoso de tiempo, **alternativa low-cost**: simular el streaming. Cuando un archivo se crea, en lugar de mostrar `+ src/domain/users/entity.ts` de golpe, hacer typewriter del path letra a letra con cursor parpadeante (~50ms por carácter). Visualmente parecido al efecto real pero mucho más simple de implementar.

Para Phase 3 ve por la alternativa low-cost (typewriter simulado). Stream-json real lo dejamos como opcional si sobra tiempo.

## Detalles cinematográficos transversales

### HUD superior

Una barra fija en la parte superior con:

- **Timer** "MM:SS" en JetBrains Mono grande (24px), pulsa sutilmente cada segundo
- **Contadores** (archivos, líneas, tests) con animación slot-machine cuando incrementan: el nuevo número aparece desde abajo con `transform: translateY` mientras el viejo sale por arriba. Easing `cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot)
- **Phase badge** indicando qué fase está activa: "DESIGN", "BUILD", "VALIDATE". Cambia con un fade-blur

### Conexiones entre nodos

- Edges de React Flow customizados con SVG path
- En estado idle: línea gris fina (1px) `#1f2937`
- Cuando un agente activo tiene next agent, su edge tiene un **flow animation**: gradient `#8b5cf6` → `#3b82f6` que se mueve a lo largo del path con `stroke-dashoffset` animado
- En el momento de handoff: 5-8 partículas violeta-azul vuelan desde el nodo origen al destino (component custom con `position: absolute` + `motion.div` con keyframes)

### Code rain ambiental

- En el background del canvas (no encima de los nodos), líneas de código falso pero realista cayendo lentamente, opacidad 5%, fuente JetBrains Mono, color `#8b5cf6`
- 6-10 columnas, velocidades distintas
- El contenido son fragmentos de las reglas del blueprint mezcladas: `R8: repository pattern`, `R14: JWT in header`, etc.
- Solo activa cuando hay un agente trabajando, se desvanece en idle

### Glow ambiental detrás del nodo activo

- Un `radial-gradient` en `position: absolute` detrás del nodo trabajando, escala 1.5x el nodo, opacidad 0.4, color `#8b5cf6`
- Pulsa muy lentamente (3s ciclo) con `motion.div` animando opacity entre 0.3 y 0.5
- Cuando el agente cambia, el glow se mueve al nuevo nodo con `transition: layout` de Framer Motion (animación tipo "fluido")

### Transición del Studio al Reveal

Cuando todo termina con éxito y QA da OK final:

1. Todos los nodos pulsan en verde simultáneamente (1 segundo)
2. Los nodos se contraen hacia el centro con escala 0 + rotación leve, easing `cubic-bezier(0.7, 0, 0.84, 0)` (ease-in pronunciado)
3. En el centro queda un único punto de luz violeta-azul brillante por 0.3 segundos
4. **Big bang**: el punto explota en un flash blanco que cubre la pantalla, fade rápido
5. El flash se desvanece y el viewport ya está en `/reveal/[id]` con el nuevo contenido

Implementación: usar `framer-motion`'s `AnimatePresence` con `mode="wait"` y un overlay de transición.

### Sonido (toggle off por defecto)

Toggle en la esquina superior derecha del Studio (icono `IconVolume` / `IconVolumeOff`). Estado guardado en `localStorage`.

Sonidos a generar (todos cortos, 100-400ms, MP3 < 20KB cada uno):
- `tick.mp3` - "click" suave, para handoffs y nuevos archivos
- `swoosh.mp3` - aire desplazándose, para transiciones de fase
- `success.mp3` - "ding" cálido, cuando un agente completa
- `error.mp3` - "thud" grave, cuando QA detecta violación
- `complete.mp3` - acorde subido, transición a Reveal
- `scanner.mp3` - hum continuo en loop, para QA scanning

Si no quieres complicarte generándolos, busca en freesound.org bajo licencia CC0 o usa @tonejs/midi para generar tonos sintéticos.

Pre-carga todos los sonidos al montar el Studio (con `<audio preload="auto">`). Volumen al 30% por defecto. Si el usuario activa el toggle, fade-in suave del primer sonido.

## Mejoras al agente Discovery

Aprovechamos esta fase para subir el listón:

1. **Subir umbral READY_TO_BUILD**: ahora 3 entidades, 2 roles, 6 use cases. Subir a 4 entidades, 2+ roles, 8 use cases, **y por cada entidad al menos 3 fields documentados**
2. **Preguntas obligatorias por reglas de negocio** antes de READY:
   - Para cada use case crítico (cancelar, modificar, eliminar), Discovery debe preguntar las reglas: refunds, penalizaciones, ventanas de tiempo, permisos
   - Para cada entidad con relación a usuarios, preguntar permisos: ¿quién puede ver, modificar, borrar?
   - Para cualquier app que mencione fechas/horarios, preguntar: zonas horarias, conflictos
3. **Botón "Quiero seguir hablando"** junto al "Build it" cuando aparezca READY. Si el usuario lo pulsa, se le dice al agente "El usuario quiere profundizar más, haz 2-3 preguntas adicionales sobre aspectos no cubiertos aún"
4. **Indicador visual** del progreso del PRD: una barra que muestra "PRD madurez: 60%" basada en cuántos campos están rellenos vs. el ideal. Cuando llega a 100% se muestra el botón Build it. Antes de 100% solo está el botón "Quiero seguir hablando" (gris) y un texto "El agente sigue analizando tu idea"

## Constraints

- TypeScript strict, sin `any`. Animaciones sin sacrificar tipo.
- Framer Motion 11+ (ya está en deps). Para 3D / cubos rotando: usar transformaciones CSS planas (no Three.js — overkill).
- Performance budget: el Studio debe correr a 60fps en un MacBook Air M1. Si una animación tira el frame rate, simplificarla. `will-change: transform` en elementos animados, no en todos.
- Accessibility: `prefers-reduced-motion` debe deshabilitar las animaciones decorativas (mantén las funcionales). Toggle también en settings.
- Todas las animaciones de entrada/salida deben ser cancelables si el usuario navega rápido — usa `AnimatePresence` y `mode="wait"` cuando aplique.
- Sonidos: precarga, volumen 30%, respeta toggle.
- El fix loop debe ser robusto: max 3 reintentos por agente por generación, log claro de qué se intentó arreglar y qué no.
- Idempotencia del orchestrator: si el agente se desconecta a mitad, restart desde el último `AgentRun` con `status=done`.
- Cleanup: al final de cada generación, archivar el workDir en `out/<generationId>/` en lugar de borrarlo (para auditoría y para que Reveal pueda servir la app).

## Out of scope para Phase 3

- WebContainers en Reveal — Phase 4
- Monaco editor en Reveal — Phase 4
- Demos pre-cargadas como cache — Phase 4
- Edición incremental de generaciones existentes — Phase 5+
- Soporte multi-stack (Spring/FastAPI) — Phase 5+

## Process

1. `/sdd-new phase-3`. Decompose. Build.
2. Orden de implementación recomendado:
   1. **QA fix loop** primero — sin esto la demo puede salir mal y todo lo demás es maquillaje
   2. **Paralelización del orchestrator**
   3. **Bajar costes con Sonnet en agentes mecánicos** (si el CLI lo soporta)
   4. **Mejoras al Discovery**
   5. Visual: paleta y tokens base
   6. Visual: animaciones por agente (uno a uno, primero Architect como prototipo)
   7. Visual: HUD superior con slot-machine counters
   8. Visual: edges con flow + partículas en handoffs
   9. Visual: code rain ambiental
   10. Visual: glow ambiental que sigue al agente activo
   11. Visual: transición Big Bang al Reveal
   12. Sonido: toggle + preload + integración
   13. Tests: visual regression con Playwright para los estados clave del Studio
3. `mem_save` cada decisión clave.
4. Commits intermedios cada vez que pase un sprint visual.

## When you're done

Reply con:
- Video o GIF de una generación entera (lo grabas tú o un script con `puppeteer-screen-recorder`)
- Tiempo total de una Generation real con paralelización + Sonnet
- Cómo se comporta el fix loop en un caso real (forzando una violación si hace falta)
- Lista de las animaciones implementadas con un screenshot de cada una
- Métricas de performance: FPS medio durante una generación
- Cualquier desviación con justificación

Then stop. Phase 4 (Reveal con WebContainers + Monaco + demos cacheadas + deploy) es el siguiente paso.

Begin.
