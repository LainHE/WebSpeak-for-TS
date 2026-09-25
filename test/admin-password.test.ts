import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashAdminPassword,
  validateAdminPassword,
  verifyAdminPassword,
} from "../src/security/admin-password.js";

describe("validateAdminPassword", () => {
  it("rejects passwords shorter than 12 characters", () => {
    assert.match(validateAdminPassword("short"), /at least 12/);
  });

  it("rejects passwords longer than 1024 characters", () => {
    assert.match(validateAdminPassword("x".repeat(1025)), /too long/);
  });

  it("accepts a 12-character password", () => {
    assert.equal(validateAdminPassword("correct-horse-1"), null);
  });
});

describe("hashAdminPassword / verifyAdminPassword", () => {
  it("round-trips a valid password", async () => {
    const credential = await hashAdminPassword("correct-horse-battery", { username: "root" });
    assert.equal(credential.username, "root");
    assert.equal(credential.version, 1);
    assert.equal(await verifyAdminPassword("correct-horse-battery", credential), true);
  });

  it("rejects a wrong password", async () => {
    const credential = await hashAdminPassword("correct-horse-battery");
    assert.equal(await verifyAdminPassword("wrong-password-123", credential), false);
  });

  it("rejects a weak password unless explicitly allowed", async () => {
    await assert.rejects(() => hashAdminPassword("short"));
    const weak = await hashAdminPassword("short", { allowWeakPassword: true });
    assert.equal(await verifyAdminPassword("short", weak), true);
  });

  it("returns false for malformed credentials instead of throwing", async () => {
    const credential = await hashAdminPassword("correct-horse-battery");
    assert.equal(await verifyAdminPassword("correct-horse-battery", { ...credential, version: 2 as never }), false);
    assert.equal(await verifyAdminPassword("correct-horse-battery", { ...credential, hash: "!!!not-base64!!!" }), false);
  });

  it("generates unique salts for identical passwords", async () => {
    const a = await hashAdminPassword("correct-horse-battery");
    const b = await hashAdminPassword("correct-horse-battery");
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
  });
});
