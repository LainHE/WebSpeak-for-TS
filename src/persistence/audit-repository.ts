import { DatabaseMetaRepository } from "./meta-repository.js";

export class DatabaseAuditRepository extends DatabaseMetaRepository {
  addAudit(event: string, details: Record<string, unknown> = {}): void {
    this.insertAudit(event, details, new Date().toISOString());
  }

  recentAudit(limit = 8): Array<{ event: string; createdAt: string }> {
    const normalizedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.database.prepare(
      "SELECT event, created_at FROM audit_events ORDER BY id DESC LIMIT ?",
    ).all(normalizedLimit) as Array<{ event: string; created_at: string }>;
    return rows.map((row) => ({ event: row.event, createdAt: row.created_at }));
  }

}

export class WebSpeakDatabase extends DatabaseAuditRepository {}
