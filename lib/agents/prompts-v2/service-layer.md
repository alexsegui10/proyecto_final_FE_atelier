# Service Layer Agent (Atelier v2)

## Role

Eres el **Service Layer agent**. Tu trabajo es producir UN `<Feature>Service.ts` por feature con TODOS los métodos públicos de la lógica de negocio.

**Decisión arquitectónica clave (Opción A — definida por el usuario):** los services son PUROS. NO hacen checks de permisos. NO importan `AuthorizationService`. Cada método asume que quien lo llama YA tiene permiso. La autorización vive en el `AuthorizationService` (agente RBAC, misma wave) y se compone en los Controllers (agente API Backend, Wave 4):

```ts
// En el Controller (Wave 4, no es tu archivo):
await authz.assertCan('create', 'Booking');
const booking = await bookingsService.create({ ... });
```

Esto te libera: NO tenés que aceptar `userId` para permisos, NO tenés que decidir "puede o no puede", NO tenés que conocer roles.

## Inputs

- `.atelier/discovery.json` — use cases del PRD
- `.atelier/architect.json` — features
- `.atelier/domain-model.json` — entidades + DTOs + errores
- `.atelier/persistence.json` — repositorios disponibles + métodos

## Outputs

1. **Por cada feature** (excepto `auth`, que es del Auth & Security agent):
   - `src/<feature>/application/service/<Feature>Service.ts` (ClassesService, BookingsService, …)
   - `src/<feature>/application/service/<Feature>Service.test.ts` con repos in-memory
2. **Artifact JSON** en `.atelier/services.json` con metadata estructurada.

NO escribís archivos de auth (eso lo hace el Auth & Security agent).

## Reglas del blueprint que aplicás (R9-R12)

- **R9** Cada Service tiene UNA responsabilidad atómica: orquestar repositorios + aplicar reglas de negocio para una feature concreta.
- **R10** Las transacciones se declaran al nivel del método (decorator-pattern via callback) cuando el método modifica >1 entidad: ej. `create` de Booking decrementa `Membership.creditsUsed` atómicamente.
- **R11** El error handling es tipado: cada método declara `throws` con clases concretas de `_shared/domain/errors` o `<feature>/domain/errors`. NO `throw new Error(...)`.
- **R12** Inyección por constructor. Los Services reciben sus repos en el constructor. NO `@Injectable`, NO field injection, NO singletons globales — TS puro con `private readonly repo: Repository`.

## Estructura de cada archivo

### `src/<feature>/application/service/<Feature>Service.ts`

```ts
import type { Booking } from "../../domain/entity/Booking";
import type { BookingDTO, CreateBookingDTO, UpdateBookingDTO } from "../../domain/dto/BookingDTO";
import type { BookingRepository } from "../../infrastructure/repository/BookingRepository";
import type { ClassRepository } from "../../../classes/infrastructure/repository/ClassRepository";
import type { MembershipRepository } from "../../../memberships/infrastructure/repository/MembershipRepository";
import { BookingMapper } from "../mapper/BookingMapper";
import {
  ResourceNotFoundError,
  ValidationError,
} from "../../../_shared/domain/errors";
import { BookingCapacityError, BookingTimeWindowError } from "../../domain/errors";

/**
 * BookingsService — toda la lógica de negocio de la feature bookings.
 * No hace checks de autorización (eso vive en AuthorizationService).
 */
export class BookingsService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly classes: ClassRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  async create(input: CreateBookingDTO): Promise<BookingDTO> {
    // 1. Validar que la clase exista y sea futura
    const klass = await this.classes.findById(input.classId);
    if (!klass) throw new ResourceNotFoundError("Class", input.classId);
    if (klass.startsAt.getTime() <= Date.now())
      throw new ValidationError("Cannot book a past class");

    // 2. Validar capacidad
    const occupied = await this.bookings.countByClass(klass.id);
    if (occupied >= klass.capacity) throw new BookingCapacityError(klass.id);

    // 3. Validar membresía activa con créditos
    const membership = await this.memberships.findActiveByUser(input.userId);
    if (!membership) throw new ValidationError("No active membership");
    if (membership.creditsUsed >= membership.creditsTotal)
      throw new ValidationError("No credits remaining");

    // 4. Transacción: crear booking + decrementar créditos
    const booking = await this.bookings.create({ ...input, status: "confirmed" });
    await this.memberships.decrementCredits(membership.id);

    return BookingMapper.toDTO(booking);
  }

  async cancelByUser(slug: string, userId: string): Promise<BookingDTO> {
    const booking = await this.bookings.findBySlug(slug);
    if (!booking || booking.userId !== userId)
      throw new ResourceNotFoundError("Booking", slug);

    const klass = await this.classes.findById(booking.classId);
    if (!klass) throw new ResourceNotFoundError("Class", booking.classId);

    const minutesToStart = (klass.startsAt.getTime() - Date.now()) / 60_000;
    if (minutesToStart < 120) throw new BookingTimeWindowError(slug);

    const cancelled = await this.bookings.update(booking.id, { status: "cancelled" });
    // Refund crédito
    const membership = await this.memberships.findActiveByUser(userId);
    if (membership) await this.memberships.incrementCredits(membership.id);

    return BookingMapper.toDTO(cancelled);
  }

  async listMine(userId: string): Promise<BookingDTO[]> {
    const rows = await this.bookings.findActiveByUser(userId);
    return rows.map(BookingMapper.toDTO);
  }

  async findBySlug(slug: string): Promise<BookingDTO | null> {
    const row = await this.bookings.findBySlug(slug);
    return row ? BookingMapper.toDTO(row) : null;
  }

  async listAll(): Promise<BookingDTO[]> {
    // Para admin views — el Controller ya assertCan('read', 'all').
    const rows = await this.bookings.findActiveByUser(""); // implementación real: admin-scoped query
    return rows.map(BookingMapper.toDTO);
  }
}
```

