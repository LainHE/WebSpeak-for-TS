import { AdminInputError } from "../admin-service.js";

export function readRelaySettingsAction(value: unknown): "keep" | "replace" | "remove" {
  return value === "replace" || value === "remove" ? value : "keep";
}

export function readPasswordAction(value: unknown): "keep" | "replace" | "remove" {
  return value === "replace" || value === "remove" ? value : "keep";
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminInputError("INVALID_REQUEST", "Request body is invalid");
  return value as Record<string, unknown>;
}

export function readString(body: Record<string, unknown>, key: string, max: number): string {
  if (typeof body[key] !== "string" || body[key].length > max) throw new AdminInputError("INVALID_REQUEST", `${key} is invalid`);
  return body[key];
}

export function readOptionalInteger(body: Record<string, unknown>, key: string): number | undefined {
  if (body[key] === undefined) return undefined;
  if (typeof body[key] !== "number" || !Number.isSafeInteger(body[key])) {
    throw new AdminInputError("INVALID_REQUEST", `${key} is invalid`);
  }
  return body[key];
}

export function readOptionalString(body: Record<string, unknown>, key: string, max: number): string {
  return typeof body[key] === "string" ? body[key].slice(0, max) : "";
}

export function readOptionalNumber(body: Record<string, unknown>, key: string, fallback: number): number {
  return body[key] === undefined ? fallback : typeof body[key] === "number" ? body[key] : Number.NaN;
}

export function readLimit(value: unknown, fallback: number): number {
  const limit = typeof value === "string" ? Number(value) : fallback;
  return Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : fallback;
}
