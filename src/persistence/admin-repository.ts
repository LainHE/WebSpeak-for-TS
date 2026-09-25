import type { AdminCredential } from "../security/admin-password.js";
import type { SettingsUpdate } from "./types.js";
import { DatabaseCore } from "./core.js";

export class DatabaseAdminRepository extends DatabaseCore {
  hasAdmin(): boolean {
    return Boolean(this.database.prepare("SELECT 1 AS present FROM admin_credentials WHERE id = 1").get());
  }

  getAdminCredential(): AdminCredential | null {
    const row = this.database.prepare("SELECT credential_json FROM admin_credentials WHERE id = 1").get() as { credential_json?: string } | undefined;
    if (!row?.credential_json) return null;
    const credential = JSON.parse(row.credential_json) as Partial<AdminCredential>;
    return {
      ...credential,
      version: 1,
      username: typeof credential.username === "string" && credential.username ? credential.username : "admin",
      mustChangePassword: credential.mustChangePassword === true,
    } as AdminCredential;
  }

  initializeAdmin(credential: AdminCredential, settings: SettingsUpdate): void {
    this.transaction(() => {
      if (this.hasAdmin()) throw new Error("WebSpeak is already initialized");
      const now = new Date().toISOString();
      this.database.prepare(
        "INSERT INTO admin_credentials (id, credential_json, created_at, updated_at) VALUES (1, ?, ?, ?)",
      ).run(JSON.stringify(credential), now, now);
      this.writeSettings(settings, now);
      this.insertAudit("ADMIN_INITIALIZED", { accessMode: settings.accessMode, target: `${settings.tsHost}:${settings.tsPort}` }, now);
    });
  }

  updateAdminCredential(credential: AdminCredential): void {
    const now = new Date().toISOString();
    this.database.prepare(
      "UPDATE admin_credentials SET credential_json = ?, updated_at = ? WHERE id = 1",
    ).run(JSON.stringify(credential), now);
  }

}
