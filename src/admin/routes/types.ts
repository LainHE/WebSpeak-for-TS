// Admin router shared types (split module).
import type { Logger } from "../../logger.js";
import type { AdminService } from "../admin-service.js";
import type { AdminSessionStore } from "../admin-session.js";
import type { AdminSessionSummary } from "../../server/voice-bridge.js";

export interface AdminConnectionRecord {
  id: string;
  nickname: string;
  clientIp: string;
  target: string;
  relayName: string | null;
  relayTarget: string | null;
  startedAt: string;
  connectedAt: string | null;
  disconnectedAt: string | null;
  durationSeconds: number | null;
  status: "active" | "connecting" | "disconnected" | "failed";
  reason: string | null;
  failureDetail: string | null;
}

export interface AdminRouterOptions {
  service: AdminService;
  sessions: AdminSessionStore;
  logger: Logger;
  getActiveSessions(): number;
  getPeakSessions(): number;
  getCreatedSessions?: () => number;
  getSessionSummaries?: () => AdminSessionSummary[];
  terminateSession?: (id: string) => Promise<boolean>;
  version?: string;
  logFile?: string;
  startedAt: number;
}

export interface AdminOverview {
  gateway: { uptimeSeconds: number };
  teamSpeak: {
    target: string;
    status: string;
    lastTestAt: string | null;
    latencyMs: number | null;
    lastError: string | null;
  };
}

export interface AdminLogEntry {
  timestamp: string | null;
  level: string;
  message: string;
  context: Record<string, string | number | boolean>;
}

export interface StructuredLogEntry {
  timestamp: string | null;
  message: string;
  raw: Record<string, unknown>;
}
