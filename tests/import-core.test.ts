import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildBilibiliStudyBlock,
  addTranscriptToBilibiliStudyBlock,
  buildStudyBlock,
  chooseAvailableTranscriptPath,
  cleanSubtitleText,
  extractBilibiliLinks,
  extractBilibiliVideosFromStudyBlocks,
  extractInitialPlayerResponse,
  extractInnerTubeConfig,
  extractTranscriptPathsFromStudyBlocks,
  extractYouTubeLinks,
  extractSupportedVideoLinks,
  findBilibiliLinksByPriority,
  findSupportedVideoLinksByPriority,
  findYouTubeLinksByPriority,
  groupTranscriptSegmentsIntoSentences,
  mapHttpFailure,
  mapPlayerFailure,
  normalizeTranscriptSegments,
  parseBilibiliLink,
  parseJson3Captions,
  parseStandalonePastedVideoLink,
  parseSubtitleFile,
  parseTimedTextXml,
  parseYouTubeLink,
  removeMatchingVideoLinkFromLine,
  removeVisibleBilibiliLinksFromMarkdown,
  sanitizeTranscriptFolder,
  selectEnglishCaptionTrack
} from "../src/import-core";
import { validateTranscript } from "../src/transcript-core";

const VIDEO_ID = "abcdefghijk";

test("识别所有支持的 YouTube 链接格式", () => {
  const urls = [
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtube.com/watch?list=test&v=${VIDEO_ID}&t=20`,
    `https://youtu.be/${VIDEO_ID}?si=test`,
    `https://www.youtube.com/shorts/${VIDEO_ID}`,
    `https://www.youtube.com/embed/${VIDEO_ID}`,
    `https://www.youtube.com/live/${VIDEO_ID}?feature=share`,
    `https://music.youtube.com/watch?v=${VIDEO_ID}`,
    `www.youtube.com/watch?v=${VIDEO_ID}`
  ];
  for (const url of urls) {
    assert.equal(parseYouTubeLink(url)?.videoId, VIDEO_ID, url);
  }
});

test("拒绝伪造域名、非网页协议、错误路径和错误视频 ID", () => {
  const rejected = [
    `https://youtube.com.evil.example/watch?v=${VIDEO_ID}`,
    `https://notyoutube.com/watch?v=${VIDEO_ID}`,
    `javascript://www.youtube.com/watch?v=${VIDEO_ID}`,
    "https://www.youtube.com/channel/abcdefghijk",
    "https://youtu.be/short",
    "https://www.youtube.com/watch?v=abcdefghijkx"
  ];
  for (const url of rejected) {
    assert.equal(parseYouTubeLink(url), null, url);
  }
});

