# ROADMAP V3 — Atelier

> ⚠️ **Plan histórico** — `V3_PROGRESS.md` es la fuente de verdad actual del estado. Las desviaciones materiales se listan en la sección **Deviations** al final de este documento.

> Documento de planificación técnica para la siguiente iteración del sistema multi-agente Atelier. Se redacta tras la validación end-to-end de la versión 2 con el dominio yoga, y motivado por los hallazgos concretos detectados durante esa validación.

---

## 1. Resumen ejecutivo

Atelier v2 demostró que un sistema multi-agente orquestado por LLM puede generar aplicaciones full-stack arquitectónicamente correctas a partir de un único prompt de dominio. La validación E2E con yoga produjo 411 tests verde, typecheck limpio, lint limpio y dependencias sin errores. Sin embargo, al arrancar la aplicación generada en un entorno real (Postgres + Next.js dev server) emergieron tres categorías de bugs que ninguno de los cuatro gates de QA estáticos pudo detectar.

La versión 3 nace de un hallazgo claro: **los gates estáticos no son suficientes**. Una aplicación con tests unitarios verdes puede estar funcionalmente rota en runtime. Hace falta validación con la aplicación ejecutándose, con datos reales, simulando un usuario.

Esta v3 introduce siete cambios mayores:

1. Un **Bootstrap & DevOps Agent** que garantiza que el proyecto generado arranca sin intervención humana.
2. Un **Visual QA Agent** que prueba la app generada como cliente y admin reales, con clicks y scrolls.
3. **Cuatro nuevos agentes de diseño** que reemplazan al UX/UI Designer monolítico de v2: Layout Architect, Brand Identity, Animation Choreographer, Accessibility Agent.
4. Integración con **MCPs externos** para diseño y componentes: Stitch (motor principal de diseño visual), shadcn MCP, Tweakcn, 21st.dev, Framer.
5. **Tres nuevos gates de QA** sobre los cuatro existentes: runtime smoke test, visual regression, flow validation E2E.
6. Un **Seeds & Fixtures mejorado** con datos abundantes, variados y casos edge.
7. **Reorganización del esquema de waves** del orchestrator para acomodar el nuevo pipeline.

El objetivo final: con un único prompt de dominio, generar aplicaciones funcionales, estéticas y completas que un usuario humano puede probar de inmediato sin encontrarse con errores 500 ni datos que no cargan.

---

## 2. Hallazgos de la validación E2E de v2

Durante la validación con yoga se ejecutaron 9 corridas iterativas hasta alcanzar FINAL GO. La generación atravesó las 6 waves con 16 agentes y produjo el código completo de la aplicación. Los gates estáticos pasaron: typecheck cero errores, lint cero errores, format verde, deps cero errores, tests 411 passed.

Al intentar arrancar la aplicación generada se detectaron los siguientes bugs:

### 2.1 Bug clase A — Inconsistencia de nombres entre agentes

El agente Auth Security definió en su artifact que el JWT secret debía leerse de la variable de entorno `AUTH_JWT_SECRET`. El agente Service Layer, sin embargo, generó código que también usa esa variable, pero al generar el `.env.example` el sistema escribió `JWT_SECRET` en lugar de `AUTH_JWT_SECRET`. Resultado: la aplicación arrancaba, pero cualquier request que tocara el TokenService devolvía error 500 con mensaje *"AUTH_JWT_SECRET is not configured"*.

**Naturaleza del bug**: contrato implícito entre agentes que no estaba formalizado en ningún schema validable.

### 2.2 Bug clase B — Endpoint llamado por frontend, no creado por backend

El agente Frontend Architect generó código cliente que llama a `/api/classes/public` y `/api/auth/me`. El agente API Backend solo creó `/api/classes/[slug]`. Resultado: la pantalla de listado de clases queda en estado de error permanente con mensaje *"No pudimos cargar las clases"*, y el contexto de autenticación nunca puede resolver el usuario actual.

**Naturaleza del bug**: descoordinación entre el contrato API que el frontend asume y el contrato API que el backend implementa.

### 2.3 Bug clase C — Hydration mismatch

El componente ThemeToggle generado por el agente UI Components hace detección del tema actual del sistema en el primer render, lo que produce un valor distinto en servidor (donde no hay sistema) y en cliente (donde sí lo hay). React emite un warning de hydration mismatch en cada carga de página y el componente reinicia su estado.

**Naturaleza del bug**: falta de conocimiento por parte del agente UI Components sobre las particularidades de Next.js App Router con respecto a server vs client components y al ciclo de hydration.

### 2.4 Bug clase D — Inicialización del entorno

Independiente de los bugs anteriores, arrancar la aplicación requirió aproximadamente tres horas porque Prisma con adapter-pg en Windows con Docker Desktop tiene un bug conocido de autenticación cuando se conecta a Postgres en localhost. La solución final fue migrar a Postgres serverless en Neon. La aplicación generada en sí no podía hacer nada al respecto: no tenía mecanismo para detectar el entorno, verificar la conexión, ni sugerir alternativas.

**Naturaleza del bug**: la aplicación generada asume que el entorno está bien preparado, pero no incluye herramientas para diagnosticar ni recuperarse de problemas del entorno.

### 2.5 Bug clase E — Diseño incompleto

La pantalla de inicio de yoga no incluye header con navegación. El header existe en otras rutas porque está en `(public)/layout.tsx`, pero la home no se renderiza dentro de ese layout. El agente UX/UI Designer no especificó esta jerarquía con suficiente precisión y el agente Pages & Routing tomó decisiones que dejaron la home huérfana del layout público.

**Naturaleza del bug**: el UX/UI Designer monolítico es responsable de demasiadas decisiones (paleta, tipografía, layout, hero, brand voice, micro-interacciones, navegación) y algunas decisiones quedan implícitas o incompletas.

### 2.6 Síntesis

Estos cinco bugs comparten una característica: **ninguno se detecta sin ejecutar la aplicación**. Los gates estáticos validan que el código compila, que los tests unitarios pasan, que las dependencias son consistentes. No validan que un humano (o un agente que se comporte como humano) pueda usar la aplicación. Esa es la brecha que v3 cierra.

---

## 3. Arquitectura de v3: nuevos agentes

Atelier v3 mantiene la arquitectura general de v2 (orchestrator + waves + agentes + schemas + fix loop) pero añade siete agentes nuevos. Los agentes se reorganizan en siete waves en lugar de seis.

### 3.1 Bootstrap & DevOps Agent

**Posición en el pipeline**: Wave 1, entre Discovery y Architect.

**Responsabilidades**:

- Escanear el código que generarán los demás agentes (mediante análisis del PRD y del Discovery) y producir la lista exhaustiva de variables de entorno que la aplicación necesitará.
- Generar `.env.example` con todas esas variables, sus valores por defecto donde aplique, y comentarios explicando cada una.
- Generar `.env.local` con valores que funcionan en el entorno de desarrollo.
- Generar `docker-compose.yml` con servicios preconfigurados (Postgres principalmente) usando configuración robusta probada contra Docker Desktop en Windows, macOS y Linux.
- Generar scripts `setup.ps1` (PowerShell) y `setup.sh` (bash) que automatizan: levantar Docker, aplicar migraciones Prisma, ejecutar seed, verificar conexión, arrancar dev server.
- Producir un agente `check-environment` que la aplicación pueda ejecutar al arrancar para detectar entorno inválido y sugerir fixes (por ejemplo: si Postgres no responde, sugerir Neon como alternativa).
- Generar `README.md` con instrucciones paso a paso para que un humano arranque el proyecto en menos de cinco minutos.

**Contratos clave**:

