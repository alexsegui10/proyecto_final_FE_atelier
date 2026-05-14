import { describe, it, expect } from "vitest";

import {
  validateBrandIdentity,
  type BrandIdentity,
} from "./brand-identity.schema";

// ─── Fixture builder ────────────────────────────────────────────────

function microcopy30(): Record<string, string> {
  return {
    "button.primary.submit": "Confirmar",
    "button.primary.cancel": "Cancelar",
    "button.primary.delete": "Eliminar",
    "button.secondary.back": "Volver",
    "empty-state.classes.no-items": "Todavía no hay clases.",
    "empty-state.bookings.no-items": "No tenés reservas.",
    "empty-state.search.no-results": "Sin resultados.",
    "error.network.offline": "Sin conexión.",
    "error.network.retry": "Reintentar.",
    "error.validation.required": "Este campo es obligatorio.",
    "success.booking.created": "Reserva confirmada.",
    "success.profile.updated": "Perfil actualizado.",
    "loading.classes.fetching": "Cargando clases...",
    "loading.checkout.processing": "Procesando pago...",
    "placeholder.email": "tu@email.com",
    "placeholder.password": "Mínimo 8 caracteres",
    "placeholder.search.classes": "Buscar clases...",
    "tooltip.help.calendar": "Tocá un día para reservar.",
    "tooltip.help.membership": "Tu plan vigente.",
    "confirmation.booking.cancel": "¿Cancelar reserva?",
    "confirmation.account.delete": "¿Eliminar cuenta?",
    "validation.email.invalid": "Email inválido.",
    "validation.password.weak": "Contraseña débil.",
    "validation.required.field": "Campo obligatorio.",
    "navigation.home": "Inicio",
    "navigation.classes": "Clases",
    "navigation.profile": "Perfil",
    "navigation.signin": "Iniciar sesión",
    "navigation.signout": "Cerrar sesión",
    "navigation.admin": "Administrar",
  };
}

function brandIdentity(over: Partial<BrandIdentity> = {}): BrandIdentity {
  return {
    brand: {
      name: "Atelier Yoga",
      tagline: "Encontrá tu calma en cada clase",
      voice: "calm",
      tone: "intimate",
      logo: { kind: "wordmark", font: "Inter", tracking: "-0.02em" },
    },
    tentativePaletteHints: {
      primarySeed: "#4a7c59",
      vibeMood: "calm",
      rationale: "Verdes salvia muted evocan calma y naturaleza del yoga.",
    },
    tentativeFontHints: {
      sansSuggestion: "Inter",
      displaySuggestion: "Cormorant Garamond",
      rationale: "Pareja Inter/Cormorant — modernidad legible con headings editoriales.",
    },
    microcopy: microcopy30(),
    ...over,
  };
}

// ─── Happy path ─────────────────────────────────────────────────────

describe("brandIdentitySchema — happy path", () => {
  it("accepts a coherent yoga-style brand identity", () => {
    expect(validateBrandIdentity(brandIdentity())).toBeNull();
  });

  it("accepts SVG logo when discovery signals it", () => {
    const result = validateBrandIdentity(
      brandIdentity({
        brand: {
          name: "Atelier",
          tagline: "Calma respirada",
          voice: "calm",
          tone: "intimate",
          logo: {
            kind: "svg",
            inlineSvg:
              '<svg viewBox="0 0 100 32"><circle cx="14" cy="16" r="8" fill="#4a7c59"/></svg>',
          },
        },
      }),
    );
    expect(result).toBeNull();
  });

  it("accepts brand without displaySuggestion (admin-style brands)", () => {
    expect(
      validateBrandIdentity(
        brandIdentity({
          tentativeFontHints: {
            sansSuggestion: "Geist Sans",
            rationale: "Sans uniforme — dashboard tone, no display font needed.",
          },
        }),
      ),
    ).toBeNull();
  });

  it("accepts optional i18nLocales forward-compat field", () => {
    expect(validateBrandIdentity(brandIdentity({ i18nLocales: ["es-AR", "en-US"] }))).toBeNull();
  });
});

// ─── Microcopy refinements ──────────────────────────────────────────

