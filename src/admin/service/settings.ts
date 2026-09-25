import { formatTeamSpeakTarget, parseTeamSpeakTarget, type TeamSpeakTarget } from "../../domain/teamspeak-target.js";
import { type PersistedRelayNode, type SettingsUpdate, WebSpeakDatabase } from "../../persistence/database.js";
import { encryptSecret } from "../../security/secret-crypto.js";
import { DEFAULT_ACCELERATION_RELAY_PORT } from "../../server/acceleration-relay.js";
import { DEFAULT_WEBRTC_UDP_PORT_RANGE, WEBRTC_UDP_PORT_MAX, WEBRTC_UDP_PORT_MIN } from "../../server/webrtc-config.js";
import { DEFAULT_WELCOME_TEXTS, resolveWelcomeTexts } from "../../site-copy.js";
import { AdminInputError } from "./admin-input-error.js";
import { formatRelayTarget } from "./utils.js";
import type { AdminSettingsInput } from "./types.js";
import { AdminServiceRelay } from "./relay.js";

export class AdminServiceSettings extends AdminServiceRelay {

  getPublicConfig(): Record<string, unknown> {
    const settings = this.database.getSettings();
    const welcomeTexts = resolveWelcomeTexts({
      zh: settings.welcomeText,
      en: settings.welcomeTextEn,
      de: settings.welcomeTextDe,
      ru: settings.welcomeTextRu,
      ja: settings.welcomeTextJa,
    });
    return {
      version: this.version,
      initialized: this.isInitialized(),
      siteName: settings.siteName,
      // Keep the old fields for older clients, but return the complete,
      // already-fallback-resolved map for current clients.
      welcomeText: welcomeTexts.zh,
      welcomeTextEn: welcomeTexts.en,
      welcomeTexts,
      accessMode: settings.accessMode,
      target: formatTeamSpeakTarget({ host: settings.tsHost, port: settings.tsPort }),
    };
  }

  getAdminSettings(): Record<string, unknown> {
    const settings = this.database.getSettings();
    return {
      target: formatTeamSpeakTarget({ host: settings.tsHost, port: settings.tsPort }),
      hasPassword: Boolean(settings.tsPasswordEncrypted),
      accessMode: settings.accessMode,
      siteName: settings.siteName,
      welcomeText: settings.welcomeText,
      welcomeTextEn: settings.welcomeTextEn,
      welcomeTextDe: settings.welcomeTextDe,
      welcomeTextRu: settings.welcomeTextRu,
      welcomeTextJa: settings.welcomeTextJa,
      welcomeDefaults: DEFAULT_WELCOME_TEXTS,
      lastTestAt: settings.lastTestAt,
      lastTestLatencyMs: settings.lastTestLatencyMs,
      lastTestError: settings.lastTestError,
      webRtcEnabled: settings.webRtcEnabled,
      webRtcUdpStart: settings.webRtcUdpStart,
      webRtcUdpEnd: settings.webRtcUdpEnd,
      relayConfigured: settings.relayConfigured,
      relayEnabled: settings.relayEnabled,
      relayName: settings.relayName,
      relayTarget: settings.relayHost ? formatRelayTarget(settings.relayHost, settings.relayPort) : "",
      hasRelayToken: Boolean(settings.relayTokenEncrypted),
      relayNodes: this.getRelayNodeViews(),
      internalPort: 3040,
      updatedAt: settings.updatedAt,
    };
  }

  updateSettings(input: AdminSettingsInput): void {
    const current = this.database.getSettings();
    const relayNodes = input.relayNodes === undefined ? undefined : this.normalizeRelayNodes(input.relayNodes);
    const settings = this.normalizeSettings(input, current, relayNodes);
    const targetChanged = current.tsHost !== settings.tsHost || current.tsPort !== settings.tsPort;
    this.database.updateSettings(settings);
    if (relayNodes !== undefined) {
      this.database.replaceRelayNodes(relayNodes);
    } else if (input.relaySettingsAction && input.relaySettingsAction !== "keep") {
      this.database.replaceRelayNodes(this.legacyRelayNodesFromSettings(settings));
    }
    if (targetChanged) this.database.clearConnectionTest();
  }

