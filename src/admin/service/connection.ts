import { parseTeamSpeakTarget, type TeamSpeakTarget } from "../../domain/teamspeak-target.js";
import { decryptSecret } from "../../security/secret-crypto.js";
import { pingTeamSpeakHost } from "../../server/network-probe.js";
import { probeTeamSpeak, TeamSpeakProbeError } from "../../server/teamspeak-probe.js";
import { AdminInputError } from "./admin-input-error.js";
import type { ConnectionPolicy } from "./types.js";
import { AdminServiceSettings } from "./settings.js";

export class AdminServiceConnection extends AdminServiceSettings {

  getConnectionPolicy(): ConnectionPolicy {
    const settings = this.database.getSettings();
    let serverPassword = "";
    try {
      serverPassword = decryptSecret(settings.tsPasswordEncrypted, this.masterSecret);
    } catch (error: unknown) {
      this.logger.error({ err: error instanceof Error ? error.message : String(error) }, "Stored TeamSpeak password could not be decrypted");
    }
    return {
      defaultTarget: { host: settings.tsHost, port: settings.tsPort },
      serverPassword,
      accessMode: settings.accessMode,
    };
  }

  async testConnection(targetText: string, password: string, persistResult: boolean): Promise<{ ok: boolean; checkType: "network" | "protocol"; passwordVerified: boolean; latencyMs: number; serverName: string | null; requiresPassword: boolean; packetLossPercent?: number; attempts?: number; successfulAttempts?: number; errorCode?: string }> {
    let target: TeamSpeakTarget;
    try {
      target = parseTeamSpeakTarget(targetText);
    } catch {
      throw new AdminInputError("INVALID_TARGET", "TeamSpeak target is invalid");
    }
    try {
      // The admin connection test must not create a temporary TeamSpeak
      // client: that client becomes visible in the target channel. Use the
      // WebSpeak host's ICMP route measurement instead. The injected probe is
      // retained for unit tests and explicit protocol-probe callers.
      if (this.probe === probeTeamSpeak) {
        const result = await pingTeamSpeakHost(target.host, { attempts: 4 });
        const publicResult = {
          ok: result.ok,
          checkType: "network" as const,
          passwordVerified: false,
          latencyMs: result.latencyMs ?? 0,
          serverName: null,
          requiresPassword: false,
          packetLossPercent: result.packetLossPercent,
          attempts: result.attempts,
          successfulAttempts: result.successfulAttempts,
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        };
        if (persistResult) {
          this.database.recordConnectionTest({ protocol: null, latencyMs: result.latencyMs, error: result.ok ? null : (result.errorCode ?? "UNREACHABLE") });
          this.database.addAudit(result.ok ? "CONNECTION_TEST_SUCCEEDED" : "CONNECTION_TEST_FAILED", {
            latencyMs: result.latencyMs,
            packetLossPercent: result.packetLossPercent,
            ...(result.errorCode ? { code: result.errorCode } : {}),
          });
        }
        return publicResult;
      }
      const result = await this.probe(target, password, this.logger);
      if (persistResult) {
        this.database.recordConnectionTest({ protocol: result.protocol, latencyMs: result.latencyMs, error: null });
        this.database.addAudit("CONNECTION_TEST_SUCCEEDED", { protocol: result.protocol, latencyMs: result.latencyMs });
      }
      const { protocol: _protocol, ...publicResult } = result;
      return { ...publicResult, checkType: "protocol", passwordVerified: true };
    } catch (error: unknown) {
      const probeError = error instanceof TeamSpeakProbeError
        ? error
        : new TeamSpeakProbeError("INTERNAL_ERROR", "Connection test failed", error);
      if (persistResult) {
        this.database.recordConnectionTest({ protocol: null, latencyMs: null, error: probeError.code });
        this.database.addAudit("CONNECTION_TEST_FAILED", { code: probeError.code });
      }
      throw probeError;
    }
  }
}
