import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../lib/client.js";
import { summarizePlantModel } from "../lib/index.js";

const CONFIG = {
  kernelUrl: "http://kernel.test:55200/v1/",
  apiKeyEnv: "OPENTCS_API_KEY",
  timeoutMs: 5000
};

/** Build a fake Response-like object for the injected fetch. */
function fakeResponse({ status = 200, body = "" } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return body;
    }
  };
}

/** Capture the fetch call args for assertions. */
function mockFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return responder(calls.length - 1);
  };
  return { impl, calls };
}

test("getKernelInfo parses JSON response", async () => {
  const { impl, calls } = mockFetch(() =>
    fakeResponse({ body: JSON.stringify({ baselineVersion: "7.5.0" }) })
  );
  const client = createClient(CONFIG, { fetchImpl: impl });
  const info = await client.getKernelInfo();
  assert.equal(info.baselineVersion, "7.5.0");
  assert.equal(calls[0].url.href, "http://kernel.test:55200/v1/kernel/version");
});

test("sends X-Api-Access-Key when apiKey provided", async () => {
  const { impl, calls } = mockFetch(() => fakeResponse({ body: "[]" }));
  const client = createClient(CONFIG, { fetchImpl: impl, apiKey: "secret-key" });
  await client.listVehicles();
  assert.equal(calls[0].init.headers["X-Api-Access-Key"], "secret-key");
});

test("403 surfaces a readable API-key error", async () => {
  const { impl } = mockFetch(() => fakeResponse({ status: 403 }));
  const client = createClient(CONFIG, { fetchImpl: impl });
  await assert.rejects(client.getKernelInfo(), /API Key 无效或缺失.*OPENTCS_API_KEY/);
});

test("network failure surfaces a readable unreachable error", async () => {
  const client = createClient(CONFIG, {
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    }
  });
  await assert.rejects(client.getKernelInfo(), /内核不可达/);
});

test("kernel error body (array of strings) is surfaced", async () => {
  const { impl } = mockFetch(() =>
    fakeResponse({ status: 400, body: JSON.stringify(["Could not find location 'Storage 01'"]) })
  );
  const client = createClient(CONFIG, { fetchImpl: impl });
  await assert.rejects(client.createTransportOrder("TOrder-1", { destinations: [] }), /Could not find location 'Storage 01'/);
});

test("createTransportOrder posts correct path, method and body", async () => {
  const { impl, calls } = mockFetch(() => fakeResponse({ body: JSON.stringify({ name: "TOrder-1" }) }));
  const client = createClient(CONFIG, { fetchImpl: impl });
  const body = {
    destinations: [{ locationName: "Storage 01", operation: "Load" }],
    type: "Transport"
  };
  await client.createTransportOrder("TOrder-1", body);
  const call = calls[0];
  assert.equal(call.url.href, "http://kernel.test:55200/v1/transportOrders/TOrder-1");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(call.init.body), body);
});

test("withdrawTransportOrder adds immediate query param", async () => {
  const { impl, calls } = mockFetch(() => fakeResponse());
  const client = createClient(CONFIG, { fetchImpl: impl });
  await client.withdrawTransportOrder("TOrder-9", true);
  const call = calls[0];
  assert.equal(call.url.pathname, "/v1/transportOrders/TOrder-9/withdrawal");
  assert.equal(call.url.searchParams.get("immediate"), "true");
});

test("getEvents passes timeout query", async () => {
  const { impl, calls } = mockFetch(() =>
    fakeResponse({ body: JSON.stringify({ timeStamp: "t", statusMessages: [] }) })
  );
  const client = createClient(CONFIG, { fetchImpl: impl });
  await client.getEvents({ timeout: 1000 });
  assert.equal(calls[0].url.searchParams.get("timeout"), "1000");
});

test("getPlantModel requests the plant model endpoint", async () => {
  const { impl, calls } = mockFetch(() => fakeResponse({ body: JSON.stringify({ name: "M" }) }));
  const client = createClient(CONFIG, { fetchImpl: impl });
  const model = await client.getPlantModel();
  assert.equal(model.name, "M");
  assert.equal(calls[0].url.pathname, "/v1/plantModel");
});

test("summarizePlantModel computes counts and maps locations/vehicles", () => {
  const model = {
    name: "Plant A",
    points: [{ name: "P1" }, { name: "P2" }],
    paths: [{ name: "Pa" }],
    locations: [
      { name: "Storage 01", type: "StorageType" },
      { name: "Bay 02", type: "BayType" }
    ],
    blocks: [{ name: "B1" }],
    vehicles: [{ name: "V1", state: "IDLE" }]
  };
  assert.deepEqual(summarizePlantModel(model), {
    name: "Plant A",
    pointCount: 2,
    pathCount: 1,
    locationCount: 2,
    blockCount: 1,
    vehicleCount: 1,
    locations: [
      { name: "Storage 01", type: "StorageType" },
      { name: "Bay 02", type: "BayType" }
    ],
    vehicles: [{ name: "V1", state: "IDLE" }]
  });
});

test("summarizePlantModel tolerates missing/unknown fields", () => {
  assert.deepEqual(summarizePlantModel({ name: "Empty" }), {
    name: "Empty",
    pointCount: 0,
    pathCount: 0,
    locationCount: 0,
    blockCount: 0,
    vehicleCount: 0,
    locations: [],
    vehicles: []
  });
});
