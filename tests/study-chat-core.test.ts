import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStudyChatRequestBody,
  normalizeLocalChatCompletionsUrl,
  StudyChatSessions,
  validateLocalChatConfiguration
} from "../src/study-chat-core";
import { STUDY_PROFILES, STUDY_PROFILE_LABELS } from "../src/study-core";
import { sanitizeSettings } from "../src/settings-core";

test("聊天服务独立于翻译服务且默认关闭", () => {
  assert.equal(sanitizeSettings({}).chatProvider, "disabled");
  assert.equal(sanitizeSettings({}).chatDeepSeekEffort, "none");
  assert.equal(sanitizeSettings({}).chatKimiThinking, false);
  assert.equal(sanitizeSettings({ deepSeekModel: "deepseek-v4-pro" }).chatDeepSeekModel, "deepseek-v4-pro");
  assert.equal(sanitizeSettings({ chatDeepSeekEffort: "invalid" }).chatDeepSeekEffort, "none");
  assert.equal(sanitizeSettings({ translationProvider: "baidu", chatProvider: "deepseek" }).chatProvider, "deepseek");
  assert.equal(sanitizeSettings({ translationProvider: "disabled", chatProvider: "kimi" }).chatProvider, "kimi");
  assert.equal(sanitizeSettings({ chatProvider: "baidu" }).chatProvider, "disabled");
  assert.equal(sanitizeSettings({ chatProvider: "local" }).chatProvider, "local");
  assert.equal(sanitizeSettings({ translationProvider: "local" }).translationProvider, "disabled");
  assert.equal(sanitizeSettings({}).localChatModel, "");
  assert.equal(sanitizeSettings({ localChatModel: "  local-model  " }).localChatModel, "local-model");
});

test("本地聊天地址只允许本机回环接口，并保留远程配置边界", () => {
  assert.equal(normalizeLocalChatCompletionsUrl("http://localhost:11434"),
    "http://localhost:11434/v1/chat/completions");
  assert.equal(normalizeLocalChatCompletionsUrl("http://127.0.0.1:11434/v1/"),
    "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(normalizeLocalChatCompletionsUrl("http://[::1]:1234/v1/chat/completions/"),
    "http://[::1]:1234/v1/chat/completions");
  assert.equal(normalizeLocalChatCompletionsUrl("https://localhost:1234/v1"),
    "https://localhost:1234/v1/chat/completions");
  for (const address of [
    "http://192.168.1.2:1234/v1", "http://localhost.evil.test/v1",
    "https://example.com/v1", "http://user:pass@localhost:1234/v1",
    "http://localhost:1234/v1?token=x", "http://localhost:1234/v1#fragment"
  ]) {
    assert.throws(() => normalizeLocalChatCompletionsUrl(address));
  }
  assert.deepEqual(validateLocalChatConfiguration("http://localhost:1234/v1", "  my-model  "), {
    endpoint: "http://localhost:1234/v1/chat/completions", model: "my-model"
  });
  assert.throws(() => validateLocalChatConfiguration("http://localhost:1234/v1", " "), /模型 ID/u);
});

test("聊天模型与思考深度只改变聊天请求，不向不支持的接口发送参数", () => {
  const args = ["cet4", null, [], "解释这个句型"] as const;
  const quick = buildStudyChatRequestBody("deepseek", "deepseek-v4-flash", ...args, "low");
  assert.equal(quick.model, "deepseek-v4-flash");
  assert.deepEqual(quick.thinking, { type: "enabled" });
  assert.equal(quick.reasoning_effort, "low");
  assert.equal(quick.max_tokens, 4_096);
  const deep = buildStudyChatRequestBody("deepseek", "deepseek-v4-pro", ...args, "max");
  assert.equal(deep.model, "deepseek-v4-pro");
  assert.equal(deep.reasoning_effort, "max");
  const kimi = buildStudyChatRequestBody("kimi", "kimi-k2.6", ...args, "high");
  assert.deepEqual(kimi.thinking, { type: "enabled" });
  assert.equal(kimi.max_tokens, 16_000);
  assert.equal("reasoning_effort" in kimi, false);
  const custom = buildStudyChatRequestBody("openai-compatible", "custom", ...args, "high");
  assert.equal("thinking" in custom, false);
  assert.equal("reasoning_effort" in custom, false);
  const local = buildStudyChatRequestBody("local", "my-model", ...args, "high");
  assert.equal(local.model, "my-model");
  assert.equal(local.max_tokens, 8_192);
  assert.equal("thinking" in local, false);
  assert.equal("reasoning_effort" in local, false);
});

