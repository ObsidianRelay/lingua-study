# Lingua Study

Learn languages in Obsidian with timestamped YouTube transcripts, playback controls, and on-demand AI translation.

> [!IMPORTANT]
> Lingua Study 1.0.0 is a desktop-only first release. It currently focuses on English YouTube transcripts translated into Simplified Chinese. It does not download subtitles or bypass YouTube login, region, embedding, or anti-bot restrictions.

## Features

- Embedded YouTube player using the privacy-enhanced `youtube-nocookie.com` domain
- Play, pause, seek backward or forward by five seconds
- Playback speeds from 0.75x to 2x
- Clickable timestamps and automatic highlighting of the current transcript segment
- Per-segment translation that runs only after the user clicks a translation button
- DeepSeek API and HTTPS OpenAI Chat Completions-compatible providers
- Translation cache stored beside the transcript file
- API keys selected through Obsidian SecretStorage

## Requirements

- Obsidian 1.11.4 or later
- Obsidian desktop app
- A YouTube video that allows embedded playback in your current network environment
- A local transcript JSON file
- An API key only if you want to use translation

## Installation

### Community plugins

Lingua Study is preparing for submission to the Obsidian Community directory. After approval, install it from **Settings → Community plugins → Browse**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the matching GitHub release.
2. Create `<vault>/.obsidian/plugins/lingua-study/`.
3. Put the three files in that directory.
4. Reload Obsidian and enable **Lingua Study** under **Settings → Community plugins**.

## Usage

Create a transcript file inside your vault, for example `Language study/Transcripts/example.json`:

```json
{
  "version": 1,
  "videoId": "abcdefghijk",
  "sourceUrl": "https://www.youtube.com/watch?v=abcdefghijk",
  "language": "en",
  "segments": [
    {
      "start": 4,
      "end": 10,
      "text": "Welcome to this language lesson."
    }
  ]
}
```

Then add this code block to a Markdown note:

````markdown
```lingua-study
transcript: Language study/Transcripts/example.json
```
````

Open Reading view to use the player and transcript. The legacy `english-video-study` code block remains supported for notes created during early development.

## Translation setup

Open **Settings → Community plugins → Lingua Study** and choose one provider.

### DeepSeek

- Base URL: `https://api.deepseek.com`
- Models: `deepseek-v4-flash` or `deepseek-v4-pro`
- Thinking mode is disabled for short translation requests.

### OpenAI-compatible provider

Provide:

- An HTTPS base URL such as `https://example.com/v1`, or a complete `/chat/completions` URL
- The exact model ID supported by the provider
- A Bearer API key selected through Obsidian SecretStorage

Custom headers, Anthropic-compatible endpoints, Ollama, bulk translation, and additional target languages are not supported in 1.0.0.

## Translation controls

- **Translate** sends only that transcript segment to the selected provider.
- **Show translation** reads an existing local cache without making a network request.
- **Hide translation** hides the result without deleting the cache.
- **Retranslate** makes a new request and replaces the cached result for that segment.

When caching is enabled, Lingua Study creates a separate file beside the transcript:

```text
example.json
example.zh-CN.translations.json
```

## Privacy, network use, and costs

- The YouTube player connects to YouTube when a Lingua Study block is rendered.
- Translation requests connect to DeepSeek or the OpenAI-compatible HTTPS endpoint configured by the user.
- Only a segment explicitly selected for translation, the translation instruction, and the configured model name are sent.
- The connection test sends the fixed sentence `Thank you for using Lingua Study.`.
- The plugin does not collect telemetry, serve advertisements, create accounts, or operate a developer-controlled server.
- The plugin does not write API key values to plugin data, notes, transcript files, translation caches, or console logs.
- Translation providers may charge for API usage. Review the provider's current terms and pricing before use.
- A third-party gateway can read the text sent to it. Use only providers you trust.
- Obsidian community plugins share an application environment. SecretStorage protects against plain-text configuration and accidental syncing, but it cannot provide absolute isolation from a malicious plugin.
- Users are responsible for the rights to any transcript content they create or import.

## Limitations

- YouTube can refuse embedded playback because of publisher settings, login requirements, regional restrictions, or anti-bot checks.
- Lingua Study does not include a YouTube login flow and does not use cookies to bypass restrictions.
- Transcript files must currently be prepared outside the plugin.
- The interface and translation target are currently Simplified Chinese.

## Development

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run check:release
```

The production build creates `main.js`. Source control intentionally ignores that file; GitHub releases include it as a downloadable asset.

Maintainer instructions are available in [RELEASING.md](./RELEASING.md).

## License

[MIT](./LICENSE) © 2026 xiaobai

---

## 中文说明

Lingua Study 是一款桌面端 Obsidian 外语学习插件。当前 1.0.0 版本主要支持 YouTube 英语视频、本地时间戳字幕、播放控制、逐句高亮，以及翻译为简体中文。

插件不会自动抓取 YouTube 字幕，也不会绕过登录、地区、嵌入或反机器人限制。只有点击某句话的翻译按钮后，该句英文才会发送给你选择的 DeepSeek 或 OpenAI Chat Completions 兼容服务；API Key 通过 Obsidian SecretStorage 选择，翻译服务可能产生费用。

详细安装、字幕 JSON 格式和隐私说明请参考上方英文文档。
