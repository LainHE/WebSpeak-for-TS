import type { PersistedRelayNode } from "./types.js";
import { DatabaseSettingsRepository } from "./settings-repository.js";

interface RelayNodeRow extends Record<string, unknown> {
  id: string;
  name: string;
  enabled: number;
  host: string;
  port: number;
  token_encrypted: string | null;
  created_at: string;
  updated_at: string;
}


export class DatabaseRelayRepository extends DatabaseSettingsRepository {
  listRelayNodes(): PersistedRelayNode[] {
    const rows = this.database.prepare(
      "SELECT * FROM relay_nodes ORDER BY created_at ASC, id ASC",
    ).all() as RelayNodeRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      host: row.host,
      port: row.port,
      tokenEncrypted: row.token_encrypted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  replaceRelayNodes(nodes: Array<Omit<PersistedRelayNode, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }>): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.database.exec("DELETE FROM relay_nodes");
      const insert = this.database.prepare(
        `INSERT INTO relay_nodes (id, name, enabled, host, port, token_encrypted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const node of nodes) {
        insert.run(
          node.id,
          node.name,
          node.enabled ? 1 : 0,
          node.host,
          node.port,
          node.tokenEncrypted,
          node.createdAt ?? now,
          node.updatedAt ?? now,
        );
      }
    });
  }

}