- El Bootstrap Agent es el único agente autorizado a escribir variables de entorno. Cualquier otro agente que necesite leer `process.env.X` debe registrar `X` en el `env-manifest.json` que produce Bootstrap.
- El schema de Bootstrap incluye `env-manifest.json` con campos `name`, `required`, `defaultValue`, `description`, `consumedBy[]` (agentes que la usan), `producedBy` (servicio que la valida).
- Si un agente downstream usa una variable que no está en el manifest, el QA Reviewer emite violación con `severity: BLOCKER`.

**Resuelve los bugs clase A (inconsistencia de nombres) y clase D (inicialización del entorno).**

**Nota sobre enforcement de R0 (autoridad única).** La regla R0 del prompt
de Bootstrap declara que es el único agente autorizado a declarar variables
de entorno. Esa regla no descansa solo en la disciplina del agente: el QA
Reviewer del Wave 6 implementa un gate que escanea todo el código generado
buscando el patrón `process.env\.` fuera de `src/_shared/config/env.ts`.
Cada coincidencia emite una violación routada a `bootstrap-devops` con
`severity: error`, y el fix loop reinvoca al agente para añadir la variable
faltante al manifest. Esto cierra completamente el bug clase A: no hay
manera de que dos agentes acaben con nombres distintos para la misma
variable porque el segundo nunca consigue leerla directamente — el QA gate
lo fuerza a pasar por el manifest.

### 3.2 Layout Architect Agent

**Posición en el pipeline**: Wave 2, después de UX/UI Designer.

**Responsabilidades**:

- Decidir la arquitectura visual global de la aplicación: qué páginas existen, qué layout tiene cada página, qué elementos persisten entre páginas (header, footer, sidebar, breadcrumbs).
- Decidir la jerarquía de layouts en Next.js App Router: qué páginas están dentro de `(public)/layout.tsx`, qué páginas están dentro de `(dashboard)/layout.tsx`, qué páginas tienen layout propio.
- Decidir la composición de cada layout: en el header qué links aparecen, dónde va el toggle de tema, dónde el botón de empezar.
- Producir un artifact `layout-tree.json` con la estructura completa.
- **Conectarse con Stitch**: a partir del designVibe, del PRD y de la lista de páginas decidida, escribir el prompt arquitectónico que Stitch entiende para generar todas las pantallas de la aplicación.
- Recibir la respuesta de Stitch y parsearla: extraer estructura, jerarquía, espaciados, agrupaciones visuales. **No tomar el HTML literal**. Producir un artifact `stitch-analysis.json` con la decomposición.

**Contratos clave**:

- Toda página declarada por Pages & Routing en Wave 3 debe corresponder a una entrada en `layout-tree.json`. Si no corresponde, violación BLOCKER.
- El header generado por UI Components debe contener todos los links declarados en `layout-tree.json`. Si falta alguno, violación BLOCKER.
- La home page debe estar declarada explícitamente como dentro de `(public)/layout.tsx` o como standalone. No puede quedar ambigua.

**Resuelve el bug clase E (diseño incompleto, home sin header).**

### 3.3 Brand Identity Agent

**Posición en el pipeline**: Wave 2, en paralelo con Layout Architect.

**Responsabilidades**:

- Decidir el nombre de marca, tagline, voz, tono.
- Decidir el microcopy de toda la aplicación: textos de botones, mensajes de error, estados vacíos, placeholders, tooltips, confirmaciones.
- Decidir la paleta de colores final (los tokens concretos) a partir del designVibe del UX/UI Designer.
- Decidir la tipografía: familias, escalas, pesos.
- Producir `brand-identity.json` con todos estos elementos formalizados.
- Generar logo SVG simple si la aplicación lo necesita (o decidir explícitamente que se usa solo wordmark).

**Contratos clave**:

- Cualquier string visible al usuario en la aplicación debe provenir del `brand-identity.json` o del archivo de i18n que este agente produce.
- El UI Components Agent no puede hardcodear textos: debe consumirlos del manifest del Brand Identity.

**Resuelve la fragmentación de voz y la inconsistencia de microcopy que existe en v2.**

### 3.4 Animation Choreographer Agent

**Posición en el pipeline**: Wave 4, después de UI Components.

**Responsabilidades**:

- Decidir qué animaciones hay y dónde: transiciones entre páginas, animaciones de entrada de elementos, micro-interacciones de botones, scroll-driven animations, hover states sofisticados.
- Producir `animations.json` con cada animación: trigger, target, duration, easing, propiedades animadas, fallback para `prefers-reduced-motion`.
- Generar el código real de las animaciones usando Framer Motion (o tu librería preferida) e inyectarlo en los componentes correspondientes.
- Garantizar que ninguna animación rompe el flujo (no animar cosas que el usuario necesita pulsar, no animar formularios al teclear, etc).
- Validar que todas las animaciones respetan `prefers-reduced-motion`.

**Contratos clave**:

- Las animaciones se aplican como wrappers o props sobre componentes existentes. El agente no reescribe componentes.
- Toda animación debe tener fallback para accesibilidad.
- Las animaciones se documentan visualmente (cada una con un gif o descripción precisa en `animations.json`).

**Aporta el polish que el UX/UI Designer de v2 no producía.**

### 3.5 Accessibility Agent

**Posición en el pipeline**: Wave 5, después de Animation Choreographer.

**Responsabilidades**:

- Auditar la salida de UI Components y Forms Validations para verificar cumplimiento WCAG 2.1 nivel AA.
- Verificar contrastes de color sobre todos los pares (foreground, background) usados en la aplicación.
- Verificar que todos los elementos interactivos tienen estados de focus visibles.
- Verificar que todos los formularios tienen labels asociados.
- Verificar que las imágenes tienen `alt`.
- Verificar que la navegación con teclado funciona en todos los flujos críticos.
- Verificar que los roles ARIA son correctos y necesarios.
- Producir un `accessibility-audit.json` con findings clasificados como CRITICAL, MAJOR, MINOR.
- Para findings CRITICAL y MAJOR: emitir patches sobre los archivos involucrados y aplicarlos.

**Contratos clave**:

- Findings CRITICAL bloquean el GO. Findings MAJOR generan violations al fix loop. Findings MINOR se documentan pero no bloquean.
- El Accessibility Agent puede modificar archivos producidos por otros agentes. Es el único agente con esa capacidad post-hoc además del fix loop.

**Resuelve un gap completo de v2 donde la accesibilidad no se validaba.**

### 3.6 Visual QA Agent

**Posición en el pipeline**: Wave 7, después del QA estático tradicional y antes del FINAL GO.

**Responsabilidades**:

- Arrancar la aplicación generada en background (usando los scripts producidos por Bootstrap Agent).
- Esperar a que esté lista (polling de `/` hasta recibir 200 OK).
- Ejecutar dos suites de validación:
  - **Suite cliente**: comportamiento como usuario no autenticado y como usuario autenticado normal. Navega home, ve listados públicos, hace signup, hace login, completa el flujo principal de la aplicación (en yoga: ver clases, reservar; en tutorías: ver tutores, contactar).
  - **Suite admin**: comportamiento como administrador. Login con admin demo, accede al dashboard, lista entidades, crea una nueva, edita la existente, borra la creada.
- Cada paso del flujo está parametrizado por el dominio: el Visual QA Agent lee el PRD y el discovery para entender qué flujos existen y qué entidades manipula el admin.
- Capturar screenshot tras cada paso.
- Detectar errores de runtime: error 500, error 404 sobre endpoints internos, hydration mismatches, errores de consola que no son `console.warn`, requests fallidos en la network tab.
- Comparar screenshots con mockups de Stitch (cuando existen) para detectar regresiones visuales mayores.
- Producir `visual-qa-report.json` con: pasos ejecutados, screenshots, errores detectados, request log, console log.
- Para cada error detectado: emitir violación routada al agente responsable (404 sobre endpoint → API Backend; hydration mismatch → UI Components; layout roto → Layout Architect).
- El fix loop existente recoge esas violaciones y las arregla.

