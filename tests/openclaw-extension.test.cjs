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

  assert.equal(mod.register.constructor.name, "Function");
  assert.equal(mod.activate.constructor.name, "Function");
});

test("openclaw extension register swallows sync lifecycle throws", async (t) => {
  const mod = await importExtension();
  t.mock.method(cjs, "register", () => {
    throw new Error("sync register boom");
  });

  assert.doesNotThrow(() => mod.register({}));
});

test("openclaw extension swallows rejected thenable from lifecycle", async (t) => {
  const mod = await importExtension();

  t.mock.method(cjs, "register", () => {
    // Return a rejected promise — exercises the Promise.resolve().catch() path
    return Promise.reject(new Error("async lifecycle reject"));
  });

  // Should not throw — invokeLifecycle wraps with Promise.resolve().catch()
  assert.doesNotThrow(() => mod.register({}));
});
