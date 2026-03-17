import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cjs = require("./dist/index.js");

export async function activate(api) {
  if (typeof cjs.activate === "function") {
    return cjs.activate(api);
  }

  if (typeof cjs.default?.init === "function") {
    return cjs.default.init(api);
  }

  throw new Error("plugin export missing activate/init");
}

export async function register(api) {
  if (typeof cjs.register === "function") {
    return cjs.register(api);
  }

  return activate(api);
}

export default {
  name: cjs.default?.name ?? "clawvoice",
  register,
  activate,
};