describe("brandIdentitySchema — microcopy coverage refinements", () => {
  it("rejects when microcopy has fewer than 30 keys", () => {
    const m: Record<string, string> = {};
    const all = Object.entries(microcopy30());
    for (let i = 0; i < 20; i++) {
      const entry = all[i]!;
      m[entry[0]] = entry[1];
    }
    expect(validateBrandIdentity(brandIdentity({ microcopy: m }))).toMatch(/30 keys/);
  });

  it("rejects when microcopy covers fewer than 8 categories", () => {
    const m: Record<string, string> = {};
    // 30+ keys, all in just 3 categories: button.* / empty-state.* / error.*
    for (let i = 0; i < 12; i++) m[`button.fake.k${i}`] = `B${i}`;
    for (let i = 0; i < 10; i++) m[`empty-state.fake.k${i}`] = `E${i}`;
    for (let i = 0; i < 10; i++) m[`error.fake.k${i}`] = `R${i}`;
    expect(validateBrandIdentity(brandIdentity({ microcopy: m }))).toMatch(/8 distinct/);
  });

  it("rejects microcopy key that is not kebab-case dotted", () => {
    const m = { ...microcopy30(), "Bad.Key.WithCapitals": "no" };
    expect(validateBrandIdentity(brandIdentity({ microcopy: m }))).toMatch(/kebab-case/);
  });

  it("rejects single-segment keys (regex requires at least one dot)", () => {
    const m = { ...microcopy30(), "singlesegment": "no" };
    expect(validateBrandIdentity(brandIdentity({ microcopy: m }))).toMatch(/kebab-case/);
  });
});

// ─── Tentative hints refinements ────────────────────────────────────

describe("brandIdentitySchema — tentative hints", () => {
  it("rejects tentativePaletteHints.primarySeed not in #rrggbb format", () => {
    expect(
      validateBrandIdentity(
        brandIdentity({
          tentativePaletteHints: {
            primarySeed: "salvia" as never,
            vibeMood: "calm",
            rationale: "color suggestion",
          },
        }),
      ),
    ).toMatch(/primarySeed|hex/i);
  });

  it("rejects vibeMood not in enum", () => {
    expect(
      validateBrandIdentity(
        brandIdentity({
          tentativePaletteHints: {
            primarySeed: "#4a7c59",
            vibeMood: "exotic" as never,
            rationale: "color suggestion",
          },
        }),
      ),
    ).toMatch(/vibeMood/i);
  });

  it("rejects rationale shorter than 10 chars on tentativePaletteHints", () => {
    expect(
      validateBrandIdentity(
        brandIdentity({
          tentativePaletteHints: {
            primarySeed: "#4a7c59",
            vibeMood: "calm",
            rationale: "short",
          },
        }),
      ),
    ).toMatch(/rationale|10/);
  });

  it("rejects rationale shorter than 10 chars on tentativeFontHints", () => {
    expect(
      validateBrandIdentity(
        brandIdentity({
          tentativeFontHints: {
            sansSuggestion: "Inter",
            rationale: "short",
          },
        }),
      ),
    ).toMatch(/rationale|10/);
  });
});

// ─── Rework removed shapes are gone ─────────────────────────────────

describe("brandIdentitySchema — rework removed legacy fields", () => {
  it("rejects when 17-slot palette is present (legacy field)", () => {
    const legacy = {
      ...brandIdentity(),
      palette: {
        primary: "#4a7c59",
        primaryForeground: "#ffffff",
        background: "#fafaf7",
        foreground: "#1f1f1f",
        muted: "#e8e8e3",
        mutedForeground: "#5b5b5b",
        seededFrom: "tweakcn-calm-salvia",
      },
    };
    expect(validateBrandIdentity(legacy)).toMatch(/palette|unrecognized/i);
  });

  it("rejects when typography canonical block is present (legacy field)", () => {
    const legacy = {
      ...brandIdentity(),
      typography: {
        fontFamilies: { sans: "Inter, system-ui", mono: "monospace" },
        scale: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48 },
        weights: [400, 700],
        webFonts: [],
      },
    };
    expect(validateBrandIdentity(legacy)).toMatch(/typography|unrecognized/i);
  });
});