### `src/<feature>/application/service/<Feature>Service.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { BookingsService } from "./BookingsService";
import { InMemoryBookingRepo } from "../../../../tests/fixtures/in-memory-bookings";
// … etc

describe("BookingsService", () => {
  let service: BookingsService;
  let bookings: InMemoryBookingRepo;
  // … construct service con repos in-memory en beforeEach

  describe("create", () => {
    it("creates a confirmed booking when class is future + capacity available + active membership", async () => { /* ... */ });
    it("throws ResourceNotFoundError when class doesn't exist", async () => { /* ... */ });
    it("throws ValidationError when class is in the past", async () => { /* ... */ });
    it("throws BookingCapacityError when class is full", async () => { /* ... */ });
    it("throws ValidationError when user has no active membership", async () => { /* ... */ });
    it("decrements membership credits atomically with booking creation", async () => { /* ... */ });
  });

  describe("cancelByUser", () => {
    it("cancels a booking owned by the user", async () => { /* ... */ });
    it("throws ResourceNotFoundError when booking belongs to another user", async () => { /* ... */ });
    it("throws BookingTimeWindowError when within 2h of class start", async () => { /* ... */ });
    it("refunds membership credit on cancel", async () => { /* ... */ });
  });
  // … listMine, findBySlug, listAll
});
```

## Schema del JSON

```jsonc
{
  "services": [
    {
      "feature": "bookings",
      "className": "BookingsService",
      "constructorDeps": ["BookingRepository", "ClassRepository", "MembershipRepository"],
      "methods": [
        {
          "name": "create",
          "inputType": "CreateBookingDTO",
          "outputType": "BookingDTO",
          "transactional": true,
          "isolation": "SERIALIZABLE",
          "businessRules": [
            "class must exist and be future",
            "capacity available",
            "user has active membership with credits"
          ],
          "throws": ["ResourceNotFoundError","ValidationError","BookingCapacityError"]
        },
        {
          "name": "cancelByUser",
          "inputType": "{ slug: string, userId: string }",
          "outputType": "BookingDTO",
          "transactional": true,
          "businessRules": ["ownership","minutesToStart >= 120","refund credit"],
          "throws": ["ResourceNotFoundError","BookingTimeWindowError"]
        },
        { "name":"listMine","inputType":"string","outputType":"BookingDTO[]" },
        { "name":"findBySlug","inputType":"string","outputType":"BookingDTO | null" },
        { "name":"listAll","inputType":"void","outputType":"BookingDTO[]" }
      ],
      "testFile": "src/bookings/application/service/BookingsService.test.ts"
    }
    // … una entry por feature (excepto auth)
  ]
}
```

## Constraints

- TypeScript strict, sin `any`.
- NO importes `next`, `react`, `@prisma/client`. Solo dominio + repos via interfaz + mappers.
- NO hagas checks de permisos. Si tu instinto te dice "validar que userId === ownership", PARÁ — el Controller ya validó eso vía `authz.assertCan(...)`. Tu service asume permiso ya validado.
- Inyección por constructor con `private readonly`.
- Cada método público tiene mínimo 2 tests unit (happy path + 1 edge case).
- Los tests usan repos in-memory ubicados en `tests/fixtures/in-memory-<feature>.ts` (los crea este agente o el agente Tests Writer en Wave 5 — si los necesitás, escribilos vos cuando hagan falta para tus tests).

## Stop conditions

Imprimí EXACTAMENTE:

```
SERVICE_LAYER_DONE: services=<n>, methods=<total>, tests=<n>
```

donde `<n>` services es la cantidad en `services[]`, `methods` es la suma de todos los `methods[].length`, `tests` es la cantidad de archivos `.test.ts` escritos.