**Implementación técnica**:

- **Para flujos deterministas** (login, navegar a ruta concreta, click en botón con selector estable, rellenar formulario): **Playwright headless**. Es rápido, determinista, y los pasos los puede generar el propio Visual QA Agent leyendo el PRD.
- **Para evaluación más sutil** (¿este botón está bien alineado?, ¿este texto se sale del card?, ¿este color tiene contraste suficiente?): **Claude Vision sobre los screenshots**. Se llama a Claude con la imagen y un prompt de auditoría. Esto es Claude Code subprocess, no API, manteniendo la coherencia del stack v2.
- **Para auditorías reactivas a fallos** (cuando Playwright detecta un 500, capturar el contexto completo: stack trace, request, headers, body): el agente compone un reporte estructurado.

**Contratos clave**:

- Ningún FINAL GO se emite sin Visual QA verde.
- Visual QA es el único agente que ejecuta código de la aplicación generada, no solo lo analiza.
- Si la app no arranca, Visual QA emite violación CRITICAL routada a Bootstrap Agent.

**Resuelve los bugs clase A, B, C, D y E**. Es la pieza central de v3.

### 3.7 Seeds & Fixtures mejorado

**Posición en el pipeline**: Wave 5 (igual que en v2, pero con responsabilidades ampliadas).

**Responsabilidades nuevas respecto a v2**:

- Generar volumen realista: si la aplicación es para gestión de clases de yoga, no 6 clases sino 50; no 5 usuarios sino 30; no 3 reservas sino 200.
- Distribuir datos en el tiempo de forma natural: las clases del pasado, presente y futuro tienen distribución realista.
- Generar casos edge explícitos: un usuario suspended, una clase cancelled, una membresía exhausted, una reserva invalidated. Cada estado del dominio debe tener al menos un representante en el seed.
- Generar relaciones consistentes pero diversas: usuarios con múltiples membresías históricas, clases con teachers diferentes, reservas dispersas entre fechas y usuarios.
- Coordinar con Visual QA: el Visual QA Agent necesita saber qué entidades concretas existen en el seed para verificar que el admin puede editarlas. Seeds produce un `seed-manifest.json` con los identificadores de las entidades clave que Visual QA usará en sus scripts.

**Contratos clave**:

- Cobertura de estados: para cada enum del dominio, al menos un row en el seed con cada valor del enum.
- Identificadores estables: las entidades demo principales (admin, demo user, demo class, demo membership) tienen IDs fijos predecibles que Visual QA puede usar.

**Resuelve la insuficiencia de los datos demo de v2 y habilita la validación admin de Visual QA.**

---

## 4. Integración con MCPs externos

V3 introduce uso intensivo de MCPs para acercar la calidad del output al nivel de un equipo humano senior. Todos los MCPs se consumen desde subagentes Claude Code, no desde API directa.

### 4.1 Stitch (Google) — Motor principal de diseño visual

Stitch es la herramienta de diseño más capaz disponible: genera pantallas completas y multi-página desde un prompt. En v3 ocupa el rol de **generador maestro de diseño**.

**Cómo se usa en v3**:

- **Layout Architect** redacta el prompt arquitectónico para Stitch. El prompt incluye: tipo de aplicación, designVibe, lista de páginas a generar, descripción funcional de cada página, paleta de colores tentativa, tipografía tentativa, brand voice.
- Stitch genera todas las pantallas. La salida es HTML/CSS de alta calidad.
- **El HTML de Stitch no se usa literalmente**. Layout Architect parsea la salida y produce `stitch-analysis.json` con: estructura jerárquica, agrupaciones visuales, espaciados, tokens de color, tokens tipográficos, decisiones de layout.
- **UI Components Agent** consume `stitch-analysis.json` y codifica los componentes en la arquitectura real de Atelier: React + shadcn + Tailwind, con las convenciones de v2.
- El resultado: la aplicación se ve como Stitch la diseñó, pero está implementada con tu stack real, tus convenciones, tus tests.

**Limitaciones de Stitch que cubren otros agentes**:

- Stitch no genera animaciones complejas → Animation Choreographer
- Stitch no audita accesibilidad → Accessibility Agent
- Stitch no decide microcopy ni voz de marca → Brand Identity (que también informa al prompt de Stitch)
- Stitch no implementa funcionalidad real → toda la cadena backend + frontend de v2

### 4.2 shadcn MCP

Atelier v2 ya usa shadcn como librería de componentes base. En v3, el shadcn MCP permite al UI Components Agent:

- Consultar el catálogo completo de componentes shadcn actualizado.
- Importar componentes con un comando del MCP en lugar de copiar código manualmente.
- Pedir variantes (botón con loading state, dropdown con search, etc) que vienen pre-armadas.

### 4.3 Tweakcn

Tweakcn produce themes premium para shadcn (tokens de color y radius más sofisticados que los defaults). En v3, **Brand Identity Agent** consulta Tweakcn para obtener tokens de color que combinen bien con el designVibe decidido.

### 4.4 21st.dev

21st.dev es una librería de componentes UI premium. En v3, **UI Components Agent** consulta 21st.dev cuando shadcn no tiene un componente que el diseño requiere (por ejemplo: bento grid sofisticado, hero con animaciones específicas, pricing table con comparador).

### 4.5 Framer Motion (librería, no MCP)

Para animaciones, Framer Motion es la librería estándar en React. **Animation Choreographer** la usa para implementar todas las animaciones decididas. No hay MCP de Framer por ahora, pero la librería en sí es suficiente: el agente conoce su API y genera el código directamente.

### 4.6 Decisión sobre Figma

Figma MCP existe y permitiría importar diseños humanos hechos en Figma. **Se excluye explícitamente de v3** porque va contra la visión: Atelier debe generar la aplicación completa sin necesidad de diseño humano previo. Stitch reemplaza ese rol con generación automática.

---

## 5. Nuevos gates de QA

Atelier v2 tiene cuatro gates: typecheck, lint, tests, deps. En v3 se añaden tres más, ejecutados secuencialmente tras los cuatro existentes.

### 5.1 Gate 5 — Runtime smoke test

**Qué hace**: arranca la aplicación en background con los scripts de Bootstrap Agent. Espera a que `/` responda 200. Verifica que cinco rutas básicas (home, login page, signup page, una ruta protegida sin auth devuelve 401, una ruta pública devuelve 200) responden lo esperado.

**Quién lo ejecuta**: el orchestrator, antes de pasar a gate 6.

**Si falla**: violación routada a Bootstrap Agent o al agente API Backend según el tipo de fallo.

### 5.2 Gate 6 — Visual regression

**Qué hace**: para cada página principal generada, captura screenshot. Compara con los mockups de Stitch correspondientes mediante pixel diff con tolerancia (las diferencias menores son aceptables, las grandes no).

**Quién lo ejecuta**: Visual QA Agent en modo screenshot-only.

**Si falla**: violación routada a UI Components o Layout Architect según el tipo de regresión.

### 5.3 Gate 7 — Flow validation E2E

**Qué hace**: ejecuta las suites cliente y admin completas con Playwright. Pasa si todos los flujos completan sin errores 500, sin 404s sobre endpoints internos, sin hydration mismatches, sin errores en consola.

**Quién lo ejecuta**: Visual QA Agent.

**Si falla**: violaciones individuales routadas según el origen (404 → API Backend, hydration → UI Components, layout incompleto → Layout Architect, datos no cargan → Service Layer o Persistence).

### 5.4 Estrategia general de los gates

El principio se mantiene: cada gate produce violaciones que el fix loop intenta resolver. La diferencia es que ahora los gates 5, 6, 7 detectan **bugs de runtime**, lo cual cierra completamente la brecha que motivó v3.

