import type { TeamSpeakProtocol } from "../server/teamspeak-adapter.js";
import type { PersistedSettings, SettingsUpdate } from "./types.js";
import { DatabaseAdminRepository } from "./admin-repository.js";

interface SettingsRow extends Record<string, unknown> {
  site_name: string;
  welcome_text: string;
  welcome_text_en: string;
  welcome_text_de: string;
  welcome_text_ru: string;
  welcome_text_ja: string;
  access_mode: string;
  ts_host: string;
  ts_port: number;
  ts_password_encrypted: string | null;
  detected_protocol: string | null;
  last_test_at: string | null;
  last_test_latency_ms: number | null;
  last_test_error: string | null;
  webrtc_enabled: number;
  webrtc_public_host: string;
  webrtc_udp_start: number;
  webrtc_udp_end: number;
  relay_configured: number;
  relay_enabled: number;
  relay_name: string;
  relay_host: string;
  relay_port: number;
  relay_token_encrypted: string | null;
  updated_at: string;
}


export class DatabaseSettingsRepository extends DatabaseAdminRepository {
  getSettings(): PersistedSettings {
    const row = this.database.prepare("SELECT * FROM settings WHERE id = 1").get() as SettingsRow;
    return {
      siteName: row.site_name,
      welcomeText: row.welcome_text,
      welcomeTextEn: row.welcome_text_en,
      welcomeTextDe: row.welcome_text_de,
      welcomeTextRu: row.welcome_text_ru,
      welcomeTextJa: row.welcome_text_ja,
      accessMode: row.access_mode === "open" ? "open" : "fixed",
      tsHost: row.ts_host,
      tsPort: row.ts_port,
      tsPasswordEncrypted: row.ts_password_encrypted,
      detectedProtocol: row.detected_protocol === "ts3" || row.detected_protocol === "ts6" ? row.detected_protocol : null,
      lastTestAt: row.last_test_at,
      lastTestLatencyMs: row.last_test_latency_ms,
      lastTestError: row.last_test_error,
      webRtcEnabled: row.webrtc_enabled === 1,
      webRtcUdpStart: row.webrtc_udp_start,
      webRtcUdpEnd: row.webrtc_udp_end,
      relayConfigured: row.relay_configured === 1,
      relayEnabled: row.relay_enabled === 1,
      relayName: row.relay_name,
      relayHost: row.relay_host,
      relayPort: row.relay_port,
      relayTokenEncrypted: row.relay_token_encrypted,
      updatedAt: row.updated_at,
    };
  }

  updateSettings(settings: SettingsUpdate, auditEvent = "SETTINGS_CHANGED"): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.writeSettings(settings, now);
      this.insertAudit(auditEvent, { accessMode: settings.accessMode, target: `${settings.tsHost}:${settings.tsPort}` }, now);
    });
  }

  recordConnectionTest(result: {
    protocol: TeamSpeakProtocol | null;
    latencyMs: number | null;
    error: string | null;
  }): void {
    this.database.prepare(
      `UPDATE settings
       SET detected_protocol = ?, last_test_at = ?, last_test_latency_ms = ?, last_test_error = ?
       WHERE id = 1`,
    ).run(result.protocol, new Date().toISOString(), result.latencyMs, result.error);
  }

  clearConnectionTest(): void {
    this.database.exec(
      "UPDATE settings SET detected_protocol = NULL, last_test_at = NULL, last_test_latency_ms = NULL, last_test_error = NULL WHERE id = 1",
    );
  }

}
