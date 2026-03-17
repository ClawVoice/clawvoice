const test = require("node:test");
const assert = require("node:assert/strict");

const plugin = require("../dist/index.js").default;

function validSelfHostedConfig(overrides = {}) {
  return {
    telephonyProvider: "twilio",
    voiceProvider: "deepgram-agent",
    twilioAccountSid: "AC-test",
    twilioAuthToken: "auth-test",
    twilioPhoneNumber: "+15550001111",
    deepgramApiKey: "deepgram-key",
    dailyCallLimit: 50,
    voiceSystemPrompt: "",
    inboundEnabled: true,
    ...overrides
  };
}

function createMockApi(config = {}) {
  const state = {
    tools: [],
    cli: [],
    routes: [],
    hooks: [],
    services: [],
    logs: []
  };

  const api = {
    config,
    tools: {
      register(definition) {
        state.tools.push(definition);
      }
    },
    cli: {
      register(definition) {
        state.cli.push(definition);
      }
    },
    http: {
      router(prefix) {
        return {
          post(path, _handler) {
            state.routes.push(`${prefix}${path}`);
          },
          get(path, _handler) {
            state.routes.push(`GET ${prefix}${path}`);
          }
        };
      }
    },
    hooks: {
      on(name, _handler) {
        state.hooks.push(name);
      }
    },
    services: {
      register(name, instance) {
        state.services.push({ name, instance });
      }
    },
    log: {
      info(message, metadata) {
        state.logs.push({ message, metadata });
      },
      warn(message, metadata) {
        state.logs.push({ level: "warn", message, metadata });
      },
      error(message, metadata) {
        state.logs.push({ level: "error", message, metadata });
      }
    }
  };

  return { api, state };
}

test("plugin init registers core extension points", async () => {
  const { api, state } = createMockApi(validSelfHostedConfig());

  await plugin.init(api);

  assert.equal(state.tools.length, 7, "expected 7 tools: call, clear_calls, hangup, send_text, text_status, status, promote_memory");
  assert.equal(state.cli.length, 9, "expected 9 CLI commands: setup, call, clear, sms, inbox, status, promote, history, test");
  assert.equal(state.routes.length, 4);
  assert.equal(state.hooks.length, 4);
  assert.equal(state.services.length, 1);
  assert.equal(state.services[0].name, "clawvoice-calls");
  assert.ok(state.logs.some((entry) => entry.message === "ClawVoice initialized"));
});

test("plugin init registers expected tool names", async () => {
  const { api, state } = createMockApi(validSelfHostedConfig());

  await plugin.init(api);

  const toolNames = state.tools.map((t) => t.name).sort();
  assert.deepEqual(toolNames, [
    "voice_assistant.call",
    "voice_assistant.clear_calls",
    "voice_assistant.hangup",
    "voice_assistant.promote_memory",
    "voice_assistant.send_text",
    "voice_assistant.status",
    "voice_assistant.text_status"
  ]);
});

test("plugin init registers expected CLI command names", async () => {
  const { api, state } = createMockApi(validSelfHostedConfig());

  await plugin.init(api);

  const cliNames = state.cli.map((c) => c.name).sort();
  assert.deepEqual(cliNames, [
    "clawvoice call",
    "clawvoice clear",
    "clawvoice history",
    "clawvoice inbox",
    "clawvoice promote",
    "clawvoice setup",
    "clawvoice sms",
    "clawvoice status",
    "clawvoice test"
  ]);
});

test("plugin init registers only calls service", async () => {
  const { api, state } = createMockApi(validSelfHostedConfig());

  await plugin.init(api);

  const names = state.services.map((service) => service.name);
  assert.deepEqual(names, ["clawvoice-calls"]);
});

test("plugin init registers expected webhook routes", async () => {
  const { api, state } = createMockApi(validSelfHostedConfig());

  await plugin.init(api);

  assert.ok(state.routes.includes("/clawvoice/webhooks/telnyx"));
  assert.ok(state.routes.includes("/clawvoice/webhooks/twilio/sms"));
  assert.ok(state.routes.includes("/clawvoice/webhooks/twilio/voice"));
});

test("plugin init registers expected hooks", async () => {
  const { api, state } = createMockApi(validSelfHostedConfig());

  await plugin.init(api);

  assert.ok(state.hooks.includes("before_tool_execute"));
  assert.ok(state.hooks.includes("before_memory_write"));
});
