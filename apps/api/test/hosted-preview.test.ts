import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import handleRequest from "../src/index";

test("the hosted Node handler serves the public preview and isolates local restaurant operations", async () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const server = createServer(handleRequest).listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
    const routes = [
      ["menu", { version: 1, overrides: {} }],
      ["menu?after=1", { version: 1, overrides: null }],
      ["auth/me", { user: null }],
      ["auth/deliveries/config", { enabled: false, postalPrefixes: [] }],
      ["auth/pickups/config", { enabled: false }],
    ] as const;

    await Promise.all(routes.map(async ([path, expected]) => {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.deepEqual(await response.json(), expected, path);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("set-cookie"), null);
    }));
    assert.equal((await fetch(base + "readiness")).status, 503);
    assert.equal((await fetch(base + "checkout-sessions", { method: "POST" })).status, 503);
    assert.equal((await fetch(base + "auth/deliveries", { method: "POST" })).status, 404);
    assert.equal((await fetch(base + "auth/pickups", { method: "POST" })).status, 404);
    for (const path of ["auth/admin/session", "auth/admin/deliveries", "training/operations", "print-diagnostics"]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});
