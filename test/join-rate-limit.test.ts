import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JoinRateLimiter } from "../src/server/join-rate-limit.js";

const T0 = 1_000_000;

describe("JoinRateLimiter", () => {
  it("allows up to the window limit per peer and then rejects", () => {
    const limiter = new JoinRateLimiter();
    let now = T0;
    for (let i = 0; i < 30; i++) {
      assert.equal(limiter.allow("peer-a", now), true, `request ${i + 1} should be allowed`);
    }
    assert.equal(limiter.allow("peer-a", now), false);
  });

  it("resets the window after 60 seconds", () => {
    const limiter = new JoinRateLimiter();
    let now = T0;
    for (let i = 0; i < 30; i++) limiter.allow("peer-a", now);
    assert.equal(limiter.allow("peer-a", now), false);
    assert.equal(limiter.allow("peer-a", now + 60_000), true);
  });

  it("isolates peers from each other", () => {
    const limiter = new JoinRateLimiter();
    let now = T0;
    for (let i = 0; i < 30; i++) limiter.allow("peer-a", now);
    assert.equal(limiter.allow("peer-b", now), true);
  });

  it("evicts the oldest peer when the tracked set is full", () => {
    const limiter = new JoinRateLimiter(2);
    let now = T0;
    limiter.allow("peer-1", now);
    limiter.allow("peer-2", now + 1);
    // Filling beyond the cap evicts peer-1, so a fresh window for peer-1 is allowed.
    limiter.allow("peer-3", now + 2);
    assert.equal(limiter.allow("peer-1", now + 3), true);
  });

  it("handles an empty map without crashing on prune", () => {
    const limiter = new JoinRateLimiter(0);
    assert.equal(limiter.allow("any-peer", T0), true);
  });
});
