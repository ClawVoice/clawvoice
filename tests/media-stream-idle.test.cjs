const { test } = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");

const { MediaStreamServer } = require("../dist/transport/media-stream-server.js");

const PORT = 34567;
const PATH = "/media-stream";
const URL = `ws://127.0.0.1:${PORT}${PATH}`;

function makeHandler({ authenticated }) {
  return {
    // handleMessage never establishes a session unless `authenticated` is true.
    async handleMessage() { /* accept the frame, do nothing */ },
    handleClose() {},
    hasSession() { return authenticated; },
  };
}

function delay(ms) {
  return new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });
}

test("unauthenticated client dribbling garbage frames is closed at the idle deadline", async () => {
  const server = new MediaStreamServer({
    host: "127.0.0.1",
    port: PORT,
    path: PATH,
    sessionHandler: makeHandler({ authenticated: false }),
    idleTimeoutMs: 250,
  });
  await server.start();

  try {
    const ws = new WebSocket(URL);
    let closed = false;
    let junkTimer = null;
    await new Promise((resolve, reject) => {
      ws.on("open", () => {
        // Send garbage well under the idle window — must NOT keep the slot alive.
        junkTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("not-json-garbage");
        }, 60);
        junkTimer.unref?.();
      });
      ws.on("close", () => { closed = true; resolve(); });
      ws.on("error", () => { /* close will follow */ });
      const guard = setTimeout(() => reject(new Error("socket was not closed by the idle deadline")), 3000);
      guard.unref?.();
    });
    if (junkTimer) clearInterval(junkTimer);
    assert.equal(closed, true, "garbage-only socket should be force-closed despite continuous frames");
  } finally {
    await server.stop();
  }
});

test("authenticated session is kept alive by ongoing frames past the idle deadline", async () => {
  const server = new MediaStreamServer({
    host: "127.0.0.1",
    port: PORT + 1,
    path: PATH,
    sessionHandler: makeHandler({ authenticated: true }),
    idleTimeoutMs: 200,
  });
  await server.start();

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT + 1}${PATH}`);
    let closed = false;
    let frameTimer = null;
    await new Promise((resolve) => {
      ws.on("open", () => {
        frameTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: "media" }));
        }, 60);
        frameTimer.unref?.();
        resolve();
      });
      ws.on("close", () => { closed = true; });
    });
    // Wait well past the idle window; ongoing authenticated frames keep it open.
    await delay(600);
    if (frameTimer) clearInterval(frameTimer);
    assert.equal(closed, false, "authenticated socket with continuous frames should stay open");
    ws.close();
  } finally {
    await server.stop();
  }
});
