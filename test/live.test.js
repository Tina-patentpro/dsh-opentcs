import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../lib/client.js";

/**
 * Live integration tests against a running openTCS kernel.
 * Opt-in: set OPENTCS_LIVE_TESTS=1 (and OPENTCS_API_KEY for an access-key-protected kernel).
 * Default target: http://localhost:55200/v1 (POC kernel), key defaults to the POC value.
 */
const ENABLED = process.env.OPENTCS_LIVE_TESTS === "1";
const CONFIG = {
  kernelUrl: process.env.OPENTCS_KERNEL_URL ?? "http://localhost:55200/v1",
  apiKeyEnv: "OPENTCS_API_KEY",
  timeoutMs: 10000
};
const API_KEY = process.env.OPENTCS_API_KEY ?? "";

test("live: kernel info returns version", { skip: !ENABLED }, async () => {
  const client = createClient(CONFIG, { apiKey: API_KEY });
  const info = await client.getKernelInfo();
  assert.equal(typeof info.baselineVersion, "string");
  assert.ok(info.baselineVersion.length > 0);
});

test("live: vehicles returns an array", { skip: !ENABLED }, async () => {
  const client = createClient(CONFIG, { apiKey: API_KEY });
  const vehicles = await client.listVehicles();
  assert.ok(Array.isArray(vehicles));
});

test("live: transport orders returns an array", { skip: !ENABLED }, async () => {
  const client = createClient(CONFIG, { apiKey: API_KEY });
  const orders = await client.listTransportOrders();
  assert.ok(Array.isArray(orders));
});

test("live: events returns statusMessages", { skip: !ENABLED }, async () => {
  const client = createClient(CONFIG, { apiKey: API_KEY });
  const events = await client.getEvents({ timeout: 1000 });
  assert.ok(Array.isArray(events.statusMessages));
});

test("live: plant model returns an object with name", { skip: !ENABLED }, async () => {
  const client = createClient(CONFIG, { apiKey: API_KEY });
  const model = await client.getPlantModel();
  assert.equal(typeof model.name, "string");
});

test("live: creating an order on an empty plant model fails with readable error", { skip: !ENABLED }, async () => {
  const client = createClient(CONFIG, { apiKey: API_KEY });
  const name = `TOrder-live-${Date.now()}`;
  await assert.rejects(
    client.createTransportOrder(name, {
      destinations: [{ locationName: "Nope-01", operation: "Load" }]
    }),
    /openTCS 请求失败/
  );
});
