import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { applyTheme, getStoredTheme, type ThemeMode } from "../../services/theme.js";
import { DEFAULT_WELCOME_TEXTS } from "../../modules/admin/translations.js";

export type Language = "zh" | "en" | "de" | "ru" | "ja";
export type Screen = "login" | "change-password" | "admin";
export type AccessMode = "fixed" | "open";
export interface ProbeState { ok: boolean; checkType?: "network" | "protocol"; passwordVerified?: boolean; latencyMs?: number; serverName?: string | null; packetLossPercent?: number; attempts?: number; successfulAttempts?: number; code?: string; errorCode?: string }
export interface RelayNodeForm { id: string; name: string; enabled: boolean; target: string; token: string; tokenAction: "keep" | "replace" | "remove"; hasToken: boolean }
export type WelcomeLanguage = "zh" | "en" | "de" | "ru" | "ja";
export type WelcomeTextField = "welcomeText" | "welcomeTextEn" | "welcomeTextDe" | "welcomeTextRu" | "welcomeTextJa";

export interface AdminSession { id: string; nickname: string; target: string; state: string; createdAt: string; ageSeconds: number; tsClientId: number | null; channelId: string | null; memberCount: number }
export interface ManagedInvite { id: string; target: string; channel: string; expiresAt: string; maxUses: number; useCount: number; createdAt: string; revokedAt: string | null; status: "active" | "expired" | "exhausted" | "revoked" }
export interface AdminLog { timestamp: string | null; level: string; message: string; context: Record<string, string | number | boolean> }
export interface AdminConnectionRecord { id: string; nickname: string; clientIp: string; target: string; relayName: string | null; relayTarget: string | null; startedAt: string; connectedAt: string | null; disconnectedAt: string | null; durationSeconds: number | null; status: "active" | "connecting" | "disconnected" | "failed"; reason: string | null; failureDetail: string | null }

export function createAdminContext(): any {
  const route = useRoute();
  const router = useRouter();
  const storedLanguage = localStorage.getItem("webspeak:language");
  const language = ref<Language>(storedLanguage === "en" || storedLanguage === "de" || storedLanguage === "ru" || storedLanguage === "ja" ? storedLanguage : typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ru") ? "ru" : typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ja") ? "ja" : "zh");
  const themeMode = ref<ThemeMode>(getStoredTheme());
  applyTheme(themeMode.value);
  const loading = ref(true);
  const screen = ref<Screen>("login");
  const csrfToken = ref("");
  const submitting = ref(false);
  const testing = ref(false);
  const errorMessage = ref("");
  const loginUsername = ref("admin");
  const loginPassword = ref("");
  const newPassword = ref("");
  const confirmNewPassword = ref("");
  const testResult = ref<ProbeState | null>(null);
  
  const serverForm = reactive({ address: "", port: "9987", serverPassword: "", passwordAction: "keep" as "keep" | "replace" | "remove", hasPassword: false, accessMode: "fixed" as AccessMode, siteName: "WebSpeak", welcomeText: "", welcomeTextEn: "", welcomeTextDe: "", welcomeTextRu: "", welcomeTextJa: "", welcomeDefaults: { ...DEFAULT_WELCOME_TEXTS }, webRtcEnabled: false, webRtcUdpStart: 40000, webRtcUdpEnd: 40099, relayConfigured: false, relayEnabled: false, relayName: "", relayTarget: "", relayToken: "", relayTokenAction: "keep" as "keep" | "replace" | "remove", hasRelayToken: false, relaySettingsTouched: false, relayNodes: [] as RelayNodeForm[], lastTestAt: null as string | null, lastTestLatencyMs: null as number | null });
  const welcomeLanguage = ref<WelcomeLanguage>("zh");
  const overview = reactive({ gateway: { version: "", uptimeSeconds: 0 }, teamSpeak: { target: "", status: "unknown", lastTestAt: null as string | null, latencyMs: null as number | null }, sessions: { active: 0, peak: 0, limit: 100 }, recentEvents: [] as Array<{ event: string; createdAt: string }>, legacyConfigImported: false });
  const operationsLoading = ref(false);
  const terminatingSession = ref("");
  const inviteForm = reactive({ channel: "", expiresInHours: 24, maxUses: 0 });
  const createdInvite = ref<{ token: string; link: string } | null>(null);
  const webrtcPortNoticeOpen = ref(false);
  const operations = reactive({ sessions: [] as AdminSession[], invites: [] as ManagedInvite[], diagnostics: { version: "", node: "", platform: "", arch: "", schemaVersion: 0, createdSessions: 0 }, logs: { available: false, entries: [] as AdminLog[], sessions: [] as AdminConnectionRecord[] }, audit: [] as Array<{ event: string; createdAt: string }> });
  return { route, router, language, themeMode, loading, screen, csrfToken, submitting, testing, errorMessage, loginUsername, loginPassword, newPassword, confirmNewPassword, testResult, serverForm, welcomeLanguage, overview, operationsLoading, terminatingSession, inviteForm, createdInvite, webrtcPortNoticeOpen, operations };
}
