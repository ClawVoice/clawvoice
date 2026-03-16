const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac, generateKeyPairSync, sign } = require("node:crypto");

const { registerRoutes } = require("../dist/routes.js");

// Generate a real Ed25519 keypair for Telnyx route tests
const { publicKey: ed25519PublicKey, privateKey: ed25519PrivateKey } =
  generateKeyPairSync("ed25519");

const publicKeyBase64 = ed25519PublicKey
  .export({ type: "spki", format: "der" })
  .subarray(12)
  .toString("base64");

function telnyxEd25519Sign(timestamp, payload) {
  const data = `${timestamp}|${payload}`;
  const sig = sign(null, Buffer.from(data), ed25519PrivateKey);
  return sig.toString("hex");
}

function baseConfig(overrides) {
  return {
    telephonyProvider: "twilio",
    voiceProvider: "deepgram-agent",
    amdEnabled: true,
    restrictTools: true,
    deniedTools: ["exec"],
    mainMemoryAccess: "read",
    maxCallDuration: 1800,
    dailyCallLimit: 50,
    disclosureEnabled: true,
    disclosureStatement: "AI call.",
    telnyxWebhookSecret: publicKeyBase64,
    twilioAuthToken: "auth_token_test",
    voiceSystemPrompt: "",
    inboundEnabled: true,
    ...overrides,
  };
}

function createMockApi() {
  const handlers = {};
  const api = {
    http: {
      router(_prefix) {
        return {
          post(path, handler) {
            handlers[path] = handler;
          },
        };
      },
    },
  };
  return { api, handlers };
}

function createMockResponse() {
  let statusCode = 200;
  let body = null;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      body = data;
    },
    getStatus() { return statusCode; },
    getBody() { return body; },
  };
}

describe("Route Handlers — inboundEnabled guard (Minor #5)", () => {
  it("telnyx webhook invokes onInbound when inboundEnabled=true", async () => {
    const config = baseConfig({ inboundEnabled: true });
    const { api, handlers } = createMockApi();
    const calls = [];
    registerRoutes(api, config, (record) => calls.push(record));

    const bodyObj = { call_control_id: "telnyx-123", from: "+15551234", to: "+15559999" };
    const timestamp = "1678901234";
    const bodyStr = JSON.stringify(bodyObj);
    const sig = telnyxEd25519Sign(timestamp, bodyStr);

    const req = {
      body: bodyObj,
      headers: {
        "telnyx-signature-ed25519": sig,
        "telnyx-timestamp": timestamp,
      },
    };
    const res = createMockResponse();

    await handlers["/webhooks/telnyx"](req, res);

    assert.equal(res.getStatus(), 200);
    assert.equal(calls.length, 1, "onInbound should be called when inboundEnabled=true");
    assert.equal(calls[0].provider, "telnyx");
  });

  it("telnyx webhook does NOT invoke onInbound when inboundEnabled=false", async () => {
    const config = baseConfig({ inboundEnabled: false });
    const { api, handlers } = createMockApi();
    const calls = [];
    registerRoutes(api, config, (record) => calls.push(record));

    const bodyObj = { call_control_id: "telnyx-456", from: "+15551234", to: "+15559999" };
    const timestamp = "1678901234";
    const bodyStr = JSON.stringify(bodyObj);
    const sig = telnyxEd25519Sign(timestamp, bodyStr);

    const req = {
      body: bodyObj,
      headers: {
        "telnyx-signature-ed25519": sig,
        "telnyx-timestamp": timestamp,
      },
    };
    const res = createMockResponse();

    await handlers["/webhooks/telnyx"](req, res);

    assert.equal(res.getStatus(), 200);
    assert.equal(calls.length, 0, "onInbound should NOT be called when inboundEnabled=false");
  });

  it("telnyx webhook returns 401 when signature invalid regardless of inboundEnabled", async () => {
    const config = baseConfig({ inboundEnabled: true });
    const { api, handlers } = createMockApi();
    const calls = [];
    registerRoutes(api, config, (record) => calls.push(record));

    const req = {
      body: '{"call_control_id":"telnyx-789"}',
      headers: {
        "telnyx-signature-ed25519": "bad-signature",
        "telnyx-timestamp": "1678901234",
      },
    };
    const res = createMockResponse();

    await handlers["/webhooks/telnyx"](req, res);

    assert.equal(res.getStatus(), 401);
    assert.equal(calls.length, 0);
  });
});