---

### 5.5 Protocolo de validación incremental wave-por-wave

V2 demostró que correr el pipeline entero y validar al final es inadecuado: una corrida puede terminar en FINAL GO con todos los gates verde y aún así tener bugs runtime detectables solo al arrancar la aplicación. V3 introduce un modo de validación incremental que pausa entre waves para permitir intervención humana cuando se desea.

#### Modo `--step-by-step`

El orchestrator acepta el flag `--step-by-step` que cambia su comportamiento de "correr todo de un tirón" a "correr una wave, pausar, mostrar artifacts, esperar aprobación humana".

Cuando una wave termina, el orchestrator:

1. Imprime en consola un resumen estructurado y legible de los artifacts producidos por esa wave (no JSON crudo, formato humano).
2. Para wave 2 (diseño): renderiza los mockups de Stitch que Layout Architect ha consumido, junto con la paleta, tipografía y microcopy decidido por Brand Identity. Permite ver lo decidido antes de codificar.
3. Para wave 4 (frontend): produce un report HTML temporal con cada componente generado en un sandbox aislado (storybook-like) para que el humano pueda revisar visualmente.
4. Para wave 7 (visual QA): produce un report con todos los screenshots tomados, los logs de errores capturados, y el detalle de qué flujos pasaron y cuáles no.
5. Espera input humano mediante uno de tres comandos:
   - `atelier approve <wave>`: aprueba la wave y procede a la siguiente.
   - `atelier reject <wave> --reason "texto explicando qué cambiar"`: rechaza la wave, regenera SOLO esa wave con el feedback humano como contexto adicional, vuelve a pausar.
   - `atelier inspect <wave>`: imprime detalle adicional sin tomar decisión, permite explorar antes de decidir.

#### Regeneración granular en rechazo

Cuando el humano rechaza una wave, el orchestrator:

- Conserva intactos los artifacts de las waves anteriores aprobadas.
- Descarta los artifacts de la wave rechazada.
- Re-ejecuta solo los agentes de esa wave, inyectándoles en el contexto el motivo del rechazo del humano y los artifacts anteriores que ya están aprobados.
- Vuelve a pausar tras terminar.

Si el rechazo de una wave invalida lógicamente waves anteriores (por ejemplo: el humano rechaza wave 2 diciendo "quiero un dominio de e-commerce, no de yoga", lo cual invalida el Discovery), el orchestrator detecta la incompatibilidad y propone regenerar también las waves anteriores afectadas, pidiendo confirmación.

#### Modo `--auto` por defecto

Si el flag `--step-by-step` no se proporciona, el orchestrator se comporta como en v2: corre todo de un tirón, gates se ejecutan al final, fix loop intenta arreglar. Este modo se mantiene para iteraciones rápidas y para CI/CD.

#### Recomendación de uso

La recomendación operativa es:

- **Primera generación de un dominio nuevo**: siempre `--step-by-step`. El humano valida cada wave antes de gastar tokens en la siguiente. Esto previene quemar 1h de generación por una decisión arquitectónica mal tomada en wave 1 que invalida todo lo de después.
- **Iteraciones posteriores sobre el mismo dominio**: `--auto`, fiándose del fix loop, porque las decisiones de diseño ya están validadas.
- **Validación de la propia v3 sobre dominios de prueba**: `--step-by-step` siempre, para que el equipo humano pueda detectar regresiones del sistema multi-agente en cada punto del pipeline.

#### Comparativa de modos

| Aspecto | Modo v2 (auto) | Modo v3 step-by-step |
|---|---|---|
| Intervención humana | Solo al final | En cada wave |
| Detección temprana de problemas | No | Sí |
| Coste de tokens si algo va mal | Alto (toda la corrida) | Bajo (solo hasta el rechazo) |
| Tiempo total | Más rápido si todo va bien | Más lento pero más seguro |
| Adecuado para | CI, iteraciones | Primera generación de dominio |

Este protocolo aborda directamente la preocupación de que "v2 parece que va todo pero al final fallan cosas". En v3 las cosas no fallan al final porque cada paso se valida en su momento, no después de horas de generación.

---

## 6. Cambios al orchestrator y al esquema de waves

V2 tiene 6 waves y 16 agentes. V3 tiene 7 waves y 23 agentes.

```
Wave 1 — Discovery & Architecture
  - Discovery Agent (existente)
  - Architect Agent (existente)
  - Bootstrap & DevOps Agent (NUEVO)

Wave 2 — Design & Domain
  - UX/UI Designer Agent (existente, simplificado)
  - Layout Architect Agent (NUEVO)
  - Brand Identity Agent (NUEVO)
  - Domain Modeler Agent (existente)

Wave 3 — Backend Foundation
  - Persistence Agent (existente)
  - Auth Security Agent (existente)
  - RBAC Authorization Agent (existente)
  - Service Layer Agent (existente)
  - API Contract Agent (existente)
  - API Backend Agent (existente)

Wave 4 — Frontend Foundation
  - Frontend Architect Agent (existente)
  - UI Components Agent (existente, ahora consume stitch-analysis)
  - Pages Routing Agent (existente, ahora consume layout-tree)
  - Forms Validations Agent (existente)
  - Animation Choreographer Agent (NUEVO)

Wave 5 — Data & Polish
  - Seeds & Fixtures Agent (existente, ampliado)
  - Tests Writer Agent (existente)
  - Accessibility Agent (NUEVO)

Wave 6 — Static QA
  - QA Reviewer Agent (existente)
  - Gates: typecheck, lint, tests, deps

Wave 7 — Runtime QA
  - Visual QA Agent (NUEVO)
  - Gates: runtime smoke test, visual regression, flow validation
```

### 6.1 Fix loop ampliado

El fix loop de v2 solo enruta violaciones a agentes que producen código. En v3 también enruta violaciones a:

- **Bootstrap Agent** (cuando hay env vars mal documentadas, cuando docker-compose falla, cuando la app no arranca).
- **Layout Architect** (cuando una página carece de layout o tiene layout incorrecto).
- **Brand Identity** (cuando un texto hardcodeado debería venir del manifest).
- **Animation Choreographer** (cuando una animación rompe accesibilidad).
- **Accessibility Agent** (cuando una nueva regresión introduce un finding CRITICAL).

### 6.2 Modo orchestrator: skip y resume

V2 ya soporta skip y resume. En v3 se generaliza: cualquier wave puede saltarse si su artifact está presente en disco y valida contra schema. Esto es crítico porque las waves nuevas (Wave 7 especialmente) son costosas y queremos poder iterar sobre fixes sin re-generar diseño.

---

## 7. Skills custom propuestos

Claude Code soporta skills (paquetes con instrucciones especializadas). V3 introduce los siguientes skills custom que viven en `/skills/` del repositorio Atelier:

### 7.1 Skill `stitch-bridge`

Instrucciones precisas sobre cómo escribir prompts efectivos para Stitch y cómo parsear su salida. Usado por Layout Architect.

### 7.2 Skill `motion-design`

Buenas prácticas de motion design: cuándo animar, cuándo no, qué easings usar para cada tipo de transición, cómo respetar prefers-reduced-motion. Usado por Animation Choreographer.

### 7.3 Skill `brand-voice-writing`

Plantillas y ejemplos de microcopy efectivo para los estados comunes de aplicaciones SaaS: empty states, error states, success states, loading states, tooltips, placeholders. Usado por Brand Identity.

### 7.4 Skill `playwright-e2e-flows`

Patrones probados de scripts Playwright para flujos comunes: signup, login, CRUD de entidad, navegación entre roles, captura de errores de consola. Usado por Visual QA.

### 7.5 Skill `accessibility-audit`

