import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UnsafeTeamSpeakTargetError,
  isRestrictedAddress,
  resolveSafeOpenTarget,
} from "../src/security/open-target-policy.js";

describe("isRestrictedAddress (IPv4)", () => {
  for (const address of [
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "100.64.0.1",
    "198.18.0.1",
    "203.0.113.7",
    "224.0.0.1",
    "255.255.255.255",
  ]) {
    it(`marks ${address} as restricted`, () => {
      assert.equal(isRestrictedAddress(address), true);
    });
  }

  for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
    it(`allows public ${address}`, () => {
      assert.equal(isRestrictedAddress(address), false);
    });
  }
});

describe("isRestrictedAddress (IPv6)", () => {
  for (const address of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "fec0::1", "ff02::1", "2001:db8::1", "::ffff:10.0.0.1", "::ffff:192.168.1.1"]) {
    it(`marks ${address} as restricted`, () => {
      assert.equal(isRestrictedAddress(address), true);
    });
  }

  for (const address of ["2001:4860:4860::8888", "2606:4700:4700::1111", "2a00:1450:4001::1"]) {
    it(`allows public ${address}`, () => {
      assert.equal(isRestrictedAddress(address), false);
    });
  }
});

describe("resolveSafeOpenTarget", () => {
  it("accepts a public IPv4 literal and returns the validated address", async () => {
    const resolved = await resolveSafeOpenTarget({ host: "8.8.8.8", port: 9987 });
    assert.deepEqual(resolved, { host: "8.8.8.8", port: 9987 });
  });

  it("rejects private and loopback IPv4 literals", async () => {
    await assert.rejects(() => resolveSafeOpenTarget({ host: "10.0.0.1", port: 9987 }), UnsafeTeamSpeakTargetError);
    await assert.rejects(() => resolveSafeOpenTarget({ host: "127.0.0.1", port: 9987 }), UnsafeTeamSpeakTargetError);
  });

  it("rejects loopback and unique-local IPv6 literals", async () => {
    await assert.rejects(() => resolveSafeOpenTarget({ host: "::1", port: 9987 }), UnsafeTeamSpeakTargetError);
    await assert.rejects(() => resolveSafeOpenTarget({ host: "fc00::1", port: 9987 }), UnsafeTeamSpeakTargetError);
  });

  it("accepts a public IPv6 literal", async () => {
    const resolved = await resolveSafeOpenTarget({ host: "2606:4700:4700::1111", port: 9987 });
    assert.equal(resolved.host, "2606:4700:4700::1111");
  });
});
