// Admin service shared types (split module).
import type { AccessMode } from "../../persistence/database.js";
import type { TeamSpeakTarget } from "../../domain/teamspeak-target.js";
export interface AdminSettingsInput {
  target: string;
  serverPassword?: string;
  passwordAction?: "keep" | "replace" | "remove";
  accessMode: AccessMode;
  siteName: string;
  welcomeText: string;
  welcomeTextEn?: string;
  welcomeTextDe?: string;
  welcomeTextRu?: string;
  welcomeTextJa?: string;
  webRtcEnabled: boolean;
  webRtcUdpStart?: number;
  webRtcUdpEnd?: number;
  relaySettingsAction?: "keep" | "replace" | "remove";
  relayEnabled?: boolean;
  relayName?: string;
  relayTarget?: string;
  relayToken?: string;
  relayTokenAction?: "keep" | "replace" | "remove";
  relayNodes?: RelayNodeInput[];
}

export interface RelayNodeInput {
  id?: string;
  name: string;
  target: string;
  enabled: boolean;
  token?: string;
  tokenAction?: "keep" | "replace" | "remove";
}

export interface ConnectionPolicy {
  defaultTarget: TeamSpeakTarget;
  serverPassword: string;
  accessMode: AccessMode;
}

export interface ManagedInviteInput {
  channel: string;
  expiresInHours: number;
  maxUses: number;
}

export interface ManagedInviteView {
  id: string;
  target: string;
  channel: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  createdAt: string;
  revokedAt: string | null;
  status: "active" | "expired" | "exhausted" | "revoked";
}