Checklist completa WCAG 2.1 AA con código de detección para cada criterio. Usado por Accessibility Agent.

### 7.6 Skill `runtime-diagnostics`

Patrones de detección y resolución de problemas comunes de arranque: connection refused, env vars missing, port in use, dependencies missing, migrations not applied. Usado por Bootstrap y Visual QA.

---

## 8. Decisiones técnicas explícitas

### 8.1 Sin API de Anthropic, solo Claude Code subprocess

Todos los agentes y sub-agentes de v3 se ejecutan como subprocess de Claude Code con el plan Max, sin uso de la API directa. Esto preserva el modelo económico de v2 (subscription en lugar de pago por token) y mantiene la coherencia operativa.

### 8.2 Stitch via MCP, no via screenshot manual

El Layout Architect interactúa con Stitch programáticamente a través del MCP. No se pegan capturas manualmente. Esto garantiza reproducibilidad.

### 8.3 Visual QA usa Playwright + Claude Vision

- **Playwright** para clicks deterministas, asserts duros, captura de logs de red y consola.
- **Claude Vision** (a través de subprocess Claude Code analizando screenshots) para evaluación visual subjetiva y detección de problemas de layout que Playwright no puede expresar.

### 8.4 El admin demo es first-class

V2 ya tiene admin demo (`admin@demo.atelier / demo1234`). En v3 este admin es **first-class**: el Visual QA Agent siempre prueba el flujo admin, y el Seed Agent garantiza que existe data abundante que el admin pueda manipular.

### 8.5 Detección de stack incompleto

Si durante la generación se detecta que la aplicación necesita algo que ningún agente cubre (por ejemplo: pagos, emails transaccionales, file uploads, websockets), el orchestrator emite una nota explícita en el FINAL report. No falla, pero documenta la limitación. Esto es transparencia técnica que evita sorpresas.

---

## 9. Prompt de implementación para Claude Code

A continuación, el prompt que se le entregará a Claude Code (Max plan, sin `--bare`) para implementar v3 sobre la rama actual de v2. Este prompt se usa **después de la defensa del TFG**, no antes. Durante la defensa, v3 se presenta como evidencia de hallazgos y plan de evolución.

---

**INICIO DEL PROMPT**

Estás trabajando sobre Atelier v2, un sistema multi-agente generador de aplicaciones web full-stack. La versión 2 está completa, validada con yoga y tutorías, y residente en la rama `v2`. Tu tarea es implementar la versión 3.

El documento `ROADMAP_V3.md` en la raíz del repo contiene la especificación completa. Léelo en su totalidad antes de empezar. No improvises sobre lo que no está en el documento.

Objetivos de v3:

1. Añadir Bootstrap & DevOps Agent que garantice que el proyecto generado arranca sin intervención humana.
2. Añadir Visual QA Agent que pruebe la aplicación generada como cliente y como admin reales con Playwright y Claude Vision.
3. Descomponer el UX/UI Designer monolítico en cuatro agentes especializados: Layout Architect, Brand Identity, Animation Choreographer, Accessibility Agent.
4. Integrar MCPs externos: Stitch (motor de diseño), shadcn MCP, Tweakcn, 21st.dev. Sin Figma.
5. Añadir tres gates nuevos de QA: runtime smoke test, visual regression, flow validation E2E.
6. Ampliar Seeds & Fixtures para producir datos abundantes, variados y con casos edge cubiertos.
7. Reorganizar el orchestrator a siete waves en lugar de seis.

Restricciones operativas:

- Todos los agentes son subprocess de Claude Code, plan Max, sin `--bare`. No usar la API de Anthropic directamente.
- Mantener compatibilidad hacia atrás con v2: el motor v2 sigue funcionando, v3 es opt-in mediante flag `--v3` en el orchestrator.
- Cada nuevo agente tiene su prompt en `/prompts/v3/<agent>.md`, su schema en `/schemas/v3/<agent>.zod.ts`, y su artifact se guarda en `.atelier/<artifact>.json` igual que en v2.
- Cada nuevo skill custom vive en `/skills/<skill-name>/SKILL.md` con sus ejemplos.
- Crear un fixture nuevo `restaurant-prd.json` para validar v3 contra un dominio que v2 no ha tocado.
- Lanzar generación end-to-end del fixture restaurant con v3 activado, debe terminar en FINAL GO con todos los gates verde incluidos los nuevos.

Orden recomendado de implementación:

1. Bootstrap & DevOps Agent (resuelve los bloqueos más sangrantes de arranque).
2. Flag `--step-by-step` en el orchestrator y comandos `atelier approve|reject|inspect`. Esto entra temprano porque facilita validar todo lo demás.
3. Esquema de Wave 7 y Visual QA Agent versión Playwright-only (sin Claude Vision aún).
4. Tres gates nuevos integrados al orchestrator.
5. Layout Architect Agent con integración Stitch MCP.
6. Brand Identity Agent.
7. Animation Choreographer Agent.
8. Accessibility Agent.
9. Visual QA Agent versión con Claude Vision integrada.
10. Seeds & Fixtures ampliado.
11. Skills custom (en paralelo durante todo el proceso).
12. Validación E2E con fixture restaurant en modo `--step-by-step`, wave por wave, sin pasar a la siguiente hasta aprobación.
13. Re-validación de yoga y tutorías para asegurar no-regresión.

Para cada agente nuevo, antes de codificar:

- Leer en el ROADMAP la sección correspondiente.
- Diseñar el schema Zod del artifact.
- Diseñar el prompt del agente (estilo v2: rol, contexto, inputs, deliverables, restricciones, formato de salida).
- Escribir 3-5 tests unitarios sobre el agente con fixtures sintéticos antes de integrarlo al orchestrator.
- Integrarlo al orchestrator detrás del flag `--v3`.
- Probarlo en dry-run completo antes de probarlo con LLM real.

Trabajas iterativamente. Reportas progreso cada wave. Si algo no está claro en el ROADMAP, paras y preguntas en lugar de improvisar.

**FIN DEL PROMPT**

---

## 10. Métricas de éxito de v3

V3 se considera completa cuando, sobre tres dominios distintos (yoga, tutorías, restaurant) en cleanup separado:

- La aplicación generada arranca con un único comando (`pnpm setup && pnpm dev`) en menos de cinco minutos sobre Windows, macOS y Linux.
- Los siete gates de QA pasan en verde en la primera corrida o tras un único ciclo de fix loop.
- Un humano puede completar el flujo cliente principal y el flujo admin principal sin encontrarse con error 500, error 404 sobre endpoints internos, hydration mismatch ni datos que no cargan.
- El diseño es comparable visualmente a aplicaciones SaaS contemporáneas de buena factura: tiene header, tiene navegación, tiene microcopy cuidado, tiene animaciones discretas pero presentes, tiene estados vacíos diseñados.
- La accesibilidad WCAG 2.1 nivel AA se cumple sin findings CRITICAL.

---

## 11. Trabajo futuro post-v3

V3 no es la versión final del sistema. Más allá de v3, hay decisiones que quedarán abiertas y que se documentan aquí para no perder el hilo:

- **Multi-tenancy nativo**: que las aplicaciones generadas soporten múltiples organizaciones desde el primer momento, no como añadido posterior.
- **Self-improving agents**: que el sistema aprenda de las violaciones que ha tenido que arreglar y ajuste los prompts de los agentes para evitarlas en futuras corridas.
- **Deploy agent**: que tras el FINAL GO la aplicación se despliegue automáticamente a Vercel o equivalente con Postgres en Neon, dominio, SSL, y todo configurado.
- **Branding wizard**: permitir al usuario customizar la identidad de marca tras la generación inicial, con regeneración solo de los artifacts afectados.
- **Plugin marketplace**: que los dominios verticales (e-commerce, SaaS B2B, marketplaces) tengan paquetes de agentes especializados encima del core.

