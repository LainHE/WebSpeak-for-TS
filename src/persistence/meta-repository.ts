import { DatabaseInviteRepository } from "./invite-repository.js";

export class DatabaseMetaRepository extends DatabaseInviteRepository {
  getMeta(key: string): string | null {
    const row = this.database.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.database.prepare(
      "INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  }

  nextVisitorNumber(): number {
    let nextNumber = 1;
    this.transaction(() => {
      const currentValue = this.getMeta("visitor_count");
      const current = currentValue ? Number.parseInt(currentValue, 10) : 0;
      nextNumber = Number.isSafeInteger(current) && current >= 0 && current < Number.MAX_SAFE_INTEGER
        ? current + 1
        : 1;
      this.setMeta("visitor_count", String(nextNumber));
    });
    return nextNumber;
  }

  getVisitorCount(): number {
    const value = this.getMeta("visitor_count");
    const count = value ? Number.parseInt(value, 10) : 0;
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  }

}
