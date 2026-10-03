import assert from "node:assert/strict";
import test from "node:test";
import { replaceRenamedPath } from "../src/rename-path-core";

test("文件和文件夹重命名只更新匹配的路径", () => {
  assert.equal(replaceRenamedPath("A/transcript.json", "A/transcript.json", "B/transcript.json"), "B/transcript.json");
  assert.equal(replaceRenamedPath("A/part/transcript.json", "A", "B"), "B/part/transcript.json");
  assert.equal(replaceRenamedPath("AB/transcript.json", "A", "B"), "AB/transcript.json");
});
