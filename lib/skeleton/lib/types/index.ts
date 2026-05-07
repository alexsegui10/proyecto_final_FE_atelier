/**
 * Shared TypeScript types for the generated app. Mirrors the polideportivo's
 * `react_client/src/types/index.ts` in spirit — a single source for
 * cross-module types so Domain/Application don't need to know about
 * presentation shapes.
 */

export type Role = string; // narrowed per project (e.g. "admin" | "alumno" | "profesor")

export interface ApiError {
  error: string;
  fields?: Record<string, string>;
}

export interface ApiResponse<T> {
  data: T;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: Pagination;
}

export interface Identifiable {
  id: string;
  slug: string;
}

export interface SoftDeletable {
  isActive: boolean;
  status: string;
}

export interface Timestamped {
  createdAt: string;
  updatedAt: string;
}
