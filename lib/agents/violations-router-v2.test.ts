import { describe, it, expect } from "vitest";

import {
  routeViolationToAgent,
  AGENT_NAMES_V2,
  type AgentNameV2,
} from "./violations-router-v2";

describe("routeViolationToAgent — v2 feature-first paths", () => {
  it.each<[string, AgentNameV2]>([
    // Wave 2 — Domain Modeler
    ["src/bookings/domain/entity/Booking.ts", "domain-modeler"],
    ["src/bookings/domain/dto/BookingDTO.ts", "domain-modeler"],
    ["src/bookings/domain/errors.ts", "domain-modeler"],
    ["src/classes/domain/entity/Class.ts", "domain-modeler"],
    ["src/_shared/domain/errors.ts", "domain-modeler"],

    // Wave 2 — Persistence
    ["prisma/schema.prisma", "persistence"],
    ["prisma/migrations/20260507_init/migration.sql", "persistence"],
    ["prisma.config.ts", "persistence"],
    ["src/bookings/infrastructure/repository/BookingRepository.ts", "persistence"],
    ["src/bookings/infrastructure/repository/BookingRepositoryImpl.ts", "persistence"],
    ["src/classes/application/mapper/ClassMapper.ts", "persistence"],
    ["src/_shared/infrastructure/db/client.ts", "persistence"],
    ["src/_shared/infrastructure/db/generated/index.ts", "persistence"],
  ])("routes %s to %s", (path, expected) => {
    expect(routeViolationToAgent(path)).toBe(expected);
  });
});

describe("routeViolationToAgent — Wave 3 (services + auth + rbac)", () => {
  it.each<[string, AgentNameV2]>([
    // Service Layer (NOT auth)
    ["src/bookings/application/service/BookingsService.ts", "service-layer"],
    ["src/classes/application/service/ClassesService.ts", "service-layer"],
    ["src/memberships/application/service/MembershipsService.ts", "service-layer"],
    ["src/_shared/application/transaction.ts", "service-layer"],

    // Auth & Security (high priority — must win over generic service rule)
    ["src/auth/application/service/AuthService.ts", "auth-security"],
    ["src/auth/application/service/TokenService.ts", "auth-security"],
    ["src/auth/application/service/RefreshTokenService.ts", "auth-security"],
    ["src/auth/application/service/JwtBlacklistService.ts", "auth-security"],
    ["src/auth/infrastructure/filter/SecurityFilter.ts", "auth-security"],
    ["src/auth/presentation/controller/AuthController.ts", "auth-security"],
    ["src/auth/presentation/router/AuthRouter.ts", "auth-security"],
    ["app/api/auth/login/route.ts", "auth-security"],
    ["app/api/auth/refresh/route.ts", "auth-security"],
    ["proxy.ts", "auth-security"],
    ["middleware.ts", "auth-security"],

    // RBAC (NARROWER subset of auth — must win over auth-security)
    ["src/auth/abilities.ts", "rbac-authorization"],
    ["src/auth/application/abilities.ts", "rbac-authorization"],
    ["src/auth/application/AuthorizationService.ts", "rbac-authorization"],
    ["src/auth/infrastructure/middleware/withAuthorization.ts", "rbac-authorization"],
  ])("routes %s to %s", (path, expected) => {
    expect(routeViolationToAgent(path)).toBe(expected);
  });
});

