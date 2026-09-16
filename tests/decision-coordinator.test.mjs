import assert from "node:assert/strict";
import test from "node:test";
import { DecisionCoordinator } from "../lib/decision-coordinator.ts";

function request(path, token) {
  return new Request(`https://decision-coordinator.internal${path}`, {
    method: "POST",
    headers: { "x-decision-token": token },
  });
}

function memoryState() {
  const values = new Map();
  return {
    values,
    state: {
      storage: {
        async transaction(operation) {
          return operation({
            async get(key) {
              return values.has(key) ? structuredClone(values.get(key)) : undefined;
            },
            async put(key, value) {
              values.set(key, structuredClone(value));
            },
            async delete(key) {
              return values.delete(key);
            },
          });
        },
      },
    },
  };
}

test("decision coordinator persists one writer lease and releases only its owner", async () => {
  const storage = memoryState();
  let coordinator = new DecisionCoordinator(storage.state);

  assert.equal((await coordinator.fetch(request("/acquire", "owner-a"))).status, 204);
  coordinator = new DecisionCoordinator(storage.state);
  const blocked = await coordinator.fetch(request("/acquire", "owner-b"));
  assert.equal(blocked.status, 429);
  assert.equal(Number(blocked.headers.get("retry-after")) >= 1, true);

  assert.equal((await coordinator.fetch(request("/release", "owner-b"))).status, 204);
  assert.equal((await coordinator.fetch(request("/acquire", "owner-b"))).status, 429);

  assert.equal((await coordinator.fetch(request("/release", "owner-a"))).status, 204);
  assert.equal((await coordinator.fetch(request("/acquire", "owner-b"))).status, 204);
});

test("decision coordinator replaces an expired persistent lease", async () => {
  const storage = memoryState();
  storage.values.set("active", { token: "expired-owner", expiresAt: Date.now() - 1 });
  const coordinator = new DecisionCoordinator(storage.state);
  assert.equal((await coordinator.fetch(request("/acquire", "new-owner"))).status, 204);
  assert.equal(storage.values.get("active").token, "new-owner");
});

test("decision coordinator fails closed when storage fails", async () => {
  const coordinator = new DecisionCoordinator({
    storage: {
      async transaction() {
        throw new Error("storage unavailable");
      },
    },
  });
  await assert.rejects(
    coordinator.fetch(request("/acquire", "owner-a")),
    /storage unavailable/,
  );
});

test("decision coordinator rejects malformed internal requests", async () => {
  const coordinator = new DecisionCoordinator(memoryState().state);
  assert.equal((await coordinator.fetch(new Request("https://decision-coordinator.internal/acquire", {
    method: "GET",
  }))).status, 400);
  assert.equal((await coordinator.fetch(request("/unknown", "owner-a"))).status, 404);
});
