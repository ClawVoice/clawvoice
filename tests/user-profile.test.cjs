const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("readUserProfile", () => {
  it("returns default when file does not exist", () => {
    const { readUserProfile } = require("../dist/services/user-profile.js");
    const result = readUserProfile("/nonexistent/path");
    assert.strictEqual(result.ownerName, "");
    assert.strictEqual(typeof result.contextBlock, "string");
  });

  it("reads ownerName from YAML frontmatter", () => {
    const { readUserProfile } = require("../dist/services/user-profile.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-test-"));
    const file = path.join(dir, "user-profile.md");
    fs.writeFileSync(file, "---\nownerName: Cody McLain\n---\n\n## About\nLikes sushi.\n");
    const result = readUserProfile(dir);
    assert.strictEqual(result.ownerName, "Cody McLain");
    assert.ok(result.contextBlock.includes("Likes sushi"));
    fs.rmSync(dir, { recursive: true });
  });
});

describe("buildCallPrompt", () => {
  it("builds prompt with owner name and purpose", () => {
    const { buildCallPrompt } = require("../dist/services/user-profile.js");
    const profile = { ownerName: "Cody", communicationStyle: "casual", contextBlock: "Likes coffee", raw: "" };
    const result = buildCallPrompt(profile, "Book a table");
    assert.ok(result.includes("Cody"));
    assert.ok(result.includes("Book a table"));
    assert.ok(result.includes("Likes coffee"));
  });

  it("returns empty string when no profile data", () => {
    const { buildCallPrompt } = require("../dist/services/user-profile.js");
    const profile = { ownerName: "", communicationStyle: "casual", contextBlock: "", raw: "" };
    const result = buildCallPrompt(profile);
    assert.strictEqual(result, "");
  });
});

describe("writeDefaultProfile", () => {
  it("creates profile file in directory", () => {
    const { writeDefaultProfile, readUserProfile } = require("../dist/services/user-profile.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-test-"));
    writeDefaultProfile(dir, "Test User", "professional");
    const result = readUserProfile(dir);
    assert.strictEqual(result.ownerName, "Test User");
    assert.strictEqual(result.communicationStyle, "professional");
    fs.rmSync(dir, { recursive: true });
  });
});
