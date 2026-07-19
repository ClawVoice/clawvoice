const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  mulawToPcm16,
  pcm16ToMulaw,
} = require("../dist/transport/audio-convert.js");

function decode(byte) {
  return mulawToPcm16(Buffer.from([byte])).readInt16LE(0);
}

describe("G.711 mulaw decode table", () => {
  // ITU-T G.711 reference vectors.
  it("decodes 0x00 to the most-negative sample", () => {
    assert.equal(decode(0x00), -32124);
  });

  it("decodes 0xFF to positive zero", () => {
    assert.equal(decode(0xff), 0);
  });

  it("decodes 0x7F to negative zero", () => {
    assert.equal(decode(0x7f), 0);
  });

  it("decodes 0x80 to the most-positive sample", () => {
    assert.equal(decode(0x80), 32124);
  });

  it("is monotonic across the positive half (0x80..0xFF descending magnitude)", () => {
    let prev = decode(0x80);
    for (let b = 0x81; b <= 0xff; b++) {
      const cur = decode(b);
      assert.ok(cur <= prev, `expected decode(${b}) <= decode(${b - 1})`);
      prev = cur;
    }
  });

  it("round-trips small non-zero samples through encode without sign flips", () => {
    for (const sample of [-8000, -1000, -100, 100, 1000, 8000, 16000]) {
      const buf = Buffer.alloc(2);
      buf.writeInt16LE(sample, 0);
      const decoded = mulawToPcm16(pcm16ToMulaw(buf)).readInt16LE(0);
      assert.equal(Math.sign(decoded), Math.sign(sample), `sign preserved for ${sample}`);
    }
  });
});
