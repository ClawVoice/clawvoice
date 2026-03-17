const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

test("openclaw extension exports sync register/activate wrappers", async () => {
  const extensionPath = pathToFileURL(
    path.resolve(__dirname, "../openclaw-extension.mjs"),
  ).href;
  const mod = await import(`${extensionPath}?t=${Date.now()}`);

  assert.equal(mod.register.constructor.name, "Function");
  assert.equal(mod.activate.constructor.name, "Function");
});
