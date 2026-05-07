# v2 prompts — notes & deferrals

Notas técnicas que afectan a múltiples agentes; documentadas acá para no
repetirlas en cada prompt y mantener consistencia entre Waves.

## Prisma 7

- Schema NO acepta `url = env("DATABASE_URL")` en el bloque `datasource`.
  La URL va en `prisma.config.ts` (`datasource.url`). Si la dejás en el schema,
  `prisma format` y `prisma generate` fallan con `P1012`.
- Output del generator: usar `output = "../src/_shared/infrastructure/db/generated"`
  (nunca apuntes a `node_modules`).
- Para `pnpm install` con argon2 / bcrypt nativos en workspaces, ver sección
  abajo.

## argon2 vs bcrypt en Windows (Auth & Security agent — Wave 3)

`argon2` requiere build nativo (node-gyp + MSVC). En Windows con WSL/Linux no
hay problema, pero en Windows nativo (la plataforma del usuario) el build
falla a menudo. **Mitigación**: el agente Auth & Security debe detectar la
plataforma y usar `bcrypt` (cost 12) cuando `process.platform === "win32"`,
fallback a `argon2id` en Linux/macOS. La interfaz `PasswordHasher` queda
agnóstica del backend.

Pattern aceptable:

```ts
// src/auth/infrastructure/security/PasswordHasher.ts
import bcrypt from "bcrypt";

export const PasswordHasher = {
  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  },
  async verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  },
};
```

Razón: en Camino 3 (v1) ya bcrypt funcionó verde en todos los gates.
argon2 es marginalmente más seguro pero no compensa el riesgo de build break.

## shadcn primitives (UI Components agent — Wave 4)

El skeleton-v2 ships con **5 primitives pre-instaladas** en
`client/components/ui/`: `button`, `card`, `input`, `label`, `badge`. Los
otros 16 los tiene que generar el UI Components agent. Lista exacta:

```
dialog, dropdown-menu, form, select, table, tabs, toast, sheet,
skeleton, alert, avatar, popover, tooltip, command, calendar, checkbox
```

Si la app generada no los necesita todos, omitir los que no usa. Pero al
menos `dialog`, `select`, `table`, `tabs`, `alert`, `tooltip`, `checkbox`
son universalmente requeridos por el subset Admin/Forms.

El UI Components agent puede:
1. Generar cada primitive escribiendo el archivo a mano (radix-ui + cva).
2. O ejecutar `pnpm dlx shadcn@latest add <primitive>` si está disponible.

Preferí (1) porque (2) es interactivo y rompe en runs no-TTY.

## Stop sentinels — formato canónico

Todos los sentinels v2 siguen el patrón:

```
<AGENT_NAME_UPPER_SNAKE>_DONE: <key>=<value>, <key>=<value>
```

Ejemplos:
- `ARCHITECT_DONE: features=4, pages=12, components=28`
- `UX_UI_DESIGNER_DONE: vibe=Calm, screens=8, components=19`
- `DOMAIN_MODELER_DONE: entities=4, errors=8`
- `PERSISTENCE_DONE: models=4, repositories=4`
- `SEEDS_SHAPE_DONE: users=16, entities_planned=3`

El runner busca la última línea que empieza con el prefix exacto. Si no la
encuentra, marca status='failed'.

## Castellano vs inglés

Convención fija para los 17 agentes:

- **Castellano** en: descripciones de pantallas (`purpose`), `description`
  de demo users, `personasHints`, business rules, JSDoc de archivos
  domain, mensajes de UI.
- **Inglés** en: nombres técnicos (`StatCard`, `BookingService`, no
  `TarjetaEstadística`), nombres de entidades, nombres de fields, nombres
  de errores, codes (`RESOURCE_NOT_FOUND`).

Razón: las apps generadas son código que se va a abrir/leer en cualquier
parte del mundo, mientras que el contenido visible al usuario final es
en castellano (los users de Atelier construyen apps en español).