test("聊天请求按八种目标区分，且只携带选中的学习材料和有限历史", () => {
  const prompts = STUDY_PROFILES.map((profile) => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `turn-${index}`
    }));
    const body = buildStudyChatRequestBody("deepseek", "model", profile,
      { sentence: "I have been studying English.", focus: "现在完成进行时" }, history,
      "这里为什么用 have been studying？");
    assert.equal(body.messages.length, 14);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.match(body.messages[0]?.content ?? "", new RegExp(STUDY_PROFILE_LABELS[profile], "u"));
    assert.match(body.messages[0]?.content ?? "", /I have been studying English/u);
    assert.match(body.messages[0]?.content ?? "", /现在完成进行时/u);
    assert.equal(body.messages[1]?.content, "turn-8");
    assert.equal(body.messages.at(-1)?.content, "这里为什么用 have been studying？");
    assert.doesNotMatch(JSON.stringify(body), /private-note-or-whole-vault/u);
    return body.messages[0]?.content;
  });
  assert.equal(new Set(prompts).size, STUDY_PROFILES.length);
  const general = buildStudyChatRequestBody("openai-compatible", "model", "cet4", null, [], "解释定语从句");
  assert.match(general.messages[0]?.content ?? "", /没有指定学习材料/u);
  assert.equal("thinking" in general, false);
});

test("问 AI 只更新当前会话的材料，新对话才加入历史且目标互不混用", () => {
  const sessions = new StudyChatSessions();
  const cet4 = sessions.attachContext("cet4", { sentence: "A first sentence." });
  cet4.messages.push({ role: "user", content: "question" });
  cet4.draft = "follow-up draft";
  assert.equal(sessions.get("cet6").messages.length, 0);
  assert.equal(sessions.attachContext("cet4", { sentence: "A first sentence." }), cet4);
  assert.equal(sessions.attachContext("cet4", { sentence: "A second sentence." }), cet4);
  assert.equal(cet4.context?.sentence, "A second sentence.");
  assert.equal(cet4.messages[0]?.content, "question");
  assert.equal(cet4.draft, "follow-up draft");
  assert.equal(sessions.list("cet4").length, 1);
  const next = sessions.clear("cet4");
  assert.notEqual(next, cet4);
  assert.equal(next.messages.length, 0);
  assert.deepEqual(sessions.list("cet4"), [next, cet4]);
  assert.equal(sessions.select("cet4", cet4), true);
  assert.equal(sessions.get("cet4").messages[0]?.content, "question");
  assert.equal(sessions.get("cet4").context?.sentence, "A second sentence.");
  assert.equal(sessions.select("cet6", cet4), false);
  assert.equal(sessions.list("cet6").length, 1);
});

test("连续点新对话不会积累空记录，生成中的会话不能切走", () => {
  const sessions = new StudyChatSessions();
  sessions.clear("ielts");
  sessions.clear("ielts");
  assert.equal(sessions.list("ielts").length, 1);
  const first = sessions.get("ielts");
  first.messages.push({ role: "user", content: "Explain this." });
  const second = sessions.clear("ielts");
  second.pending = true;
  assert.equal(sessions.select("ielts", first), false);
  assert.equal(sessions.get("ielts"), second);
  second.pending = false;
  assert.equal(sessions.select("ielts", first), true);
});

test("同一句子的不同知识点留在同一会话，移除材料不删除问答", () => {
  const sessions = new StudyChatSessions();
  const sentence = "I have some special news to share.";
  const current = sessions.attachContext("ielts", { sentence, focus: "special news" });
  current.messages.push({ role: "user", content: "这是什么搭配？" });
  assert.equal(sessions.attachContext("ielts", { sentence, focus: "have sth to do" }), current);
  assert.equal(current.context?.focus, "have sth to do");
  assert.equal(sessions.list("ielts").length, 1);
  assert.equal(sessions.removeContext("ielts"), current);
  assert.equal(current.context, null);
  assert.equal(current.messages[0]?.content, "这是什么搭配？");
});

test("未提问时替换材料或点新对话不会制造空历史", () => {
  const sessions = new StudyChatSessions();
  sessions.attachContext("ielts", { sentence: "First." });
  sessions.attachContext("ielts", { sentence: "Second." });
  assert.equal(sessions.list("ielts").length, 1);
  sessions.clear("ielts");
  assert.equal(sessions.list("ielts").length, 1);
});