test("链接识别去重并遵循选区、当前行、全文优先级", () => {
  const secondId = "ZYXWVUTsrqp";
  assert.deepEqual(
    extractYouTubeLinks(`(${`https://youtu.be/${VIDEO_ID}`}). ${`https://youtu.be/${VIDEO_ID}`}`)
      .map((link) => link.videoId),
    [VIDEO_ID]
  );
  assert.deepEqual(
    findYouTubeLinksByPriority(
      `https://youtu.be/${VIDEO_ID}`,
      `https://youtu.be/${secondId}`,
      ""
    ).map((link) => link.videoId),
    [VIDEO_ID]
  );
  assert.deepEqual(
    findYouTubeLinksByPriority("", "", `https://youtu.be/${VIDEO_ID}\nhttps://youtu.be/${secondId}`)
      .map((link) => link.videoId),
    [VIDEO_ID, secondId]
  );
});

test("识别 B站 BV、av、多 P 和 b23.tv 链接", () => {
  const bvid = "BV1B7411m7LV";
  assert.deepEqual(parseBilibiliLink(`https://www.bilibili.com/video/${bvid}?p=3&spm_id_from=test`), {
    kind: "video",
    idType: "bvid",
    videoId: bvid,
    page: 3,
    canonicalUrl: `https://www.bilibili.com/video/${bvid}?p=3`,
    originalUrl: `https://www.bilibili.com/video/${bvid}?p=3&spm_id_from=test`
  });
  assert.equal(parseBilibiliLink("https://m.bilibili.com/video/av123456/")?.kind, "video");
  assert.deepEqual(parseBilibiliLink("https://b23.tv/AbCd_12?share_source=test"), {
    kind: "short",
    shortUrl: "https://b23.tv/AbCd_12",
    originalUrl: "https://b23.tv/AbCd_12?share_source=test"
  });
});

test("拒绝伪造 B站域名、非视频地址和错误视频 ID", () => {
  const rejected = [
    "https://bilibili.com.evil.example/video/BV1B7411m7LV",
    "javascript://www.bilibili.com/video/BV1B7411m7LV",
    "https://www.bilibili.com/read/cv123",
    "https://www.bilibili.com/video/BVshort",
    "https://b23.tv/a/b"
  ];
  for (const url of rejected) {
    assert.equal(parseBilibiliLink(url), null, url);
  }
});

test("B站链接去重并遵循选区、当前行、全文优先级", () => {
  const first = "BV1B7411m7LV";
  const second = "BV1z64y167fn";
  assert.deepEqual(
    extractBilibiliLinks(`https://www.bilibili.com/video/${first} https://m.bilibili.com/video/${first}`)
      .map((link) => link.kind === "video" ? link.videoId : link.shortUrl),
    [first]
  );
  assert.deepEqual(
    findBilibiliLinksByPriority(
      `https://www.bilibili.com/video/${first}`,
      `https://www.bilibili.com/video/${second}`,
      ""
    ).map((link) => link.kind === "video" ? link.videoId : link.shortUrl),
    [first]
  );
});

test("粘贴自动导入只接受一个独立的 B站或 YouTube 视频链接", () => {
  assert.equal(
    parseStandalonePastedVideoLink("https://youtu.be/abcdefghijk")?.platform,
    "youtube"
  );
  const bilibili = parseStandalonePastedVideoLink(
    "  <https://www.bilibili.com/video/BV1B7411m7LV?p=3&spm_id_from=test>  "
  );
  assert.equal(bilibili?.platform, "bilibili");
  assert.equal(bilibili?.platform === "bilibili" && bilibili.link.kind === "video"
    ? bilibili.link.page
    : null, 3);
  assert.equal(
    parseStandalonePastedVideoLink("学习这个视频 https://youtu.be/abcdefghijk"),
    null
  );
  assert.equal(
    parseStandalonePastedVideoLink(
      "https://youtu.be/abcdefghijk\nhttps://youtu.be/ZYXWVUTsrqp"
    ),
    null
  );
  assert.equal(parseStandalonePastedVideoLink("https://youtube.com.evil.example/watch?v=abcdefghijk"), null);
});

test("左侧 Logo 按正文顺序识别两种平台并遵循操作范围优先级", () => {
  const bvid = "BV1B7411m7LV";
  const mixed = [
    `先看 https://www.bilibili.com/video/${bvid}`,
    `再看 https://youtu.be/${VIDEO_ID}`,
    `重复 https://www.bilibili.com/video/${bvid}`
  ].join("\n");
  const extracted = extractSupportedVideoLinks(mixed);
  assert.deepEqual(extracted.map((item) => item.platform), ["bilibili", "youtube"]);
  assert.equal(
    extracted[0]?.platform === "bilibili" && extracted[0].link.kind === "video"
      ? extracted[0].link.videoId
      : null,
    bvid
  );
  assert.equal(
    extracted[1]?.platform === "youtube" ? extracted[1].link.videoId : null,
    VIDEO_ID
  );

  assert.deepEqual(
    findSupportedVideoLinksByPriority(
      `https://youtu.be/${VIDEO_ID}`,
      `https://www.bilibili.com/video/${bvid}`,
      mixed
    ).map((item) => item.platform),
    ["youtube"]
  );
  assert.deepEqual(
    findSupportedVideoLinksByPriority("", "没有链接", mixed).map((item) => item.platform),
    ["bilibili", "youtube"]
  );
});

test("成功导入后只移除匹配的视频链接并保留同一行其他文字", () => {
  const videoId = "abcdefghijk";
  const matches = (url: string): boolean => parseYouTubeLink(url)?.videoId === videoId;
  assert.deepEqual(
    removeMatchingVideoLinkFromLine(`https://youtu.be/${videoId}`, matches),
    { line: "", removed: true }
  );
  assert.deepEqual(
    removeMatchingVideoLinkFromLine(`学习：[打开视频](https://youtu.be/${videoId})`, matches),
    { line: "学习：", removed: true }
  );
  assert.deepEqual(
    removeMatchingVideoLinkFromLine(
      `保留 https://example.com/docs 并移除 <https://youtu.be/${videoId}>`,
      matches
    ),
    { line: "保留 https://example.com/docs 并移除", removed: true }
  );
});

test("仅播放器会清理代码块外的匹配 B站链接并保留说明文字", () => {
  const link = parseBilibiliLink(
    "https://www.bilibili.com/video/BV1B7411m7LV?p=2&spm_id_from=test"
  );
  assert.ok(link?.kind === "video");
  const source = [
    "课程说明 https://www.bilibili.com/video/BV1B7411m7LV?p=2&spm_id_from=test 请认真观看",
    buildBilibiliStudyBlock(link),
    "```text",
    "https://www.bilibili.com/video/BV1B7411m7LV?p=2",
    "```",
    "~~~text",
    "https://www.bilibili.com/video/BV1B7411m7LV?p=2",
    "~~~",
    "保留另一页 https://www.bilibili.com/video/BV1B7411m7LV?p=3"
  ].join("\n");
  const cleaned = removeVisibleBilibiliLinksFromMarkdown(source, link);
  assert.equal(cleaned.removed, 1);
  assert.match(cleaned.markdown, /课程说明\s+请认真观看/u);
  assert.match(cleaned.markdown, /```text\nhttps:\/\/www\.bilibili\.com\/video\/BV1B7411m7LV\?p=2\n```/u);
  assert.match(cleaned.markdown, /~~~text\nhttps:\/\/www\.bilibili\.com\/video\/BV1B7411m7LV\?p=2\n~~~/u);
  assert.match(cleaned.markdown, /\?p=3/u);
});

test("生成 B站播放器代码块并识别已有视频", () => {
  const link = parseBilibiliLink("https://www.bilibili.com/video/BV1B7411m7LV?p=2");
  assert.ok(link?.kind === "video");
  const block = buildBilibiliStudyBlock(link);
  assert.equal(
    block,
    "```lingua-study\nplatform: bilibili\nbvid: BV1B7411m7LV\npage: 2\n```"
  );
  assert.deepEqual(extractBilibiliVideosFromStudyBlocks(block), [
    { idType: "bvid", videoId: "BV1B7411m7LV", page: 2 }
  ]);
  assert.deepEqual(
    extractBilibiliVideosFromStudyBlocks(
      "```lingua-study\nplatform: bilibili\naid: 123456\npage: 1\n```"
    ),
    [{ idType: "aid", videoId: "av123456", page: 1 }]
  );
});

test("B站学习代码块可以安全加入字幕路径", () => {
  const link = parseBilibiliLink("https://www.bilibili.com/video/BV1B7411m7LV?p=2");
  assert.ok(link?.kind === "video");
  assert.equal(
    buildBilibiliStudyBlock(link, "Lingua Study/Transcripts/BV1B7411m7LV-p2.json"),
    "```lingua-study\nplatform: bilibili\nbvid: BV1B7411m7LV\npage: 2\ntranscript: Lingua Study/Transcripts/BV1B7411m7LV-p2.json\n```"
  );
  assert.equal(
    addTranscriptToBilibiliStudyBlock(
      `before\n${buildBilibiliStudyBlock(link)}\nafter`,
      link,
      "Lingua Study/Transcripts/BV1B7411m7LV-p2.json"
    ),
    `before\n${buildBilibiliStudyBlock(link, "Lingua Study/Transcripts/BV1B7411m7LV-p2.json")}\nafter`
  );
});

test("优先选择人工英文字幕，其次英文自动字幕", () => {
  const manual = { baseUrl: "https://www.youtube.com/api/timedtext?id=1", languageCode: "en-US" };
  const automatic = {
    baseUrl: "https://www.youtube.com/api/timedtext?id=2",
    languageCode: "en",
    kind: "asr",
    vssId: "a.en"
  };
  const french = { baseUrl: "https://www.youtube.com/api/timedtext?id=3", languageCode: "fr" };
  assert.equal(selectEnglishCaptionTrack([automatic, manual]), manual);
  assert.equal(selectEnglishCaptionTrack([french, automatic]), automatic);
  assert.equal(selectEnglishCaptionTrack([french]), null);
});

test("从页面安全提取播放器 JSON 和 InnerTube 配置", () => {
  const response = { videoDetails: { title: "A } brace" }, captions: {} };
  const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(response)};</script>`;
  assert.deepEqual(extractInitialPlayerResponse(html), response);
  assert.deepEqual(
    extractInnerTubeConfig(
      '<script>ytcfg.set({"INNERTUBE_API_KEY":"test_key-1","INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20260813.00.00"});</script>'
    ),
    { apiKey: "test_key-1", clientVersion: "2.20260813.00.00" }
  );
  assert.equal(extractInitialPlayerResponse("<html>broken</html>"), null);
});

test("解析 JSON3 并清理实体、标签、重复片段和重叠时间轴", () => {
  const segments = parseJson3Captions(JSON.stringify({
    events: [
      { tStartMs: 1000, dDurationMs: 4000, segs: [{ utf8: " Hello &amp; <i>world</i> " }] },
      { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: "Next" }] },
      { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: "line" }] },
      { tStartMs: 6000, dDurationMs: 1000, segs: [{ utf8: "   " }] }
    ]
  }));
  assert.deepEqual(segments, [
    { start: 1, end: 3, text: "Hello & world" },
    { start: 3, end: 5, text: "Next line" }
  ]);
  assert.throws(() => parseJson3Captions('{"events":[]}'), /为空/);
  assert.throws(() => parseJson3Captions("not-json"), /无法解析/);
});

test("解析 YouTube timedtext XML", () => {
  assert.deepEqual(
    parseTimedTextXml(
      '<transcript><text start="0.5" dur="1.5">Hi &amp; welcome</text><p t="2000" d="1000">Next</p></transcript>'
    ),
    [
      { start: 0.5, end: 2, text: "Hi & welcome" },
      { start: 2, end: 3, text: "Next" }
    ]
  );
  assert.throws(() => parseTimedTextXml("<transcript></transcript>"), /为空/);
});

test("解析 SRT 和 VTT，本地无效字幕不会生成内容", () => {
  const srt = "1\n00:00:01,000 --> 00:00:03,000\nHello <b>world</b>\n\n2\n00:00:02,500 --> 00:00:04,000\nNext line";
  assert.deepEqual(parseSubtitleFile(srt), [
    { start: 1, end: 2.5, text: "Hello world" },
    { start: 2.5, end: 4, text: "Next line" }
  ]);

  const vtt = "WEBVTT\n00:00:00.000 --> 00:00:01.250 align:start\nHello\n\nNOTE ignored\nmetadata\n\n00:01.250 --> 00:02.000\nWorld";
  assert.deepEqual(parseSubtitleFile(vtt), [
    { start: 0, end: 1.25, text: "Hello" },
    { start: 1.25, end: 2, text: "World" }
  ]);
  assert.throws(() => parseSubtitleFile("WEBVTT\n\nnot a cue"), /没有识别/);
});

test("字幕清理可处理无效实体与缺少时长的片段", () => {
  assert.equal(cleanSubtitleText("<c>Hello&nbsp;  world &#x1F44B;</c>"), "Hello world 👋");
  assert.equal(cleanSubtitleText("bad &#x110000; entity"), "bad &#x110000; entity");
  assert.deepEqual(normalizeTranscriptSegments([{ start: 4, duration: 0, text: "Hi" }]), [
    { start: 4, end: 6, text: "Hi" }
  ]);
});

test("将连续碎片整理为完整句子并保持原始时间范围", () => {
  const grouped = groupTranscriptSegmentsIntoSentences([
    { start: 6.61, end: 8.16, text: "Every four seconds," },
    { start: 8.16, end: 9.7, text: "someone is diagnosed with" },
    { start: 9.7, end: 11.58, text: "Alzheimer's disease." },
    { start: 11.58, end: 13.75, text: "It's the most common cause of dementia," },
    { start: 13.75, end: 16.61, text: "affecting over 40 million people worldwide," },
    { start: 16.61, end: 19.13, text: "and yet finding a cure is something that still" },
    { start: 19.13, end: 21.61, text: "eludes researchers today." }
  ]);

  assert.deepEqual(grouped, [
    {
      start: 6.61,
      end: 11.58,
      text: "Every four seconds, someone is diagnosed with Alzheimer's disease."
    },
    {
      start: 11.58,
      end: 21.61,
      text: "It's the most common cause of dementia, affecting over 40 million people worldwide, and yet finding a cure is something that still eludes researchers today."
    }
  ]);
  assert.deepEqual(groupTranscriptSegmentsIntoSentences(grouped), grouped);
});

test("完整句整理识别缩写、句末符号、长停顿和无标点兜底", () => {
  const fortyWords = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");
  const grouped = groupTranscriptSegmentsIntoSentences([
    { start: 0, end: 1, text: "Dr." },
    { start: 1, end: 2, text: "Smith asked," },
    { start: 2, end: 3, text: "\"Are you ready?\"" },
    { start: 3, end: 4, text: "Yes!" },
    { start: 6, end: 7, text: "A new scene without punctuation" },
    { start: 7, end: 17, text: fortyWords },
    { start: 17, end: 21, text: "six extra words make fallback happen" },
    { start: 21, end: 22, text: "Final fragment without punctuation" },
    { start: 24, end: 25, text: "Pause-bound fragment" },
    { start: 27, end: 28, text: "After a long pause." }
  ]);

  assert.deepEqual(grouped.slice(0, 2), [
    { start: 0, end: 3, text: "Dr. Smith asked, \"Are you ready?\"" },
    { start: 3, end: 4, text: "Yes!" }
  ]);
  assert.equal(grouped[2]?.start, 6);
  assert.equal(grouped[2]?.end, 17);
  assert.match(grouped[2]?.text ?? "", /^A new scene without punctuation word0/u);
  assert.equal(grouped[3]?.text, "six extra words make fallback happen Final fragment without punctuation");
  assert.equal(grouped[4]?.text, "Pause-bound fragment");
  assert.equal(grouped[5]?.text, "After a long pause.");
  assert.deepEqual(groupTranscriptSegmentsIntoSentences(grouped), grouped);
});

test("YouTube 和 B站所有新字幕保存路径都会执行完整句整理", async () => {
  const [youtubeSource, bilibiliSource] = await Promise.all([
    readFile("src/youtube-import.ts", "utf8"),
    readFile("src/bilibili-import.ts", "utf8")
  ]);
  assert.ok((youtubeSource.match(/groupTranscriptSegmentsIntoSentences\(/gu)?.length ?? 0) >= 2);
  assert.ok((bilibiliSource.match(/groupTranscriptSegmentsIntoSentences\(/gu)?.length ?? 0) >= 2);
  assert.match(youtubeSource, /segments = groupTranscriptSegmentsIntoSentences\(segments\);/u);
  assert.match(bilibiliSource, /segments = groupTranscriptSegmentsIntoSentences\(segments\);/u);
});

test("B站字幕导入不再包含 Chrome Helper 通信路径", async () => {
  const [controller, session, packageJson, releaseCheck] = await Promise.all([
    readFile("src/bilibili-import.ts", "utf8"),
    readFile("src/bilibili-session.ts", "utf8"),
    readFile("package.json", "utf8"),
    readFile("scripts/check-release.mjs", "utf8")
  ]);
  const activeSources = [controller, session, packageJson, releaseCheck].join("\n");
  assert.doesNotMatch(activeSources, /BilibiliHelper|browser-extension|build:helper|27124|27133/u);
  await assert.rejects(readFile("src/bilibili-helper-bridge.ts", "utf8"));
  await assert.rejects(readFile("src/bilibili-helper-core.ts", "utf8"));
  await assert.rejects(readFile("browser-extension/manifest.json", "utf8"));
});

test("字幕文件夹、代码块与冲突文件名受到保护", () => {
  assert.equal(sanitizeTranscriptFolder(" /My Folder/Transcripts/ "), "My Folder/Transcripts");
  assert.equal(sanitizeTranscriptFolder("../Secrets"), "Lingua Study/Transcripts");
  assert.equal(
    buildStudyBlock("Lingua Study/Transcripts/abcdefghijk.json"),
    "```lingua-study\ntranscript: Lingua Study/Transcripts/abcdefghijk.json\n```"
  );
  assert.deepEqual(
    extractTranscriptPathsFromStudyBlocks(
      "```lingua-study\ntranscript: Lingua Study/Transcripts/abcdefghijk.json\n```"
    ),
    ["Lingua Study/Transcripts/abcdefghijk.json"]
  );
  const occupied = new Set([
    "Lingua Study/Transcripts/abcdefghijk.json",
    "Lingua Study/Transcripts/abcdefghijk-2.json"
  ]);
  assert.deepEqual(
    chooseAvailableTranscriptPath(
      "Lingua Study/Transcripts",
      VIDEO_ID,
      (path) => occupied.has(path)
    ),
    { path: "Lingua Study/Transcripts/abcdefghijk-3.json", conflict: true }
  );
});

test("现有 version 1 字幕可直接复用，损坏或错视频字幕会被拒绝", () => {
  const valid = {
    version: 1,
    videoId: VIDEO_ID,
    sourceUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    language: "en",
    segments: [{ start: 0, end: 1, text: "Hello" }]
  };
  assert.equal(validateTranscript(valid).videoId, VIDEO_ID);
  assert.throws(() => validateTranscript({ ...valid, version: 2 }), /version/);
  assert.throws(
    () => validateTranscript({ ...valid, videoId: "ZYXWVUTsrqp", segments: [{ start: 1, end: 0, text: "x" }] }),
    /end/
  );
});

test("私密、登录、限流、网络和无效状态映射为明确原因", () => {
  assert.equal(mapHttpFailure(200), null);
  assert.equal(mapHttpFailure(429)?.code, "rate-limited");
  assert.equal(mapHttpFailure(403)?.code, "login-required");
  assert.equal(mapHttpFailure(503)?.code, "network");
  assert.equal(
    mapPlayerFailure({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in" } })?.code,
    "login-required"
  );
  assert.equal(
    mapPlayerFailure({ playabilityStatus: { status: "UNPLAYABLE", reason: "Private" } })?.code,
    "private-or-unavailable"
  );
  assert.equal(mapPlayerFailure({ playabilityStatus: { status: "OK" } }), null);
});
