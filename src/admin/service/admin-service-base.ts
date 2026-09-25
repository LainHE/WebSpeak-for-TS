import { existsSync } from "node:fs";
import type { Logger } from "../../logger.js";
import { loadConfig } from "../../config.js";
import { type SettingsUpdate, WebSpeakDatabase } from "../../persistence/database.js";
import { hashAdminPassword, validateAdminPassword, verifyAdminPassword } from "../../security/admin-password.js";
import { encryptSecret } from "../../security/secret-crypto.js";
import { probeTeamSpeak } from "../../server/teamspeak-probe.js";
import type { TeamSpeakTarget } from "../../domain/teamspeak-target.js";
import { AdminInputError } from "./admin-input-error.js";

type ProbeFunction = typeof probeTeamSpeak;

export class AdminServiceBase {
  constructor(
    readonly database: WebSpeakDatabase,
    protected readonly masterSecret: Buffer,
    protected readonly logger: Logger,
    protected readonly legacyConfigPath: string,
    protected readonly probe: ProbeFunction = probeTeamSpeak,
    protected readonly version = "0.1.0",
  ) {}

  async initialize(): Promise<void> {
    this.importLegacyConfigOnce();
    if (!this.database.hasAdmin()) {
      const credential = await hashAdminPassword("admin", { username: "admin", mustChangePassword: true, allowWeakPassword: true });
      this.database.initializeAdmin(credential, this.toSettingsUpdate(this.database.getSettings()));
      this.logger.warn("Default admin account created. Change the password on first login.");
    }
  }

  isInitialized(): boolean {
    return this.database.hasAdmin();
  }

  async verifyPassword(username: string, password: string): Promise<boolean> {
    const credential = this.database.getAdminCredential();
    return credential?.username === username && await verifyAdminPassword(password, credential);
  }

  isPasswordChangeRequired(): boolean {
    return this.database.getAdminCredential()?.mustChangePassword === true;
  }

  async changePassword(password: string): Promise<void> {
    const credential = this.database.getAdminCredential();
    if (!credential) throw new AdminInputError("NOT_INITIALIZED", "The administrator account is not initialized");
    const passwordError = validateAdminPassword(password);
    if (passwordError) throw new AdminInputError("INVALID_ADMIN_PASSWORD", passwordError);
    const replacement = await hashAdminPassword(password, { username: credential.username, mustChangePassword: false });
    this.database.updateAdminCredential(replacement);
    this.database.addAudit("ADMIN_PASSWORD_CHANGED");
  }

  private importLegacyConfigOnce(): void {
    if (this.database.getMeta("legacy_config_checked") === "1") return;
    if (existsSync(this.legacyConfigPath)) {
      const legacy = loadConfig(this.legacyConfigPath);
      const current = this.database.getSettings();
      this.database.updateSettings({
        siteName: current.siteName,
        welcomeText: current.welcomeText,
        welcomeTextEn: current.welcomeTextEn,
        welcomeTextDe: current.welcomeTextDe,
        welcomeTextRu: current.welcomeTextRu,
        welcomeTextJa: current.welcomeTextJa,
        accessMode: current.accessMode,
        tsHost: legacy.tsHost,
        tsPort: legacy.tsPort,
        tsPasswordEncrypted: legacy.tsServerPassword ? encryptSecret(legacy.tsServerPassword, this.masterSecret) : null,
        webRtcEnabled: current.webRtcEnabled,
        webRtcUdpStart: current.webRtcUdpStart,
        webRtcUdpEnd: current.webRtcUdpEnd,
        relayConfigured: current.relayConfigured,
        relayEnabled: current.relayEnabled,
        relayName: current.relayName,
        relayHost: current.relayHost,
        relayPort: current.relayPort,
        relayTokenEncrypted: current.relayTokenEncrypted,
      }, "LEGACY_CONFIG_IMPORTED");
      this.database.setMeta("legacy_config_imported", "1");
      this.database.setMeta("legacy_import_notice_pending", "1");
      this.logger.info("Legacy config imported; WebSpeak settings are now managed from /admin");
    }
    this.database.setMeta("legacy_config_checked", "1");
  }

  private toSettingsUpdate(settings: ReturnType<WebSpeakDatabase["getSettings"]>): SettingsUpdate {
    return {
      siteName: settings.siteName,
      welcomeText: settings.welcomeText,
      welcomeTextEn: settings.welcomeTextEn,
      welcomeTextDe: settings.welcomeTextDe,
      welcomeTextRu: settings.welcomeTextRu,
      welcomeTextJa: settings.welcomeTextJa,
      accessMode: settings.accessMode,
      tsHost: settings.tsHost,
      tsPort: settings.tsPort,
      tsPasswordEncrypted: settings.tsPasswordEncrypted,
      webRtcEnabled: settings.webRtcEnabled,
      webRtcUdpStart: settings.webRtcUdpStart,
      webRtcUdpEnd: settings.webRtcUdpEnd,
      relayConfigured: settings.relayConfigured,
      relayEnabled: settings.relayEnabled,
      relayName: settings.relayName,
      relayHost: settings.relayHost,
      relayPort: settings.relayPort,
      relayTokenEncrypted: settings.relayTokenEncrypted,
    };
  }
}
