import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IdentityLeaseStore } from "../src/server/identity-lease.js";

describe("IdentityLeaseStore", () => {
  it("grants the first owner and denies a second owner for the same key", () => {
    const store = new IdentityLeaseStore();
    assert.equal(store.acquire("identity-1", "session-A"), true);
    assert.equal(store.acquire("identity-1", "session-B"), false);
  });

  it("allows the same owner to re-acquire its own key", () => {
    const store = new IdentityLeaseStore();
    assert.equal(store.acquire("identity-1", "session-A"), true);
    assert.equal(store.acquire("identity-1", "session-A"), true);
  });

  it("allows distinct keys to be leased independently", () => {
    const store = new IdentityLeaseStore();
    assert.equal(store.acquire("identity-1", "session-A"), true);
    assert.equal(store.acquire("identity-2", "session-B"), true);
  });

  it("releases only the owning session", () => {
    const store = new IdentityLeaseStore();
    store.acquire("identity-1", "session-A");
    store.release("identity-1", "session-B");
    assert.equal(store.acquire("identity-1", "session-B"), false);
    store.release("identity-1", "session-A");
    assert.equal(store.acquire("identity-1", "session-B"), true);
  });

  it("release on an unknown key is a no-op", () => {
    const store = new IdentityLeaseStore();
    assert.doesNotThrow(() => store.release("missing", "session-A"));
  });
});
