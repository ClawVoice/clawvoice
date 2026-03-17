const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DeepgramBridgeClient,
} = require("../dist/transport/deepgram-bridge.js");
const {
  TwilioMediaSessionHandler,
} = require("../dist/transport/media-session-handler.js");

function createMockSocket() {
  const handlers = new Map();
  return {
    sent: [],
    readyState: 1,
    send(payload) {
      this.sent.push(payload);
    },
    closeCalled: false,
    close() {
      this.closeCalled = true;
      const cb = handlers.get("close");
      if (cb) cb();
    },
    on(event, cb) {
      handlers.set(event, cb);
    },
    emit(event, value) {
      const cb = handlers.get(event);
      if (cb) cb(value);
    },
  };
}

test("DeepgramBridgeClient sends settings after open", async () => {
  const created = [];

  class FakeWebSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = 1;
      this.handlers = new Map();
      this.sent = [];
      created.push(this);
      setImmediate(() => {
        const open = this.handlers.get("open");
        if (open) open();
      });
    }
    on(event, cb) {
      this.handlers.set(event, cb);
    }
    send(payload) {
      this.sent.push(payload);
    }
    close() {}
  }

  const client = new DeepgramBridgeClient({
    apiKey: "dg-key",
    webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols),
  });

  const session = await client.connect({
    callId: "call-1",
    settings: { type: "Settings", agent: { greeting: { text: "hi" } } },
    onMessage: () => {},
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].url, "wss://agent.deepgram.com/v1/agent/converse");
  assert.deepEqual(created[0].protocols, ["token", "dg-key"]);
  assert.equal(created[0].sent.length, 1);
  assert.match(created[0].sent[0], /"type":"Settings"/);
  session.close();
});

test("TwilioMediaSessionHandler forwards media payload to deepgram session", async () => {
  const sentAudio = [];
  const deepgramClient = {
    async connect() {
      return {
        sendAudio(chunk) {
          sentAudio.push(chunk);
        },
        close() {},
      };
    },
  };

  const bridge = {
    getSessionConfig() {
      return {
        callId: "call-1",
        providerCallId: "provider-1",
        voiceProviderUrl: "wss://agent.deepgram.com/v1/agent/converse",
        voiceProviderAuth: "dg-key",
        telephonyCodec: "mulaw",
        voiceProviderCodec: "mulaw",
        sampleRate: 8000,
        greeting: "hello",
        voiceModel: "aura-2-thalia-en",
        keepAliveIntervalMs: 5000,
        greetingGracePeriodMs: 3000,
      };
    },
    buildSettingsMessage(config) {
      return { type: "Settings", greeting: config.greeting };
    },
    setVoiceSocket() {},
    startHeartbeatMonitor() {},
    handleVoiceAgentMessage() {
      return { action: "none" };
    },
    recordActivity() {},
  };

  const handler = new TwilioMediaSessionHandler({
    bridge,
    deepgramClient,
    resolveCallIdByProviderCallId(providerCallId) {
      return providerCallId === "provider-1" ? "call-1" : null;
    },
  });

  const socket = createMockSocket();
  await handler.handleMessage(
    socket,
    JSON.stringify({ event: "start", streamSid: "stream-1", start: { callSid: "provider-1" } }),
  );

  const payload = Buffer.from("audio-bytes").toString("base64");
  await handler.handleMessage(
    socket,
    JSON.stringify({ event: "media", streamSid: "stream-1", media: { payload } }),
  );

  assert.equal(sentAudio.length, 1);
  assert.equal(sentAudio[0].toString(), "audio-bytes");
});
