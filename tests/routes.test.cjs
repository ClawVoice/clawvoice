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
    twilioStreamUrl: "wss://voice.example.test/media-stream",
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
  let jsonBody = null;
  let sentBody = null;
  let contentType = null;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    type(value) {
      contentType = value;
      return this;
    },
    send(data) {
      sentBody = data;
    },
    json(data) {
      jsonBody = data;
    },
    getStatus() { return statusCode; },
    getBody() { return jsonBody; },
    getSentBody() { return sentBody; },
    getContentType() { return contentType; },
  };
}

function twilioSignature(url, params, authToken) {
  const sortedKeys = Object.keys(params).sort();
  let dataToSign = url;
  for (const key of sortedKeys) {
    dataToSign += key + params[key];
  }
  return createHmac("sha1", authToken)
    .update(dataToSign)
    .digest("base64");
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

describe("Route Handlers — SMS webhooks", () => {
  it("twilio SMS webhook invokes onInboundText and returns TwiML", async () => {
    const config = baseConfig();
    const { api, handlers } = createMockApi();
    const texts = [];
    registerRoutes(api, config, undefined, (from, to, body, messageId) => {
      texts.push({ from, to, body, messageId });
    });

    const params = {
      From: "+15551234567",
      To: "+15550001111",
      Body: "Hello from Twilio",
      MessageSid: "SM123",
    };
    // H1: URL is now derived from twilioStreamUrl (wss://voice.example.test/media-stream -> https://voice.example.test)
    const url = "https://voice.example.test/clawvoice/webhooks/twilio/sms";
    const signature = twilioSignature(url, params, config.twilioAuthToken);
    const req = {
      protocol: "https",
      url: "/clawvoice/webhooks/twilio/sms",
      headers: {
        host: "voice.example.test",
        "x-twilio-signature": signature,
      },
      body: params,
    };
    const res = createMockResponse();

    await handlers["/webhooks/twilio/sms"](req, res);

    assert.equal(res.getStatus(), 200);
    assert.equal(res.getContentType(), "text/xml");
    assert.equal(res.getSentBody(), "<Response></Response>");
    assert.equal(texts.length, 1);
    assert.deepEqual(texts[0], {
      from: "+15551234567",
      to: "+15550001111",
      body: "Hello from Twilio",
      messageId: "SM123",
    });
  });

  it("telnyx SMS webhook invokes onInboundText for message.received events", async () => {
    const config = baseConfig({ inboundEnabled: true });
    const { api, handlers } = createMockApi();
    const texts = [];
    registerRoutes(
      api,
      config,
      undefined,
      (from, to, body, messageId) => texts.push({ from, to, body, messageId }),
    );

    const bodyObj = {
      event_type: "message.received",
      data: {
        payload: {
          id: "sms-telnyx-1",
          from: { phone_number: "+15552223333" },
          to: { phone_number: "+15550001111" },
          text: "Hello from Telnyx",
        },
      },
    };
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
    assert.equal(texts.length, 1);
    assert.deepEqual(texts[0], {
      from: "+15552223333",
      to: "+15550001111",
      body: "Hello from Telnyx",
      messageId: "sms-telnyx-1",
    });
  });
});

describe("Route Handlers — Twilio voice webhook", () => {
  it("uses forwarded host/proto for Twilio signature validation", async () => {
    const config = baseConfig();
    const { api, handlers } = createMockApi();
    registerRoutes(api, config, () => {});

    const params = {
      CallSid: "CA123",
      From: "+15551234567",
      To: "+15550001111",
    };
    // buildPublicUrl uses forwarded headers to reconstruct the URL Twilio signed
    const expectedUrl = "https://public.example.com/clawvoice/webhooks/twilio/voice";
    const signature = twilioSignature(expectedUrl, params, config.twilioAuthToken);

    const req = {
      protocol: "http",
      url: "/clawvoice/webhooks/twilio/voice",
      headers: {
        host: "127.0.0.1:3334",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "public.example.com",
        "x-twilio-signature": signature,
      },
      body: params,
    };
    const res = createMockResponse();

    await handlers["/webhooks/twilio/voice"](req, res);

    assert.equal(res.getStatus(), 200);
  });

  it("returns TwiML response for inbound Twilio voice webhook", async () => {
    const config = baseConfig();
    const { api, handlers } = createMockApi();
    registerRoutes(api, config, () => {});

    const params = {
      CallSid: "CA456",
      From: "+15551234567",
      To: "+15550001111",
    };
    // H1: URL derived from twilioStreamUrl
    const url = "https://voice.example.test/clawvoice/webhooks/twilio/voice";
    const signature = twilioSignature(url, params, config.twilioAuthToken);
    const req = {
      protocol: "https",
      url: "/clawvoice/webhooks/twilio/voice",
      headers: {
        host: "voice.example.test",
        "x-twilio-signature": signature,
      },
      body: params,
    };
    const res = createMockResponse();

    await handlers["/webhooks/twilio/voice"](req, res);

    assert.equal(res.getStatus(), 200);
    assert.equal(res.getContentType(), "text/xml");
    assert.match(res.getSentBody(), /<Response>/);
    assert.match(res.getSentBody(), /<Connect>/);
    assert.match(res.getSentBody(), /<Stream url="wss:\/\/voice.example.test\/media-stream\?token=[a-f0-9]{32}" track="inbound_track">/);
    // Inbound TwiML now includes From/To as stream parameters
    assert.match(res.getSentBody(), /<Parameter name="from" value="\+15551234567"\/>/);
  });

  it("returns error TwiML when streamUrl is missing", async () => {
    const config = baseConfig({
      twilioStreamUrl: undefined,
    });
    const { api, handlers } = createMockApi();
    registerRoutes(api, config, () => {});

    const params = {
      CallSid: "CA789",
      From: "+15551234567",
      To: "+15550001111",
    };
    // No twilioStreamUrl configured, so buildPublicUrl falls back to header-based reconstruction
    const url = "https://example.test/clawvoice/webhooks/twilio/voice";
    const signature = twilioSignature(url, params, config.twilioAuthToken);
    const req = {
      protocol: "https",
      url: "/clawvoice/webhooks/twilio/voice",
      headers: {
        host: "example.test",
        "x-twilio-signature": signature,
      },
      body: params,
    };
    const res = createMockResponse();

    await handlers["/webhooks/twilio/voice"](req, res);

    assert.equal(res.getStatus(), 200);
    assert.equal(res.getContentType(), "text/xml");
    assert.match(res.getSentBody(), /cannot be completed/i);
    assert.match(res.getSentBody(), /<Hangup\/>/);
  });
});
