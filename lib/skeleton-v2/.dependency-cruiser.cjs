/**
 * Dependency-cruiser config v2 — feature-first Clean Architecture.
 *
 * Layout: src/<feature>/<layer>/* where layer ∈ {domain, application, infrastructure, presentation}
 * Allowed direction (inwards):
 *   domain ⇐ application ⇐ infrastructure ⇐ presentation
 *
 * No layer below may import from a layer above. domain has zero
 * external runtime deps (no prisma, no next, no react).
 */
module.exports = {
  forbidden: [
    {
      name: "no-domain-to-infra",
      severity: "error",
      comment: "Domain is pure: cannot reach into infrastructure.",
      from: { path: "^src/[^/]+/domain" },
      to: { path: "^src/[^/]+/infrastructure" },
    },
    {
      name: "no-domain-to-app",
      severity: "error",
      comment: "Domain has no upward dependencies (application sits above it).",
      from: { path: "^src/[^/]+/domain" },
      to: { path: "^src/[^/]+/application" },
    },
    {
      name: "no-domain-to-presentation",
      severity: "error",
      comment: "Domain has no knowledge of HTTP, controllers, or UI.",
      from: { path: "^src/[^/]+/domain" },
      to: { path: "^src/[^/]+/presentation" },
    },
    {
      name: "no-app-to-presentation",
      severity: "error",
      comment:
        "Application orchestrates domain; presentation calls into application, not the reverse.",
      from: { path: "^src/[^/]+/application" },
      to: { path: "^src/[^/]+/presentation" },
    },
    {
      name: "no-app-to-infra-impl",
      severity: "error",
      comment: "Application depends on Repository INTERFACES, never on *Impl concrete classes.",
      from: { path: "^src/[^/]+/application" },
      to: { path: "^src/[^/]+/infrastructure/.+Impl\\.ts$" },
    },
    {
      name: "no-prisma-in-domain-app",
      severity: "error",
      comment: "Prisma client only lives in infrastructure layer.",
      from: { path: "^src/[^/]+/(domain|application)" },
      to: { path: "@prisma/client|^prisma$" },
    },
    {
      name: "no-react-in-domain-app",
      severity: "error",
      comment: "Domain and application are framework-agnostic.",
      from: { path: "^src/[^/]+/(domain|application)" },
      to: { path: "^(react|react-dom|next|next/.+)$" },
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
      severity: "warn",
      comment: "Stand-alone files with no incoming or outgoing deps.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(?:js|ts|tsx|json)$",
          "\\.d\\.ts$",
          "(^|/)tsconfig\\.json$",
          "(^|/)(?:babel|webpack|next|tailwind|postcss|playwright|vitest|eslint|prettier)\\.config\\.[a-z]+$",
          // Next.js App Router files are auto-discovered by filename, not imported.
          "^app/.+/(page|layout|template|loading|error|not-found|route)\\.tsx?$",
          "^app/(layout|page|not-found|error|loading|globals\\.css)\\.(tsx?|css)$",
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
