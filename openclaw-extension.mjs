import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cjs = require("./dist/index.js");

function invokeLifecycle(fn, api, name) {
  try {
    const result = fn(api);
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch((error) => {
        console.error(`[clawvoice] ${name} failed`, error);
      });
    }
  } catch (error) {
    console.error(`[clawvoice] ${name} failed`, error);
  }
}

export function activate(api) {
  if (typeof cjs.activate === "function") {
    invokeLifecycle(cjs.activate, api, "activate");
    return;
  }

  if (typeof cjs.default?.init === "function") {
    invokeLifecycle(cjs.default.init, api, "activate");
    return;
  }

  throw new Error("plugin export missing activate/init");
}

export function register(api) {
  if (typeof cjs.register === "function") {
    invokeLifecycle(cjs.register, api, "register");
    return;
  }

  activate(api);
}

export default {
  name: cjs.default?.name ?? "clawvoice",
  register,
  activate,
};