describe("routeViolationToAgent — Wave 4 (presentation)", () => {
  it.each<[string, AgentNameV2]>([
    // API Backend (controllers, routers, requests, responses)
    ["src/bookings/presentation/controller/BookingsController.ts", "api-backend"],
    ["src/bookings/presentation/router/BookingsRouter.ts", "api-backend"],
    ["src/bookings/presentation/request/CreateBookingRequest.ts", "api-backend"],
    ["src/bookings/presentation/response/BookingResponse.ts", "api-backend"],
    ["src/_shared/presentation/errors/GlobalExceptionHandler.ts", "api-backend"],
    ["app/api/bookings/route.ts", "api-backend"],
    ["app/api/bookings/[slug]/route.ts", "api-backend"],
    ["app/api/classes/route.ts", "api-backend"],
    ["docs/api/openapi.yaml", "api-backend"],

    // Frontend Architect
    ["client/context/AuthContext.tsx", "frontend-architect"],
    ["client/context/BookingsContext.tsx", "frontend-architect"],
    ["client/hooks/queries/useBookings.ts", "frontend-architect"],
    ["client/hooks/mutations/useCreateBooking.ts", "frontend-architect"],
    ["client/services/queries/bookingsQueries.ts", "frontend-architect"],
    ["client/services/mutations/bookingsMutations.ts", "frontend-architect"],
    ["client/services/apiBackend.ts", "frontend-architect"],
    ["client/services/JwtService.ts", "frontend-architect"],
    ["client/types/index.ts", "frontend-architect"],

    // Forms & Validations (narrower than UI Components — must win)
    ["client/components/forms/CreateBookingForm.tsx", "forms-validations"],
    ["client/components/forms/SignUpForm.tsx", "forms-validations"],
    ["client/lib/schemas/bookings-schemas.ts", "forms-validations"],
    ["client/hooks/useFormError.ts", "forms-validations"],

    // UI Components
    ["client/components/ui/button.tsx", "ui-components"],
    ["client/components/ui/dialog.tsx", "ui-components"],
    ["client/components/Auth/LoginForm.tsx", "ui-components"],
    ["client/components/Layout/Header.tsx", "ui-components"],
    ["client/components/Home/HeroSection.tsx", "ui-components"],
    ["client/components/Shop/FiltersClasses.tsx", "ui-components"],
    ["client/components/Profile/ProfileTabs.tsx", "ui-components"],
    ["client/components/Admin/TablaBookings.tsx", "ui-components"],
    ["client/components/Shared/AuthGuard.tsx", "ui-components"],

    // Pages & Routing
    ["app/page.tsx", "pages-routing"],
    ["app/layout.tsx", "pages-routing"],
    ["app/not-found.tsx", "pages-routing"],
    ["app/(public)/layout.tsx", "pages-routing"],
    ["app/(public)/sign-in/page.tsx", "pages-routing"],
    ["app/(dashboard)/profile/page.tsx", "pages-routing"],
    ["app/(dashboard)/admin/users/page.tsx", "pages-routing"],
    ["app/(dashboard)/loading.tsx", "pages-routing"],
    ["app/(dashboard)/error.tsx", "pages-routing"],
  ])("routes %s to %s", (path, expected) => {
    expect(routeViolationToAgent(path)).toBe(expected);
  });
});

describe("routeViolationToAgent — Wave 5 (data + tests)", () => {
  it.each<[string, AgentNameV2]>([
    // Seeds & Fixtures
    ["prisma/seed.ts", "seeds-fixtures"],
    ["prisma/seed-data/users.json", "seeds-fixtures"],
    ["prisma/seed-data/classes.json", "seeds-fixtures"],
    ["tests/fixtures/in-memory-repos.ts", "seeds-fixtures"],

    // Tests Writer
    ["tests/unit/bookings/BookingsService.test.ts", "tests-writer"],
    ["tests/integration/bookings.api.test.ts", "tests-writer"],
    ["tests/e2e/sign-up.spec.ts", "tests-writer"],
    ["tests/e2e/booking-flow.spec.ts", "tests-writer"],
    ["tests/helpers/test-db.ts", "tests-writer"],
    ["tests/helpers/auth-helpers.ts", "tests-writer"],
    ["src/bookings/application/service/BookingsService.test.ts", "tests-writer"],
    ["client/components/forms/CreateBookingForm.test.tsx", "tests-writer"],
  ])("routes %s to %s", (path, expected) => {
    expect(routeViolationToAgent(path)).toBe(expected);
  });
});

describe("routeViolationToAgent — Wave 1 (planning + design)", () => {
  it.each<[string, AgentNameV2]>([
    // Architect
    ["docs/ARCHITECTURE.md", "architect"],
    ["README.md", "architect"],

    // UX/UI Designer
    ["client/theme/tokens.ts", "ux-ui-designer"],
    ["client/theme/index.ts", "ux-ui-designer"],
    ["app/globals.css", "ux-ui-designer"],
    ["tailwind.config.ts", "ux-ui-designer"],

    // Seeds Shape Designer (planning artifact)
    ["docs/seeds-plan.md", "seeds-shape"],
  ])("routes %s to %s", (path, expected) => {
    expect(routeViolationToAgent(path)).toBe(expected);
  });
});

