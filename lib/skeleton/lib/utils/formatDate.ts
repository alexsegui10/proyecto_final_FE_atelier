/**
 * Format a Date or ISO string in `es-ES`. Equivalent in spirit to the
 * polideportivo's `formatLocalDateTime.ts` — Castilian locale, 24h time.
 */
export function formatDate(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString("es-ES", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatDateTime(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("es-ES", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatRelative(value: Date | string | number, now: number = Date.now()): string {
  const d = value instanceof Date ? value : new Date(value);
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const rtf = new Intl.RelativeTimeFormat("es-ES", { numeric: "auto" });
  if (abs < hour) return rtf.format(Math.round(diff / min), "minute");
  if (abs < day) return rtf.format(Math.round(diff / hour), "hour");
  return rtf.format(Math.round(diff / day), "day");
}
