/**
 * Dependency-cruiser config — enforces Clean Architecture boundaries.
 *
 * Allowed direction (low layer ↑ high layer):
 *   domain ⇐ application ⇐ infrastructure ⇐ presentation
 *
 * No layer below may import from a layer above. domain has zero
 * external runtime deps (no prisma, no next, no react).
 */
module.exports = {
  forbidden: [
    {
      name: "domain-must-not-import-anything-above",
      severity: "error",
      comment:
        "Pure domain code: no infrastructure, no application, no presentation, no Prisma, no Next, no React.",
      from: { path: "^src/domain" },
      to: {
        path: [
          "^src/application",
          "^src/infrastructure",
          "^src/presentation",
          "^node_modules/(prisma|@prisma|next|react|react-dom|@casl|better-auth)",
        ],
      },
    },
    {
      name: "application-must-not-import-infrastructure",
      severity: "error",
      comment:
        "Application talks to domain only. Infrastructure is injected from presentation.",
      from: { path: "^src/application" },
      to: { path: "^src/(infrastructure|presentation)" },
    },
    {
      name: "application-must-not-import-prisma",
      severity: "error",
      comment:
        "Use cases are persistence-agnostic. Prisma lives in src/infrastructure only.",
      from: { path: "^src/application" },
      to: { path: "^node_modules/(prisma|@prisma)" },
    },
    {
      name: "presentation-route-handlers-only-from-application",
      severity: "warn",
      comment:
        "Route handlers and server components compose use cases — they don't reach into infrastructure directly except for DI wiring.",
      from: {
        path: "^app",
        pathNot: "^app/.+/_di\\.ts$",
      },
      to: { path: "^src/infrastructure", pathNot: "^src/infrastructure/auth/middleware" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "No circular dependencies anywhere.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "info",
      comment: "Stand-alone files with no incoming or outgoing deps.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(?:js|ts|tsx|json)$",
          "\\.d\\.ts$",
          "(^|/)tsconfig\\.json$",
          "(^|/)(?:babel|webpack|next|tailwind|postcss|playwright|vitest|eslint)\\.config\\.[a-z]+$",
          // Next.js App Router files are auto-discovered by filename, not imported.
          "^app/.+/(page|layout|template|loading|error|not-found|route)\\.tsx?$",
          "^app/(layout|page|globals\\.css)\\.(tsx?|css)$",
          "^app/.+/route\\.tsx?$",
          // Next.js root-level convention files
          "^next\\.config\\.ts$",
          "^next-env\\.d\\.ts$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["main", "types"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
