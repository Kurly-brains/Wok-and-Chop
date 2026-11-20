import assert from "node:assert/strict";
import { test } from "node:test";
import { renderDeliverySlip, type DeliverySlipOrder } from "../../packages/printing/src/index.ts";

const example: DeliverySlipOrder = {
  number: "D-21", status: "PREPARING", updatedAt: "2026-11-18T19:05:00Z",
  name: "Test Recipient", phone: "613-555-0100", address: { street: "123 Test Street", unit: "8", city: "Kanata", province: "ON", postalCode: "K2T 0A1" },
  instructions: "Ring the lower bell", items: [{ quantity: 1, name: "Sample entrée", modifiers: ["Dry"], note: "Allergy: sesame\u001b" }],
};
test("kitchen slips retain modifiers and kitchen notes without delivery contact fields", () => {
  const text = renderDeliverySlip(example, "kitchen");
  assert.match(text, /D-21/); assert.match(text, /Allergy: sesame/); assert.match(text, /Dry/);
  assert.doesNotMatch(text, /Test Recipient|613-555-0100|123 Test Street|lower bell|\u001b/);
  assert.ok(text.split("\n").every(line => line.length <= 42));
});
test("driver slips show addresses and handoff instructions, omitting kitchen and payment details", () => {
  const text = renderDeliverySlip({ ...example, status: "CANCELLED" }, "driver");
  assert.match(text, /CANCELLED \/ DO NOT FULFIL/); assert.match(text, /Test Recipient/);
  assert.match(text, /613-555-0100/); assert.match(text, /123 Test Street\nUnit 8/); assert.match(text, /lower bell/);
  assert.doesNotMatch(text, /Allergy|sesame|Sample entrée|\$/);
});
test("pickup kitchen slips label the handoff and preserve dish notes without an address", () => {
  const order: DeliverySlipOrder = { ...example, number: "P-21", fulfillment: "PICKUP", status: "PICKED_UP", address: null };
  const text = renderDeliverySlip(order, "kitchen");
  assert.match(text, /PICKUP \/ KITCHEN COPY/);
  assert.match(text, /ALREADY PICKED UP/);
  assert.match(text, /Dry/);
  assert.match(text, /Allergy: sesame/);
  assert.doesNotMatch(text, /DELIVERY|Test Recipient|613-555-0100/);
  assert.throws(() => renderDeliverySlip(order, "driver"), /delivery address is required/);
});