Estas no son tareas de v3, pero forman el horizonte natural del proyecto.

---

## 12. Cierre

V3 es la consecuencia directa de lo aprendido en v2. No es ambición desordenada, no es feature creep. Es respuesta concreta a cinco clases de bugs identificados y reproducibles en la validación E2E del dominio yoga. Cada agente nuevo, cada gate nuevo, cada MCP integrado responde a un bug específico que v2 no detectó.

El sistema resultante mantendrá la arquitectura clara y modular de v2 pero cerrará la brecha entre "código sintácticamente correcto" y "aplicación funcionalmente operativa", completando el ciclo de validación end-to-end y acercando la calidad del output al nivel de un equipo humano senior trabajando con buenas prácticas.

---

## Deviations

Cambios materiales entre este plan y la implementación real. Para detalle por bug y verificación end-to-end, ver `V3_PROGRESS.md`.

1. **Stitch arch pivot — parse-and-rebuild → preserve literal HTML + Visual Adapter.** [§3.2, §4.1] dicen *"el HTML de Stitch no se usa literalmente; Layout Architect parsea (...); UI Components codifica los componentes en la arquitectura real"*. Código actual: el HTML se conserva literal en `.atelier/stitch-html/<slug>.html` y un agente Visual Adapter (NUEVO) lo transforma a JSX preservando look. Commits ea94c19, 4a2f10e, e8f5bc0.

2. **Brand Identity REDUCED.** [§3.3] dice que Brand Identity decide *"paleta de colores final (los tokens concretos) (...) tipografía: familias, escalas, pesos"*. Código actual: schema `brand-identity.schema.ts` solo expone `tentativePaletteHints` (un seed + vibeMood) y `tentativeFontHints` (sansSuggestion + displaySuggestion opcional). Stitch decide paleta y tipografía en el HTML; el Visual Adapter las preserva. El prompt mismo se titula *"REDUCED post-rework"*. Commit ea94c19.

3. **Visual Adapter — agente NUEVO no en plan.** [§6 esquema de waves] enumera Wave 4 con 5 agentes. Código actual: `wave-4-presentation` tiene 7 agentes incluyendo `visual-adapter` (que no aparece en el ROADMAP). El test `orchestrator-v3.test.ts:88` asserta `expect(counts.size).toBe(24)` — total real 24 agentes, no 23. Commit ea94c19.

4. **Font loading — 4 capas de defensa no documentadas.** [ROADMAP] no menciona estrategia de font loading. Código actual: capa 1 Stitch embebe `<link>` web fonts; capa 2 Layout Architect los declara en `stitch-analysis.pages[].linkedFonts[]`; capa 3 Visual Adapter los preserva en `app/layout.tsx`; capa 4 runtime-smoke-gate verifica HTTP 200 (pendiente cableado). Mencionado en `lib/agents/prompts-v3/visual-adapter.md:75`. Commit ea94c19.

5. **Schemas nuevos/modificados.** [ROADMAP] no enumera schemas con detalle. Cambios materiales actuales:
   - `layout-tree.schema.ts` añade `layoutCompositions: Record<group, { slots, sidebarPosition }>` (commit 0e4afd8, B10) + refinement R0 home-no-standalone + `requiresAuth`.
   - `stitch-analysis.schema.ts` añade `linkedFonts: URL[]`, `stitchHealth: clean|degraded`, `stitchAttempt: 0|1|2`.
   - `test-id-contract.schema.ts` `requiredOn` ahora three-variant (`layoutGroup`|`pageRoute`|`component`) con refinement de "al menos uno" (commit b080a7b, B2).
   - `page-adaptation.schema.ts` NUEVO — artifact del Visual Adapter, 5 tipos en `ADAPTATION_CHANGE_TYPES`.
   - `stitch-fixture.schema.ts` NUEVO — fixture attempt-aware para grabar Stitch.

6. **B1-B13 — bugs descubiertos en F3 no anticipados.** [§2] enumera 5 clases de bugs (A: env names, B: endpoints, C: hydration, D: bootstrap, E: home huérfana). El primer run real F3 destapó 13 bugs adicionales del orquestador + scanner + fixture (B1-B13) no anticipados. Documentados en `V3_PROGRESS.md` sección "F3 — Primer run real wave-1-2-design". Commits b080a7b → 49dbf05.

7. **Waves — 10 slices vs 7 wave-bloques.** [§6] describe 7 waves (Discovery&Arch, Design&Domain, Backend, Frontend, Data&Polish, Static QA, Runtime QA). Código actual: 10 dependency-ordered slices (`wave-1-discovery|bootstrap|planning`, `wave-2-design|domain`, `wave-3-app-security`, `wave-4-presentation`, `wave-5-data-tests`, `wave-6-static-qa`, `wave-7-runtime-qa`). Backend Foundation (ROADMAP Wave 3) está disuelto: persistence en `wave-2-domain`, auth+rbac+service-layer en `wave-3-app-security`, api-backend fusionado con frontend foundation en `wave-4-presentation`. `api-contract` resuelto como artifact emitido por `api-backend` (D1). Commit caa7c68.

8. **D2/D3 contract drift por Visual Adapter.** [§3.6] dice Visual QA *"comparar screenshots con mockups de Stitch para detectar regresiones visuales mayores"*, asumiendo que UI Components re-codifica desde stitch-analysis (causa de regresiones). Con Visual Adapter (`visual-adapter.md:9`) la regresión visual contra Stitch debería caer <5% por construcción. `visual-regression-scanner.ts` sigue siendo defensa pero la causa original (UI Components re-autora) está resuelta arquitecturalmente. Commits 7d140ac (scanner) + ea94c19 (pivot).

9. **seeds-fixtures rework pendiente.** [§3.7] describe ampliación con volumen 50/30/200 + casos edge + `seed-manifest.json` para coordinar con Visual QA. Código actual: el agente `seeds-fixtures` está en `wave-5-data-tests` pero NO tiene schema v3 ni prompt v3 (`lib/agents/contracts-v3/` y `lib/agents/prompts-v3/` no contienen entradas). El agente es v2-reused; la "ampliación" del §3.7 no está implementada.

11. **wave-4 sub-dividida — 7 agentes → 6 paralelos → 4 sub-waves secuenciales.** [§6 esquema de waves] describe Wave 4 como un bloque. Post-rework quedó como `wave-4-presentation` con 6 agentes concurrentes. El pre-flight de visual-adapter (antes de F3-run-10) descubrió que los 5 agentes v2-reused tienen una cadena productor→consumidor genuina de 5 niveles que NO puede correr concurrente (B-w4-2), `screens-map.json` decomposado sin alias (B-w4-1) y cero slots wave-4 en el runner (B-w4-3). Código actual: `WAVES_V3` divide wave-4 en `wave-4a-api` → `wave-4b-frontend-arch` → `wave-4c-components` → `wave-4d-routing-forms-adapter` (secuenciales; los 3 de 4d paralelizan). aliasFile `screens-map.json`→`layout-tree.json` como primer intento. `WAVES_V3` 10→13 slices, 23 agentes intactos. Commit e7a5bd3.

10. **animation-choreographer eliminado — agente fantasma.** [§6 23 → 24 → 23] El esquema de waves enumeraba un `animation-choreographer` en Wave 4 (que nunca tuvo prompt ni schema v3). Eliminado en commit 63d0f4b: Stitch + shadcn + Tailwind cubren animaciones; la única responsabilidad real (respetar `prefers-reduced-motion`) se movió a `bootstrap-devops` (`globals.css`, R11). Total agentes 23 (no 24). Motion routing (`client/motion/`, `useMotion*.ts`) → `ui-components`. El test `orchestrator-v3.test.ts` ahora asserta `counts.size === 23` y `wave-4-presentation` con 6 agentes.

