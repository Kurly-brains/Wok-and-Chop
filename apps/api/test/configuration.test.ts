import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../src/auth";
import { createApplication } from "../src/app";

test("auth preview rejects remote origins and PostgreSQL host overrides", () => {
  const origin = "http://127.0.0.1:3000";
  for (const url of [
    "postgresql://127.0.0.1/wok_chop_auth_dev?host=remote.example",
    "postgresql://remote.example/wok_chop_auth_dev",
    "postgresql://127.0.0.1/unrelated_database",
    "https://127.0.0.1/wok_chop_auth_dev",
  ]) assert.throws(() => new AuthService(url, origin), /dedicated local PostgreSQL/);
  for (const value of ["https://public.example", "http://127.0.0.1:3000/path", "http://127.0.0.1:3000/"]) {
    assert.throws(() => new AuthService(undefined, value), /exact loopback WEB_ORIGIN/);
  }
});

test("the application factory also refuses production startup", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try { await assert.rejects(createApplication(), /cannot run in production/); }
  finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
