import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { createApplication } from "../src/app";

let app: INestApplication;
let base: string;
before(async () => {
  app = await createApplication();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
after(async () => { await app?.close(); });

test("liveness does not report payment or kitchen readiness", async () => {
  const response = await fetch(`${base}/v1/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).acceptingOrders, false);
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("readiness fails closed and reports Toronto business time", async () => {
  const response = await fetch(`${base}/v1/readiness`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.acceptingOrders, false);
  assert.equal(body.restaurantTimezone, "America/Toronto");
  assert.ok(body.blockers.length > 0);
});

test("client payment claims and totals cannot create a payment or order", async () => {
  for (const path of ["quotes", "checkout-sessions"]) {
    const response = await fetch(`${base}/v1/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total: 1, paid: true, orderId: "forged" }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "ORDERING_NOT_CONFIGURED");
    assert.equal(body.details.acceptingOrders, false);
    assert.equal(body.url, undefined);
  }
});

test("unverified payment webhooks are never acknowledged as accepted", async () => {
  const response = await fetch(`${base}/v1/webhooks/stripe`, {
    method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": "forged" },
    body: JSON.stringify({ type: "checkout.session.completed", data: { object: { payment_status: "paid" } } }),
  });
  assert.equal(response.status, 503);
});

test("staff and device mutation endpoints are not exposed", async () => {
  for (const path of ["staff/orders/example/refunds", "device/print-jobs/claim"]) {
    const response = await fetch(`${base}/v1/${path}`, { method: "POST" });
    assert.equal(response.status, 404);
  }
});

test("loopback API rejects DNS-rebinding Host values and disables caching/sniffing", async () => {
  // Fetch may normalize Host; exercise an actual raw HTTP Host header instead.
  const rejected = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const req = request(`${base}/v1/health`, { headers: { Host: "untrusted.example" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(rejected.status, 403);
  assert.equal(JSON.parse(rejected.body).code, "HOST_REJECTED");
  const valid = await fetch(`${base}/v1/health`);
  assert.equal(valid.headers.get("cache-control"), "no-store");
  assert.equal(valid.headers.get("x-content-type-options"), "nosniff");
  assert.equal(valid.headers.get("x-frame-options"), "DENY");
});
