import { describe, it, expect } from "vitest";

import {
  validateFormsValidationsV3,
  type FormsValidationsV3,
} from "./forms-validations.schema";

// ─── Fixture builder (v3 — includes mountHint, B-w4-13) ─────────────

function forms(over: Partial<FormsValidationsV3> = {}): FormsValidationsV3 {
  return {
    forms: [
      {
        name: "LoginForm",
        path: "client/components/forms/LoginForm.tsx",
        schemaFile: "client/lib/schemas/auth-schemas.ts",
        schemaName: "LoginSchema",
        mutation: "useLogin",
        fields: ["email", "password"],
        submitFlow: ["validate (Zod)", "mutateAsync", "toast.success"],
        mountHint: { pageRoute: "/sign-in", mountPattern: "inline" },
      },
      {
        name: "CreateBookingForm",
        path: "client/components/forms/CreateBookingForm.tsx",
        schemaFile: "client/lib/schemas/bookings-schemas.ts",
        schemaName: "CreateBookingSchema",
        mutation: "useCreateBooking",
        fields: ["classId"],
        mountHint: {
          pageRoute: "/shop/classes/[slug]",
          mountPattern: "trigger-dialog",
          triggerHint: "primary CTA 'Reservar plaza' (data-testid reservation-button)",
        },
      },
    ],
    schemaFiles: [
      "client/lib/schemas/auth-schemas.ts",
      "client/lib/schemas/bookings-schemas.ts",
    ],
    ...over,
  };
}

// ─── Happy path ─────────────────────────────────────────────────────

describe("formsValidationsSchemaV3 — happy path", () => {
  it("accepts inline + trigger-dialog mount patterns", () => {
    expect(validateFormsValidationsV3(forms())).toBeNull();
  });

  it("accepts trigger-dialog with a triggerHint", () => {
    expect(
      validateFormsValidationsV3(
        forms({
          forms: [
            {
              name: "CreateClassForm",
              path: "client/components/forms/CreateClassForm.tsx",
              schemaFile: "client/lib/schemas/classes-schemas.ts",
              schemaName: "CreateClassSchema",
              mutation: "useCreateClass",
              fields: ["title"],
              mountHint: {
                pageRoute: "/admin/classes",
                mountPattern: "trigger-dialog",
                triggerHint: "FAB 'Crear clase'",
              },
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});

// ─── B-w4-13 — field-specific rejections (FLAG C discipline) ────────

describe("formsValidationsSchemaV3 — B-w4-13 rejections", () => {
  it("rejects the v2 shape (no mountHint at all) — the B-w4-13 root cause", () => {
    const v2Shape = {
      forms: [
        {
          name: "CreateClassForm",
          path: "client/components/forms/CreateClassForm.tsx",
          schemaFile: "client/lib/schemas/classes-schemas.ts",
          schemaName: "CreateClassSchema",
          mutation: "useCreateClass",
          fields: ["title"],
          submitFlow: ["validate (Zod)", "mutateAsync"],
          // NO mountHint — exactly what the v2 prompt emitted (run-12 orphan)
        },
      ],
      schemaFiles: ["client/lib/schemas/classes-schemas.ts"],
    } as unknown;
    const err = validateFormsValidationsV3(v2Shape);
    expect(err).not.toBeNull();
    expect(err).toMatch(/mountHint/);
  });

  it("rejects mountHint.pageRoute missing", () => {
    const bad = forms({
      forms: [
        {
          name: "LoginForm",
          path: "client/components/forms/LoginForm.tsx",
          schemaFile: "client/lib/schemas/auth-schemas.ts",
          schemaName: "LoginSchema",
          mutation: "useLogin",
          fields: ["email"],
          // @ts-expect-error — intentionally missing required pageRoute
          mountHint: { mountPattern: "inline" },
        },
      ],
    });
    const err = validateFormsValidationsV3(bad);
    expect(err).not.toBeNull();
    expect(err).toMatch(/pageRoute/);
  });

  it("rejects mountPattern outside the enum", () => {
    const bad = forms({
      forms: [
        {
          name: "LoginForm",
          path: "client/components/forms/LoginForm.tsx",
          schemaFile: "client/lib/schemas/auth-schemas.ts",
          schemaName: "LoginSchema",
          mutation: "useLogin",
          fields: ["email"],
          // @ts-expect-error — "modal" is not a valid mountPattern
          mountHint: { pageRoute: "/sign-in", mountPattern: "modal" },
        },
      ],
    });
    const err = validateFormsValidationsV3(bad);
    expect(err).not.toBeNull();
    expect(err).toMatch(/mountPattern/);
  });

  it("rejects trigger-dialog without triggerHint (refinement)", () => {
    const bad = forms({
      forms: [
        {
          name: "CreateClassForm",
          path: "client/components/forms/CreateClassForm.tsx",
          schemaFile: "client/lib/schemas/classes-schemas.ts",
          schemaName: "CreateClassSchema",
          mutation: "useCreateClass",
          fields: ["title"],
          mountHint: { pageRoute: "/admin/classes", mountPattern: "trigger-dialog" },
        },
      ],
    });
    const err = validateFormsValidationsV3(bad);
    expect(err).not.toBeNull();
    expect(err).toMatch(/triggerHint/);
  });

  it("rejects an extra key inside mountHint (.strict)", () => {
    const bad = forms({
      forms: [
        {
          name: "LoginForm",
          path: "client/components/forms/LoginForm.tsx",
          schemaFile: "client/lib/schemas/auth-schemas.ts",
          schemaName: "LoginSchema",
          mutation: "useLogin",
          fields: ["email"],
          mountHint: {
            pageRoute: "/sign-in",
            mountPattern: "inline",
            // @ts-expect-error — mountHint is .strict()
            modalSize: "lg",
          },
        },
      ],
    });
    const err = validateFormsValidationsV3(bad);
    expect(err).not.toBeNull();
    expect(err).toMatch(/[Uu]nrecognized key|modalSize/);
  });
});
