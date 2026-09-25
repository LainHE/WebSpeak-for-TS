import { formatTeamSpeakTarget } from "../../domain/teamspeak-target.js";
import { AdminServiceInvites } from "./invites.js";

export class AdminServiceStats extends AdminServiceInvites {

  getOverview(activeSessions: number, peakSessions: number, startedAt: number): Record<string, unknown> {
    const settings = this.database.getSettings();
    return {
      gateway: {
        status: "running",
        version: this.version,
        uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
      },
      teamSpeak: {
        target: formatTeamSpeakTarget({ host: settings.tsHost, port: settings.tsPort }),
        status: settings.lastTestError ? "unreachable" : settings.lastTestAt ? "reachable" : "unknown",
        lastTestAt: settings.lastTestAt,
        latencyMs: settings.lastTestLatencyMs,
        lastError: settings.lastTestError,
      },
      sessions: { active: activeSessions, peak: peakSessions, limit: 100 },
      recentEvents: this.database.recentAudit(),
      legacyConfigImported: this.database.getMeta("legacy_import_notice_pending") === "1",
    };
  }

  dismissLegacyImportNotice(): void {
    this.database.setMeta("legacy_import_notice_pending", "0");
  }
}
