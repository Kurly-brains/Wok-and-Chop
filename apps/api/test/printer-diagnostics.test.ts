import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import type { INestApplication } from "@nestjs/common";
import { createApplication } from "../src/app";
import { readStatus, recordPaper, runCheck, writeToSocket } from "../../print-bridge/diagnostics.cjs";

const origin = "http://127.0.0.1:3000";
const directory = mkdtempSync(join(tmpdir(), "wok-printer-test-"));
let app: INestApplication;
let endpoint: string;
before(async () => {
  process.env.WOK_PRINTER_DIAGNOSTICS_DIR = directory;
  delete process.env.WOK_PRINTER_IPV4;
  app = await createApplication({ webOrigin: origin });
  await app.listen(0, "127.0.0.1");
  endpoint = (await app.getUrl()) + "/v1/print-diagnostics";
});
after(async () => {
  await app?.close();
  rmSync(directory, { recursive: true, force: true });
});

function simulate(body: unknown, requestOrigin = origin) {
  return fetch(endpoint + "/simulate", { method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin }, body: JSON.stringify(body) });
}

test("staff diagnostic verifies the virtual spool and reuses the same immutable request", async () => {
  const id = randomUUID();
  const [first, repeated] = await Promise.all([simulate({id}), simulate({id})]);
  assert.equal(first.status, 201);
  assert.equal(repeated.status, 201);
  const result = await first.json();
  assert.deepEqual(result, await repeated.json());
  assert.equal(result.outcome, "simulated");
  const bytes = readFileSync(join(directory, `test-${id}.prn`));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), result.digest);
  assert.equal(bytes.toString("ascii").trimEnd(), result.ticket);
  assert.ok(result.ticket.startsWith("PRINTER TEST / DO NOT PREPARE"));
  assert.ok(result.ticket.split("\n").every((line: string) => line.length <= 42));
  const status = await (await fetch(endpoint)).json();
  assert.equal(status.setup, "unconfigured");
  assert.equal(status.lastHardware, null);
  assert.deepEqual(status.lastSimulator, result);
});

test("the web diagnostic rejects external origins, addresses and arbitrary ticket content", async () => {
  const id = randomUUID();
  assert.equal((await simulate({id}, "https://external.invalid")).status, 403);
  assert.equal((await simulate({id, host: "192.168.1.1"})).status, 400);
  assert.equal((await simulate({id, ticket: "Any text"})).status, 400);
  assert.equal((await fetch(endpoint + "/test-device", { method: "POST" })).status, 404);
});

test("an interrupted intent can be inspected without sending it again", async () => {
  const id = randomUUID();
  await runCheck("simulator", id);
  const db = new DatabaseSync(join(directory, "checks.sqlite"));
  db.prepare("UPDATE checks SET outcome='sending' WHERE id=?").run(id);
  db.close();
  assert.equal((await runCheck("simulator", id)).outcome, "uncertain");
});

test("the raw transport writes the specimen to a loopback fixture and distinguishes a refused connection", async () => {
  const received: Buffer[] = [];
  let observed!: () => void;
  const finished = new Promise<void>(resolve => { observed = resolve; });
  const receiver = createServer(socket => {
    socket.on("data", chunk => received.push(Buffer.from(chunk)));
    socket.on("end", observed);
  });
  await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
  const address = receiver.address();
  assert.ok(address && typeof address === "object");
  const destination = { host: "127.0.0.1", port: address.port };
  const bytes = Buffer.from("PRINTER TEST / DO NOT PREPARE\n", "ascii");
  try {
    assert.equal(await writeToSocket(destination, bytes), "socket-sent");
    await finished;
    assert.deepEqual(Buffer.concat(received), bytes);
  } finally {
    await new Promise<void>(resolve => receiver.close(() => resolve()));
  }
  assert.equal(await writeToSocket(destination, bytes), "not-sent");
});

test("hardware mode requires an explicitly configured private device", async () => {
  await assert.rejects(runCheck("hardware", "test-without-hardware"), /has not been configured/);
  process.env.WOK_PRINTER_IPV4 = "example.invalid";
  try {
    await assert.rejects(runCheck("hardware", "test-address"), /private LAN/);
  } finally { delete process.env.WOK_PRINTER_IPV4; }
});

test("the LAN specimen is sent once, and the matching paper observation is recorded independently", async (t) => {
  // Redirect the configured address to a disposable loopback receiver at the connector boundary.
  const receiver = createServer();
  const captured: Buffer[] = [];
  let connections = 0;
  const finished = new Promise<void>(resolve => receiver.on("connection", socket => {
    connections++;
    socket.on("data", chunk => captured.push(Buffer.from(chunk)));
    socket.on("end", resolve);
  }));
  await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
  const address = receiver.address();
  assert.ok(address && typeof address === "object");
  const original = Socket.prototype.connect;
  const connect = t.mock.method(Socket.prototype, "connect", function(this: Socket, port: number, host: string, cb: () => void) {
    assert.equal(host, "192.168.1.20");
    assert.equal(port, 9100);
    return original.call(this, { port: address.port, host: "127.0.0.1" }, cb);
  });
  process.env.WOK_PRINTER_IPV4 = "192.168.1.20";
  process.env.WOK_PRINTER_PORT = "9100";
  const id = "network-fixture-" + randomUUID();
  try {
    const result = await runCheck("hardware", id);
    await finished;
    assert.equal(result.outcome, "socket-sent");
    assert.equal(result.digest, createHash("sha256").update(Buffer.concat(captured)).digest("hex"));
    assert.deepEqual(await runCheck("hardware", id), result);
    assert.equal(connections, 1);
    assert.throws(() => recordPaper("missing-id"), /No matching hardware/);
    assert.equal(readStatus().paperObservedAt, null);
    const event = recordPaper(id);
    assert.deepEqual(recordPaper(id), event);
    assert.equal(readStatus().paperObservedAt, event.observedAt);
    assert.equal(readStatus().lastHardware?.outcome, "socket-sent");
  } finally {
    connect.mock.restore();
    delete process.env.WOK_PRINTER_IPV4;
    delete process.env.WOK_PRINTER_PORT;
    await new Promise<void>(resolve => receiver.close(() => resolve()));
  }
});
