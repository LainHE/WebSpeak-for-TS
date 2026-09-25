import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateMasterSecret } from "../src/security/master-secret.js";

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("loadOrCreateMasterSecret", () => {
  it("creates a 32-byte secret file on first use", () => {
    const dir = mkdtempSync(join(tmpdir(), "webspeak-secret-"));
    dirs.push(dir);
    const path = join(dir, "secret.key");
    const key = loadOrCreateMasterSecret(path);
    assert.equal(key.length, 32);
    assert.equal(loadOrCreateMasterSecret(path).length, 32);
  });

  it("reuses the same file across loads", () => {
    const dir = mkdtempSync(join(tmpdir(), "webspeak-secret-"));
    dirs.push(dir);
    const path = join(dir, "secret.key");
    const first = loadOrCreateMasterSecret(path);
    const second = loadOrCreateMasterSecret(path);
    assert.deepEqual(first, second);
  });

  it("rejects a secret file with the wrong length", () => {
    const dir = mkdtempSync(join(tmpdir(), "webspeak-secret-"));
    dirs.push(dir);
    const path = join(dir, "secret.key");
    loadOrCreateMasterSecret(path);
    // Overwrite with a truncated key; reloading must fail loudly.
    writeFileSync(path, Buffer.alloc(16));
    assert.throws(() => loadOrCreateMasterSecret(path), /expected 32 bytes/);
  });
});
