import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_WEBRTC_UDP_PORT_RANGE } from "../server/webrtc-config.js";
import { DATABASE_SCHEMA_VERSION } from "./types.js";
import type { SettingsUpdate } from "./types.js";

export class DatabaseCore {
  protected readonly database: DatabaseSync;

  constructor(protected readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    const existed = existsSync(path);
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate(existed);
  }

  close(): void {
    this.database.close();
  }

  get schemaVersion(): number {
    return Number((this.database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  }

  exportBackup(): Buffer {
    const exportPath = `${this.path}.export-${randomBytes(8).toString("hex")}.db`;
    try {
      const escapedPath = exportPath.replaceAll("'", "''");
      this.database.exec(`VACUUM INTO '${escapedPath}'`);
      return readFileSync(exportPath);
    } finally {
      try { unlinkSync(exportPath); } catch { /* best effort cleanup */ }
    }
  }

  protected migrate(existed: boolean): void {
    let version = this.schemaVersion;
    if (version > DATABASE_SCHEMA_VERSION) {
      throw new Error(`Database schema ${version} is newer than this WebSpeak build`);
    }
    if (existed && version > 0) {
      copyFileSync(this.path, `${this.path}.schema-${version}.bak`);
    }
    if (version === 0) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );
          CREATE TABLE admin_credentials (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            credential_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            site_name TEXT NOT NULL,
            welcome_text TEXT NOT NULL,
            access_mode TEXT NOT NULL CHECK (access_mode IN ('fixed', 'open')),
            ts_host TEXT NOT NULL,
            ts_port INTEGER NOT NULL CHECK (ts_port BETWEEN 1 AND 65535),
            ts_password_encrypted TEXT,
            detected_protocol TEXT CHECK (detected_protocol IS NULL OR detected_protocol IN ('ts3', 'ts6')),
            last_test_at TEXT,
            last_test_latency_ms INTEGER,
            last_test_error TEXT,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            details_json TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
        `);
        const now = new Date().toISOString();
        this.database.prepare(
          `INSERT INTO settings (
             id, site_name, welcome_text, access_mode, ts_host, ts_port,
             ts_password_encrypted, detected_protocol, last_test_at,
             last_test_latency_ms, last_test_error, updated_at
           ) VALUES (1, 'WebSpeak', '', 'fixed', '127.0.0.1', 9987, NULL, NULL, NULL, NULL, NULL, ?)`,
        ).run(now);
        this.database.exec("PRAGMA user_version = 1");
      });
      version = 1;
    }
    if (version === 1) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE managed_invites (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE,
            target_host TEXT NOT NULL,
            target_port INTEGER NOT NULL CHECK (target_port BETWEEN 1 AND 65535),
            server_password_encrypted TEXT,
            channel TEXT NOT NULL DEFAULT '',
            expires_at TEXT NOT NULL,
            max_uses INTEGER NOT NULL CHECK (max_uses >= 0),
            use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
            created_at TEXT NOT NULL,
            revoked_at TEXT
          );
          CREATE INDEX managed_invites_token_idx ON managed_invites(token_hash);
          CREATE INDEX managed_invites_expiry_idx ON managed_invites(expires_at);
        `);
        this.database.exec("PRAGMA user_version = 2");
      });
      version = 2;
    }
    if (version === 2) {
      this.transaction(() => {
        this.database.exec(`
          -- WebRTC media ports are stored with the administrator settings so the
          -- same range is used by the gateway and shown in the admin console.
          ALTER TABLE settings ADD COLUMN webrtc_enabled INTEGER NOT NULL DEFAULT 0 CHECK (webrtc_enabled IN (0, 1));
          ALTER TABLE settings ADD COLUMN webrtc_public_host TEXT NOT NULL DEFAULT '';
          ALTER TABLE settings ADD COLUMN webrtc_udp_start INTEGER NOT NULL DEFAULT 40000 CHECK (webrtc_udp_start BETWEEN 1 AND 65535);
          ALTER TABLE settings ADD COLUMN webrtc_udp_end INTEGER NOT NULL DEFAULT 40099 CHECK (webrtc_udp_end BETWEEN 1 AND 65535);
        `);
        this.database.exec("PRAGMA user_version = 3");
      });
      version = 3;
    }
    if (version === 3) {
      this.transaction(() => {
        this.database.exec(`
          ALTER TABLE settings ADD COLUMN welcome_text_en TEXT NOT NULL DEFAULT '';
        `);
        this.database.exec("PRAGMA user_version = 4");
      });
      version = 4;
    }
    if (version === 4) {
      this.transaction(() => {
        this.database.exec(`
          ALTER TABLE settings ADD COLUMN relay_configured INTEGER NOT NULL DEFAULT 0 CHECK (relay_configured IN (0, 1));
          ALTER TABLE settings ADD COLUMN relay_enabled INTEGER NOT NULL DEFAULT 0 CHECK (relay_enabled IN (0, 1));
          ALTER TABLE settings ADD COLUMN relay_name TEXT NOT NULL DEFAULT '';
          ALTER TABLE settings ADD COLUMN relay_host TEXT NOT NULL DEFAULT '';
          ALTER TABLE settings ADD COLUMN relay_port INTEGER NOT NULL DEFAULT 39087 CHECK (relay_port BETWEEN 1 AND 65535);
          ALTER TABLE settings ADD COLUMN relay_token_encrypted TEXT;
        `);
        this.database.exec("PRAGMA user_version = 5");
      });
      version = 5;
    }
    if (version === 5) {
      this.transaction(() => {
        this.database.exec(`
          CREATE TABLE relay_nodes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
            host TEXT NOT NULL,
            port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
            token_encrypted TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX relay_nodes_enabled_idx ON relay_nodes(enabled);
        `);
        const legacy = this.database.prepare(
          `SELECT relay_configured, relay_enabled, relay_name, relay_host, relay_port, relay_token_encrypted
           FROM settings WHERE id = 1`,
        ).get() as {
          relay_configured?: number;
          relay_enabled?: number;
          relay_name?: string;
          relay_host?: string;
          relay_port?: number;
          relay_token_encrypted?: string | null;
        } | undefined;
        if (legacy?.relay_configured === 1 && legacy.relay_host && legacy.relay_token_encrypted) {
          const now = new Date().toISOString();
          this.database.prepare(
            `INSERT INTO relay_nodes (id, name, enabled, host, port, token_encrypted, created_at, updated_at)
             VALUES ('relay-default', ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            legacy.relay_name || "中继加速",
            legacy.relay_enabled === 1 ? 1 : 0,
            legacy.relay_host,
            legacy.relay_port || 39087,
            legacy.relay_token_encrypted,
            now,
            now,
          );
        }
        this.database.exec("PRAGMA user_version = 6");
      });
      version = 6;
    }
    if (version === 6) {
      this.transaction(() => {
        this.database.exec(`
          ALTER TABLE settings ADD COLUMN welcome_text_de TEXT NOT NULL DEFAULT '';
          ALTER TABLE settings ADD COLUMN welcome_text_ru TEXT NOT NULL DEFAULT '';
          ALTER TABLE settings ADD COLUMN welcome_text_ja TEXT NOT NULL DEFAULT '';
        `);
        this.database.exec("PRAGMA user_version = 7");
      });
    }
  }

  protected writeSettings(settings: SettingsUpdate, now: string): void {
    this.database.prepare(
      `UPDATE settings SET
         site_name = ?, welcome_text = ?, welcome_text_en = ?, welcome_text_de = ?, welcome_text_ru = ?, welcome_text_ja = ?, access_mode = ?, ts_host = ?, ts_port = ?,
         ts_password_encrypted = ?, webrtc_enabled = ?, webrtc_udp_start = ?,
         webrtc_udp_end = ?, relay_configured = ?, relay_enabled = ?, relay_name = ?,
         relay_host = ?, relay_port = ?, relay_token_encrypted = ?, updated_at = ?
       WHERE id = 1`,
    ).run(
      settings.siteName,
      settings.welcomeText,
      settings.welcomeTextEn ?? "",
      settings.welcomeTextDe ?? "",
      settings.welcomeTextRu ?? "",
      settings.welcomeTextJa ?? "",
      settings.accessMode,
      settings.tsHost,
      settings.tsPort,
      settings.tsPasswordEncrypted,
      settings.webRtcEnabled ? 1 : 0,
      settings.webRtcUdpStart ?? DEFAULT_WEBRTC_UDP_PORT_RANGE[0],
      settings.webRtcUdpEnd ?? DEFAULT_WEBRTC_UDP_PORT_RANGE[1],
      settings.relayConfigured ? 1 : 0,
      settings.relayEnabled ? 1 : 0,
      settings.relayName,
      settings.relayHost,
      settings.relayPort,
      settings.relayTokenEncrypted,
      now,
    );
  }

  protected insertAudit(event: string, details: Record<string, unknown>, now: string): void {
    this.database.prepare(
      "INSERT INTO audit_events (event, details_json, created_at) VALUES (?, ?, ?)",
    ).run(event, JSON.stringify(details), now);
  }

  protected transaction(action: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
