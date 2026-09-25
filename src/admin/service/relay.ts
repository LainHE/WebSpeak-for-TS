import { randomBytes } from "node:crypto";
import { parseTeamSpeakTarget, type TeamSpeakTarget } from "../../domain/teamspeak-target.js";
import { type PersistedRelayNode, type SettingsUpdate } from "../../persistence/database.js";
import { decryptSecret, encryptSecret } from "../../security/secret-crypto.js";
import { DEFAULT_ACCELERATION_RELAY_PORT, type ConfiguredAccelerationRelay } from "../../server/acceleration-relay.js";
import type { WebRtcAudioOptions } from "../../server/webrtc-audio.js";
import { AdminInputError } from "./admin-input-error.js";
import { formatRelayTarget } from "./utils.js";
import type { RelayNodeInput } from "./types.js";
import { AdminServiceBase } from "./admin-service-base.js";

export class AdminServiceRelay extends AdminServiceBase {

  getWebRtcAudioOptions(): WebRtcAudioOptions {
    const settings = this.database.getSettings();
    return {
      enabled: settings.webRtcEnabled,
      udpPortRange: [settings.webRtcUdpStart, settings.webRtcUdpEnd],
    };
  }

  getAccelerationRelayOptions(): ConfiguredAccelerationRelay[] {
    const relays: ConfiguredAccelerationRelay[] = [];
    for (const node of this.database.listRelayNodes()) {
      if (!node.enabled || !node.host || !node.tokenEncrypted) continue;
      try {
        const token = decryptSecret(node.tokenEncrypted, this.masterSecret);
        relays.push({ id: node.id, name: node.name, relayHost: node.host, relayPort: node.port, token });
      } catch (error: unknown) {
        this.logger.error({ err: error instanceof Error ? error.message : String(error), relayId: node.id }, "Stored acceleration relay token could not be decrypted");
      }
    }
    return relays;
  }

  getAccelerationRelayName(): string | undefined {
    return this.getAccelerationRelayOptions()[0]?.name;
  }

  protected normalizeRelayNodes(inputs: RelayNodeInput[]): PersistedRelayNode[] {
    if (!Array.isArray(inputs) || inputs.length > 16) throw new AdminInputError("INVALID_RELAY_NODES", "At most 16 relay nodes may be configured");
    const current = new Map(this.database.listRelayNodes().map((node) => [node.id, node]));
    const seen = new Set<string>();
    const now = new Date().toISOString();
    return inputs.map((input) => {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const targetText = typeof input.target === "string" ? input.target.trim() : "";
      if (!name || name.length > 80) throw new AdminInputError("INVALID_RELAY_NAME", "Relay name must contain 1 to 80 characters");
      if (!targetText || targetText.length > 300) throw new AdminInputError("INVALID_RELAY_TARGET", "Relay target is invalid");
      let target: TeamSpeakTarget;
      try { target = parseTeamSpeakTarget(targetText, DEFAULT_ACCELERATION_RELAY_PORT); }
      catch { throw new AdminInputError("INVALID_RELAY_TARGET", "Relay target is invalid"); }
      const id = typeof input.id === "string" && /^relay-[a-z0-9-]{1,100}$/i.test(input.id)
        ? input.id
        : `relay-${randomBytes(8).toString("hex")}`;
      if (seen.has(id)) throw new AdminInputError("INVALID_RELAY_ID", "Relay id must be unique");
      seen.add(id);
      const previous = current.get(id);
      const tokenAction = input.tokenAction ?? (input.token === undefined ? "keep" : "replace");
      let tokenEncrypted = previous?.tokenEncrypted ?? null;
      if (tokenAction === "remove") tokenEncrypted = null;
      if (tokenAction === "replace") {
        const token = typeof input.token === "string" ? input.token.trim() : "";
        tokenEncrypted = token ? encryptSecret(token, this.masterSecret) : null;
      }
      if (input.enabled === true && (!tokenEncrypted || !this.canDecryptToken(tokenEncrypted))) {
        throw new AdminInputError("INVALID_RELAY_TOKEN", "A relay token of at least 16 characters is required when the relay is enabled");
      }
      return {
        id,
        name,
        enabled: input.enabled === true,
        host: target.host,
        port: target.port,
        tokenEncrypted,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
    });
  }

  private canDecryptToken(encrypted: string): boolean {
    try {
      return decryptSecret(encrypted, this.masterSecret).length >= 16;
    } catch {
      return false;
    }
  }

  protected getRelayNodeViews(): Array<{ id: string; name: string; enabled: boolean; target: string; hasToken: boolean }> {
    return this.database.listRelayNodes().map((node) => ({
      id: node.id,
      name: node.name,
      enabled: node.enabled,
      target: formatRelayTarget(node.host, node.port),
      hasToken: Boolean(node.tokenEncrypted),
    }));
  }

  protected legacyRelayNodesFromSettings(settings: SettingsUpdate): PersistedRelayNode[] {
    if (!settings.relayConfigured || !settings.relayHost || !settings.relayTokenEncrypted) return [];
    const previous = this.database.listRelayNodes()[0];
    const now = new Date().toISOString();
    return [{
      id: previous?.id ?? "relay-default",
      name: settings.relayName || "中继加速",
      enabled: settings.relayEnabled,
      host: settings.relayHost,
      port: settings.relayPort || DEFAULT_ACCELERATION_RELAY_PORT,
      tokenEncrypted: settings.relayTokenEncrypted,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }];
  }
}
