import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEAM_SPEAK_PORT,
  InvalidTeamSpeakTargetError,
  formatTeamSpeakTarget,
  parseTeamSpeakTarget,
  parseTeamSpeakTargetParts,
  teamSpeakTargetKey,
} from "../src/domain/teamspeak-target.js";

describe("parseTeamSpeakTarget", () => {
  it("parses a bare host with the default port", () => {
    assert.deepEqual(parseTeamSpeakTarget("voice.example.com"), {
      host: "voice.example.com",
      port: DEFAULT_TEAM_SPEAK_PORT,
    });
  });

  it("parses host:port and host#port forms", () => {
    assert.deepEqual(parseTeamSpeakTarget("voice.example.com:9988"), { host: "voice.example.com", port: 9988 });
    assert.deepEqual(parseTeamSpeakTarget("voice.example.com#9988"), { host: "voice.example.com", port: 9988 });
  });

  it("parses bracketed IPv6 addresses", () => {
    assert.deepEqual(parseTeamSpeakTarget("[2001:db8::1]:9988"), { host: "2001:db8::1", port: 9988 });
    assert.deepEqual(parseTeamSpeakTarget("[2001:db8::1]"), { host: "2001:db8::1", port: DEFAULT_TEAM_SPEAK_PORT });
    assert.deepEqual(parseTeamSpeakTarget("[2001:db8::1]#9988"), { host: "2001:db8::1", port: 9988 });
  });

  it("normalizes host case and trims whitespace", () => {
    assert.deepEqual(parseTeamSpeakTarget("  Voice.Example.COM  "), { host: "voice.example.com", port: DEFAULT_TEAM_SPEAK_PORT });
  });

  it("rejects empty input", () => {
    assert.throws(() => parseTeamSpeakTarget("   "), InvalidTeamSpeakTargetError);
  });

  it("rejects multiple port separators", () => {
    assert.throws(() => parseTeamSpeakTarget("host:9987:9988"), InvalidTeamSpeakTargetError);
    assert.throws(() => parseTeamSpeakTarget("host#1#2"), InvalidTeamSpeakTargetError);
  });

  it("rejects unbracketed IPv6", () => {
    assert.throws(() => parseTeamSpeakTarget("2001:db8::1"), InvalidTeamSpeakTargetError);
  });

  it("rejects invalid port ranges and types", () => {
    assert.throws(() => parseTeamSpeakTarget("host:0"), InvalidTeamSpeakTargetError);
    assert.throws(() => parseTeamSpeakTarget("host:65536"), InvalidTeamSpeakTargetError);
    assert.throws(() => parseTeamSpeakTarget("host:abc"), InvalidTeamSpeakTargetError);
  });

  it("rejects forbidden characters in host", () => {
    assert.throws(() => parseTeamSpeakTarget("ho st"), InvalidTeamSpeakTargetError);
    assert.throws(() => parseTeamSpeakTarget("host/path"), InvalidTeamSpeakTargetError);
  });
});

describe("parseTeamSpeakTargetParts", () => {
  it("combines separate host and port fields", () => {
    assert.deepEqual(parseTeamSpeakTargetParts("voice.example.com", "9988"), { host: "voice.example.com", port: 9988 });
  });

  it("falls back to single-field parsing when the port is empty", () => {
    assert.deepEqual(parseTeamSpeakTargetParts("voice.example.com:9988", ""), { host: "voice.example.com", port: 9988 });
    assert.deepEqual(parseTeamSpeakTargetParts("voice.example.com", undefined), { host: "voice.example.com", port: DEFAULT_TEAM_SPEAK_PORT });
  });

  it("accepts a bracketed IPv6 host with a separate port", () => {
    assert.deepEqual(parseTeamSpeakTargetParts("[2001:db8::1]", "9988"), { host: "2001:db8::1", port: 9988 });
  });

  it("accepts a raw IPv6 host combined with a separate port field", () => {
    assert.deepEqual(parseTeamSpeakTargetParts("2001:db8::1", "9988"), { host: "2001:db8::1", port: 9988 });
  });

  it("rejects a combined host:port value passed as the host field", () => {
    assert.throws(() => parseTeamSpeakTargetParts("voice.example.com:9988", "9988"), InvalidTeamSpeakTargetError);
  });
});

describe("formatTeamSpeakTarget / teamSpeakTargetKey", () => {
  it("formats IPv4-style hosts plainly and IPv6 hosts in brackets", () => {
    assert.equal(formatTeamSpeakTarget({ host: "voice.example.com", port: 9987 }), "voice.example.com:9987");
    assert.equal(formatTeamSpeakTarget({ host: "2001:db8::1", port: 9988 }), "[2001:db8::1]:9988");
  });

  it("keys are case-insensitive and round-trippable", () => {
    const a = teamSpeakTargetKey({ host: "Voice.Example.COM", port: 9987 });
    const b = teamSpeakTargetKey({ host: "voice.example.com", port: 9987 });
    assert.equal(a, b);
    assert.equal(a, "voice.example.com:9987");
  });
});
