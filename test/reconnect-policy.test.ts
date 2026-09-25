import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RECONNECT_DELAYS_MS,
  RECONNECT_WINDOW_MS,
  isRecoverable,
  reconnectDelayMs,
  reconnectWindowOpen,
} from "../src/server/reconnect-policy.js";

describe("reconnect-policy", () => {
  it("follows the configured backoff sequence with zero jitter", () => {
    const fixed = () => 0.5; // jitter = 0
    for (const attempt of [1, 2, 3, 4, 5, 6, 7]) {
      assert.equal(reconnectDelayMs(attempt, fixed), RECONNECT_DELAYS_MS[attempt - 1]);
    }
  });

  it("normalizes attempts below 1 to the first delay", () => {
    assert.equal(reconnectDelayMs(0, () => 0.5), RECONNECT_DELAYS_MS[0]);
    assert.equal(reconnectDelayMs(-3, () => 0.5), RECONNECT_DELAYS_MS[0]);
  });

  it("caps the delay at the last configured step for long attempts", () => {
    const last = RECONNECT_DELAYS_MS.at(-1)!;
    assert.equal(reconnectDelayMs(99, () => 0.5), last);
  });

  it("applies bounded jitter around the base delay", () => {
    const base = RECONNECT_DELAYS_MS[0];
    assert.ok(Math.abs(reconnectDelayMs(1, () => 0) - base) <= base * 0.1);
    assert.ok(Math.abs(reconnectDelayMs(1, () => 1) - base) <= base * 0.1);
  });

  it("never returns a delay below the 250ms floor", () => {
    // Smallest base is 1000ms; even with max negative jitter the floor matters at the low end.
    assert.ok(reconnectDelayMs(1, () => 0) >= 250);
  });

  it("keeps the reconnect window open only within five minutes", () => {
    const startedAt = 1_000_000;
    assert.equal(reconnectWindowOpen(startedAt, startedAt), true);
    assert.equal(reconnectWindowOpen(startedAt, startedAt + RECONNECT_WINDOW_MS - 1), true);
    assert.equal(reconnectWindowOpen(startedAt, startedAt + RECONNECT_WINDOW_MS), false);
  });

  it("treats unknown errors as recoverable by default", () => {
    assert.equal(isRecoverable(null), true);
    assert.equal(isRecoverable(undefined as never), true);
    assert.equal(isRecoverable({ retryable: true } as never), true);
    assert.equal(isRecoverable({ retryable: false } as never), false);
  });
});
