import type { ManagedInviteRecord } from "./types.js";
import { DatabaseRelayRepository } from "./relay-repository.js";

interface ManagedInviteRow extends Record<string, unknown> {
  id: string;
  token_hash: string;
  target_host: string;
  target_port: number;
  server_password_encrypted: string | null;
  channel: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  created_at: string;
  revoked_at: string | null;
}


export class DatabaseInviteRepository extends DatabaseRelayRepository {
  createManagedInvite(record: Omit<ManagedInviteRecord, "createdAt" | "revokedAt" | "useCount">): ManagedInviteRecord {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.database.prepare(
        `INSERT INTO managed_invites (
           id, token_hash, target_host, target_port, server_password_encrypted,
           channel, expires_at, max_uses, use_count, created_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
      ).run(
        record.id,
        record.tokenHash,
        record.targetHost,
        record.targetPort,
        record.serverPasswordEncrypted,
        record.channel,
        record.expiresAt,
        record.maxUses,
        now,
      );
    });
    return { ...record, useCount: 0, createdAt: now, revokedAt: null };
  }

  listManagedInvites(): ManagedInviteRecord[] {
    const rows = this.database.prepare(
      "SELECT * FROM managed_invites ORDER BY created_at DESC",
    ).all() as ManagedInviteRow[];
    return rows.map(mapManagedInviteRow);
  }

  revokeManagedInvite(id: string): boolean {
    const result = this.database.prepare(
      "UPDATE managed_invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    ).run(new Date().toISOString(), id) as { changes?: number | bigint };
    return Number(result.changes ?? 0) === 1;
  }

  consumeManagedInvite(tokenHash: string, now = Date.now()): ManagedInviteRecord | null {
    const nowIso = new Date(now).toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare(
        `SELECT * FROM managed_invites
         WHERE token_hash = ?
           AND revoked_at IS NULL
           AND expires_at > ?
           AND (max_uses = 0 OR use_count < max_uses)`,
      ).get(tokenHash, nowIso) as ManagedInviteRow | undefined;
      if (!row) {
        this.database.exec("COMMIT");
        return null;
      }
      const result = this.database.prepare(
        `UPDATE managed_invites
         SET use_count = use_count + 1
         WHERE id = ? AND revoked_at IS NULL AND expires_at > ?
           AND (max_uses = 0 OR use_count < max_uses)`,
      ).run(row.id, nowIso) as { changes?: number | bigint };
      if (Number(result.changes ?? 0) !== 1) {
        this.database.exec("COMMIT");
        return null;
      }
      this.database.exec("COMMIT");
      return { ...mapManagedInviteRow(row), useCount: row.use_count + 1 };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

}

function mapManagedInviteRow(row: ManagedInviteRow): ManagedInviteRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    targetHost: row.target_host,
    targetPort: row.target_port,
    serverPasswordEncrypted: row.server_password_encrypted,
    channel: row.channel,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    useCount: row.use_count,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}