12. **ui-components reducido a solo shadcn primitives (v3-native-lite).** [§3.4 / §6] describía UI Components generando todos los componentes visuales por área desde `componentSpecs`. Código actual: el Bloque B (~60-90 componentes por área) fue ELIMINADO — es el bug de re-autoría de diseño que el rework cierra (visual-adapter R0 renderiza desde HTML Stitch literal). `prompts-v3/ui-components.md` slim + `contracts-v3/components-catalog.schema.ts` reducido (solo `primitives[]`). Conserva los 17 shadcn primitives (visual-adapter R5 los necesita en disco). Cierra B-w4-6 para ui-components (ya no lee `screens-map.json`). Commit 0c08cc07.

13. **pages-routing eliminado — App Router absorbido por visual-adapter.** [§6 esquema de waves] enumeraba `pages-routing` como agente de Wave 4 (uno de los 17 v2 heredados). Código actual: ELIMINADO de v3 (v2 lo conserva). Overlap conflictivo con visual-adapter: ambos escribían los mismos `app/<route>/page.tsx` + `app/(group)/layout.tsx` en paralelo en wave-4d con semántica opuesta (B-w4-7, colisión de escritura). visual-adapter es ahora single owner de `app/*` (R11 metadata SEO + R12 special files + R13 política RSC/CC). Conteo de agentes **23 → 22** (16 v2 + 6 net-new). `violations-router-v3` rutea `app/**/page.tsx|layout.tsx` + special files → visual-adapter. B-w4-7 cerrado por construcción. Commit cf51f01c.

14. **wave-4 re-estructurada + R6 carve-out — forms canónicos montados, no hand-rolled (B-w4-9).** [§6 esquema de waves] El run F3-run-10d (`2026-05-16T16-15-35`) mostró que la vieja `wave-4d-routing-forms-adapter` corría `[forms-validations ‖ visual-adapter]` paralelos sin dependencia → visual-adapter no leía `forms-validations.json`, hand-rolleaba handlers y dejaba el `LoginForm` canónico huérfano. Código actual: `wave-4c-components-forms = [ui-components ‖ forms-validations]` (independientes), `wave-4d-adapter = [visual-adapter]` solo (convergencia downstream). R6 de `visual-adapter.md` reescrito como carve-out a R0: monta `client/components/forms/<Name>` reemplazando el `<form>` Stitch, preservando contenedor/estilos; nuevo change type `mounted-canonical-form`. `WAVES_V3` 13→13. Detalle completo en `V3_PROGRESS.md` "Cambios arquitecturales no-bug". Commits 8ad5e760 (A) + 70760dbe (B).

15. **visual-adapter — defensas R5 aplicadas (B-w4-11/12).** F3-run-11 validó el carve-out R6 funcionalmente (forms canónicos montados, cero hand-roll) pero `page-adaptations.json` salió schema-inválido (`outputPath`, `adaptationStatus:"adapted"`, changes sin rationale, keys inventadas) y el slot no validaba el artifact → falso-verde. Código actual: skeleton JSON pineado + prohibiciones explícitas en `visual-adapter.md` (capa pin), `validatePageAdaptations` wired al slot vía `assertArtifactsValid` (capa boundary — drift = reprompt/B12, no falso-verde), test de regresión field-specific (capa regresión). Deuda #23 (audit validators all v3 agents). Detalle en `V3_PROGRESS.md`. Commit ab97abd9.

16. **mountHint contract — forms-validations promovido v2→v3 (B-w4-13).** F3-run-12 validó B-w4-11/12 pero mostró varianza run-a-run: mismo prompt, run-11 montó 5 forms canónicos (lectura liberal), run-12 solo 2 (lectura literal `<form>`) → CreateBooking/CreateClass/Edit\* huérfanos. Código actual: NUEVO `contracts-v3/forms-validations.schema.ts` (v2 intacto) con `mountHint` required (`pageRoute`, `mountPattern` enum, `triggerHint?` condicional, `.strict()`); NUEVO `prompts-v3/forms-validations.md`; slot promovido a v3 + `validateFormsValidationsV3` wired; `visual-adapter.md` R6 ramifica por `mountPattern` (R6 inline / R6b trigger-dialog Dialog / R6c post-condition `count(mounted)===len(forms)`). Cierra deuda #23 para el slot forms-validations. Detalle en `V3_PROGRESS.md`. Commit (este pase).

