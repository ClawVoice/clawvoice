const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");

const { registerRoutes } = require("../dist/routes.js");

function telnyxHmac(secret, timestamp, payload) {
  return createHmac("sha256", secret)
    .update(`${timestamp}|${payload}`)
    .digest("hex");
}

function baseConfig(overrides) {
  return {
    telephonyProvider: "telnyx",
    voiceProvider: "deepgram-agent",
    amdEnabled: true,
    restrictTools: true,
    deniedTools: ["exec"],
    mainMemoryAccess: "read",
    maxCallDuration: 1800,
    disclosureEnabled: true,
    disclosureStatement: "AI call.",
    telnyxWebhookSecret: "whsec_test_secret",
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

    // Body must be an object so parseWebhookBody can extract fields
    const bodyObj = { call_control_id: "telnyx-123", from: "+15551234", to: "+15559999" };
    const timestamp = "1678901234";
    // Signature is computed over the JSON string representation
    const bodyStr = JSON.stringify(bodyObj);
    const sig = telnyxHmac(config.telnyxWebhookSecret, timestamp, bodyStr);

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
    const sig = telnyxHmac(config.telnyxWebhookSecret, timestamp, bodyStr);

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
