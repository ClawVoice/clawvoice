const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const cjs = require("../dist/index.js");

let importCounter = 0;

async function importExtension() {
  const extensionPath = pathToFileURL(
    path.resolve(__dirname, "../openclaw-extension.mjs"),
  ).href;
  importCounter += 1;
  return import(`${extensionPath}?i=${importCounter}`);
}

test("openclaw extension exports sync register/activate wrappers", async () => {
  const mod = await importExtension();

  assert.notEqual(mod.register.constructor.name, "AsyncFunction");
  assert.notEqual(mod.activate.constructor.name, "AsyncFunction");
});

test("openclaw extension register swallows sync lifecycle throws", async () => {
  const mod = await importExtension();
  const originalRegister = cjs.register;
  cjs.register = () => {
    throw new Error("sync register boom");
  };

  try {
    assert.doesNotThrow(() => mod.register({}));
  } finally {
    cjs.register = originalRegister;
  }
});
