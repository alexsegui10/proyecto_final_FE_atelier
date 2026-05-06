# Emotiva Poli — Architecture Blueprint

A reverse-engineered, prescriptive blueprint of the developer's "house style" across the four services that make up *Emotiva Poli*: Spring Boot (primary backend), FastAPI (read-only auxiliary), Next.js (IA Gateway) and React + Vite (SPA client). Read this before generating any new feature; every rule is anchored to a concrete file in this repo.

---

## 1. Stack & versions

### Spring Boot service (`springboot_server/`) — primary backend
- **Language / runtime:** Java 17 (`<java.version>17</java.version>` in [springboot_server/pom.xml:22](springboot_server/pom.xml#L22)).
- **Framework:** Spring Boot **3.2.1** (parent pom in [springboot_server/pom.xml:8-12](springboot_server/pom.xml#L8-L12)).
- **Persistence:** Spring Data JPA + Hibernate (PostgreSQL 15 driver, runtime). Schema is owned by Flyway, NOT by Hibernate (`spring.jpa.hibernate.ddl-auto=validate` in [springboot_server/src/main/resources/application.properties:11](springboot_server/src/main/resources/application.properties#L11)).
- **Migrations:** Flyway 10.4.1 (`org.flyway:flyway-database-postgresql`), files in `src/main/resources/db/migration/`.
- **Security:** Spring Security 6 (Boot starter), **JJWT 0.12.5** (api/impl/jackson), **Argon2** via BouncyCastle 1.77.
- **Validation:** Bean Validation via `spring-boot-starter-validation` (Jakarta).
- **Stripe:** `com.stripe:stripe-java:25.3.0`.
- **Env loading:** `io.github.cdimascio:dotenv-java:3.0.0` — `Dotenv.configure().directory("./").ignoreIfMissing().load()`.
- **OpenAPI:** `springdoc-openapi-starter-webmvc-ui:2.3.0`.
- **Build:** Maven 3.9 (Dockerfile uses `maven:3.9-eclipse-temurin-17-alpine`, [springboot_server/Dockerfile:1](springboot_server/Dockerfile#L1)).
- **Bootstrap:** `@SpringBootApplication(scanBasePackages = {"com.emotivasport", "com.emotivapoli"})`, `@EntityScan(basePackages = {"com.emotivapoli"})`, `@EnableJpaRepositories`, `@EnableScheduling` ([springboot_server/src/main/java/com/emotivasport/springbootserver/Application.java:9-12](springboot_server/src/main/java/com/emotivasport/springbootserver/Application.java#L9-L12)).
- **Scripts:** `mvn spring-boot:run` for dev. Docker entry: `java -jar app.jar`.

### FastAPI service (`fastapi_server/`) — read-only auxiliary
Pinned exactly in [fastapi_server/requirements.txt](fastapi_server/requirements.txt):
- `fastapi==0.115.0`
- `uvicorn[standard]==0.32.1`
- `pydantic==2.10.3`
- `python-dotenv==1.0.1`
- `sqlalchemy==2.0.25`
- `psycopg[binary]==3.1.18` (DB driver: `postgresql+psycopg://...`)
- Python **3.11** (Dockerfile base).
- **No Alembic / no schema ownership.** Comment in [fastapi_server/main.py:8-9](fastapi_server/main.py#L8-L9): `# NO crear tablas - Spring Boot maneja las migraciones`.

### IA Gateway service (`ia_gateway_next/`) — Next.js
Pinned in [ia_gateway_next/package.json](ia_gateway_next/package.json):
- `next: 16.2.3` (App Router; **NOT** the Next.js you may know — see [ia_gateway_next/AGENTS.md](ia_gateway_next/AGENTS.md): "This version has breaking changes — APIs, conventions, and file structure may all differ from your training data").
- `react: 19.2.4`, `react-dom: 19.2.4`.
- TypeScript ^5, ESLint ^9 with `eslint-config-next`.
- **No DB.** Calls Spring via `SPRING_API_URL` and three LLM providers via REST.

### React client (`react_client/`) — Vite SPA
Pinned in [react_client/package.json](react_client/package.json):
- `react ^18.2.0` + `react-dom ^18.2.0` (functional components only).
- `vite ^5.0.11`, TypeScript `^5.3.3` (strict; see [react_client/tsconfig.json](react_client/tsconfig.json)).
- `react-router-dom ^6.21.1`, `@tanstack/react-query ^5.17.19`, `axios ^1.6.5`.
- `@mui/material ^5.15.3`, `@mui/icons-material`, `@mui/x-date-pickers`, `@emotion/react`, `@emotion/styled`.
- `@fullcalendar/{daygrid,timegrid,interaction,react,resource,resource-timegrid} ^6.1.20`.
- `@stripe/stripe-js ^4.0.0`, `@stripe/react-stripe-js ^2.7.0`.
- `recharts ^3.6.0`, `sweetalert2 ^11.26.17`, `date-fns ^3.6.0`.
- ESLint 8.56 with `@typescript-eslint`, `react-hooks`, `react-refresh` plugins; `--max-warnings 0`.

### npm scripts (React)
| Script | Command | Purpose |
|---|---|---|
| `dev` | `vite` | Dev server with HMR + proxy to Spring/FastAPI |
| `build` | `tsc && vite build` | Type-check then bundle to `dist/` |
| `lint` | `eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0` | Strict CI lint |
| `preview` | `vite preview` | Preview production build |

### Next.js scripts
`dev` (`next dev`), `build` (`next build`), `start` (`next start`), `lint` (`eslint`).

### FastAPI scripts
No `package.json` equivalent — `python main.py` (uvicorn embedded) or `uvicorn main:app` directly.

---

## 2. Folder structure

### Spring Boot — feature-modular hexagonal
Package root `com.emotivapoli`. **One package per business domain**, each subdivided into the four canonical layers:

```
springboot_server/src/main/java/com/
├── emotivapoli/
│   ├── auth/                ← módulo
│   │   ├── application/service     ← AuthService, JwtBlacklistService, RefreshTokenService
│   │   ├── domain/dto              ← RefreshSessionDTO
│   │   ├── domain/entity           ← RefreshSession, JwtBlacklist (JPA entities)
│   │   ├── infrastructure/mapper   ← RefreshSessionMapper
│   │   ├── infrastructure/repository ← *Repository (Spring Data JPA)
│   │   └── presentation/
│   │       ├── controller          ← AuthController (delegate)
│   │       ├── request             ← LoginRequest, RegisterRequest (validated DTOs)
│   │       ├── response            ← AuthResponse
│   │       └── router              ← AuthRouter (annotated with @RestController)
│   ├── clase/                ← idem
│   ├── club/                 ← idem
│   ├── evento/domain/entity  ← solo entidad (tabla agregadora)
│   ├── exception/            ← BusinessException, DuplicateResourceException, ResourceNotFoundException, ValidationException, GlobalExceptionHandler
│   ├── incidencia/           ← idem (presentation/{request,response,router,controller})
│   ├── pago/                 ← idem (presentation/schemas/{request,response})
│   ├── pista/                ← idem
│   ├── profile/              ← idem
│   ├── reserva/              ← idem
│   ├── security/
│   │   ├── config            ← SecurityConfig
│   │   ├── filter            ← SecurityFilter (OncePerRequestFilter)
│   │   ├── service           ← TokenService, CustomUserDetailsService
│   │   └── util              ← AuthUtils
│   ├── stripe/               ← StripeWebhookRouter (lives outside /api on purpose)
│   ├── usuario/              ← idem (con presentation/schemas además de presentation/{request,response})
│   └── utils/                ← SlugUtils, controller/UtilsController
└── emotivasport/springbootserver/   ← arranque histórico (Application.java, CorsConfig, MainController)
```

Some modules use `presentation/{request,response,router,controller}` (e.g. `auth`, `pista`, `usuario`, `incidencia`), others use `presentation/schemas/{request,response}` (e.g. `pago`, `reserva`, `clase`, `club`, `profile`). **Both shapes are accepted.** The majority pattern for newer modules (pago, reserva, clase, club) is `presentation/schemas/...`; legacy modules (auth, pista, usuario) keep `presentation/{request,response}` flat. Use the schemas variant for new code.

**Rules per folder:**
- `domain/entity/` — **JPA entities only** (`@Entity`, `@Table`). May reference other domain entities via fully-qualified names. **Forbidden:** Spring annotations (`@Service`, `@Component`), DTOs, controller code.
- `domain/dto/` — Plain Java DTOs (POJO with getters/setters). **Forbidden:** JPA annotations.
- `application/service/` — `@Service` classes that orchestrate repositories and Stripe/external calls; own transactions. **Forbidden:** HTTP/servlet types except where unavoidable (Stripe webhook handler is the only carve-out and it lives in `stripe/`, not in a domain).
- `application/mapper/` — `@Component` mappers translating DTO ↔ Entity ↔ Request/Response.
- `infrastructure/repository/` — Spring Data JPA `interface ... extends JpaRepository<E, Long>` (and `JpaSpecificationExecutor` when needed).
- `infrastructure/mapper/` — alternative mapper home (used in `usuario`, `auth`, `pista`, `incidencia`, `profile`).
- `presentation/router/` — `@RestController` + `@RequestMapping("/api/<recurso>")`. **This is where HTTP shape lives.**
- `presentation/controller/` — `@Component` (NOT `@RestController`). Delegate called by the router; converts DTO ↔ Request/Response.
- `presentation/request/` (or `…schemas/request/`) — input DTOs with Bean Validation annotations.
- `presentation/response/` (or `…schemas/response/`) — output DTOs.

### FastAPI — same hexagonal split, snake_case
```
fastapi_server/
├── main.py                          ← FastAPI app, includes routers
├── requirements.txt
└── app/
    ├── config/database.py           ← engine, SessionLocal, Base, get_db()
    ├── pista/
    │   ├── application/service/pista_service.py
    │   ├── domain/dto/pista_dto.py
    │   ├── domain/entity/pista.py            ← SQLAlchemy ORM model
    │   ├── domain/repository/pista_repository.py     ← ABC interface
    │   ├── infrastructure/mapper/pista_mapper.py
    │   ├── infrastructure/repository/pista_repository_impl.py
    │   └── presentation/
    │       ├── controllers/pista_controller.py      ← APIRouter lives here
    │       └── schemas/{request,response}/*.py
    ├── clase/  (idem)
    └── club/   (idem)
```

Rule: **the FastAPI service does NOT create tables** (`Base.metadata.create_all` is commented out in `main.py`). Schema is exclusively owned by Flyway in Spring.

### Next.js (IA Gateway) — App Router + feature module
```
ia_gateway_next/
├── next.config.ts
├── eslint.config.mjs
├── tsconfig.json
└── src/
    ├── app/                                  ← Next.js App Router
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── globals.css
    │   ├── page.module.css
    │   └── api/
    │       ├── recommend/route.ts            ← POST + OPTIONS
    │       └── status/route.ts
    └── modules/
        └── search/                            ← single feature module
            ├── application/                   ← orchestration (AIGatewayService, recommendPistas)
            ├── domain/                        ← retriever, types
            └── infrastructure/                ← providers/, providerRegistry, pistasDataSource
```

Path alias: `@/*` maps to `./src/*` (used throughout: `import ... from '@/modules/search/...'`).

### React client — Pages / Components / Services / Context / Hooks
```
react_client/src/
├── main.tsx                 ← Vite entry: QueryClient + StrictMode
├── App.tsx                  ← BrowserRouter, ThemeProvider, AuthProvider, Suspense, lazy routes
├── theme/theme.ts           ← ÚNICO punto de paleta + tipografía + componentes MUI
├── constants/               ← deportes.ts, index.ts (constantes de dominio)
├── context/                 ← *Context.tsx — un Provider por recurso (Auth, Pistas, Reservas, Clases, …)
├── hooks/
│   ├── queries/             ← useReservas.ts, usePistas.ts, … (READ — wrap context o useQuery)
│   └── mutations/           ← useReservasMutations.ts, … (WRITE — wrap context)
├── services/
│   ├── api.ts               ← Axios instance para FastAPI
│   ├── apiSpring.ts         ← Axios instance para Spring + interceptors + BroadcastChannel
│   ├── JwtService.ts        ← localStorage helpers + deviceId
│   ├── queries/             ← <recurso>Queries.ts — funciones GET puras
│   └── mutations/           ← <recurso>Mutations.ts — funciones POST/PUT/PATCH/DELETE puras
├── components/
│   ├── Admin/, Auth/, Home/, Layout/, Pistas/, Profile/, Shop/, Shared/
├── pages/
│   ├── admin/, auth/, home/, notfound/, profile/, shop/
├── types/index.ts           ← TODOS los tipos compartidos (Pista, Reserva, AuthResponse, …)
└── utils/                   ← formatLocalDateTime.ts, sweetAlert.ts
```

Rules:
- **Lazy load every page** in `App.tsx` (`const HomePage = lazy(() => import('./pages/home/HomePage'))`).
- Provider composition is explicit per route in `App.tsx`. Forbidden: a single mega-provider tree.
- `services/queries/*` and `services/mutations/*` contain **pure async functions** that hit the API; they don't know about React. The hooks layer (`hooks/queries/`, `hooks/mutations/`) wraps them in context or React Query.
- Types live exclusively in `types/index.ts` and the API mutation files (e.g. `LoginRequest`, `RegisterRequest`, `AuthResponse` are co-located in [react_client/src/services/mutations/authMutations.ts:8-47](react_client/src/services/mutations/authMutations.ts#L8-L47) — exception, not the rule).

---

## 3. Architectural style

**Multi-service modular hexagonal.** Each backend follows the same four-layer split (presentation → application → domain ← infrastructure). The frontend is a layered SPA. No shared library: services communicate by HTTP.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (React)                         │
│   pages → components → hooks/{queries,mutations}                │
│                                ↓                                │
│        services/queries + services/mutations + apiSpring        │
└─────────┬───────────────────────────────────────────────┬───────┘
          │ /api/springboot/*                              │ POST /api/recommend
          ▼                                                ▼
┌─────────────────────────────┐                ┌────────────────────┐
│   Spring Boot (8080)        │                │ Next.js IA Gateway │
│   presentation              │                │   app/api/...      │
│        ↓                    │                │        ↓           │
│   application (services)    │                │ modules/search/    │
│        ↓                    │ ←── /api/pistas│  application       │
│   domain (entity, dto)      │                │  domain (retriever)│
│        ↑                    │                │  infrastructure    │
│   infrastructure            │                │   (providers,      │
│   (Spring Data JPA)         │                │    pistasDataSource│
│        ↓                    │                │        ↓           │
│   PostgreSQL ← Flyway       │                │   Groq | Gemini |  │
│        ↑                    │                │   OpenRouter       │
│   FastAPI (5000) reads only │                └────────────────────┘
└─────────────────────────────┘
          ↑
          │ Webhook payment_intent.succeeded
        Stripe
```

**Dependency rule (Spring & FastAPI):** `presentation` → `application` → `domain` ← `infrastructure`. The domain has zero outward dependencies on Spring, JPA-specific or framework code in principle — though in practice this codebase relaxes the rule: JPA annotations (`@Entity`, `@Column`) live on entities under `domain/entity/`. Treat that as the *house style*: domain entities ARE the JPA model.

**Boundary enforcement:** by folder structure and naming conventions. There is **no ArchUnit, no Dependency Cruiser, no nx-style boundaries** wired into CI. Discipline is manual.

**Dependency rule (React):** `pages` → `components` → `hooks` → `services`. Types flow up; no service layer ever imports from `components/`.

---

## 4. Domain modeling

### Entities
- Plain JPA classes with `@Entity` and `@Table(name = "<plural>")`. Default constructor implicit; getters/setters generated by hand (no Lombok in this repo).
- Relationships use fully-qualified package names to avoid wildcard imports between domains: `private com.emotivapoli.pista.domain.entity.Pista pista;` ([springboot_server/src/main/java/com/emotivapoli/reserva/domain/entity/Reserva.java:24](springboot_server/src/main/java/com/emotivapoli/reserva/domain/entity/Reserva.java#L24)).
- Status fields are **plain `String` columns with documented allowed values** in a comment:
  ```java
  @Column(nullable = false, length = 50)
  private String status = "pendiente"; // pendiente, confirmada, en_curso, completada, cancelada, no_show
  ```
  ([springboot_server/.../Reserva.java:46-47](springboot_server/src/main/java/com/emotivapoli/reserva/domain/entity/Reserva.java#L46-L47)). Values are also validated at the SQL layer with `CHECK` constraints (see [springboot_server/src/main/resources/db/migration/V1__Initial_schema.sql:17-18](springboot_server/src/main/resources/db/migration/V1__Initial_schema.sql#L17-L18)). **No enum types** — strings are the canonical representation.
- Soft-delete is the default: every entity has `is_active BOOLEAN` and a `status` that includes `"eliminado"`. Real `DELETE` SQL is rare; controllers expose `PATCH /:slug/soft-delete`.

### Value objects
**There are none in the strict sense.** Money is `BigDecimal` (precision 10, scale 2). Dates are `LocalDateTime`/`LocalDate`. There is no `Email`, no `Money`, no `Slug` value object — just primitive types with column-level constraints.

### Invariants
Enforced inside `application/service` methods, not in constructors. Example: `ReservaService.createReserva` re-validates start-date > now and runs conflict detection by hand ([springboot_server/.../ReservaService.java:114-122](springboot_server/src/main/java/com/emotivapoli/reserva/application/service/ReservaService.java#L114-L122)). Constructors are dumb.

### Identity
Triple identity per top-level entity (when the row is user-facing):
- `id BIGSERIAL` (`Long`) — PK and FK target.
- `uid UUID UNIQUE NOT NULL DEFAULT gen_random_uuid()` — externalisable opaque id.
- `slug VARCHAR UNIQUE NOT NULL` — URL identifier built by [SlugUtils.generateSlug](springboot_server/src/main/java/com/emotivapoli/utils/SlugUtils.java) (lowercases, strips diacritics, hyphenates, suffixes 4 random digits).

REST endpoints address resources by **slug**, never by id (`/api/reservas/{slug}`, `/api/pistas/{slug}`, see [ReservaRouter.java:36](springboot_server/src/main/java/com/emotivapoli/reserva/presentation/router/ReservaRouter.java#L36) and [PistaRouter.java:58](springboot_server/src/main/java/com/emotivapoli/pista/presentation/router/PistaRouter.java#L58)). The internal `Long id` is only used in foreign keys and Stripe metadata. `uid` is rarely used.

Pure secondary tables (e.g. `Pista`) sometimes skip `uid` (see [Pista.java:10-38](springboot_server/src/main/java/com/emotivapoli/pista/domain/entity/Pista.java#L10-L38) — has `slug` but no `uid`); aggregator tables (`Reserva`, `Usuario`, `Pago`, `ClasePublica`) always have all three.

### Aggregates
Implicit. The closest thing to an aggregate is `Reserva`, which owns the `Pago` lifecycle through `PagoService.createPaymentIntent` (creates both in one transaction, [PagoService.java:91-187](springboot_server/src/main/java/com/emotivapoli/pago/application/service/PagoService.java#L91-L187)). There are no `Aggregate` interfaces or DDD-style invariant classes.

### Three real entities

**1. `Reserva` — booking** ([springboot_server/src/main/java/com/emotivapoli/reserva/domain/entity/Reserva.java](springboot_server/src/main/java/com/emotivapoli/reserva/domain/entity/Reserva.java)):
```java
@Entity
@Table(name = "reservas")
public class Reserva {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(unique = true, nullable = false) private UUID uid = UUID.randomUUID();
    @Column(unique = true, nullable = false) private String slug;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "pista_id", nullable = false)
    private com.emotivapoli.pista.domain.entity.Pista pista;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "usuario_id", nullable = false)
    private com.emotivapoli.usuario.domain.entity.Usuario usuario;
    @Column(name = "fecha_hora_inicio", nullable = false) private LocalDateTime fechaHoraInicio;
    @Column(nullable = false, precision = 10, scale = 2) private BigDecimal precio;
    @Column(nullable = false, length = 50)
    private String status = "pendiente"; // pendiente, confirmada, ...
    @Column(name = "is_active", nullable = false) private Boolean isActive = true;
    // refund + cancellation columns + getters/setters
}
```
Initialization in field declarations (`= UUID.randomUUID()`, `= "pendiente"`, `= true`, `= LocalDateTime.now()`).

**2. `Usuario`** ([springboot_server/src/main/java/com/emotivapoli/usuario/domain/entity/Usuario.java](springboot_server/src/main/java/com/emotivapoli/usuario/domain/entity/Usuario.java)) — same shape; adds `passwordHash`, `role` (`admin|cliente|entrenador`), `sessionVersion` (used to invalidate every refresh-token globally), and **owns** `clubsEntrenados`, `reservas`, `pagos`, `listasEspera` via `@OneToMany(cascade = CascadeType.ALL, fetch = FetchType.LAZY)`.

**3. `Pago`** ([springboot_server/src/main/java/com/emotivapoli/pago/domain/entity/Pago.java](springboot_server/src/main/java/com/emotivapoli/pago/domain/entity/Pago.java)) — three nullable FKs (`reserva_id`, `clase_inscripcion_id`, `club_suscripcion_id`) instead of polymorphism. `stripe_payment_intent_id` is `UNIQUE` (the idempotency key) at both the JPA level (`@Column(... unique = true)`) and the SQL level (constraint added in [V11__Add_stripe_columns.sql](springboot_server/src/main/resources/db/migration/V11__Add_stripe_columns.sql)).

---

## 5. Persistence

### ORM
- Spring Data JPA + Hibernate (Spring Boot 3.2.1 — Hibernate 6 transitively).
- `spring.jpa.hibernate.ddl-auto=validate` ([application.properties:11](springboot_server/src/main/resources/application.properties#L11)). The schema is **owned by Flyway**. Hibernate is only allowed to validate.
- `spring.jpa.show-sql=true` and `format_sql=true` are kept on in dev. Logging is `DEBUG` for `org.hibernate.SQL` ([application.properties:28](springboot_server/src/main/resources/application.properties#L28)).
- FastAPI uses SQLAlchemy 2.0 + psycopg 3 against the **same** database (`postgresql+psycopg://admin:admin123@postgres:5432/emotivapoli`, [fastapi_server/app/config/database.py:11-13](fastapi_server/app/config/database.py#L11-L13)).

### Schema location & conventions
- Authoritative schema: `springboot_server/src/main/resources/db/migration/`.
- Naming: `V<N>__<Snake_Case_description>.sql`. Example: [V9__Add_refresh_sessions.sql](springboot_server/src/main/resources/db/migration/V9__Add_refresh_sessions.sql), [V11__Add_stripe_columns.sql](springboot_server/src/main/resources/db/migration/V11__Add_stripe_columns.sql).
- Disabled migrations are kept on disk with the suffix `.DISABLED` (e.g. `V3__Insert_initial_data.sql.DISABLED`, `V4__Add_deportes_constraints.sql.DISABLED`) instead of being deleted.
- Tables: lower_snake_case plural (`reservas`, `usuarios`, `clases_publicas`, `refresh_sessions`).
- Columns: lower_snake_case (`fecha_hora_inicio`, `password_hash`).
- All long-running tables include `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP` and `updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`.
- Status columns ALWAYS have a `CHECK` constraint:
  ```sql
  role VARCHAR(50) NOT NULL DEFAULT 'cliente' CHECK (role IN ('admin', 'cliente', 'entrenador'))
  ```
  ([V1__Initial_schema.sql:17](springboot_server/src/main/resources/db/migration/V1__Initial_schema.sql#L17)).
- Flyway runs with `baseline-on-migrate=true` and `validate-on-migrate=false` ([application.properties:18-21](springboot_server/src/main/resources/application.properties#L18-L21)) — tolerates manual edits in dev. **Don't rely on this in prod.**

### Repository pattern

**Spring (majority pattern):** No interface separation — repositories are framework-coupled `JpaRepository` interfaces directly in `infrastructure/repository/`.

```java
// springboot_server/src/main/java/com/emotivapoli/reserva/infrastructure/repository/ReservaRepository.java
@Repository
public interface ReservaRepository extends JpaRepository<Reserva, Long> {
    Optional<Reserva> findBySlug(String slug);

    @Query("SELECT r FROM Reserva r WHERE r.status != 'eliminado' AND r.isActive = true")
    List<Reserva> findActivas();

    @Query("SELECT CASE WHEN COUNT(r) > 0 THEN true ELSE false END FROM Reserva r WHERE r.slug = ?1 AND r.status != 'eliminado'")
    boolean existsBySlugAndNotDeleted(String slug);
}
```

For dynamic queries, extend `JpaSpecificationExecutor<E>` and put the `Specification` as a `default` method in the interface (see [PistaRepository.java:18-78](springboot_server/src/main/java/com/emotivapoli/pista/infrastructure/repository/PistaRepository.java#L18-L78)).

**FastAPI (minority but exemplary):** explicit `ABC` interface in `domain/repository/` + `Impl` in `infrastructure/repository/`:
```python
# fastapi_server/app/pista/domain/repository/pista_repository.py
class PistaRepository(ABC):
    @abstractmethod
    def get_all(self) -> List[Pista]: ...

# fastapi_server/app/pista/infrastructure/repository/pista_repository_impl.py
class PistaRepositoryImpl(PistaRepository):
    def __init__(self, db: Session): self.db = db
    def get_all(self) -> List[Pista]:
        return self.db.query(Pista).all()
    def count_all(self) -> int: ...
    def get_destacadas(self, limit: int = 6) -> List[Pista]: ...
```
The service receives the abstract interface and is wired up in the route handler:
```python
# fastapi_server/app/pista/presentation/controllers/pista_controller.py:23-25
repository = PistaRepositoryImpl(db)
service = PistaService(repository)
```

### Transaction management
- `@Transactional` on the **service method**, never the controller, never the router.
- Single-statement reads use no annotation (Spring Data handles the read-only TX implicitly).
- Multi-write operations use class-level or method-level `@Transactional`.
- High-contention writes use **`@Transactional(isolation = Isolation.SERIALIZABLE)`** — see [PagoService.createPaymentIntent](springboot_server/src/main/java/com/emotivapoli/pago/application/service/PagoService.java#L91):
  ```java
  @Transactional(isolation = Isolation.SERIALIZABLE)
  public PaymentIntentResponse createPaymentIntent(CreatePaymentIntentRequest request) { ... }
  ```
- The `RefreshTokenService.rotate` uses `@Transactional(noRollbackFor = SecurityException.class)` so reuse-detection writes (revoke whole family) commit even when the method throws ([RefreshTokenService.java:95](springboot_server/src/main/java/com/emotivapoli/auth/application/service/RefreshTokenService.java#L95)).

### N+1 prevention
**There is no systematic N+1 prevention.** Many services call `repository.findAll().stream().filter(...)` to look up associations — see [ReservaService.validarConflictos](springboot_server/src/main/java/com/emotivapoli/reserva/application/service/ReservaService.java#L57-L72) and [PagoService.createPaymentIntent:120-126](springboot_server/src/main/java/com/emotivapoli/pago/application/service/PagoService.java#L120-L126). Performance is acceptable at MVP scale. **For new features, prefer a custom `@Query` JPQL with explicit `JOIN FETCH`** over `findAll()+filter`.

### Real repository — full implementation
Reproduced above (`ReservaRepository.java`). Notice:
- Custom finder methods named `findBySlug`, `existsBy<X>` follow Spring Data naming conventions.
- Hand-rolled JPQL goes in `@Query` annotations, never native SQL unless absolutely required (e.g. `entityManager.createNativeQuery("SELECT actualizar_estado_reservas()")` in [ReservaSchedulerService.java:38](springboot_server/src/main/java/com/emotivapoli/reserva/application/service/ReservaSchedulerService.java#L38)).

---

## 6. Application layer (use cases)

### Shape
A use case is **a public method on an `@Service` class**, not a single-method `Command` class. The service can be large: `UsuarioService` and `ReservaService` each carry every CRUD plus business rules. Names are imperative: `createReserva`, `updatePistaBySlug`, `getMisIncidencias`.

### Inputs / outputs
- **In:** `Request` DTOs from `presentation/...request/` (annotated with Bean Validation), or domain `DTO` objects.
- **Out:** domain `DTO` objects when crossing into the controller, then converted to `Response` shapes by mappers.
- **Pattern:** Router → Controller → Service. The router unwraps HTTP, the controller adapts request → DTO, the service runs the use case.

### Dependencies
- **Field injection with `@Autowired`** is the dominant pattern (`ReservaService`, `UsuarioService`, `PagoService`).
- Constructor injection (cleaner) is used in newer code: `AuthService` ([AuthService.java:46-63](springboot_server/src/main/java/com/emotivapoli/auth/application/service/AuthService.java#L46-L63)), `RefreshTokenService`, `TokenService`, `SecurityConfig`. **Prefer constructor injection in new code.**

### Errors
Services throw exceptions, never return `Result<T, E>`. Hierarchy lives in [com/emotivapoli/exception/](springboot_server/src/main/java/com/emotivapoli/exception):
- `ResourceNotFoundException` → 404
- `DuplicateResourceException` → 409
- `ValidationException` → 400
- `BusinessException` → 422
- `SecurityException` → 401
- Bare `RuntimeException` is also used liberally (`throw new RuntimeException("Pista no encontrada")`); the global handler maps it to 400. **For new code, prefer the specific subclasses.**

`GlobalExceptionHandler` ([GlobalExceptionHandler.java](springboot_server/src/main/java/com/emotivapoli/exception/GlobalExceptionHandler.java)) maps each into the canonical envelope.

### Transactions across operations
The transaction boundary is **the service method**. The Stripe flow shows the pattern: one `@Transactional(isolation = SERIALIZABLE)` opens, `Reserva` and `Pago` are saved, `PaymentIntent.create` is called, the resulting `pi.getId()` is written back to the same `Pago`, and only then does the transaction commit ([PagoService.java:147-181](springboot_server/src/main/java/com/emotivapoli/pago/application/service/PagoService.java#L147-L181)). If Stripe throws, the entire JPA transaction rolls back.

### Two real use cases

**A — `PagoService.createPaymentIntent`** (atomic reserva+pago+Stripe):
1. Load `STRIPE_SECRET_KEY` from `.env` via Dotenv.
2. Load and validate Pista (active?), Usuario.
3. Parse ISO-8601 strings to `LocalDateTime`; reject past dates.
4. Conflict scan (in-memory `findAll().stream().anyMatch`).
5. Build `Reserva` with status `"pendiente"`, save.
6. Build `Pago` with status `"pendiente"`, save.
7. `PaymentIntent.create(..., metadata = {reservaId, pagoId})`.
8. Persist returned `pi.getId()` on the existing `Pago`. Commit.
9. Return `{clientSecret, reservaId, pagoId}`.
On exception → rollback. On reuse of webhook → idempotent thanks to UNIQUE on `stripe_payment_intent_id`.

**B — `RefreshTokenService.rotate`** (refresh-token rotation with reuse detection, [RefreshTokenService.java:95-140](springboot_server/src/main/java/com/emotivapoli/auth/application/service/RefreshTokenService.java#L95-L140)):
1. Verify JWT signature + expiration with `tokenService.isRefreshTokenValid`.
2. Extract `email`, `familyId`, hash (SHA-256) the incoming raw token.
3. Look up `RefreshSession` by `familyId`.
4. If `revoked` → revoke the family again, throw `SecurityException`.
5. If hash mismatch → REUSE DETECTED → revoke family, throw.
6. If `session.sessionVersion != usuario.sessionVersion` → global logout active → throw.
7. Issue new refresh token (same `familyId`) and new access token.
8. Update `current_token_hash` and `last_used_at`. Commit.

The `noRollbackFor = SecurityException.class` is what makes the family revocation persist when reuse is detected.

---

## 7. API layer

### Style
- **Spring + FastAPI**: REST.
- **Next.js IA Gateway**: a single REST endpoint (`POST /api/recommend`) plus `GET /api/status`. Not REST-CRUD — it's an RPC-shaped POST.
- No GraphQL, no tRPC, no server actions.

### Routing
- **Spring**: `@RestController` + `@RequestMapping("/api/<resource>")` on a `Router` class. The `@<Verb>Mapping` lives on each method. Path variables are slugs: `@GetMapping("/{slug}")`. Verbose example: [ReservaRouter.java](springboot_server/src/main/java/com/emotivapoli/reserva/presentation/router/ReservaRouter.java).
- **FastAPI**: each entity has its own `APIRouter(prefix="/api/<resource>", tags=["<Resource>"])`, and `main.py` includes them.
  ```python
  router = APIRouter(prefix="/api/pistas", tags=["Pistas"])
  @router.get("/", response_model=List[PistaResponse], status_code=status.HTTP_200_OK)
  ```
  ([fastapi_server/app/pista/presentation/controllers/pista_controller.py:12-28](fastapi_server/app/pista/presentation/controllers/pista_controller.py#L12-L28)).
- **Next.js**: file-based routing (`src/app/api/recommend/route.ts` exports `POST` and `OPTIONS`).

### Request validation
- **Spring**: Bean Validation (`jakarta.validation.constraints.*`) on `Request` DTOs:
  ```java
  @NotBlank(message = "El email es obligatorio")
  @Email(message = "El email debe ser válido")
  private String email;
  @NotBlank(message = "La contraseña es obligatoria")
  @Size(min = 8, message = "La contraseña debe tener al menos 8 caracteres")
  private String password;
  ```
  ([RegisterRequest.java:16-22](springboot_server/src/main/java/com/emotivapoli/auth/presentation/request/RegisterRequest.java#L16-L22)). Triggered by `@Valid` on the router parameter:
  ```java
  public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest request, ...)
  ```
  Pattern matching for enum-like fields uses `@Pattern`:
  ```java
  @Pattern(regexp = "^(Pádel|Tenis|Fútbol Sala|...)$",
           message = "El deporte debe ser uno de: ...")
  private String tipo;
  ```
  ([PistaRequest.java:10-11](springboot_server/src/main/java/com/emotivapoli/pista/presentation/request/PistaRequest.java#L10-L11)).
- **FastAPI**: Pydantic 2 schemas in `presentation/schemas/{request,response}/`. Response models declared as `response_model=PistaResponse` on the route. `class Config: from_attributes = True` to map from SQLAlchemy entities ([pista_response.py:16-30](fastapi_server/app/pista/presentation/schemas/response/pista_response.py#L16-L30)).
- **Next.js IA Gateway**: hand-rolled (`if (!prompt || typeof prompt !== 'string') { return ... 400 }`).

### Response shapes
- **Success:** the DTO directly. No envelope. Example: `ResponseEntity<List<ReservaResponse>>` returns the bare array.
- **Created:** `HttpStatus.CREATED` + the new resource. Example: `return ResponseEntity.status(HttpStatus.CREATED).body(nuevaReserva);` ([ReservaRouter.java:46-47](springboot_server/src/main/java/com/emotivapoli/reserva/presentation/router/ReservaRouter.java#L46-L47)).
- **Soft delete:** `204 No Content` (`return ResponseEntity.noContent().build();`).
- **Pagination (Spring):** Spring Data's `Page<T>` shape leaks straight to the wire — `{ content, totalElements, totalPages, size, number, numberOfElements, first, last, empty }`. Mirrored in TS as `PistaSearchResponse` ([react_client/src/types/index.ts:67-78](react_client/src/types/index.ts#L67-L78)).
- **Errors:** uniform JSON envelope from `GlobalExceptionHandler`:
  ```json
  { "timestamp": "2026-05-06T...", "status": 409, "error": "Conflicto", "message": "...", "path": "/api/..." }
  ```
  ([GlobalExceptionHandler.java:19-25](springboot_server/src/main/java/com/emotivapoli/exception/GlobalExceptionHandler.java#L19-L25)). Keys: `timestamp` (LocalDateTime), `status` (numeric), `error` (Spanish label), `message`, `path`. **Not RFC 7807** — custom envelope.
- **Auth-specific:** Spring Security entry/access handlers return `{"error": "..."}` (no envelope) for 401/403 ([SecurityConfig.java:73-83](springboot_server/src/main/java/com/emotivapoli/security/config/SecurityConfig.java#L73-L83)).
- **Pago endpoint** does its own ad-hoc response shaping for known errors: `Map.of("error", msg)` with manual status mapping ([PagoRouter.java:62-69](springboot_server/src/main/java/com/emotivapoli/pago/presentation/router/PagoRouter.java#L62-L69)). Inconsistent with the global envelope — minority pattern.

### Status codes (concrete rules)
| Status | When |
|---|---|
| 200 | GET success, PUT success |
| 201 | POST that creates a resource |
| 204 | PATCH soft-delete, DELETE |
| 400 | Bean Validation failure, generic `RuntimeException`, malformed input |
| 401 | No JWT or invalid JWT (Spring Security entry point) |
| 403 | JWT valid, role insufficient (Spring Security access denied handler) |
| 404 | `ResourceNotFoundException` (only used in `usuario/profile`; many other services throw `RuntimeException` and end up as 400 — gap) |
| 409 | `DuplicateResourceException`, also explicit "Horario no disponible" in `PagoRouter` |
| 422 | `BusinessException` |
| 500 | Catch-all `Exception` handler |

There is no 503 anywhere. There is no 429 anywhere (no rate limiting).

### API versioning
**None.** Every endpoint lives under `/api/...` with no `/v1/` prefix. Treat the API as versionless.

### HTTP method conventions
- `GET` — read.
- `POST` — create. Sometimes side-effecty (e.g. `/auth/refresh`, `/auth/logout` are POSTs because they mutate the refresh-token table).
- `PUT /<resource>/{slug}` — full update.
- `PATCH /<resource>/{slug}/<verb>` — partial mutations: `soft-delete`, `change-password`, `<id>/estado` for incidencia.
- `DELETE` — almost never used (soft delete is a `PATCH` in Spring; `DELETE` exists only on `PistaRouter` with `@DeleteMapping("/{slug}")`).

### End-to-end endpoint flow — `POST /api/reservas`

1. Browser: `await api.post('/reservas', reserva)` from [reservasMutations.ts:8-9](react_client/src/services/mutations/reservasMutations.ts#L8-L9).
2. Vite proxy rewrites `/api/springboot/reservas` → `http://springboot:8080/api/reservas` ([vite.config.ts:19-23](react_client/vite.config.ts#L19-L23)).
3. `SecurityFilter` ([SecurityFilter.java](springboot_server/src/main/java/com/emotivapoli/security/filter/SecurityFilter.java)) inspects `Authorization`, validates JWT, checks blacklist, sets `SecurityContextHolder` authentication.
4. Spring Security `SecurityFilterChain` ([SecurityConfig.java](springboot_server/src/main/java/com/emotivapoli/security/config/SecurityConfig.java)) sees `POST /api/reservas` is not public, requires `authenticated()`, allows it.
5. `ReservaRouter.createReserva(@RequestBody ReservaCreateRequest)` ([ReservaRouter.java:43-48](springboot_server/src/main/java/com/emotivapoli/reserva/presentation/router/ReservaRouter.java#L43-L48)) calls `reservaController.createReserva(request)`.
6. `ReservaController` ([ReservaController.java:38-42](springboot_server/src/main/java/com/emotivapoli/reserva/presentation/controller/ReservaController.java#L38-L42)) maps Request → DTO via `ReservaMapper.createRequestToDTO`, calls `reservaService.createReserva(dto)`, maps result → Response.
7. `ReservaService.createReserva` ([ReservaService.java:87-128](springboot_server/src/main/java/com/emotivapoli/reserva/application/service/ReservaService.java#L87-L128)): generates slug, loads pista/usuario/club, validates "no past dates" + conflict scan, saves entity, returns DTO.
8. Response: `201 Created` + JSON `ReservaResponse`. The mapper picks fields to expose (no password hashes, no sessionVersion etc.).

---

## 8. Authentication

### Mechanism
- **Hybrid JWT.** Access token is a JWT in the `Authorization: Bearer ...` header. Refresh token is a separate JWT in an `HttpOnly` cookie.
- Two independent secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) loaded via Dotenv ([TokenService.java:37-44](springboot_server/src/main/java/com/emotivapoli/security/service/TokenService.java#L37-L44)).
- Algorithm: HS256 (`Keys.hmacShaKeyFor(secret.getBytes())`).
- Access token claims: `email`, `role`, `type=access`, standard `sub`/`iat`/`exp`.
- Refresh token claims: `email`, `familyId`, `type=refresh`, `sub`/`iat`/`exp`.

### Storage
- **Access token:** `localStorage["auth_token"]` ([JwtService.ts:5-21](react_client/src/services/JwtService.ts#L5-L21)). Tradeoff accepted: XSS exposure in exchange for cross-tab and cross-page-reload simplicity.
- **Refresh token:** server-set cookie `refreshToken`, `httpOnly=true`, `secure=false` (TODO for prod), `sameSite=Strict`, `path=/`, `maxAge` per role ([AuthService.java:179-191](springboot_server/src/main/java/com/emotivapoli/auth/application/service/AuthService.java#L179-L191)).
- **Server-side session record:** `refresh_sessions` table ([V9__Add_refresh_sessions.sql](springboot_server/src/main/resources/db/migration/V9__Add_refresh_sessions.sql)) — one row per `(user_id, device_id, family_id)`.
- **Device id:** generated client-side with `crypto.randomUUID()` and stored in `localStorage["device_id"]` ([JwtService.ts:28-35](react_client/src/services/JwtService.ts#L28-L35)). Sent on every request as `X-Device-Id`.

### Lifetimes
| Role | Access | Refresh |
|---|---|---|
| `admin` | 8 h | none (admin re-logs in) |
| `monitor` | 15 min | 7 days |
| `cliente` (default) | 15 min | 30 days |

Defined as constants in [TokenService.java:25-28](springboot_server/src/main/java/com/emotivapoli/security/service/TokenService.java#L25-L28).

### Refresh strategy
- **One-time-use rotating refresh tokens with family ids.**
- Frontend interceptor catches 401 + `_hadToken` flag, calls `POST /api/auth/refresh` (refresh promise is shared across concurrent 401s to avoid race conditions, [apiSpring.ts:50-86](react_client/src/services/apiSpring.ts#L50-L86)).
- Backend `RefreshTokenService.rotate` validates by JWT signature + family + SHA-256 hash + sessionVersion. If hash doesn't match → reuse-detected → entire family revoked. Detail in §6 use case B.
- New access token is broadcast to other tabs via `BroadcastChannel('auth')`:
  ```ts
  authChannel.postMessage({ type: 'TOKEN_REFRESHED', token: newToken });
  window.dispatchEvent(new CustomEvent('auth:tokenRefreshed', { detail: { token: newToken } }));
  ```
  Plus a custom DOM event for the same tab (BroadcastChannel doesn't echo to the sender).

### Logout
- Single device: `POST /api/auth/logout` revokes the family in `refresh_sessions` (`revoked = true`) AND blacklists the access JWT (`JwtBlacklistService.revoke`) so the remaining minutes of the access token are unusable. Cookie is cleared ([AuthService.java:127-139](springboot_server/src/main/java/com/emotivapoli/auth/application/service/AuthService.java#L127-L139)).
- Global logout: `RefreshTokenService.invalidateAllSessions` increments `usuarios.session_version` and revokes all sessions of that user. Used when changing password.

### Password handling
- Hash: **Argon2** with parameters `(saltLength=16, hashLength=32, parallelism=1, memory=65536KB, iterations=3)` configured in [SecurityConfig.passwordEncoder](springboot_server/src/main/java/com/emotivapoli/security/config/SecurityConfig.java#L118-L120):
  ```java
  return new Argon2PasswordEncoder(16, 32, 1, 65536, 3);
  ```
- Comparison: `AuthenticationManager.authenticate(...)` in `AuthService.login` ([AuthService.java:90-92](springboot_server/src/main/java/com/emotivapoli/auth/application/service/AuthService.java#L90-L92)) — Spring Security's `DaoAuthenticationProvider` runs `Argon2PasswordEncoder.matches`.
- Plain passwords never leave `RegisterRequest` → `usuarioService.createUsuario(dto, passwordHash)`. The hash is calculated once in `AuthService.register` ([AuthService.java:76](springboot_server/src/main/java/com/emotivapoli/auth/application/service/AuthService.java#L76)).

### Login flow end-to-end
1. `POST /api/auth/login` with `{email, password}` and `X-Device-Id` header.
2. `AuthRouter.login` → `AuthController.login` → `AuthService.login`.
3. `authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(...))` → `CustomUserDetailsService.loadUserByUsername` returns `User(email, passwordHash, [ROLE_<ROLE>])` and the encoder verifies the password.
4. Status check (`activo` and `isActive`) explicit.
5. `setLastLogin(now)` saved.
6. `tokenService.generateAccessToken(email, role)` produces access JWT.
7. If role != admin, `refreshTokenService.createSession(...)` issues a refresh token, server hashes it (SHA-256) and stores it; cookie is written via `Set-Cookie: refreshToken=...; HttpOnly; SameSite=Strict; Path=/`.
8. Response body: `{accessToken, usuario: UsuarioResponse}` ([AuthResponse.java](springboot_server/src/main/java/com/emotivapoli/auth/presentation/response/AuthResponse.java)).
9. Client stores `accessToken` in localStorage; cookie is automatic.

### Where the authenticated user is exposed
- Inside the request: `SecurityContextHolder.getContext().getAuthentication().getName()` returns the email. Wrapped by `AuthUtils.getCurrentUserEmail()` ([AuthUtils.java](springboot_server/src/main/java/com/emotivapoli/security/util/AuthUtils.java)).
- Convenience pattern in routers that need the user id:
  ```java
  private Long getCurrentUserId() {
      String email = AuthUtils.getCurrentUserEmail();
      return usuarioRepository.findByEmail(email)
              .orElseThrow(() -> new RuntimeException("Usuario autenticado no encontrado"))
              .getId();
  }
  ```
  ([IncidenciaRouter.java:59-64](springboot_server/src/main/java/com/emotivapoli/incidencia/presentation/router/IncidenciaRouter.java#L59-L64)).
- On the client: via `useAuth()` (a thin wrapper around `AuthContext`), giving `{user, token, isAuth, isAdmin}`.

---

## 9. Authorization (RBAC)

### Roles
Three: `admin`, `cliente`, `entrenador` ([V1__Initial_schema.sql:17](springboot_server/src/main/resources/db/migration/V1__Initial_schema.sql#L17)). Stored as a string column with a `CHECK` constraint. There is also an undocumented `monitor` role referenced in `TokenService` but no migration / seed creates it.

### Declaration
- Roles are declared on the `Usuario` row (`role VARCHAR(50)`).
- Spring authorities are derived in `CustomUserDetailsService`:
  ```java
  return Collections.singletonList(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase()));
  ```
  ([CustomUserDetailsService.java:38](springboot_server/src/main/java/com/emotivapoli/security/service/CustomUserDetailsService.java#L38)).

### Permission model
- **String-tuple via `hasRole(...)`** in the security config (no CASL, no policy classes):
  ```java
  .requestMatchers(HttpMethod.GET,   "/api/usuarios").hasRole("ADMIN")
  .requestMatchers(HttpMethod.PATCH, "/api/usuarios/*/soft-delete").hasRole("ADMIN")
  ```
  ([SecurityConfig.java:57-62](springboot_server/src/main/java/com/emotivapoli/security/config/SecurityConfig.java#L57-L62)).
- `@EnableMethodSecurity` is on, but `@PreAuthorize` is NOT used in this codebase. All RBAC is path/method based in `SecurityConfig`.

### Where authorization is enforced
- Mostly in `SecurityConfig` (route matchers).
- A few service methods do an additional explicit check: see [UsuarioService.java:12 import](springboot_server/src/main/java/com/emotivapoli/usuario/application/service/UsuarioService.java#L12) of `AccessDeniedException` — used inside the service when a non-admin tries to mutate someone else.

### Resource-level checks
**Limited.** "Mis pagos" is implemented by reading `SecurityContextHolder` in the service and filtering by the current user:
```java
public List<PagoDTO> getMisPagos() {
    String email = SecurityContextHolder.getContext().getAuthentication().getName();
    Usuario usuario = usuarioRepository.findByEmail(email).orElseThrow(...);
    return pagoRepository.findByUsuarioId(usuario.getId()) ... ;
}
```
([PagoService.java:74-84](springboot_server/src/main/java/com/emotivapoli/pago/application/service/PagoService.java#L74-L84)).

**There is no row-level security in PostgreSQL** (no `ENABLE ROW LEVEL SECURITY`), no tenant scoping (the app is single-tenant). For "can this user edit *this* booking" the codebase relies on the implicit fact that the front-end only shows bookings the user owns; the backend does NOT enforce ownership on `PUT /api/reservas/{slug}`. **Gap — flag for any new code touching sensitive data.**

### Real protected operation — `POST /api/incidencias`
1. `SecurityFilter` runs, extracts JWT, populates `SecurityContextHolder`.
2. `SecurityConfig`: `.requestMatchers(HttpMethod.POST, "/api/incidencias").authenticated()` → must have a valid token (any role).
3. `IncidenciaRouter.create` calls `getCurrentUserId()` which looks up the email in `SecurityContextHolder` and resolves the DB id. The created incidencia is owned by that user.
4. The `mine` endpoint scopes by user-id; the listing endpoint requires `hasRole("ADMIN")`.

---

## 10. Validation

### Library
- **Backend (Spring):** Jakarta Bean Validation 3.x via `spring-boot-starter-validation`.
- **Backend (FastAPI):** Pydantic 2.10.3.
- **Frontend:** No validation library. Manual `if (!email) ...` checks inside form components.

### Where schemas live
- **Spring:** validation annotations are **colocated on the Request DTO** in `presentation/.../request/`. There is no central schema folder.
  - `@NotBlank`, `@NotNull`, `@Size`, `@Email`, `@Pattern` are the recurring annotations.
  - All messages are in **Spanish**.
- **FastAPI:** Pydantic schemas in `presentation/schemas/{request,response}/<resource>_<request|response>.py`. `class Config: from_attributes = True` to map from ORM entities.

### Input validation vs domain invariants
- Input validation = "the JSON is well-formed" → annotations on DTOs.
- Domain invariants = "no past date, no overlapping booking, status transition is legal" → explicit checks inside the service (see `ReservaService.createReserva` lines 114-122).
- These two layers are kept separate. **Don't put `@Future` on `fechaHoraInicio` and skip the service check** — the service check has more context (it sees existing bookings).

### Validation errors → API errors
Bean Validation failures throw `MethodArgumentNotValidException`. There is **no explicit `@ExceptionHandler` for it** in `GlobalExceptionHandler`, so it falls through to the generic `Exception` handler → 500 with the message "Ha ocurrido un error inesperado". **Gap — adding a 400 handler for `MethodArgumentNotValidException` is a high-value next change.**

### Real schema → route wiring (Spring)
```java
// RegisterRequest.java
public class RegisterRequest {
    @NotBlank(message = "El nombre es obligatorio")
    @Size(min = 2, max = 100)
    private String nombre;
    @NotBlank @Email private String email;
    @NotBlank @Size(min = 8) private String password;
}
// AuthRouter.java
@PostMapping("/register")
public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest request, ...) { ... }
```

---

## 11. Error handling

### Hierarchy
- `BusinessException`
- `DuplicateResourceException`
- `ResourceNotFoundException`
- `ValidationException`
- `SecurityException` (java.lang)
- All extend `RuntimeException`. No checked exceptions.

### Known vs unexpected
- Known: subclasses of the project's exception hierarchy. Each has a dedicated handler returning the right status (409, 404, 400, 422, 401).
- Unexpected: caught by `@ExceptionHandler(Exception.class)` → 500 + generic message. The actual stack trace is `printStackTrace()`'d to stdout ([GlobalExceptionHandler.java:104-106](springboot_server/src/main/java/com/emotivapoli/exception/GlobalExceptionHandler.java#L104-L106)). **No structured logger here.**

### Global handler
[GlobalExceptionHandler.java](springboot_server/src/main/java/com/emotivapoli/exception/GlobalExceptionHandler.java) uses `@ControllerAdvice`. Returns a hand-built `Map<String, Object>` (not a typed DTO) with keys `{timestamp, status, error, message, path}`. Path is extracted via `request.getDescription(false).replace("uri=", "")`.

### Logging
- `System.err.println` and `System.out.println` are used in `StripeWebhookRouter` for traceability ([StripeWebhookRouter.java:67-117](springboot_server/src/main/java/com/emotivapoli/stripe/StripeWebhookRouter.java#L67-L117)).
- SLF4J `Logger` is used in `ReservaSchedulerService`:
  ```java
  private static final Logger logger = LoggerFactory.getLogger(ReservaSchedulerService.class);
  logger.info("..."); logger.error("...", e);
  ```
  ([ReservaSchedulerService.java:20](springboot_server/src/main/java/com/emotivapoli/reserva/application/service/ReservaSchedulerService.java#L20)).
- **For new code, use SLF4J `Logger`.** Do not use `System.out`.

### Surfacing to the client
- The client treats `error.response.data.error` and `error.response.data.message` as user-facing strings (see [ModalReservaPago.tsx:90-94](react_client/src/components/Shop/ModalReservaPago.tsx#L90-L94)).
- The frontend never inspects the `status` JSON key; it relies on the HTTP status code (Axios `error.response.status`).

### Retry / transient failures
- Frontend Axios `defaultOptions.queries.retry: 1` ([main.tsx:11](react_client/src/main.tsx#L11)) — only one retry on read queries.
- 401 → refresh + retry (see §8).
- IA Gateway: provider blacklisted for **2 minutes** on failure (`blacklistMs = 2 * 60 * 1000`, [aiGatewayService.ts:8](ia_gateway_next/src/modules/search/application/aiGatewayService.ts#L8)), then a different provider is tried.
- No retry for Stripe webhook — Stripe handles retries on its end and the `stripe_payment_intent_id` UNIQUE makes it safe.

---

## 12. Idempotency

### What's idempotent
- **`POST /stripe/webhook`** — explicitly idempotent. Logic in [StripeWebhookRouter.java:99-103](springboot_server/src/main/java/com/emotivapoli/stripe/StripeWebhookRouter.java#L99-L103):
  ```java
  if ("completado".equals(pago.getStatus())) {
      System.out.println("Webhook Stripe: pago ya procesado (idempotente) - " + stripePaymentIntentId);
      return ResponseEntity.ok("OK");
  }
  ```
  Plus DB-level UNIQUE on `stripe_payment_intent_id`.
- All `GET` endpoints by definition.
- `DELETE` / `PATCH soft-delete` — repeated calls converge on the same final state.

### What's NOT idempotent
- `POST /api/reservas` (creates a new reserva each call).
- `POST /api/auth/login` (issues a new access token + refresh family each call).
- `POST /api/pagos/create-payment-intent` (creates a new Stripe PaymentIntent each call). **There is no idempotency-key header support.** A double-click on the "pagar" button would create two PaymentIntents (Stripe billing is unaffected because the user only confirms one, but DB would have an orphan). Mitigated by the React `loading` flag inside `CheckoutForm`.

### Idempotency keys
- **Not implemented at the API layer.** No `Idempotency-Key` header, no deduplication table.
- **At the Stripe boundary:** the `stripe_payment_intent_id` UNIQUE constraint is the de-facto idempotency key for the webhook.

### Webhook deduplication
- See above — UNIQUE constraint + status guard + manual signature verification (`Webhook.constructEvent(payload, sigHeader, webhookSecret)`).

### Gap
- **No general idempotency-key support.** For any new mutating endpoint that may be retried by a flaky network, this is a gap.

---

## 13. Concurrency & race conditions

### Locking strategy
- **Optimistic / serializable transactions, no `@Version` columns, no advisory locks.**
- The hot path (booking creation) uses `@Transactional(isolation = Isolation.SERIALIZABLE)` to make Postgres serialize the whole conflict-scan + insert ([PagoService.java:91](springboot_server/src/main/java/com/emotivapoli/pago/application/service/PagoService.java#L91)).
- Other writes use the default `READ_COMMITTED`.

### Booking double-reservation
1. SERIALIZABLE TX opens.
2. `reservaRepository.findAll().stream().anyMatch(r -> overlapping)` — runs inside the TX.
3. Insert.
4. Commit. If two concurrent transactions read overlapping data, Postgres aborts one with `40001 serialization_failure`. The exception bubbles up to the global handler as 400 with a generic message. **The frontend does NOT auto-retry** — the user re-clicks.

### Client-side double-submit
- The pay button is gated by a local `loading` boolean ([ModalReservaPago.tsx:60-97](react_client/src/components/Shop/ModalReservaPago.tsx#L60-L97)).
- React Query mutations naturally serialize state updates per component, but there's no `useMutation`-level idempotency.

### Background-job concurrency
- `ReservaSchedulerService` uses `@Scheduled(cron = "0 0/5 * * * *")` (every 5 min). Single instance. Calls native SQL functions inside `@Transactional`. There is no clustering / lock; if two app instances ran, both would fire — **single-instance assumption.**

### Refresh-token race
- Multiple tabs may receive 401 simultaneously → multiple `/auth/refresh` calls would race. Mitigated by a shared `refreshPromise` in [apiSpring.ts:50-86](react_client/src/services/apiSpring.ts#L50-L86): the first 401 starts the promise, all others `await` it.

---

## 14. Logging, tracing, observability

### Logger and format
- **Backend:** SLF4J via `LoggerFactory.getLogger(...)` plus `System.out`/`System.err` mixed in (legacy). Format is the Spring Boot default colorized text. **No JSON structured logs.**
- **Frontend:** `console.log` is used heavily for auth/interceptor diagnostics ([apiSpring.ts:64-89](react_client/src/services/apiSpring.ts#L64-L89), [AuthContext.tsx:72-149](react_client/src/context/AuthContext.tsx#L72-L149)). Strings are prefixed with `[AUTH]`, `[INTERCEPTOR]` for grep-ability.

### Levels
- `INFO` — scheduler tick start/end, reserva confirmation.
- `DEBUG` — Hibernate SQL (always on in dev: `logging.level.org.hibernate.SQL=DEBUG`).
- `WARN` — not used.
- `ERROR` — scheduler exceptions, generic exception handler.

### Request correlation / tracing
- **No request id / trace id propagation.** No Sentry, Datadog, OpenTelemetry. Only `X-Device-Id` is sent by the client; it's not echoed in logs.

### Audit log
- **None.** No `audit_log` table, no Hibernate Envers. Listed as a future improvement in MEMORIA.md (point 9 of mejoras futuras).

### External tools
- None wired in.

---

## 15. Caching

- **HTTP caching:** Nginx config sets `Cache-Control: public, immutable; expires 1y` for static assets (`.js, .css, .png, .jpg, …`) ([react_client/nginx.conf:27-30](react_client/nginx.conf#L27-L30)). HTML/API responses are not cached.
- **Query caching (frontend):** TanStack Query 5 with global defaults `refetchOnWindowFocus: false, retry: 1` ([main.tsx:7-14](react_client/src/main.tsx#L7-L14)). No explicit `staleTime` is set per query — relies on the default (0).
- **Computed-value caching:** none.
- **Server-side cache (Redis):** none.
- **CDN:** none configured.
- The IA Gateway pulls the `pistas` list every request with `cache: 'no-store'` ([pistasDataSource.ts:16](ia_gateway_next/src/modules/search/infrastructure/pistasDataSource.ts#L16)) — explicitly opts out of Next's fetch cache.

---

## 16. Background jobs & scheduling

### Runner
Spring's built-in `@Scheduled` (enabled by `@EnableScheduling` on `Application`).

### Definition location
Inside the relevant module's `application/service/`. Example: [ReservaSchedulerService.java](springboot_server/src/main/java/com/emotivapoli/reserva/application/service/ReservaSchedulerService.java).
```java
@Scheduled(cron = "0 0/5 * * * *")
@Transactional
public void actualizarEstadosReservas() {
    entityManager.createNativeQuery("SELECT actualizar_estado_reservas()").getSingleResult();
    entityManager.createNativeQuery("SELECT actualizar_estado_clases()").getSingleResult();
}
```

The actual state transitions live in PostgreSQL functions (`V8__Auto_update_status_functions.sql`). Spring just polls.

### Dispatch / retry / DLQ
- No dispatch queue, no retry, no DLQ. If the job throws, it logs and waits 5 min for the next tick.
- **No background-job queue (no Quartz, no Bull, no SQS).** Scope is small enough that `@Scheduled` is the whole story.

### Cron jobs (recurring)
Just one: the reservation-status updater above.

---

## 17. External integrations

### Third-parties
| Service | Used for | Where |
|---|---|---|
| Stripe | PaymentIntents + Webhooks | `pago/application/service/PagoService`, `stripe/StripeWebhookRouter` |
| Groq, Gemini, OpenRouter | LLMs for natural-language pista search | `ia_gateway_next/src/modules/search/infrastructure/providers/` |
| Spring API (from IA Gateway) | Read pistas | `ia_gateway_next/src/modules/search/infrastructure/pistasDataSource.ts` |

(Cerebras, Mistral, Cohere keys exist in docker-compose but no provider impl ships in the repo — placeholders.)

### Client wrappers
- **Stripe:** SDK-direct, no wrapper class. `Stripe.apiKey = dotenv.get(...)` is set inside the service method (one-shot, [PagoService.java:94-95](springboot_server/src/main/java/com/emotivapoli/pago/application/service/PagoService.java#L94-L95)).
- **LLMs:** thin functional providers conforming to the `AIProvider` interface ([types.ts:18-22](ia_gateway_next/src/modules/search/domain/types.ts#L18-L22)):
  ```ts
  export interface AIProvider {
    name: string;
    chat: (messages: ChatMessage[]) => Promise<string>;
    healthcheck: () => Promise<void>;
  }
  ```
  Each provider is created via `createXxxProvider(apiKey)` factory function. Round-robin + 2-minute blacklist on failure ([aiGatewayService.ts](ia_gateway_next/src/modules/search/application/aiGatewayService.ts)).

### Secrets
- Never hardcoded. Loaded from `.env` via `Dotenv` (Spring) or `process.env` (Next.js) or `os.getenv` (FastAPI).
- `docker-compose.yml` injects them with shell-style fallbacks (`${STRIPE_SECRET_KEY:-}`).

### Rate limits / timeouts
- **No timeouts** are set on `fetch` calls in the IA Gateway. **No client timeout** on Axios in the React client.
- Provider health is judged by the response.ok check + a 2-minute blacklist after one failure (`createGroqProvider.healthcheck` → throw → blacklist).

### Outage handling
- Stripe outage during `createPaymentIntent`: the entire `@Transactional(SERIALIZABLE)` rolls back; user sees the error message; nothing in the DB is left dangling.
- LLM outage: blacklist + try next provider; if all fail → 500 to the client.
- FastAPI outage: the React client uses Spring for the auth path, so the app stays usable.

---

## 18. Frontend architecture

### Framework & rendering
- **React 18 + TypeScript + Vite 5** SPA. Pure client-side rendering (`vite build` → static `dist/` served by Nginx).
- Routing: React Router 6 with `<BrowserRouter>` and `<Routes>` declared in `App.tsx`.
- Code-splitting: `React.lazy(() => import('./pages/...'))` for every page, wrapped in `<Suspense fallback={<LoadingFallback />}>`.

### Folder structure (frontend)
See §2.

### Component organization
- `components/<Area>/<ComponentName>.tsx` — area folders match feature areas (`Admin/`, `Auth/`, `Home/`, `Layout/`, `Pistas/`, `Profile/`, `Shared/`, `Shop/`).
- Shared atomic components live in `components/Shared/` (`FormField`, `FormSelect`, `CampoFormulario`, `UserSelector`, `MultiUserSelector`, `AdminGuard`, `AuthGuard`).
- Pages are containers in `pages/<area>/<NamePage>.tsx`.
- Each component is a **named export** typed with `interface <ComponentName>Props { … }` and an arrow-function constant: `export const FormField = ({...}: FormFieldProps) => { ... }` ([FormField.tsx:18](react_client/src/components/Shared/FormField.tsx#L18)).
- Default exports are reserved for **page** components (so `React.lazy` works without `.then(m => ({ default: m.X }))`).

### State management
- **Global auth state:** `AuthContext` (custom Context + Provider). `useAuth()` returns `{user, token, isAuth, isAdmin, isLoading, login, register, logout, reloadUser}` ([AuthContext.tsx](react_client/src/context/AuthContext.tsx)).
- **Per-resource state:** **a Context per resource** (`PistasContext`, `ReservasContext`, `ClubsContext`, `ClasesContext`, `PagosContext`, `UsuariosContext`, `ClaseInscripcionContext`, `ClubMiembroContext`). Each Provider holds `{items, loading, error, refetch, create*, update*, delete*}` and is mounted only on the routes that need it (composition is explicit in `App.tsx`). The `useReservas` and `useReservasMutations` hooks both read from the same context.
- **TanStack Query is wired up** (`QueryClientProvider` in `main.tsx`, devtools mounted) but in practice only **a small subset of queries actually use it**. The dominant pattern is "Context + manual `useState`/`useEffect` + service calls". For new code, you may follow either pattern, but the Context-per-resource approach is more common and matches the rest of the codebase.

### Form handling
- Pure controlled inputs with `useState`. **No react-hook-form, no Formik.**
- Reusable atoms in `components/Shared/`:
  - `FormField` — `<TextField>` with built-in label/error/helperText handling.
  - `FormSelect`, `CampoFormulario`, `UserSelector`, `MultiUserSelector`.
- Validation is hand-rolled inside the component before submit.

### Data fetching pattern
- **Reads:** `services/queries/<resource>Queries.ts` exports plain async functions (`getReservas`, `getReservaBySlug`). The Context calls them inside `useEffect`.
- **Writes:** `services/mutations/<resource>Mutations.ts` exports plain async functions (`createReserva`, `updateReserva`, `deleteReserva`). The Context wraps them and updates local state on success.
- **Loading / error UI:** `loading` and `error` state are part of the Context shape; consumers read them via `useReservas()` and render `<CircularProgress />` or an alert.

### Routing conventions
- Path style: kebab-case lowercase (`/dashboard/pistas`, `/dashboard/incidencias`).
- Auth subpaths: `/auth/login`, `/auth/register`. Legacy aliases (`/login`, `/register`) `<Navigate to="/auth/login" replace />`.
- Protected routes: wrap in `<Route element={<AdminGuard />}>` ([App.tsx:121](react_client/src/App.tsx#L121)). `AdminGuard` uses `Outlet` from React Router 6.
- Layout wrappers: `<Layout>` (public) or `<DashboardLayout>` (admin) wrap each route's element.
- Slug-based routes: `/profile/:slug`. Resource pages don't use ids in URLs.

### Layouts and route groups
- `<Layout>` includes header + footer for public pages.
- `<DashboardLayout>` for admin pages.
- Nested context providers are added per route only when needed (not at the App level) — so a public page that doesn't need `ReservasContext` doesn't pay for it.

---

## 19. Styling & design system

### CSS approach
- **Material UI 5 + Emotion.** No Tailwind, no CSS modules in the React client (Next.js IA Gateway has CSS modules but it has no UI to speak of).
- A single global stylesheet `react_client/src/index.css` (resets only).
- Component-scoped styles via the MUI `sx` prop. Inline `sx={{ ... }}` is the dominant pattern.

### Component library
- `@mui/material` 5 + `@mui/icons-material` (>5000 icons available out of the box).
- Custom atoms in `components/Shared/` extend MUI primitives without modifying them.

### Design tokens
- Single source of truth: [react_client/src/theme/theme.ts](react_client/src/theme/theme.ts).
- Palette (concrete):
  | Token | Hex | Usage |
  |---|---|---|
  | `primary.main` | `#1565c0` | Buttons, links |
  | `primary.dark` | `#0d47a1` | Header / focus |
  | `secondary.main` | `#455a64` | Secondary text, chips |
  | `success.main` | `#43a047` | Confirmations |
  | `error.main` | `#e53935` | Errors |
  | `warning.main` | `#fb8c00` | Warnings |
  | `info.main` | `#1e88e5` | Informational |
  | `background.default` | `#f5f7fa` | App background |
  | `background.paper` | `#ffffff` | Cards |
  | `text.primary` | `#263238` | Body text |
  | `divider` | `#cfd8dc` | Separators |
- Typography: `Inter` family, 6 levels of headings, body sizes 0.875 / 1 rem.
- Border radius: global 8 px (`shape: { borderRadius: 8 }`); buttons override to 6.
- Buttons: `textTransform: 'none'` (no uppercase).
- Custom shadow scale (24 levels) defined inline.

### Dark mode
- Selected pages (Home, Shop, Profile) instantiate a **secondary dark theme** wrapper (mode: 'dark', background `#0a0e1a`) — described in MEMORIA.md §3.4 and visible in the Stripe modal styles ([ModalReservaPago.tsx:25-29](react_client/src/components/Shop/ModalReservaPago.tsx#L25-L29) — white-on-dark text). **There is no app-wide dark mode toggle.**

### Responsive breakpoints
- Standard MUI breakpoints (`xs 0, sm 600, md 900, lg 1200, xl 1536`). Used via `sx={{ display: { xs: 'block', md: 'flex' }}}`. No custom breakpoint overrides.

---

## 20. Accessibility

- **Mostly relies on MUI's built-in semantics**: `<Button>`, `<TextField>`, `<Dialog>` already render `aria-*` attributes.
- No explicit focus management code (no `useRef`-driven focus traps beyond MUI defaults).
- No keyboard-shortcut layer.
- No color-contrast audit pinned in CI.
- Listed as a future improvement in MEMORIA.md (point 10 — WCAG 2.1 AA).

**Treat as a gap.** When generating new components, do not regress what MUI gives you; do not introduce custom non-semantic clickable `<div>`s.

---

## 21. Internationalization

- **None.** All UI strings are hardcoded in Spanish (Castilian).
- All backend error messages are Spanish.
- All Bean Validation messages are Spanish.
- Listed as future work in MEMORIA.md (point 4 — `react-i18next` for valencià + English).
- Date formatting is via `date-fns` with the system locale.

---

## 22. Testing

### Frameworks
- **None wired in code.** Spring's `spring-boot-starter-test` is on the classpath ([pom.xml:118-122](springboot_server/pom.xml#L118-L122)) but no `*Test.java` files exist under `src/test/`.
- No Vitest, no Jest, no Cypress, no Playwright in the React client.
- No pytest in FastAPI.

### What exists
PowerShell smoke tests in the project root:
- [test-suite.ps1](test-suite.ps1) — auth flow happy path / failure modes via `curl.exe`.
- [test-auth.ps1](test-auth.ps1), [test-debug.ps1](test-debug.ps1) — additional probes.
- [test_auth.py](test_auth.py) — small Python helper.

These are **manual integration scripts** run during development, not CI tests.

### Mocks / fixtures
- None.

### Coverage expectation
- None.

### Real test files
There aren't any. **Treat this section as a gap.** When generating tests for a new feature, you cannot point to a "canonical test" in the repo — set up the framework first.

---

## 23. Naming conventions

### Files
| Layer | Convention | Example |
|---|---|---|
| Java entity | PascalCase singular | `Reserva.java`, `Pago.java`, `Usuario.java` |
| Java service | `<Domain>Service.java` | `ReservaService.java`, `PagoService.java` |
| Java repository | `<Domain>Repository.java` | `ReservaRepository.java` |
| Java router | `<Domain>Router.java` | `ReservaRouter.java`, `AuthRouter.java` |
| Java controller | `<Domain>Controller.java` | `ReservaController.java` |
| Java mapper | `<Domain>Mapper.java` | `ReservaMapper.java` |
| Java request DTO | `<Action><Domain>Request.java` | `ReservaCreateRequest.java`, `LoginRequest.java`, `CreatePaymentIntentRequest.java` |
| Java response DTO | `<Domain>Response.java` | `ReservaResponse.java`, `ReservaWithPagoResponse.java` |
| Java exception | `<Reason>Exception.java` | `DuplicateResourceException.java` |
| Python module | `lower_snake_case.py` | `pista_service.py`, `pista_repository_impl.py` |
| Python class | `PascalCase` | `class PistaService:` |
| React component | `PascalCase.tsx` | `LoginForm.tsx`, `ModalReservaPago.tsx`, `AdminGuard.tsx` |
| React page | `<Name>Page.tsx` | `HomePage.tsx`, `DashboardPage.tsx` |
| React hook | `use<Name>.ts` | `useReservas.ts`, `useAuth.ts`, `useDebouncedValue.ts` |
| React service | `<resource><Layer>.ts` | `reservasQueries.ts`, `reservasMutations.ts` |
| React context | `<Resource>Context.tsx` | `AuthContext.tsx`, `ReservasContext.tsx` |
| Flyway migration | `V<N>__<Snake_Case_Description>.sql` | `V11__Add_stripe_columns.sql` |

### Variables, functions, classes, constants
- Java: classes PascalCase, methods camelCase, constants `UPPER_SNAKE_CASE` (e.g. `ACCESS_MS_DEFAULT`, `REFRESH_COOKIE`).
- TypeScript: types/interfaces PascalCase, variables/functions camelCase, constants either UPPER_CASE or `const xyz = ...` if local.
- Python: variables/functions `lower_snake_case`, classes PascalCase, constants UPPER_CASE.

### Boolean naming
- `isActive`, `isAdmin`, `isAuth`, `isLoading`, `hasToken`, `hasCoreData`, `revoked`. **Lead with `is`/`has`/`should`/`can`.** Past-participle (`revoked`) is allowed when it reads more naturally.

### Async function naming
- No special suffix. `fetchReservas`, `getReservaBySlug`, `createPaymentIntent`. **No `Async` or `Promise` suffix.**

### Event handlers
- React: `handle<Event>` (`handlePagar` in [ModalReservaPago.tsx:54](react_client/src/components/Shop/ModalReservaPago.tsx#L54), `handleTokenRefreshed`, `handleSessionExpired`). Custom events use `auth:tokenRefreshed`, `auth:sessionExpired` — colon-namespaced.

### Database tables and columns
- Tables: lower_snake_case plural (`reservas`, `pagos`, `clases_publicas`, `refresh_sessions`).
- Columns: lower_snake_case (`fecha_hora_inicio`, `password_hash`).
- Booleans: `is_<adj>` (`is_active`).
- IDs: `<resource>_id` for foreign keys, `id` for primary keys.

---

## 24. Code style & linting

### TypeScript strictness
[react_client/tsconfig.json](react_client/tsconfig.json):
```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noFallthroughCasesInSwitch": true,
  "isolatedModules": true,
  "moduleResolution": "bundler",
  "jsx": "react-jsx",
  "paths": { "@/*": ["./src/*"] }
}
```

### ESLint (React client)
- Plugins: `@typescript-eslint`, `react-hooks`, `react-refresh`.
- `npm run lint` runs `eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0` — **0 warnings is the bar**.

### ESLint (IA Gateway)
- `eslint-config-next` (core-web-vitals + typescript) ([eslint.config.mjs](ia_gateway_next/eslint.config.mjs)).

### Prettier
- **Not configured.** Formatting is whatever the IDE's default is (4-space Java, 2-space TS).

### Pre-commit hooks
- None (no `.husky/`, no `lint-staged`).

### CI gates
- There is no CI in this repo (no `.github/workflows/`). MEMORIA.md flags this as future work (point 3).

---

## 25. SOLID & design principles in practice

### Single Responsibility
- **Applied:** the `presentation/router` does HTTP routing only and delegates to `presentation/controller`, which delegates to `application/service`. See `ReservaRouter` → `ReservaController` → `ReservaService`.
- **Pragmatic violation:** `UsuarioService` has 20+ methods covering CRUD plus password change plus role lookups — it's a god-service. Acceptable tradeoff for project size.

### Open/Closed
- **Applied:** the IA Gateway's provider abstraction. Adding a new LLM is "create a new `createXxxProvider` factory + register in `providerRegistry.ts`" — no existing provider code changes ([providerRegistry.ts](ia_gateway_next/src/modules/search/infrastructure/providerRegistry.ts)).
- **Violation:** `GlobalExceptionHandler` is a long if-else of `@ExceptionHandler`s — adding a new exception type requires editing this class.

### Liskov Substitution
- **Applied:** `PistaRepositoryImpl extends PistaRepository` (FastAPI ABC).
- Spring's `JpaRepository<E, Long>` extension is implicit LSP — clients depend on the interface, not the impl.

### Interface Segregation
- **Applied:** the `AIProvider` interface has just `name`, `chat`, `healthcheck` — providers don't implement methods they don't need.
- **Violation:** the per-resource Context exposes both reads (`reservas`, `loading`) and writes (`createReserva`, …) on the same object — consumers that only read still depend on the mutation methods. Mitigated by separate hooks (`useReservas` reads, `useReservasMutations` writes), but they read from the same context.

### Dependency Inversion
- **Applied (FastAPI):** `PistaService` depends on `PistaRepository` (abstract), receives `PistaRepositoryImpl` at the route boundary.
- **Violation (Spring):** `ReservaService` depends directly on `ReservaRepository extends JpaRepository<Reserva, Long>` — the abstraction IS framework-coupled. The codebase accepts this: Spring Data is treated as a building block, not as infrastructure to be hidden.

### DRY
- The `Router → Controller → Service → Mapper → Repository` pipeline IS the DRY pattern at the architectural level.
- Code duplication: mappers (`toDTO`, `toEntity`, `toResponse`) repeat similar field-by-field copy across modules. **Don't try to centralize them with reflection** — the pattern in this codebase is "copy the mapper, adjust fields".

### YAGNI
- No dependency-injection container abstraction beyond Spring's. No GraphQL even though it could fit. No hexagonal `Port` / `Adapter` interfaces — the framework is the port.

### Composition over inheritance
- React components are pure functional; inheritance never comes up.
- Services do not inherit from a base service. Composition via injected repositories.

---

## 26. Security checklist

| Concern | Status | Where |
|---|---|---|
| Input sanitization | Partial — Bean Validation strips egregious garbage; no HTML sanitization | `*Request.java` |
| SQL injection | Safe — JPA / Spring Data parameterized everywhere; native SQL only in `ReservaSchedulerService` (no user input) | — |
| XSS | Safe by default — React escapes everything; no `dangerouslySetInnerHTML` found | — |
| CSRF | **Disabled** — `csrf(csrf -> csrf.disable())` ([SecurityConfig.java:38](springboot_server/src/main/java/com/emotivapoli/security/config/SecurityConfig.java#L38)). Justified for stateless JWT + SameSite=Strict cookie, but the cookie is `secure(false)` — must change for prod |
| Password hashing | Argon2 with strong params (3 iters, 64 MiB, parallelism 1) | [SecurityConfig.passwordEncoder](springboot_server/src/main/java/com/emotivapoli/security/config/SecurityConfig.java#L118-L120) |
| Secrets management | Loaded from `.env` via Dotenv (Java) / `process.env` (Node/Next) / `os.getenv` (Python). **`.env` is not in the repo.** docker-compose pre-fills with default values for non-secret fields | docker-compose.yml |
| Rate limiting | **None.** No bucket4j, no Spring rate limiter, no Nginx limit_req. Login/register are wide open | — |
| Dependency scanning | **None.** No `npm audit` in CI, no Snyk, no Dependabot config | — |
| HTTPS enforcement | **Not enforced** — `secure(false)` on the refresh cookie, no `requiresChannel().anyRequest().requiresSecure()`. Nginx serves HTTP only. **Required to flip both for prod** | [AuthService.java:186](springboot_server/src/main/java/com/emotivapoli/auth/application/service/AuthService.java#L186), [react_client/nginx.conf](react_client/nginx.conf) |
| Webhook signature verification | Yes — `Webhook.constructEvent(payload, sigHeader, webhookSecret)` rejects unsigned events | [StripeWebhookRouter.java:66](springboot_server/src/main/java/com/emotivapoli/stripe/StripeWebhookRouter.java#L66) |
| CORS | Whitelisted explicit origins, `allowCredentials=true` | [SecurityConfig.corsConfigurationSource](springboot_server/src/main/java/com/emotivapoli/security/config/SecurityConfig.java#L93-L109). FastAPI uses `allow_origins=["*"]` ([main.py:18-24](fastapi_server/main.py#L18-L24)) — laxer; acceptable because FastAPI is read-only |
| Security headers | Nginx adds `X-Frame-Options SAMEORIGIN`, `X-Content-Type-Options nosniff`, `X-XSS-Protection 1; mode=block` | [react_client/nginx.conf:17-19](react_client/nginx.conf#L17-L19) |

---

## 27. Configuration & environments

### Loading
- **Spring:** `application.properties` for static config, `Dotenv.configure().directory("./").ignoreIfMissing().load()` for secrets. Same code in all environments.
- **FastAPI:** `python-dotenv` `load_dotenv()` + `os.getenv("DATABASE_URL", "default-fallback")`.
- **Next.js:** `process.env.<NAME>` — Next.js auto-loads `.env`/`.env.local`.
- **React:** Vite's `import.meta.env.VITE_<NAME>` — variables MUST be `VITE_*` prefixed to be exposed to the bundle.

### Validation at boot
- **None.** Missing env vars fall back to defaults (`STRIPE_SECRET_KEY` defaults to empty string and the next Stripe call fails at runtime).

### Dev vs prod differences
- The codebase makes the dev/prod distinction **only via env vars** — same code paths.
- Things flagged as TODOs:
  - `secure(false)` on the refresh cookie (must be `true` in prod).
  - CORS allowed origins are dev-only `localhost:*`.
  - `validate-on-migrate=false` for Flyway (dev convenience).
  - `spring.jpa.show-sql=true` (noisy in prod).

### Feature flags
- None.

---

## 28. Build & deployment

### Builds
- **Spring:** `mvn clean package -DskipTests -B` produces `target/*.jar`. Tests are skipped in the Dockerfile build.
- **React:** `npm run build` runs `tsc && vite build` → static `dist/`.
- **Next.js:** `next build` (App Router production build).
- **FastAPI:** no build step — copy source + `pip install -r requirements.txt`.

### Container strategy
- One Dockerfile per service. Multi-stage where compilation is needed:
  - Spring: `maven:3.9-eclipse-temurin-17-alpine` build stage → `eclipse-temurin:17-jre-alpine` run stage. Non-root user `spring`. Healthcheck via `/api/health`.
  - React: `node:18-alpine` build stage → `nginx:alpine` serve stage.
  - FastAPI: single-stage Python.
  - Next.js: single-stage Node.
- All wired by `docker-compose.yml` on a custom bridge network `emotivapoli_network`.

### Deployment
- Currently `docker compose up -d` on a single host (the project owner's VPS).
- No Kubernetes, no Helm.

### CI pipeline
- None checked in.

### Database migrations in deploy
- Flyway runs on Spring Boot startup. `baseline-on-migrate=true` so the first deploy against a non-empty DB is non-fatal. **There is no out-of-band migration step.**

---

## 29. Documentation conventions

### Comments
- **Spanish-language Javadoc / docstrings** are used liberally for non-trivial logic. Examples in [TokenService.java:17-20](springboot_server/src/main/java/com/emotivapoli/security/service/TokenService.java#L17-L20), [RefreshTokenService.java:18-26](springboot_server/src/main/java/com/emotivapoli/auth/application/service/RefreshTokenService.java#L18-L26), [AuthService.java:122-126](springboot_server/src/main/java/com/emotivapoli/auth/application/service/AuthService.java#L122-L126).
- Section dividers in long files use box-drawing dashes:
  ```java
  // ── Access Token ────────────────────────────────────────────────
  ```
  ([TokenService.java:46](springboot_server/src/main/java/com/emotivapoli/security/service/TokenService.java#L46), [AuthService.java:65](springboot_server/src/main/java/com/emotivapoli/auth/application/service/AuthService.java#L65), [apiSpring.ts:31](react_client/src/services/apiSpring.ts#L31)). **This is a house-style flourish — copy it for new long files.**
- Inline `// REUSE DETECTADO`, `// IDEMPOTENCIA: ...` comments mark security-critical branches.

### JSDoc / TSDoc
- Inconsistent. `/** ... */` is used on exported functions in services/queries (e.g. [authMutations.ts:48-50](react_client/src/services/mutations/authMutations.ts#L48-L50)), but not on every component.

### README structure
- Top-level [README.md](README.md): quick-start (script → manual), structure overview, technologies, requirements.
- Per-service README: matches the structure (`fastapi_server/README.md`, `react_client/README.md`, `springboot_server/README.md`, `ia_gateway_next/README.md`).
- [ARQUITECTURA.md](springboot_server/ARQUITECTURA.md) per service for architecture detail.
- [MEMORIA.md](MEMORIA.md) at the project root is the canonical narrative document (the academic memoria) — diagrams in Mermaid, decisions, trade-offs.

### ADRs
- None.

### OpenAPI
- Spring: `springdoc-openapi-starter-webmvc-ui` 2.3.0 → Swagger UI auto-generated at `/swagger-ui.html`. Routers use `@Tag(name = "...", description = "...")` and methods use `@Operation(summary = "...")`.
- FastAPI: free at `/docs` and `/redoc`.

---

## 30. Generation rules — the constitution

The 30 hard rules a code generator MUST follow to produce code that looks native to this codebase.

> **Rule 1 — One package per business domain, four layers each (Spring)**
> Every new domain module sits at `com.emotivapoli.<dominio>` with subpackages `application/{service[,mapper]}`, `domain/{entity,dto}`, `infrastructure/{repository[,mapper]}`, `presentation/{router,controller}` plus `presentation/schemas/{request,response}` (or the legacy flat `request/response/`).
> *Why:* every existing module obeys it, and the boundary discipline depends on this folder shape.
> *Example:* [com/emotivapoli/reserva/](springboot_server/src/main/java/com/emotivapoli/reserva)
> *Anti-pattern:* `com.emotivapoli.<dominio>.handlers` or putting JPA `@Entity` classes inside `presentation/`.

> **Rule 2 — Router is `@RestController`, Controller is `@Component`**
> The class with `@RequestMapping` and `@<Verb>Mapping` is named `<Domain>Router` and annotated `@RestController`. The class it delegates to is named `<Domain>Controller` and annotated `@Component`. The router NEVER touches `*Service` directly.
> *Why:* this two-step indirection is the project's house style; mixing them collapses the layered intent.
> *Example:* [ReservaRouter.java](springboot_server/src/main/java/com/emotivapoli/reserva/presentation/router/ReservaRouter.java) → [ReservaController.java](springboot_server/src/main/java/com/emotivapoli/reserva/presentation/controller/ReservaController.java)
> *Anti-pattern:* a single class that's both `@RestController` and contains business logic.

> **Rule 3 — Address resources by slug, never by id**
> All public REST paths use `{slug}` as the path variable (`/api/reservas/{slug}`, `/api/pistas/{slug}`). Internal `Long id` is for FKs and Stripe metadata only. Slugs are produced by `SlugUtils.generateSlug(...)` and must contain a 4-digit random suffix.
> *Why:* slugs are user-facing and stable; ids leak DB internals.
> *Example:* [ReservaRouter.java:36](springboot_server/src/main/java/com/emotivapoli/reserva/presentation/router/ReservaRouter.java#L36), [SlugUtils.java](springboot_server/src/main/java/com/emotivapoli/utils/SlugUtils.java)
> *Anti-pattern:* `/api/reservas/{id}` or `/api/reservas/{uuid}`.

> **Rule 4 — Triple identity on top-level entities**
> Every user-facing entity has `Long id` (`@GeneratedValue(IDENTITY)`), `UUID uid = UUID.randomUUID()` (UNIQUE), `String slug` (UNIQUE). Pure secondary catalogs (e.g. `Pista`) may skip `uid` but must keep `slug`.
> *Why:* the codebase's URL routing depends on slug; ids are stable; uid is the externalisable opaque id.
> *Example:* [Reserva.java:11-21](springboot_server/src/main/java/com/emotivapoli/reserva/domain/entity/Reserva.java#L11-L21), [Usuario.java:14-22](springboot_server/src/main/java/com/emotivapoli/usuario/domain/entity/Usuario.java#L14-L22)
> *Anti-pattern:* using only `Long id` and exposing it in URLs, or using auto-incrementing slugs.

> **Rule 5 — Status as `String` + DB CHECK constraint, never enum**
> Use a `String` column with a `// allowed: a, b, c` Javadoc comment AND add a `CHECK (status IN ('a','b','c'))` constraint in the corresponding Flyway migration. Default value is set both in Java (`= "pendiente"`) and SQL (`DEFAULT 'pendiente'`).
> *Why:* the codebase chooses runtime flexibility over Java's enum strictness; CHECK constraints prevent invalid writes from the FastAPI side too.
> *Example:* [Reserva.java:46-47](springboot_server/src/main/java/com/emotivapoli/reserva/domain/entity/Reserva.java#L46-L47), [V1__Initial_schema.sql:17-18](springboot_server/src/main/resources/db/migration/V1__Initial_schema.sql#L17-L18)
> *Anti-pattern:* `enum ReservaStatus { PENDIENTE, CONFIRMADA }`.

> **Rule 6 — Soft delete by default**
> Add `is_active BOOLEAN NOT NULL DEFAULT TRUE` and include `'eliminado'` as a status. Expose `PATCH /<resource>/{slug}/soft-delete` (returning 204), not `DELETE`. The repository's "active" finder filters `status != 'eliminado' AND is_active = true`.
> *Why:* the project never destroys business records.
> *Example:* [ReservaRouter.java:61-66](springboot_server/src/main/java/com/emotivapoli/reserva/presentation/router/ReservaRouter.java#L61-L66), [ReservaService.deleteReserva](springboot_server/src/main/java/com/emotivapoli/reserva/application/service/ReservaService.java#L223-L233)
> *Anti-pattern:* `DELETE /api/reservas/{slug}` with a real `repository.delete(...)` call.

> **Rule 7 — Flyway owns the schema, JPA validates only**
> All schema changes go in `src/main/resources/db/migration/V<N>__<Snake_Case_Description>.sql`. `spring.jpa.hibernate.ddl-auto=validate` must stay. FastAPI must NOT call `Base.metadata.create_all`.
> *Why:* one source of truth; both backends need to agree.
> *Example:* [V11__Add_stripe_columns.sql](springboot_server/src/main/resources/db/migration/V11__Add_stripe_columns.sql), [main.py:8-9](fastapi_server/main.py#L8-L9)
> *Anti-pattern:* setting `ddl-auto=update` "just for this one column".

> **Rule 8 — Repository is `JpaRepository<E, Long>` (Spring) or ABC + Impl (FastAPI)**
> Spring: declare `@Repository public interface <Domain>Repository extends JpaRepository<E, Long>`; add named finders (`findBySlug`, `existsBy<X>`) or `@Query` JPQL methods. Use `JpaSpecificationExecutor<E>` + a `default` Specification method for dynamic filters.
> FastAPI: declare an ABC in `domain/repository/`, an impl in `infrastructure/repository/`. Inject the impl in the route handler.
> *Why:* matches the existing pattern; mixing in raw EntityManager is reserved for native-SQL functions.
> *Example:* [ReservaRepository.java](springboot_server/src/main/java/com/emotivapoli/reserva/infrastructure/repository/ReservaRepository.java), [PistaRepository.java](springboot_server/src/main/java/com/emotivapoli/pista/infrastructure/repository/PistaRepository.java), [pista_repository.py](fastapi_server/app/pista/domain/repository/pista_repository.py)
> *Anti-pattern:* hand-rolled `entityManager.createQuery` inside a service.

> **Rule 9 — `@Transactional` lives on the service method, not the controller**
> The transaction boundary is the public service method. Use `@Transactional(isolation = Isolation.SERIALIZABLE)` for any flow that does "scan-then-write" on contended resources (bookings, payments). Use `@Transactional(noRollbackFor = SecurityException.class)` when the security side-effects (revoke family) must persist past the thrown exception.
> *Why:* matches the patterns in `PagoService` and `RefreshTokenService`.
> *Example:* [PagoService.java:91](springboot_server/src/main/java/com/emotivapoli/pago/application/service/PagoService.java#L91), [RefreshTokenService.java:95](springboot_server/src/main/java/com/emotivapoli/auth/application/service/RefreshTokenService.java#L95)
> *Anti-pattern:* `@Transactional` on a `@RestController`.

> **Rule 10 — Bean Validation on the Request DTO + `@Valid` on the router parameter**
> Every input DTO lives in `presentation/.../request/` and carries Jakarta validation annotations with **Spanish-language messages**. The router param is annotated `@Valid @RequestBody <T> request`.
> *Why:* it's the only validation layer; without `@Valid` annotations don't fire.
> *Example:* [RegisterRequest.java](springboot_server/src/main/java/com/emotivapoli/auth/presentation/request/RegisterRequest.java), [AuthRouter.java:31](springboot_server/src/main/java/com/emotivapoli/auth/presentation/router/AuthRouter.java#L31)
> *Anti-pattern:* validating inside the service with `if (request.getEmail() == null) throw ...`.

> **Rule 11 — Custom error envelope from `GlobalExceptionHandler`**
> Throw one of `{ResourceNotFoundException, DuplicateResourceException, ValidationException, BusinessException}` (or `SecurityException` for auth). Don't build response envelopes inline. Status mapping: `DuplicateResourceException → 409`, `ResourceNotFoundException → 404`, `ValidationException → 400`, `BusinessException → 422`, `SecurityException → 401`. Body shape: `{timestamp, status, error, message, path}`.
> *Why:* uniform shape across modules.
> *Example:* [GlobalExceptionHandler.java](springboot_server/src/main/java/com/emotivapoli/exception/GlobalExceptionHandler.java)
> *Anti-pattern:* returning `Map.of("error", "...")` directly from the router (`PagoRouter` does this and is a minority pattern — don't copy it).

> **Rule 12 — Reservations and payments must use SERIALIZABLE**
> Any new flow that books a slot, allocates a quota, or cobra-and-creates an external `PaymentIntent` MUST run inside `@Transactional(isolation = Isolation.SERIALIZABLE)` and treat `40001 serialization_failure` as a "user retried too fast" condition.
> *Why:* the codebase has no advisory locks or `SELECT ... FOR UPDATE`. SERIALIZABLE is the only mechanism that prevents double bookings.
> *Example:* [PagoService.createPaymentIntent](springboot_server/src/main/java/com/emotivapoli/pago/application/service/PagoService.java#L91)
> *Anti-pattern:* default `READ_COMMITTED` for booking creation, or trying to `LockModeType.PESSIMISTIC_WRITE` (not used in this codebase).

> **Rule 13 — Webhooks are signature-verified AND idempotent**
> Verify with the SDK (`Webhook.constructEvent(...)`). Persist the provider's intent id in a UNIQUE column. Before processing, guard with `if (status == 'completado') return 200`. Always return 200 for unknown event types — never 4xx.
> *Why:* Stripe replays events; a 4xx triggers reties forever.
> *Example:* [StripeWebhookRouter.java:64-103](springboot_server/src/main/java/com/emotivapoli/stripe/StripeWebhookRouter.java#L64-L103)
> *Anti-pattern:* trusting the body without `Webhook.constructEvent`, or returning 500 to a duplicated event.

> **Rule 14 — JWT access in header, refresh in HttpOnly cookie**
> Access token: `Authorization: Bearer <jwt>`, lifetime per role from `TokenService`. Refresh token: cookie `refreshToken` with `httpOnly`, `sameSite=Strict`, `path=/`. NEVER store refresh tokens in localStorage. NEVER read the refresh cookie from JavaScript.
> *Why:* mirrors the existing `AuthService` flow; XSS exposure of refresh tokens would defeat the whole rotation scheme.
> *Example:* [AuthService.buildRefreshCookie](springboot_server/src/main/java/com/emotivapoli/auth/application/service/AuthService.java#L179-L191)
> *Anti-pattern:* sending the refresh token in the body and storing it client-side.

> **Rule 15 — Refresh tokens rotate with family-id and SHA-256 hash**
> Every `createSession` issues a new `familyId` (UUID), persists `current_token_hash = SHA-256(rawToken)`. Every `rotate` checks the hash; mismatch → revoke whole family. Every password change increments `usuarios.session_version`.
> *Why:* this is the project's defense against token theft; it cannot be simplified without breaking the security model.
> *Example:* [RefreshTokenService.java](springboot_server/src/main/java/com/emotivapoli/auth/application/service/RefreshTokenService.java)
> *Anti-pattern:* storing refresh tokens raw, or skipping the family revocation on hash mismatch.

> **Rule 16 — `Argon2PasswordEncoder(16, 32, 1, 65536, 3)`**
> Don't substitute BCrypt, don't lower the parameters. The encoder bean lives in `SecurityConfig.passwordEncoder()`. Plain passwords never live past `AuthService.register/login`.
> *Why:* the existing user table was hashed with these parameters; changing them invalidates every existing login.
> *Example:* [SecurityConfig.java:118-120](springboot_server/src/main/java/com/emotivapoli/security/config/SecurityConfig.java#L118-L120)
> *Anti-pattern:* `BCryptPasswordEncoder()` or weaker Argon2 params.

> **Rule 17 — RBAC via `SecurityConfig` matchers, not `@PreAuthorize`**
> Add new admin-only routes by appending `requestMatchers(METHOD, PATH).hasRole("ADMIN")` in `SecurityConfig.securityFilterChain`. Don't introduce `@PreAuthorize` annotations even though `@EnableMethodSecurity` is on.
> *Why:* the file is the single inventory of who can call what; scattering it across services makes audits harder.
> *Example:* [SecurityConfig.java:41-71](springboot_server/src/main/java/com/emotivapoli/security/config/SecurityConfig.java#L41-L71)
> *Anti-pattern:* putting `@PreAuthorize("hasRole('ADMIN')")` on a service method.

> **Rule 18 — Secrets via Dotenv (Spring) / `os.getenv` (FastAPI) / `process.env` (Node)**
> Spring code reads secrets through `Dotenv.configure().directory("./").ignoreIfMissing().load().get("KEY", "fallback")`. Never hardcode.
> *Why:* same code runs in dev and prod, configured by env.
> *Example:* [TokenService.java:37-44](springboot_server/src/main/java/com/emotivapoli/security/service/TokenService.java#L37-L44), [PagoService.java:94-95](springboot_server/src/main/java/com/emotivapoli/pago/application/service/PagoService.java#L94-L95)
> *Anti-pattern:* hardcoded `"sk_live_..."` or putting the secret in `application.properties`.

> **Rule 19 — `application.properties` is config, not secret**
> Put non-sensitive defaults (port, datasource URL template, Flyway location, `show-sql`) in `application.properties`. Reference secrets there only via `${VAR:}` placeholders.
> *Why:* matches existing convention.
> *Example:* [application.properties:23-25](springboot_server/src/main/resources/application.properties#L23-L25)
> *Anti-pattern:* `stripe.api.key=sk_live_xxx` directly in the file.

> **Rule 20 — Frontend talks to Spring through `/api/springboot/*`**
> Use the `apiSpring` Axios instance, never raw `axios` or `fetch`. The Vite proxy and Nginx already rewrite this prefix to `<springboot>:8080/api/`. The cookie stays under the same origin as the SPA.
> *Why:* without the proxy the refresh cookie wouldn't be sent (different origin).
> *Example:* [apiSpring.ts](react_client/src/services/apiSpring.ts), [vite.config.ts:19-23](react_client/vite.config.ts#L19-L23), [nginx.conf:46-58](react_client/nginx.conf#L46-L58)
> *Anti-pattern:* `axios.post('http://localhost:8080/api/auth/login', ...)`.

> **Rule 21 — Axios interceptor handles 401 + shared `refreshPromise`**
> Don't write per-component "if 401 then refresh". `apiSpring.interceptors.response` already does it, including the shared promise that prevents multiple concurrent `/auth/refresh` calls (which would tripping reuse detection). New calls just `await apiSpring.<verb>(...)`.
> *Why:* refreshing in two places creates the very token-theft pattern the backend punishes by revoking the family.
> *Example:* [apiSpring.ts:50-115](react_client/src/services/apiSpring.ts#L50-L115)
> *Anti-pattern:* a custom `try/catch` that calls `/auth/refresh` from a component.

> **Rule 22 — `BroadcastChannel('auth')` for cross-tab token sync**
> When you refresh the token, post `{type: 'TOKEN_REFRESHED', token}` to `authChannel`. When you logout, post `{type: 'LOGOUT'}`. The same-tab listener uses a `window.dispatchEvent(new CustomEvent('auth:tokenRefreshed', ...))` because BroadcastChannel doesn't echo to the sender.
> *Why:* multi-tab sync is part of the auth UX; skipping it leaves stale state.
> *Example:* [apiSpring.ts:78-80](react_client/src/services/apiSpring.ts#L78-L80), [AuthContext.tsx:191-204](react_client/src/context/AuthContext.tsx#L191-L204)
> *Anti-pattern:* `window.location.reload()` to sync tabs.

> **Rule 23 — Pages are `default` exports, lazy-loaded; everything else is named export**
> `const HomePage = lazy(() => import('./pages/home/HomePage'))` requires `default`. Other components must export with `export const Name = ...` to keep tree-shaking and to avoid `lazy(... .then(m => ({ default: m.X })))` boilerplate (`AuthPage` is the rare exception).
> *Why:* matches existing routing conventions in `App.tsx`.
> *Example:* [App.tsx:19-33](react_client/src/App.tsx#L19-L33)
> *Anti-pattern:* `export default FormField` from a shared atom.

> **Rule 24 — Per-resource Context provider, mounted on the routes that need it**
> New resources get `<Resource>Context.tsx` exposing `{items, loading, error, refetch, create*, update*, delete*}`. The provider wraps only the routes that need it in `App.tsx`. Reads are exposed via `use<Resource>()`, writes via `use<Resource>Mutations()`, both reading from the same context.
> *Why:* the Context-per-resource pattern is dominant. TanStack Query is wired up but used for fewer cases.
> *Example:* [ReservasContext.tsx](react_client/src/context/ReservasContext.tsx), [App.tsx:144-158](react_client/src/App.tsx#L144-L158)
> *Anti-pattern:* a single global "AppContext" with all resources.

> **Rule 25 — `services/queries/*` and `services/mutations/*` are pure**
> Pure async functions that hit Axios — no React, no hooks. The Context layer wraps them. Type-driven: input/output types are defined in the same file or in `types/index.ts`.
> *Why:* lets the same functions be reused outside React (tests, scripts).
> *Example:* [reservasMutations.ts](react_client/src/services/mutations/reservasMutations.ts), [reservasQueries.ts](react_client/src/services/queries/reservasQueries.ts)
> *Anti-pattern:* `useReservaQuery` defined inside `services/`.

> **Rule 26 — All UI strings are Spanish; emojis follow MEMORIA-defined ranges**
> No i18n is wired. Write Spanish (Castilian) text directly. MUI components handle the layout; no string keys.
> *Why:* the project is for an academic Spanish-language deliverable.
> *Example:* anywhere — every `Alert`, `Button`, error message, validation label.
> *Anti-pattern:* introducing `react-i18next` mid-feature without scoping the migration.

> **Rule 27 — Theme tokens come from `theme/theme.ts`, never raw hex**
> Use `sx={{ color: 'primary.main' }}` or `theme.palette.primary.main`. Hand-rolled hex values are reserved for highly customised dark surfaces (e.g. `ModalReservaPago`) and the Stripe `<CardElement>` style block.
> *Why:* a single token change should propagate.
> *Example:* [theme.ts](react_client/src/theme/theme.ts)
> *Anti-pattern:* `<Box sx={{ color: '#1565c0' }} />` in a component.

> **Rule 28 — Spanish-language Javadoc with box-drawing dividers for non-trivial logic**
> Auth/security/payment files use `// ── Section ────...` dividers and rich Spanish docstrings. Match that voice in any new security or payment code. Public service methods get `/** ... */` describing the contract, including failure modes and security guarantees.
> *Why:* the project's reviewer expects this voice; it's how new contributors orient.
> *Example:* [RefreshTokenService.java:18-26](springboot_server/src/main/java/com/emotivapoli/auth/application/service/RefreshTokenService.java#L18-L26), [apiSpring.ts:24-30](react_client/src/services/apiSpring.ts#L24-L30)
> *Anti-pattern:* terse English one-liners on a security-critical method.

> **Rule 29 — Stripe webhook lives at `/stripe/webhook`, NOT under `/api/...`**
> The webhook router lives in `com/emotivapoli/stripe/StripeWebhookRouter.java` and uses `@PostMapping("/stripe/webhook")` with no `/api/` prefix. It must be `permitAll()` in `SecurityConfig`. Body must be read raw via `request.getInputStream()` to verify the signature.
> *Why:* same-origin auth conventions don't apply to a third-party caller; the prefix split keeps Spring Security rules clean.
> *Example:* [StripeWebhookRouter.java](springboot_server/src/main/java/com/emotivapoli/stripe/StripeWebhookRouter.java), [SecurityConfig.java:44](springboot_server/src/main/java/com/emotivapoli/security/config/SecurityConfig.java#L44)
> *Anti-pattern:* placing the webhook under `/api/stripe/webhook` and forgetting to permit it.

> **Rule 30 — IA Gateway providers are pure factories, registered in one place, blacklisted on failure**
> A new LLM goes in `src/modules/search/infrastructure/providers/<name>Provider.ts` exporting `createXxxProvider(apiKey: string): AIProvider`. Register it in `providerRegistry.ts` behind a `process.env.<KEY>` check. The `AIGatewayService.recommend` round-robins, blacklists for 2 minutes on failure, and gives up only when ALL providers are blacklisted.
> *Why:* matches the existing failover model.
> *Example:* [groqProvider.ts](ia_gateway_next/src/modules/search/infrastructure/providers/groqProvider.ts), [providerRegistry.ts](ia_gateway_next/src/modules/search/infrastructure/providerRegistry.ts), [aiGatewayService.ts](ia_gateway_next/src/modules/search/application/aiGatewayService.ts)
> *Anti-pattern:* a switch statement that hardcodes which provider to use, or no fallback when one fails.

> **Rule 31 — `mvn spring-boot:run`, `npm run dev`, `python main.py`, `next dev` — same code, env-only differences**
> A new feature must work in `docker compose up -d` AND in plain local dev. The only legitimate environment switch is via env var; no `if (process.env.NODE_ENV === 'production') ...` business logic.
> *Why:* it's how the project ships ("mismo código local y prod").
> *Example:* [docker-compose.yml](docker-compose.yml), [vite.config.ts:11-14](react_client/vite.config.ts#L11-L14)
> *Anti-pattern:* `if (isProd) callRealStripe(); else fakeIt();`.

> **Rule 32 — Spring Boot test starter exists but no tests are written; new features add manual smoke probes to `test-suite.ps1`**
> When you implement a new endpoint that spans auth, follow the existing `test-suite.ps1` pattern: a `CurlReq` call, a `Check $label $got $expected` assertion, separated by a `Write-Host` header. Don't introduce a JUnit test in isolation without aligning the broader test strategy with the project owner.
> *Why:* the project's review expects the existing PowerShell harness; isolated JUnit tests fragment the validation story.
> *Example:* [test-suite.ps1](test-suite.ps1)
> *Anti-pattern:* writing a single `@SpringBootTest` and calling the feature "covered".

---

## Open questions

Items that are unclear from the code alone and would normally require a conversation with the developer:

1. **Why does `MethodArgumentNotValidException` not have a custom handler?** Bean Validation failures currently surface as 500. Was this an oversight or is the JSON 500 envelope intentional?
2. **Is the `monitor` role real?** It appears in `TokenService` (`REFRESH_MS_MONITOR = 7 days`) but no migration creates such a user and `usuarios.role` only allows `('admin','cliente','entrenador')`.
3. **Resource-level authorization on `PUT /api/reservas/{slug}`** — there is no check that the caller owns the booking. Is this an MVP shortcut or by design?
4. **Why `secure(false)` on the refresh cookie?** Comment says "true en producción con HTTPS" — is there an env-flag plan for prod, or is the deployment expected to terminate TLS upstream?
5. **Why `validate-on-migrate=false`** in Flyway config? "V9 fue modificado manualmente" — is there an outstanding intent to fix V9's checksum and re-enable validation?
6. **Mixing field-injection (`@Autowired` private fields) with constructor injection in newer code (`AuthService`).** Is the migration in flight or are both styles intentionally accepted long-term?
7. **TanStack Query is wired up at the root but most resources use Context + manual fetch.** Was the project mid-migration to React Query, or is the Context pattern the deliberate end-state?
8. **No unit tests anywhere.** Is the academic timeline the only reason, or is there an explicit decision to ship the MVP without them?
9. **CORS in FastAPI is `allow_origins=["*"]`** versus a strict whitelist in Spring. Is the laxer policy intentional because FastAPI is read-only, or should it be tightened for parity?
10. **Several services use `RuntimeException` directly instead of the typed exceptions** — should those be progressively migrated to `ResourceNotFoundException`/`ValidationException`/etc., and is there a back-compat concern with the existing `GlobalExceptionHandler.handleRuntimeException` returning 400?
11. **No request-id / tracing.** Acceptable for the academic deliverable, but should generators add correlation ids preemptively for any new endpoint?
12. **The `evento` package has only an entity** — is `EventoPista` consumed anywhere except via the implicit overlap-detection in `ReservaService`? Is there a dormant feature here?
