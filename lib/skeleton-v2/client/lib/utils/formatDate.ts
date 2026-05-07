import { format, formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";

function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  return parseISO(value);
}

export function formatDate(value: Date | string | number, pattern = "dd MMM yyyy"): string {
  return format(toDate(value), pattern, { locale: es });
}

export function formatDateTime(value: Date | string | number): string {
  return format(toDate(value), "dd MMM yyyy · HH:mm", { locale: es });
}

export function formatRelative(value: Date | string | number): string {
  return formatDistanceToNow(toDate(value), { addSuffix: true, locale: es });
}
