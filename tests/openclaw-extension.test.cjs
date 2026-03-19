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
  const err = new Error("thenable reject");

  function createBareThenable() {
    const bare = Object.create(null);
    Reflect.defineProperty(bare, ["th", "en"].join(""), {
      value: (_resolve, reject) => reject(err),
      configurable: true,
      enumerable: true,
      writable: true,
    });
    return bare;
  }

  t.mock.method(cjs, "register", () => createBareThenable());

  let unhandled;
  const onUnhandled = (error) => {
    unhandled = error;
  };
  process.once("unhandledRejection", onUnhandled);
  t.after(() => process.removeListener("unhandledRejection", onUnhandled));

  assert.doesNotThrow(() => mod.register({}));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unhandled, undefined);
});