describe("routeViolationToAgent — v1 layer-first backwards compatibility", () => {
  it.each<[string, AgentNameV2]>([
    // Old domain layout (now domain-modeler in v2)
    ["src/domain/bookings/entity.ts", "domain-modeler"],
    ["src/domain/_shared/errors.ts", "domain-modeler"],

    // Old infrastructure layout (now persistence in v2)
    ["src/infrastructure/bookings/repository.ts", "persistence"],
    ["src/infrastructure/classes/mapper.ts", "persistence"],
    ["src/infrastructure/db/client.ts", "persistence"],

    // Old application layout — non-auth use cases route to service-layer
    ["src/application/bookings/use-cases/create-booking.ts", "service-layer"],
    ["src/application/_shared/transaction.ts", "service-layer"],

    // Old auth files (paths under src/{application,infrastructure,presentation}/auth)
    ["src/application/auth/AuthService.ts", "auth-security"],
    ["src/infrastructure/auth/better-auth.ts", "auth-security"],
    ["src/presentation/auth/with-auth.ts", "auth-security"],

    // RBAC subset of auth (priority wins)
    ["src/application/auth/abilities.ts", "rbac-authorization"],
    ["src/application/auth/AuthorizationService.ts", "rbac-authorization"],

    // Old presentation layout (non-auth) → api-backend
    ["src/presentation/bookings/controller.ts", "api-backend"],

    // Old src/components/ (now client/components/) → ui-components
    ["src/components/Layout/Header.tsx", "ui-components"],
  ])("v1 path %s routes to v2 agent %s", (path, expected) => {
    expect(routeViolationToAgent(path)).toBe(expected);
  });
});

describe("routeViolationToAgent — edge cases", () => {
  it("normalizes Windows backslashes", () => {
    expect(routeViolationToAgent("src\\bookings\\domain\\entity\\Booking.ts")).toBe(
      "domain-modeler",
    );
    expect(routeViolationToAgent("client\\components\\forms\\Login.tsx")).toBe(
      "forms-validations",
    );
  });

  it("strips :line:col suffixes from QA violation paths", () => {
    expect(routeViolationToAgent("src/bookings/domain/entity/Booking.ts:42")).toBe(
      "domain-modeler",
    );
    expect(routeViolationToAgent("app/api/bookings/route.ts:13:5")).toBe("api-backend");
    expect(routeViolationToAgent("prisma/schema.prisma:7")).toBe("persistence");
  });

  it("returns null for empty or whitespace-only paths", () => {
    expect(routeViolationToAgent("")).toBeNull();
    expect(routeViolationToAgent("   ")).toBeNull();
  });

  it("returns null for paths outside any agent's territory", () => {
    expect(routeViolationToAgent("scripts/migrate-db.ts")).toBeNull();
    expect(routeViolationToAgent(".github/workflows/ci.yml")).toBeNull();
    expect(routeViolationToAgent("CHANGELOG.md")).toBeNull();
    expect(routeViolationToAgent("vercel.json")).toBeNull();
  });

  it("priority resolution: RBAC wins over Auth on abilities.ts", () => {
    // Both rules match `src/auth/application/abilities.ts` — RBAC has priority 12, auth-sec has 11.
    expect(routeViolationToAgent("src/auth/application/abilities.ts")).toBe(
      "rbac-authorization",
    );
  });

  it("priority resolution: Auth wins over Service on src/auth/.../service/", () => {
    // Both auth-security (priority 11) and service-layer (priority 7) could match
    // src/auth/application/service/AuthService.ts, but service-layer is excluded
    // by negative lookahead. auth-security wins.
    expect(routeViolationToAgent("src/auth/application/service/AuthService.ts")).toBe(
      "auth-security",
    );
  });

  it("priority resolution: Forms wins over UI Components on client/components/forms/", () => {
    // Both forms-validations (priority 9) and ui-components (priority 4) could
    // match. Forms wins.
    expect(routeViolationToAgent("client/components/forms/SignInForm.tsx")).toBe(
      "forms-validations",
    );
  });

  it("priority resolution: Persistence wins over Domain on prisma/schema.prisma", () => {
    expect(routeViolationToAgent("prisma/schema.prisma")).toBe("persistence");
  });

  it("priority resolution: Tests Writer wins over the source-file rule on .test.ts", () => {
    // src/bookings/application/service/BookingsService.test.ts could match both
    // service-layer (the source rule) and tests-writer. Tests writer should win.
    expect(routeViolationToAgent("src/bookings/application/service/BookingsService.test.ts")).toBe(
      "tests-writer",
    );
  });

  it("does not include disabled or unknown agent names", () => {
    // Sanity: every routed agent name must be in AGENT_NAMES_V2
    const samplePaths = [
      "src/bookings/domain/entity/Booking.ts",
      "prisma/schema.prisma",
      "src/auth/abilities.ts",
      "client/components/forms/SignInForm.tsx",
      "tests/e2e/login.spec.ts",
    ];
    for (const p of samplePaths) {
      const a = routeViolationToAgent(p);
      expect(a).not.toBeNull();
      expect(AGENT_NAMES_V2).toContain(a);
    }
  });
});