  private normalizeSettings(input: AdminSettingsInput, current: ReturnType<WebSpeakDatabase["getSettings"]>, relayNodes?: PersistedRelayNode[]): SettingsUpdate {
    let target: TeamSpeakTarget;
    try {
      target = parseTeamSpeakTarget(input.target);
    } catch {
      throw new AdminInputError("INVALID_TARGET", "TeamSpeak target is invalid");
    }
    const siteName = input.siteName.trim();
    const welcomeText = input.welcomeText.trim();
    const welcomeTextEn = typeof input.welcomeTextEn === "string" ? input.welcomeTextEn.trim() : current.welcomeTextEn;
    const welcomeTextDe = typeof input.welcomeTextDe === "string" ? input.welcomeTextDe.trim() : current.welcomeTextDe;
    const welcomeTextRu = typeof input.welcomeTextRu === "string" ? input.welcomeTextRu.trim() : current.welcomeTextRu;
    const welcomeTextJa = typeof input.welcomeTextJa === "string" ? input.welcomeTextJa.trim() : current.welcomeTextJa;
    if (!siteName || siteName.length > 80) throw new AdminInputError("INVALID_SITE_NAME", "Site name must contain 1 to 80 characters");
    if (welcomeText.length > 500) throw new AdminInputError("INVALID_WELCOME_TEXT", "Welcome text cannot exceed 500 characters");
    if (welcomeTextEn.length > 500) throw new AdminInputError("INVALID_WELCOME_TEXT_EN", "English welcome text cannot exceed 500 characters");
    if (welcomeTextDe.length > 500) throw new AdminInputError("INVALID_WELCOME_TEXT_DE", "German welcome text cannot exceed 500 characters");
    if (welcomeTextRu.length > 500) throw new AdminInputError("INVALID_WELCOME_TEXT_RU", "Russian welcome text cannot exceed 500 characters");
    if (welcomeTextJa.length > 500) throw new AdminInputError("INVALID_WELCOME_TEXT_JA", "Japanese welcome text cannot exceed 500 characters");
    if (input.accessMode !== "fixed" && input.accessMode !== "open") {
      throw new AdminInputError("INVALID_ACCESS_MODE", "Access mode is invalid");
    }
    if (typeof input.webRtcEnabled !== "boolean") {
      throw new AdminInputError("INVALID_WEBRTC_ENABLED", "WebRTC enabled value is invalid");
    }
    const webRtcUdpStart = input.webRtcUdpStart ?? current.webRtcUdpStart ?? DEFAULT_WEBRTC_UDP_PORT_RANGE[0];
    const webRtcUdpEnd = input.webRtcUdpEnd ?? current.webRtcUdpEnd ?? DEFAULT_WEBRTC_UDP_PORT_RANGE[1];
    if (!Number.isInteger(webRtcUdpStart) || webRtcUdpStart < WEBRTC_UDP_PORT_MIN || webRtcUdpStart > WEBRTC_UDP_PORT_MAX) {
      throw new AdminInputError("INVALID_WEBRTC_PORT_RANGE", "WebRTC UDP start port must be between 1024 and 65535");
    }
    if (!Number.isInteger(webRtcUdpEnd) || webRtcUdpEnd < WEBRTC_UDP_PORT_MIN || webRtcUdpEnd > WEBRTC_UDP_PORT_MAX) {
      throw new AdminInputError("INVALID_WEBRTC_PORT_RANGE", "WebRTC UDP end port must be between 1024 and 65535");
    }
    if (webRtcUdpStart > webRtcUdpEnd) {
      throw new AdminInputError("INVALID_WEBRTC_PORT_RANGE", "WebRTC UDP start port must not exceed the end port");
    }
    if (current.webRtcEnabled && (webRtcUdpStart !== current.webRtcUdpStart || webRtcUdpEnd !== current.webRtcUdpEnd)) {
      throw new AdminInputError("WEBRTC_PORT_LOCKED", "Disable WebRTC and save before changing its UDP port range");
    }

    let encryptedPassword = current.tsPasswordEncrypted;
    const action = input.passwordAction ?? (input.serverPassword === undefined ? "keep" : "replace");
    if (action === "remove") encryptedPassword = null;
    if (action === "replace") encryptedPassword = input.serverPassword ? encryptSecret(input.serverPassword, this.masterSecret) : null;

    let relayConfigured = current.relayConfigured;
    let relayEnabled = current.relayEnabled;
    let relayName = current.relayName;
    let relayHost = current.relayHost;
    let relayPort = current.relayPort || DEFAULT_ACCELERATION_RELAY_PORT;
    let relayTokenEncrypted = current.relayTokenEncrypted;
    const relaySettingsAction = input.relaySettingsAction ?? "keep";
    if (relaySettingsAction === "remove") {
      relayConfigured = true;
      relayEnabled = false;
      relayName = "";
      relayHost = "";
      relayPort = DEFAULT_ACCELERATION_RELAY_PORT;
      relayTokenEncrypted = null;
    } else if (relaySettingsAction === "replace") {
      const relayTarget = (input.relayTarget ?? "").trim();
      relayEnabled = input.relayEnabled === true;
      relayName = (input.relayName ?? "").trim();
      if (relayName.length > 80) throw new AdminInputError("INVALID_RELAY_NAME", "Relay name must contain 80 characters or fewer");
      if (relayEnabled && !relayName) throw new AdminInputError("INVALID_RELAY_NAME", "Relay name is required when the relay is enabled");
      if (relayEnabled && !relayTarget) throw new AdminInputError("INVALID_RELAY_TARGET", "Relay target is required when the relay is enabled");
      if (relayTarget) {
        try {
          const relay = parseTeamSpeakTarget(relayTarget, DEFAULT_ACCELERATION_RELAY_PORT);
          relayHost = relay.host;
          relayPort = relay.port;
        } catch {
          throw new AdminInputError("INVALID_RELAY_TARGET", "Relay target is invalid");
        }
      } else {
        relayHost = "";
        relayPort = DEFAULT_ACCELERATION_RELAY_PORT;
      }
      const relayTokenAction = input.relayTokenAction ?? (input.relayToken === undefined ? "keep" : "replace");
      if (relayTokenAction === "remove") relayTokenEncrypted = null;
      if (relayTokenAction === "replace") relayTokenEncrypted = input.relayToken ? encryptSecret(input.relayToken, this.masterSecret) : null;
      if (relayEnabled && !relayTokenEncrypted) throw new AdminInputError("INVALID_RELAY_TOKEN", "Relay token is required when the relay is enabled");
      relayConfigured = true;
    }
    if (relayNodes) {
      const primary = relayNodes.find((node) => node.enabled) ?? relayNodes[0];
      relayConfigured = relayNodes.length > 0;
      relayEnabled = primary?.enabled === true;
      relayName = primary?.name ?? "";
      relayHost = primary?.host ?? "";
      relayPort = primary?.port ?? DEFAULT_ACCELERATION_RELAY_PORT;
      relayTokenEncrypted = primary?.tokenEncrypted ?? null;
    }
    return {
      siteName,
      welcomeText,
      welcomeTextEn,
      welcomeTextDe,
      welcomeTextRu,
      welcomeTextJa,
      accessMode: input.accessMode,
      tsHost: target.host,
      tsPort: target.port,
      tsPasswordEncrypted: encryptedPassword,
      webRtcEnabled: input.webRtcEnabled,
      webRtcUdpStart,
      webRtcUdpEnd,
      relayConfigured,
      relayEnabled,
      relayName,
      relayHost,
      relayPort,
      relayTokenEncrypted,
    };
  }
}