17. **accessibility eliminado — agente fantasma (pre-flight wave-5).** [§6 esquema de waves] enumeraba `accessibility` en Wave 5. Mismo patrón que `animation-choreographer` (#10) y `pages-routing` (#13): nunca tuvo prompt (`prompts-v2/` ni `prompts-v3/`) ni schema v3 ni slot en el runner. Eliminado: shadcn primitives son accesibles por construcción, `bootstrap-devops` ya emite el CSS de `prefers-reduced-motion` (heredado de #10), Stitch genera markup semántico que visual-adapter preserva (R0). Conteo de agentes **22 → 21** (`AgentNameV3` + `AGENT_NAMES_V3` en `contracts-v3/agent-names.ts`, `AGENT_CONFIG_V3` `Record<AgentNameV3>` no-Partial, regla routing `docs/accessibility-audit.md`, docstrings, tests). Cierra deuda #22 (docstring `orchestrator-v3.ts:2` "23 agents" → "21 agents"). `orchestrator-v3.test.ts` ahora asserta `counts.size === 21` y `generatorAgentOrderV3` 21 entries. Commit (este pase).

18. **wave-5 sub-dividida en 5a/5b — anticipativa clase B-w4-9 (pre-flight wave-5).** [§6 esquema de waves] describía Wave 5 como bloque (`wave-5-data-tests = [seeds-fixtures ‖ tests-writer]`). El pre-flight detectó que `tests-writer` consume `seeds-fixtures.json` (su prompt: *"Wave 5, ya corrió antes que vos"*) → bug productor→consumidor intra-wave idéntico a B-w4-9 (visual-adapter ‖ forms-validations), aún no manifestado porque ningún run real llegó a wave-5. Fix preventivo simétrico con la bisección wave-4 (#11/#14): `wave-5a-seeds = [seeds-fixtures]` (dependsOn wave-4d-adapter) → `wave-5b-tests = [tests-writer]` (dependsOn wave-5a-seeds). `WAVES_V3` 13 → 14 slices (7 logical waves intactas), `dependsOn` de wave-6 → `wave-5b-tests`. Slots `seeds-fixtures`/`tests-writer` wirados con prompts v2 reusados, SIN validators (schema wave-5 TBD post-F3-run-14, deuda #23). Slice `wave-1-5` añadida. Detalle en `V3_PROGRESS.md`. Commit 1b677f20. **F3-run-14** validó wave-5 e2e con LLMs reales (5a→5b race cerrado, no regresión wave-4, 0 B-w5-X).

19. **Schemas + validators wave-5 — diseñados shape-first desde output real (cierra deuda #23 wave-5).** [§3.7] describía la "ampliación" de seeds-fixtures sin schema; los slots wave-5 quedaron wirados sin validator (#18, falso-verde latente clase B-w4-12). Código actual: NUEVOS `contracts-v3/seeds-fixtures.schema.ts` + `tests-writer.schema.ts`, diseñados desde el output REAL de F3-run-14 (no desde spec — el prompt v2 se reusa y el LLM varía contenido). `seededEntities`/`fixedCredentials`/`files[]` arrays de sub-objetos `.strict()`; `userDistribution` value-polimórfico `z.record(string, union[number, record-number])`; `constraints`/`verification` laxos `z.record`; refinement cross-field `counts.{unit+integration+e2e}===total`. Top-level SIN `.strict()` (lección #15/B-w4-11). Validators wirados a ambos slots vía `assertArtifactsValid` (traza `[boundary] ✓`). Verificado contra artefactos reales de run-14 (ambos VALID). Cierra deuda #23 para wave-5; quedan bootstrap-devops/ux-ui-designer/brand-identity/qa-reviewer. Detalle en `V3_PROGRESS.md`. Commit a9db17ec.

20. **wave-6 plumbing — slot qa-reviewer + slice wave-1-6 (mecánico, no asimétrico).** [§6 esquema de waves] enumera Wave 6 (qa-reviewer). El pre-flight lo flageó como posible asimetría (artifactFile `qa-report.json` ≠ agente, fix-loop `QaArtifactV3`). La inspección lo desmintió: artifactFile ≠ nombre de agente es la NORMA v2 (#13 y otros 13 slots), `bundleLoader` ya existe (layout-architect), el camino slot→runner→`r.outcome.artifact`→cast `QaArtifactV3` (orchestrator-v3.ts:740) + el fix-loop (L1072+) YA existen y son genéricos. Código actual: slot `{promptRel: prompts-v2/qa-reviewer.md, artifactFile: "qa-report.json"}` sin validators (schema TBD post-F3-run-15, shape-first — shape ya pineada informalmente en el prompt L173 + interface `QaArtifactV3`) + slice `wave-1-6` (= wave-1-5 + wave-6-static-qa; para en wave-6, NO wave-7 — wave-7+A2 será commit dedicado). Sin bundleLoader (output único). Detalle en `V3_PROGRESS.md`. Commit 27fcc9c5. **F3-run-15** murió antes de wave-6 (B-w5-1, abajo) — wave-6 sigue sin validar e2e.

23. **B-w4-14 — ui-components prompt JSON skeleton pin (casing convention) + forms-validations timeout bump preemptive.** [§3.4 / §6 ui-components] El prompt v3 reducido (post-`pages-routing` removal + `ui-components` reducido a solo shadcn primitives) listaba los 17 primitives textualmente y la R5 exigía "`primitives` DEBE incluir los 17 canónicos por nombre" — pero "nombre" era ambiguo entre **basename del archivo** (lo que el schema `REQUIRED_PRIMITIVES = ["dialog", "dropdown-menu", ...]` verifica) y **nombre React del componente** (`Dialog`, `DropdownMenu`). F3-run-19 (`2026-05-20T11-36-24`, HEAD `c2c080fc`) emitió los 22 primitives correctos PERO con `"name": "Button"` PascalCase; el schema refinement leyó la lista como "ninguno de los 17 está presente" y rechazó vía B-w4-5b boundary validator. NO era "falta lista" (ya estaba); era ambigüedad de casing. Código actual: `prompts-v3/ui-components.md` += sección "## Artifact JSON — shape EXACTO (B-w4-14 pin vinculante)" con JSON skeleton literal de los 22 primitives (lowercase kebab-case `name`), sección "Prohibiciones (B-w4-14)" con ejemplos right/wrong, R5 actualizada para referenciar el pin. NUEVO `contracts-v3/components-catalog.schema.test.ts` (3 B-w4-14 rejection cases FLAG C, incl. shape exacto extraído del workDir de run-19). `runner-generator-v2.ts`: bump preemptive `forms-validations` 18→24min (run-19: 876s = 81% del 18min cap, sibling de ui-components, mismo wave-4c). Schema INTACTO (cazó el drift correctamente). Maquinaria B-w4-5b validada (primer disparo real para ui-components: fast-fail accionable, cero falso-verde). Patrón consistente con #16 (B-w4-13 forms-validations) y #21 (B-w5-1 seeds-fixtures/tests-writer): prompt skeleton vinculante > relajar schema. Detalle en `V3_PROGRESS.md`. Commit (este pase).

22. **B-w6-1 — qa-reviewer promovido v2→v3 + bootstrap-devops extendido (R12) + D2 format rescue determinista.** [§6.1 Fix loop ampliado] describe el fix-loop pero no contempla dead-letter routing ni ejecutores deterministas post-loop. F3-run-16 (`2026-05-19T15-16-22`, `--slice wave-1-6`) destapó 2 patologías del fix-loop con la misma raíz operativa: (1) **dead-letter routing** — el prompt v2 de qa-reviewer ruteaba `app/**` → `pages-routing` (agente eliminado en #13); `eslint.config.mjs` no tenía regla en `violations-router-v3.ts`; el orchestrator caía a path-routing que también devolvía null → violation dropeada silenciosamente, 3 rondas iguales sin progreso; (2) **mecánico no-LLM-routeable** — `FormatError` repo-wide (145 archivos prettier) no tiene archivo concreto que asignar; el fix es un comando (`pnpm format`) no un patch LLM. Código actual: NUEVO `prompts-v3/qa-reviewer.md` (promoción v2→v3 con routing actualizado: `app/**`→`visual-adapter`, `eslint.config.*`+`prettier.config.*`+`.prettierrc*`→`bootstrap-devops`; sección "Format violations — special case" pin); `prompts-v3/bootstrap-devops.md` +**R12** (Fix-loop ownership extra de lint/format config, schema `bootstrap.ts:filesProduced` INTACTO — separación primer-emit vs owner-en-fix-loop); `violations-router-v3.ts` +3 reglas explícitas priority 10; NUEVO `lib/agents/runtime/format-rescue.ts` (`runDeterministicFormat(workDir)` spawn pnpm format con `shell:true` Windows-compat, timeout 120s, test seam `_spawn`); D2 rescue cableado en `orchestrator-v3.ts` post-fix-loop (si toda violation error es `FormatError` → run format → re-run qa con `fixRound:-1` sentinel; 3 eventos nuevos `format_rescue.started/completed/failed`); slot `qa-reviewer.promptRel` v2→v3 en `full-yoga-regen-v3.ts`. Trade-off Opción 2 documentado como **deuda #24**: relajar `@next/next/no-img-element` + `no-page-custom-font` es trade-off deliberado para ship wave-1-6+A2 mínimo; migración canonical `<img>→<Image>` + `<link>→next/font` queda con criterio de cierre explícito. FLAG B redux: eficacia REAL probada en F3-run-17. Detalle completo en `V3_PROGRESS.md`. Commit (este pase).

21. **B-w5-1 — seeds-fixtures + tests-writer promovidos v2→v3 con skeleton vinculante.** [§3.7] El prompt v2 de seeds-fixtures sub-especificaba el `## Schema del JSON` (sin runCommand/resetCommand/userDistribution/constraints). F3-run-15 emitió un artifact fiel a ese prompt v2 que el schema v3 (derivado de la shape rica de run-14) rechazó → `generation.failed` en wave-5a (relabel B-w6-1→B-w5-1: bug vive en schema wave-5, descubrimiento en run wave-1-6 incidental). Código actual: NUEVOS `prompts-v3/seeds-fixtures.md` + `prompts-v3/tests-writer.md` con `## Schema del JSON` reescrito como skeleton **vinculante y fiel al schema v3** (seeds: + runCommand/resetCommand flat, userDistribution, constraints; tests-writer: + generatedAt/runner/verification/notes/coverage.endpoints*) + secciones "Prohibiciones (B-w5-1)". Schemas v3 INTACTOS (el defecto era el prompt, no el schema). Slots `promptRel` v2→v3. Patrón B-w4-13 (contrato bidireccional prompt↔schema). FLAG 1: `contracts-v2/*` `.passthrough()` compartidos por scripts v2 → v2 NO se toca. Maquinaria B-w4-5b validada en real (primer disparo: falló limpio, sin falso-verde). Tests regresión FLAG C. Eficacia prompt v3 solo se prueba en F3-run-16. Detalle en `V3_PROGRESS.md`. Commit (este pase).
