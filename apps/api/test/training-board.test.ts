import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { INestApplication } from "@nestjs/common";
import { createApplication } from "../src/app";
import { TrainingBoard } from "../src/training-board";
import type { DemoService } from "../../../packages/domain/src/training";

const origin = "http://127.0.0.1:3000";
const line = { itemId: "lunch-chilli-chicken", quantity: 2, modifierIds: ["lunch-fried-rice", "lunch-soup-of-day", "lunch-dry"], note: "Separate sauce" };
const intake = { type: "create", lines: [line], minutes: 25, allergy: "Training peanut allergy", note: "Mark both boxes" };
let app: INestApplication;
let endpoint: string;
let folder: string;
let db: string;

before(async () => {
  folder = await mkdtemp(join(tmpdir(), "wok-training-test-"));
  db = join(folder, "tickets.sqlite");
  app = await createApplication({ webOrigin: origin, trainingDatabasePath: db });
  await app.listen(0, "127.0.0.1");
  endpoint = await app.getUrl() + "/v1/training/operations";
});
after(async () => { await app?.close(); if (folder) await rm(folder, { recursive: true, force: true }); });

function command(payload: unknown, id = randomUUID(), suppliedOrigin = origin) {
  return fetch(endpoint + "/commands", { method: "POST", headers: { "Content-Type": "application/json", Origin: suppliedOrigin }, body: JSON.stringify({ id, command: payload }) });
}

test("training rehearsal preserves ticket content, stage/history and idempotency across independent readers", async () => {
  const initial: DemoService = await (await fetch(endpoint)).json();
  assert.equal((await command(intake, randomUUID(), "https://untrusted.invalid")).status, 403);
  assert.equal((await command({ ...intake, lines: [{ ...line, modifierIds: [] }] })).status, 400);
  const id = randomUUID();
  const responses = await Promise.all([command(intake, id), command(intake, id)]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const created: DemoService = await responses[0].json();
  const order = created.orders.find(ticket => ticket.events.some(event => event.id === id))!;
  assert.equal(created.orders.length, initial.orders.length + 1);
  assert.equal(order.payment, "TRAINING");
  assert.equal(order.amountCents, (1399 + 250 + 100) * 2);
  assert.equal(order.jobs[0].status, "SPOOLED");
  const slipResponse = await fetch(endpoint + "/slips/" + order.jobs[0].id);
  assert.match(slipResponse.headers.get("content-type") ?? "", /text\/plain/);
  const originalSlip = await slipResponse.text();
  for (const entry of ["TRAINING", "KITCHEN ORDER", "#" + order.id, "Pickup:", "Station: Main station", "2 × Chilli Chicken", "Substitute fried rice", "Soup of the day", "Dry", "NOTE: Separate sauce", "ORDER ALLERGY ALERT", intake.allergy, "ORDER NOTE", intake.note]) {
    assert.ok(originalSlip.includes(entry), "Missing from saved slip: " + entry);
  }
  assert.equal(order.items[0].quantity, 2);
  assert.equal(order.items[0].note, "Separate sauce");
  assert.deepEqual(order.items[0].modifiers, ["Substitute fried rice", "Soup of the day", "Dry"]);
  assert.equal(order.allergy, intake.allergy);
  assert.equal(order.note, intake.note);
  const orderId = order.id;
  const copyId = randomUUID();
  const copyCommand = { type: "reprint", orderId, priorCopies: 0, reason: "Training replacement requested" };
  const copied = await Promise.all([command(copyCommand, copyId), command(copyCommand, copyId)]);
  assert.deepEqual(copied.map(response => response.status), [200, 200]);
  assert.equal((await command(copyCommand)).status, 409);
  const job = ((await copied[0].json()) as DemoService).orders.find(entry => entry.id === orderId)!.jobs[1];
  assert.equal(job.originalJobId, order.jobs[0].id);
  assert.equal(job.status, "SPOOLED");
  const reprint = await (await fetch(endpoint + "/slips/" + job.id)).text();
  assert.equal(reprint, originalSlip.replace("KITCHEN ORDER", "REPRINT — COPY 1"));
  assert.equal((await fetch(endpoint + "/slips/not-a-job")).status, 404);
  const inspection = new DatabaseSync(db, { readOnly: true });
  try {
    assert.equal(inspection.prepare("SELECT count(*) AS count FROM training_slips WHERE order_id = ?").get(orderId)!.count, 2);
  } finally { inspection.close(); }
  assert.equal((await command({ type: "start", orderId })).status, 409);
  assert.equal((await command({ type: "collect", orderId }, id)).status, 409);
  const raced = await Promise.all([command({ type: "acknowledge", orderId }), command({ type: "acknowledge", orderId })]);
  assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
  for (const type of ["start", "ready", "collect"]) assert.equal((await command({ type, orderId })).status, 200);
  assert.equal((await command({ type: "collect", orderId })).status, 409);
  const secondConnection = new TrainingBoard(origin, db);
  try {
    const persisted = secondConnection.current().orders.find(ticket => ticket.id === orderId)!;
    assert.equal(persisted.fulfillment, "COMPLETED");
    assert.equal(persisted.acknowledged, true);
    assert.equal(persisted.events.length, 6);
    assert.equal(secondConnection.slip(order.jobs[0].id), originalSlip);
  } finally { secondConnection.onApplicationShutdown(); }
});

test("paused training stops intake while leaving existing tickets and scheduled holds intact", async () => {
  assert.equal((await command({ type: "pause", reason: "Practice capacity pause" })).status, 200);
  assert.equal((await command(intake)).status, 409);
  assert.equal((await command({ type: "start", orderId: "1050" })).status, 409);
  assert.equal((await command({ type: "resume" })).status, 200);
  assert.equal((await command({ type: "reprint", orderId: "1049", reason: "Check ticket during rehearsal" })).status, 200);
  assert.equal((await command({ type: "reprint", orderId: "1049", reason: "Check ticket during rehearsal" })).status, 409);
});
