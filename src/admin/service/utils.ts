import { createHash } from "node:crypto";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function formatRelayTarget(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}#${port}`;
}
