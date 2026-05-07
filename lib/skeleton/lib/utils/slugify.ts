/**
 * Equivalent of `SlugUtils.generateSlug(...)` from the polideportivo Java code.
 * Produces a URL-safe slug from arbitrary text plus a 4-character random
 * suffix so collisions are exceedingly unlikely without a uniqueness check.
 */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return base ? `${base}-${suffix}` : suffix;
}
