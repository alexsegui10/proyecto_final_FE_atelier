/**
 * Shared frontend types. The Frontend Architect agent expands this with
 * per-feature DTOs and view models.
 */

export type Role = string;

export interface ApiError {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface Identifiable {
  id: string;
}

export interface SoftDeletable {
  isActive: boolean;
}

export interface Timestamped {
  createdAt: string;
  updatedAt: string;
}
