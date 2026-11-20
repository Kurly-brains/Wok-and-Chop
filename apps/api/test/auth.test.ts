import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { createApplication } from "../src/app";

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
const origin = "http://127.0.0.1:3000";
const email = `auth-${randomUUID()}@example.invalid`;
const password = "Synthetic test password 2026!";
let app: INestApplication;
let base: string;
let pool: Pool;

before(async () => {
  if (!enabled) return;
  const url = new URL(databaseUrl!);
  if (!url.pathname.endsWith("_test")) throw new Error("Auth integration tests require a dedicated database ending in _test.");
  pool = new Pool({ connectionString: databaseUrl });
  app = await createApplication({ authDatabaseUrl: databaseUrl, webOrigin: origin });
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
after(async () => {
  if (!enabled) return;
  await pool.query("DELETE FROM customer_accounts WHERE email_normalized=$1", [email]);
  await app?.close();
  await pool?.end();
});

async function post(path: string, body: unknown, cookie?: string, suppliedOrigin = origin) {
  return fetch(`${base}/v1/auth/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: suppliedOrigin, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function responseCookie(response: Response) {
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  const cookie = cookies[0];
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/;/);
  assert.match(cookies[1], /^wok_customer_session=; HttpOnly; SameSite=Lax; Path=\/v1\/auth; Max-Age=0; Expires=/);
  return cookie.split(";")[0];
}

test("the staff session gate rechecks manager membership and session validity", { skip: !enabled }, async () => {
  const fixtureEmail = `manager-session-${randomUUID()}@example.invalid`;
  try {
    const endpoint = `${base}/v1/auth/admin/session`;
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal((await fetch(endpoint, { headers: { Cookie: `wok_customer_session=${"0".repeat(64)}` } })).status, 401);
    const registration = await post("register", { name: "Manager session fixture", email: fixtureEmail, password });
    assert.equal(registration.status, 201);
    const cookie = responseCookie(registration);
    const { user } = await registration.json();
    const headers = { Cookie: cookie };
    assert.equal((await fetch(endpoint, { headers })).status, 403);
    await pool.query("INSERT INTO restaurant_managers(account_id) VALUES($1)", [user.id]);
    const authorized = await fetch(endpoint, { headers });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get("cache-control"), "no-store");
    assert.deepEqual(await authorized.json(), { authorized: true, accountId: user.id });
    await pool.query("DELETE FROM restaurant_managers WHERE account_id=$1", [user.id]);
    assert.equal((await fetch(endpoint, { headers })).status, 403);
    await pool.query("INSERT INTO restaurant_managers(account_id) VALUES($1)", [user.id]);
    assert.equal((await post("logout", {}, cookie)).status, 200);
    assert.equal((await fetch(endpoint, { headers })).status, 401);
    const signedIn = await post("login", { email: fixtureEmail, password });
    assert.equal(signedIn.status, 200);
    const expiredCookie = responseCookie(signedIn);
    await pool.query("UPDATE customer_sessions SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE token_hash=$1", [createHash("sha256").update(expiredCookie.split("=")[1]).digest("hex")]);
    assert.equal((await fetch(endpoint, { headers: { Cookie: expiredCookie } })).status, 401);
  } finally {
    await pool.query("DELETE FROM customer_accounts WHERE email_normalized=$1", [fixtureEmail]);
  }
});

test("the customer directory checks manager membership on every lookup", { skip: !enabled }, async () => {
  const fixtureEmail = `directory-${randomUUID()}@example.invalid`;
  try {
    const registration = await post("register", { name: "Directory fixture", email: fixtureEmail, password });
    assert.equal(registration.status, 201);
    const cookie = responseCookie(registration);
    const { user } = await registration.json();
    const directory = `${base}/v1/auth/admin/customers`;
    const history = `${directory}/${user.id}/orders`;
    const headers = { Cookie: cookie };
    assert.equal((await fetch(directory)).status, 401);
    assert.equal((await fetch(directory, { headers })).status, 403);
    assert.equal((await fetch(history, { headers })).status, 403);
    await pool.query("INSERT INTO restaurant_managers(account_id) VALUES($1)", [user.id]);
    const filtered = await fetch(`${directory}?q=${encodeURIComponent(fixtureEmail)}`, { headers });
    assert.equal(filtered.status, 200);
    const page = await filtered.json();
    assert.equal(page.customers.length, 1);
    assert.deepEqual(Object.keys(page.customers[0]).sort(), ["email", "id", "joinedAt", "lastOrderAt", "name", "orderCount"]);
    assert.equal(page.customers[0].id, user.id);
    assert.equal((await fetch(history, { headers })).status, 200);
    await pool.query("DELETE FROM restaurant_managers WHERE account_id=$1", [user.id]);
    assert.equal((await fetch(history, { headers })).status, 403);
  } finally {
    await pool.query("DELETE FROM customer_accounts WHERE email_normalized=$1", [fixtureEmail]);
  }
});

test("customer auth persists salted hashes, rotates sessions and revokes logout", { skip: !enabled }, async () => {
  const rejectedOrigin = await post("register", { name: "Fixture Customer", email, password }, undefined, "https://untrusted.example");
  assert.equal(rejectedOrigin.status, 403);
  const missingOrigin = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(missingOrigin.status, 403);
  const wrongContentType = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(wrongContentType.status, 415);
  assert.equal((await pool.query("SELECT id FROM customer_accounts WHERE email_normalized=$1", [email])).rowCount, 0);
  assert.equal((await post("register", { name: "Fixture Customer", email, password: "short" })).status, 400);

  const fixedToken = "f".repeat(64);
  const registration = await post("register", { name: "Fixture Customer", email: email.toUpperCase(), password }, `wok_customer_session=${fixedToken}`);
  assert.equal(registration.status, 201);
  assert.equal(registration.headers.get("access-control-allow-origin"), origin);
  assert.equal(registration.headers.get("access-control-allow-credentials"), "true");
  const user = (await registration.json()).user;
  const initialCookie = responseCookie(registration);
  const emptyHistory = await fetch(`${base}/v1/auth/orders`, { headers: { Cookie: initialCookie } });
  assert.equal(emptyHistory.status, 200);
  assert.deepEqual(await emptyHistory.json(), { accountId: user.id, orders: [], nextCursor: null });
  assert.equal(emptyHistory.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${base}/v1/auth/orders`)).status, 401);
  assert.equal(user.email, email);
  assert.equal(user.name, "Fixture Customer");
  assert.equal(user.password_hash, undefined);
  const token = initialCookie.split("=")[1];
  assert.notEqual(token, fixedToken);
  const rejectedFixedSession = await fetch(`${base}/v1/auth/me`, { headers: { Cookie: `wok_customer_session=${fixedToken}` } });
  assert.equal((await rejectedFixedSession.json()).user, null);
  const account = (await pool.query("SELECT password_hash FROM customer_accounts WHERE id=$1", [user.id])).rows[0];
  assert.match(account.password_hash, /^scrypt\$32768\$8\$1\$/);
  assert.ok(!account.password_hash.includes(password));
  const session = (await pool.query("SELECT token_hash FROM customer_sessions WHERE account_id=$1", [user.id])).rows[0];
  assert.notEqual(session.token_hash, token);
  assert.equal(session.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.equal((await post("register", { name: "Fixture Customer", email, password })).status, 409);
  assert.equal((await post("login", { email, password: "incorrect password" })).status, 401);
  assert.equal((await post("login", { email: "unknown@example.invalid", password })).status, 401);

  // The session survives a new API process/application instance because PostgreSQL owns it.
  await app.close();
  app = await createApplication({ authDatabaseUrl: databaseUrl, webOrigin: origin });
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  const me = await fetch(`${base}/v1/auth/me`, { headers: { Cookie: initialCookie } });
  assert.equal((await me.json()).user.id, user.id);
  assert.equal(me.headers.get("cache-control"), "no-store");
  const hostileCors = await fetch(`${base}/v1/auth/me`, { headers: { Origin: "https://untrusted.example", Cookie: initialCookie } });
  assert.notEqual(hostileCors.headers.get("access-control-allow-origin"), "https://untrusted.example");
  const login = await post("login", { email, password }, initialCookie);
  assert.equal(login.status, 200);
  const newCookie = responseCookie(login);
  assert.notEqual(newCookie, initialCookie);
  const oldSession = await fetch(`${base}/v1/auth/me`, { headers: { Cookie: initialCookie } });
  assert.equal((await oldSession.json()).user, null);
  const newSession = await fetch(`${base}/v1/auth/me`, { headers: { Cookie: newCookie } });
  assert.equal((await newSession.json()).user.id, user.id);

  assert.equal((await post("logout", {}, newCookie, "https://untrusted.example")).status, 403);
  const logout = await post("logout", {}, newCookie);
  assert.equal(logout.status, 200);
  assert.equal(logout.headers.getSetCookie().length, 2);
  assert.ok(logout.headers.getSetCookie().every(cookie => cookie.includes("Max-Age=0") && cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax")));
  assert.match(logout.headers.getSetCookie()[0], /Path=\/;/);
  assert.match(logout.headers.getSetCookie()[1], /Path=\/v1\/auth;/);
  const loggedOut = await fetch(`${base}/v1/auth/me`, { headers: { Cookie: newCookie } });
  assert.equal((await loggedOut.json()).user, null);
  assert.equal((await fetch(`${base}/v1/auth/orders`, { headers: { Cookie: newCookie } })).status, 401);
  const forged = await fetch(`${base}/v1/auth/me`, { headers: { Cookie: `wok_customer_session=${"a".repeat(64)}` } });
  assert.equal((await forged.json()).user, null);

  const relogin = await post("login", { email, password });
  const expiringCookie = responseCookie(relogin);
  await pool.query("UPDATE customer_sessions SET created_at=now() - interval '8 days', expires_at=now() - interval '1 day' WHERE token_hash=$1", [createHash("sha256").update(expiringCookie.split("=")[1]).digest("hex")]);
  const expired = await fetch(`${base}/v1/auth/me`, { headers: { Cookie: expiringCookie } });
  assert.equal((await expired.json()).user, null);
  assert.equal(expired.headers.getSetCookie().length, 2);
  assert.ok(expired.headers.getSetCookie().every(cookie => cookie.includes("Max-Age=0")));
  assert.equal((await fetch(`${base}/v1/checkout-sessions`, { method: "POST" })).status, 503);
});

test("account mutation attempts are rate-limited", { skip: !enabled }, async () => {
  let response: Response | undefined;
  for (let i = 0; i < 21; i += 1) response = await fetch(`${base}/v1/auth/login`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Forwarded-For": `192.0.2.${i}` },
    body: JSON.stringify({ email: "invalid", password: "x" }),
  });
  assert.equal(response?.status, 429);
});
