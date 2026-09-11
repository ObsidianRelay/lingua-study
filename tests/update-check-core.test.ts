import assert from "node:assert/strict";
import test from "node:test";
import {
  getPluginUpdateInfo,
  isNewerPluginVersion,
  LINGUA_STUDY_UPDATE_PAGE_URI
} from "../src/update-check-core";

test("只把语义版本号中更新的正式版识别为可用更新", () => {
  assert.equal(isNewerPluginVersion("1.3.3", "1.4.0"), true);
  assert.equal(isNewerPluginVersion("1.4.0", "1.4.1"), true);
  assert.equal(isNewerPluginVersion("1.4.0", "2.0.0"), true);
  assert.equal(isNewerPluginVersion("1.4.0", "1.4.0"), false);
  assert.equal(isNewerPluginVersion("1.4.0", "1.3.9"), false);
  assert.equal(isNewerPluginVersion("1.4.0", "1.5.0-beta.1"), false);
  assert.equal(isNewerPluginVersion("invalid", "1.5.0"), false);
});

test("只接受 Lingua Study 的新版正式 Release manifest", () => {
  assert.deepEqual(getPluginUpdateInfo("1.3.3", {
    id: "lingua-study",
    version: "1.4.0"
  }), {
    currentVersion: "1.3.3",
    latestVersion: "1.4.0",
    updatePageUrl: LINGUA_STUDY_UPDATE_PAGE_URI
  });
  assert.equal(
    LINGUA_STUDY_UPDATE_PAGE_URI,
    "obsidian://show-plugin?id=lingua-study"
  );
  assert.equal(getPluginUpdateInfo("1.4.0", {
    id: "lingua-study",
    version: "1.4.0"
  }), null);
  assert.equal(getPluginUpdateInfo("1.3.3", {
    id: "another-plugin",
    version: "9.0.0"
  }), null);
  assert.equal(getPluginUpdateInfo("1.3.3", { version: "1.4.0" }), null);
});
