const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DeepgramBridgeClient,
} = require("../dist/transport/deepgram-bridge.js");
const {
  TwilioMediaSessionHandler,
} = require("../dist/transport/media-session-handler.js");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      this.readyState = 3;
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

test("TwilioMediaSessionHandler closes voice session if socket closes before connect resolves", async () => {
  let resolveConnect;
  const sentAudio = [];
  let voiceCloseCount = 0;

  const voiceProviderClient = {
    connect() {
      return new Promise((resolve) => {
        resolveConnect = () =>
          resolve({
            sendAudio(chunk) {
              sentAudio.push(chunk);
            },
            close() {
              voiceCloseCount += 1;
            },
          });
      });
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
    reportDisconnection() {},
  };

  const handler = new TwilioMediaSessionHandler({
    bridge,
    voiceProviderClient,
    resolveCallIdByProviderCallId() {
      return "call-1";
    },
  });

  const socket = createMockSocket();
  const startPromise = handler.handleMessage(
    socket,
    JSON.stringify({ event: "start", streamSid: "stream-1", start: { callSid: "provider-1" } }),
  );

  handler.handleClose(socket);
  socket.close();
  resolveConnect();
  await startPromise;

  await handler.handleMessage(
    socket,
    JSON.stringify({ event: "media", streamSid: "stream-1", media: { payload: Buffer.from("x").toString("base64") } }),
  );

  assert.equal(voiceCloseCount, 1);
  assert.equal(sentAudio.length, 0);
});

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

  const session = await client.connectDirect({
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

test("DeepgramBridgeClient reports parse errors and connect timeout with callId", async () => {
  class SilentWebSocket {
    constructor() {
      this.readyState = 0;
      this.handlers = new Map();
    }
    on(event, cb) {
      this.handlers.set(event, cb);
    }
    send() {}
    close() {}
    emit(event, ...args) {
      const handler = this.handlers.get(event);
      if (handler) {
        handler(...args);
      }
    }
  }

  const sockets = [];
  const client = new DeepgramBridgeClient({
    apiKey: "dg-key",
    connectTimeoutMs: 20,
    webSocketFactory: () => {
      const ws = new SilentWebSocket();
      sockets.push(ws);
      return ws;
    },
  });

  await assert.rejects(
    () =>
      client.connectDirect({
        callId: "call-timeout",
        settings: { type: "Settings" },
        onMessage: () => {},
      }),
    /call-timeout/,
  );

  const parseErrors = [];
  const parseClient = new DeepgramBridgeClient({
    apiKey: "dg-key",
    webSocketFactory: () => {
      const ws = new SilentWebSocket();
      setImmediate(() => ws.emit("open"));
      setImmediate(() => ws.emit("message", "{not-json"));
      return ws;
    },
  });

  const parseSession = await parseClient.connectDirect({
    callId: "call-parse",
    settings: { type: "Settings" },
    onMessage: () => {},
    onError: (error) => {
      parseErrors.push(error);
    },
  });
  await delay(5);
  parseSession.close();
  assert.equal(parseErrors.length, 1);
  assert.match(String(parseErrors[0]), /call-parse/);
});

test("TwilioMediaSessionHandler forwards media payload to voice session", async () => {
  const sentAudio = [];
  const voiceProviderClient = {
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
    reportDisconnection() {},
  };

  const handler = new TwilioMediaSessionHandler({
    bridge,
    voiceProviderClient,
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

test("TwilioMediaSessionHandler forwards KeepAlive control messages to voice provider", async () => {
  const controlMessages = [];
  let attachedVoiceSocket = null;

  const voiceProviderClient = {
    async connect() {
      return {
        sendAudio() {},
        sendControl(message) {
          controlMessages.push(message);
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
    setVoiceSocket(_callId, socket) {
      attachedVoiceSocket = socket;
    },
    startHeartbeatMonitor() {},
    handleVoiceAgentMessage() {
      return { action: "none" };
    },
    recordActivity() {},
    reportDisconnection() {},
  };

  const handler = new TwilioMediaSessionHandler({
    bridge,
    voiceProviderClient,
    resolveCallIdByProviderCallId(providerCallId) {
      return providerCallId === "provider-1" ? "call-1" : null;
    },
  });

  const socket = createMockSocket();
  await handler.handleMessage(
    socket,
    JSON.stringify({ event: "start", streamSid: "stream-1", start: { callSid: "provider-1" } }),
  );

  assert.ok(attachedVoiceSocket);
  attachedVoiceSocket.send(JSON.stringify({ type: "KeepAlive" }));
  assert.equal(controlMessages.length, 1);
  assert.deepEqual(controlMessages[0], { type: "KeepAlive" });
});

test("TwilioMediaSessionHandler cleans previous voice session on duplicate start", async () => {
  const closes = [];
  let index = 0;
  const voiceProviderClient = {
    async connect() {
      const id = index;
      index += 1;
      return {
        sendAudio() {},
        close() {
          closes.push(id);
        },
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
    reportDisconnection() {},
  };

  const handler = new TwilioMediaSessionHandler({
    bridge,
    voiceProviderClient,
    resolveCallIdByProviderCallId() {
      return "call-1";
    },
  });

  const socket = createMockSocket();
  const startMessage = JSON.stringify({ event: "start", streamSid: "stream-1", start: { callSid: "provider-1" } });
  await handler.handleMessage(socket, startMessage);
  await handler.handleMessage(socket, startMessage);

  assert.deepEqual(closes, [0]);
});

test("TwilioMediaSessionHandler closes twilio socket when voice provider closes", async () => {
  const callbacks = {};
  const voiceProviderClient = {
    async connect(options) {
      callbacks.onClose = options.onClose;
      callbacks.onError = options.onError;
      return {
        sendAudio() {},
        close() {},
      };
    },
  };

  const disconnections = [];
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
    reportDisconnection(callId, reason) {
      disconnections.push({ callId, reason });
    },
  };

  const handler = new TwilioMediaSessionHandler({
    bridge,
    voiceProviderClient,
    resolveCallIdByProviderCallId() {
      return "call-1";
    },
  });

  const socket = createMockSocket();
  await handler.handleMessage(
    socket,
    JSON.stringify({ event: "start", streamSid: "stream-1", start: { callSid: "provider-1" } }),
  );

  callbacks.onClose?.(1006, "closed");

  assert.equal(socket.closeCalled, true);
  assert.equal(disconnections.length, 1);
});
