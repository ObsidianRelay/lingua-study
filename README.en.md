# Lingua Study

[简体中文](./README.md) | [English](./README.en.md)

Turn English YouTube and Bilibili videos into materials you can shadow, dictate, look up, and review inside Obsidian. Lingua Study combines timestamped transcripts, cached playback, per-segment translation, an offline dictionary, and a vocabulary book.

> [!IMPORTANT]
> Lingua Study 1.4.2 is desktop-only. Mobile support remains experimental and is not included in this public release. The plugin focuses on English video transcripts translated into Simplified Chinese. Public YouTube caption import uses an unofficial interface because the [official captions download API](https://developers.google.com/youtube/v3/docs/captions/download) only works for videos the user can edit. YouTube and Bilibili public interfaces can change without notice. The plugin does not bypass login, regional, embedding, membership, or anti-bot restrictions.

## Recent updates (1.3.0–1.4.2)

- **Optional appearances**: keep the classic appearance by default or switch to Lingua Paper in settings, with identical functionality in both
- **Resizable player**: drag from any of the four player corners on desktop, with responsive controls and a saved width
- **Update reminder**: check the latest official Release when settings opens and show the Obsidian Community plugin page entry only when an update exists
- **Sentence dictation**: replay one segment, submit an answer, and review a word-level comparison and score
- **Shadowing practice**: record along with the source audio, pause or resume, view a waveform, and play back the recording
- **Vocabulary learning loop**: look up a word, save it with its video context, and schedule it for daily review
- **Vocabulary export**: export the book to an Obsidian study note or paginated desktop PNG images
- **Smooth transcript following**: keep the active segment visible during playback with less page jumping and repeated layout work
- **Replaceable transcript imports**: keep the Bilibili subtitle button available after a transcript has been added so failed or incorrect imports can be replaced
- **Custom dictionaries**: import CSV, TSV, or JSON dictionaries up to 100 MB and 1,000,000 entries on desktop, with custom definitions taking priority

## Features

- Embedded YouTube player using the privacy-enhanced `youtube-nocookie.com` domain
- Local cached Bilibili playback with Bilibili's official external player as a fallback
- A dedicated left-ribbon Lingua Study logo for manually importing a YouTube or Bilibili link from the active note
- Optional automatic import after pasting one standalone video link, disabled by default
- A settings-page update check against the latest official GitHub Release, opening the plugin page inside Obsidian only when a newer version is available
- Direct Bilibili English subtitle import, with an isolated in-Obsidian login only when Bilibili requires it
- Public manual-English caption preference with automatic English captions as fallback
- Independent keyless YouTube mobile-client fallback when the normal page route is blocked
- Automatic local `yt-dlp` fallback on desktop when it is already installed
- Local SRT/VTT import when public captions cannot be fetched
- A follow-up **Add transcript** entry on player-only Bilibili blocks
- Editable PDF, DOCX, TXT, Markdown, and pasted bilingual transcript import
- Optional local Whisper Base English alignment that keeps media and transcripts on the device
- Play, pause, seek backward or forward by five seconds
- Playback speeds from 0.75x to 2x
- Clickable timestamps, automatic highlighting, and page-level transcript following without an internal scrolling window
- Per-segment translation that runs only after the user clicks a translation button
- Four-part study cards with translation, vocabulary and collocations, grammar patterns, and exam-focused tips
- CET-4, CET-6, TEM-4, TEM-8, IELTS, and TOEFL study profiles with separate local caches
- A bundled offline English-Chinese dictionary opened by double-clicking a transcript word
- A dedicated right-sidebar dictionary view with phonetics, definitions, inflections, exam tags, context, and system pronunciation
- A vocabulary book with personal notes, saved video contexts, filtering, and a daily review queue
- Per-segment transcript editing and one-click restoration of the original text
- Inline single-sentence dictation with two-second replay controls and word-level comparison
- Temporary single-sentence recording with synchronized shadowing, pause/resume, waveform, and playback comparison
- One-click vocabulary-book export to an Obsidian note or paginated desktop PNG images
- DeepSeek, Kimi, and HTTPS OpenAI Chat Completions-compatible providers
- Translation cache stored beside the transcript file
- API keys selected through Obsidian SecretStorage

The version check requests only the latest official Release `manifest.json` from this project's GitHub repository when the user opens Lingua Study settings. It does not upload notes, dictionaries, vocabulary, settings, or usage data, and it never downloads or overwrites plugin files by itself.

## Requirements

- Obsidian 1.13.0 or later
- Obsidian desktop app
- A YouTube or public Bilibili video available in your current network environment
- An API key only if you want to use translation
- Optional: a current `yt-dlp` installation for the more reliable desktop fallback

## Installation

### Community plugins

The Lingua Study project page may become visible on the Obsidian community website before the plugin is included in the official in-app directory. After the reviewed release becomes searchable in Obsidian, install or update it from **Settings → Community plugins → Browse**. Until then, use the manual installation steps below.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the matching GitHub release.
2. Create `<vault>/.obsidian/plugins/lingua-study/`.
3. Put the three files in that directory.
4. Reload Obsidian and enable **Lingua Study** under **Settings → Community plugins**.

No Chrome extension is required for Bilibili subtitle import. If a video requires login, Lingua Study opens an isolated Bilibili login window inside Obsidian and retries automatically after login.

## Usage

### Manual YouTube workflow

1. Paste a YouTube video link into a Markdown note.
2. Click the Lingua Study logo in Obsidian's left ribbon.
3. Wait for the transcript to be saved and the note to switch to Reading view.

After a successful import, Lingua Study removes the long pasted link, saves the English transcript under `Lingua Study/Transcripts`, inserts the study block, and switches the note to Reading view. Use the compact **打开原视频** button inside the player when you need the source page. If the selected scope contains multiple supported links, the ribbon action asks which video to process.

To restore paste-to-import behavior, turn on **Settings → Community plugins → Lingua Study → 通用选项 → 粘贴视频链接后自动创建学习内容**. The setting remains optional and is disabled by default.

Caption retrieval follows this order automatically:

1. YouTube watch page and public player caption tracks
2. A keyless YouTube mobile-client request that does not depend on watch-page configuration
3. A separately installed local `yt-dlp`, first for manual English subtitles and then automatic English subtitles
4. Local `.srt` or `.vtt` selection, up to 10 MB

The transcript folder and an optional full path to `yt-dlp` can be changed under **Settings → Community plugins → Lingua Study → YouTube 字幕导入**. Leave the `yt-dlp` path empty to search the system PATH and common Homebrew, MacPorts, and Windows command locations automatically. Existing valid files are reused without a network request, and an existing block for the same video is not inserted again.

### Manual Bilibili workflow

1. Paste a public Bilibili video link into a Markdown note.
2. Click the Lingua Study logo in Obsidian's left ribbon.
3. Wait for the transcript to be saved and the note to switch to Reading view.

Lingua Study reads independent subtitle tracks directly from Bilibili and downloads the public combined MP4 into the operating system cache. When Bilibili reports that subtitles require login, the user can sign in through an isolated Obsidian window and the import retries automatically. The login session is separate from Chrome. The plugin then saves the transcript, removes the long pasted link, inserts one study block, and switches the note to Reading view. BV, av, multi-part `?p=` links, and official `b23.tv` share links are supported.

Transcript creation follows this order:

1. Existing valid local transcript
2. Direct Bilibili subtitle request, preferring manual English over automatic English; in-Obsidian login only when required
3. Local `.srt` or `.vtt` selection, up to 10 MB
4. Import a creator-provided document and align it locally with Whisper Base English
5. Player-only import if no usable English track is available

After a player-only block is created, the original visible Bilibili link is removed while surrounding note text is retained. A compact caption icon remains next to the source-video button so that SRT/VTT or a creator-provided PDF, DOCX, TXT, Markdown, or pasted transcript can be added later. Imported Chinese is stored as the corresponding local translation without calling the translation API.

The video cache directory can be opened from **Settings → Community plugins → Lingua Study → 哔哩哔哩视频与登录 → 打开缓存文件夹**. Cached video is outside the Obsidian vault and is not managed by Obsidian Sync. The generated transcript JSON remains in the configured transcript folder inside the vault. The Bilibili login cookie remains in Electron's isolated persistent session and is not written into notes, transcript files, plugin settings, or Obsidian Sync. It can be cleared from the same settings section.

### Manual transcript format

Version 1 JSON files and notes created with Lingua Study 1.0.x remain supported. Advanced users can still create a transcript file manually:

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

### Kimi

- Model: `kimi-k2.6`
- The API key is selected through Obsidian SecretStorage.
- Thinking mode is disabled for short translation requests.

### OpenAI-compatible provider

Provide:

- An HTTPS base URL such as `https://example.com/v1`, or a complete `/chat/completions` URL
- The exact model ID supported by the provider
- A Bearer API key selected through Obsidian SecretStorage

The current version does not support custom headers, Anthropic-compatible endpoints, Ollama, or additional target languages. Optional whole-transcript translation is available, runs sequentially, and skips segments that already have results.

## Translation controls

- **Translate** sends only that transcript segment, the selected study profile, and matching local exam tags to the selected provider. One request returns the translation and study points.
- **Show translation** reads an existing local cache without making a network request.
- **Hide translation** hides the result without deleting the cache.
- **Retranslate** makes a new request and replaces the cached study card for the active study profile.
- **Add study points** upgrades a legacy translation-only cache after an explicit click.
- **Edit transcript** changes one segment without changing its timestamps.
- **Restore original** restores the first imported or generated text for that segment.

### Sentence dictation and shadowing

1. Click the transcript segment you want to practise.
2. Select the headphones icon in the transcript action area for dictation, or the microphone icon for shadowing.
3. Dictation includes two-second replay controls. After submission, Lingua Study shows a score and word-level comparison, followed by retry and next-sentence actions.
4. Shadowing synchronizes source playback and recording, with pause, resume, waveform, and recording-playback controls.

Dictation and shadowing currently require the desktop YouTube player or a locally cached Bilibili video. Bilibili's online external player cannot provide precise segment control. Shadowing also requires microphone permission for Obsidian.

### Vocabulary book and daily review

1. Double-click an English transcript word to see offline definitions, phonetics, inflections, and exam tags in the right sidebar.
2. Select **Add to vocabulary book** to save the word together with the current video sentence and timestamp. You can also add a personal note.
3. Use the **Vocabulary book** tab to search or filter saved words, and **Today's review** to complete the current review queue.
4. Export the vocabulary book to an Obsidian note, or create paginated PNG images on desktop.

Manual edits store the first version in an optional `originalText` field in the same version 1 transcript JSON. Existing files remain compatible.

Double-clicking one English word performs a fully offline lookup. It does not call the configured AI provider. The compressed exam-and-frequency subset of ECDICT remains inside `main.js`. The optional full ECDICT installer under **Settings → Lingua Study → Learning and dictionary** prefers a prebuilt 24.4 MB ZIP and falls back to the official ECDICT CSV when needed. Downloads support resume and up to three attempts. The installed dictionary stays in the operating-system cache rather than the vault or Obsidian Sync. The pronunciation button uses an installed operating-system English voice.

When caching is enabled, Lingua Study creates a separate file beside the transcript:

```text
example.json
example.zh-CN.translations.json
example.zh-CN.study.json
```

## Privacy, network use, and costs

- The YouTube player connects to YouTube when a Lingua Study block is rendered.
- Bilibili video caching connects to official `b23.tv`, `api.bilibili.com`, and allowlisted HTTPS `bilivideo.com` or `bilivideo.cn` CDN hosts.
- Bilibili subtitle import first uses anonymous HTTPS requests. If login is required, the isolated Electron session sends its Bilibili cookie only to Bilibili-owned API hosts; cookie values are never written to the vault or plugin settings.
- Bilibili MP4 files and a small JSON manifest are saved under the operating system's user cache directory, outside the Obsidian vault. A single cached video is limited to 2 GB. The current anonymous combined format is usually at most 480P.
- Cached Bilibili playback uses a temporary random URL bound only to `127.0.0.1`. It serves only cache files already validated by the plugin, supports browser byte-range requests, never exposes the cache to the internet, and stops when the plugin unloads.
- When no valid local cache exists, a rendered Bilibili block connects to `player.bilibili.com` and uses the official external player.
- Direct import connects only to HTTPS addresses on `youtube.com`. It may use the public watch page and YouTube's internal player and timed-text endpoints. Lingua Study does not bundle a fixed YouTube API key.
- Direct import does not use browser cookies, a Google login, a user API key, a developer-controlled server, or telemetry.
- If direct import fails and local `yt-dlp` is available, Lingua Study runs it without a shell, ignores user-wide yt-dlp configuration, downloads subtitles only into a temporary folder, and deletes that folder after parsing. It does not request video or audio.
- Local SRT/VTT fallback files are read on the device and are not uploaded by Lingua Study.
- PDF, DOCX, TXT, Markdown, and pasted creator transcripts are parsed locally. Image-only PDFs require OCR before import.
- Local transcript alignment downloads a pinned Whisper Base English model and runtime only after confirmation; the video and transcript remain on the device.
- Translation requests connect to DeepSeek or the OpenAI-compatible HTTPS endpoint configured by the user.
- A study-card request sends only the segment explicitly selected by the user, the selected CET-4/CET-6/IELTS profile, and matching local dictionary tags.
- Offline dictionary lookups and system pronunciation do not make network requests.
- The connection test sends the fixed sentence `Thank you for using Lingua Study.`.
- The plugin does not collect telemetry, serve advertisements, create accounts, or operate a developer-controlled server.
- The plugin does not write translation API key values to plugin data, notes, transcript files, translation caches, or console logs.
- Translation providers may charge for API usage. Review the provider's current terms and pricing before use.
- A third-party gateway can read the text sent to it. Use only providers you trust.
- Obsidian community plugins share an application environment. SecretStorage protects against plain-text configuration and accidental syncing, but it cannot provide absolute isolation from a malicious plugin.
- Users are responsible for the rights to any transcript or cached media content they create or import.

## Limitations

- YouTube can refuse embedded playback because of publisher settings, login requirements, regional restrictions, or anti-bot checks.
- Bilibili can refuse or limit downloads and external playback because of publisher, account, region, copyright, membership, rate limits, or platform changes.
- Bilibili may expose visible captions only as pixels burned into the video. Those are not independent subtitle tracks; use SRT/VTT or import a creator-provided document and run transcript alignment.
- Direct Bilibili subtitle import depends on Bilibili's current web APIs and, when required, a valid isolated login session. Membership, rate-limit, regional, or platform changes can still prevent retrieval.
- Lingua Study does not include a YouTube login flow and does not use cookies to bypass restrictions.
- Public-caption import depends on an unofficial YouTube interface and may require a plugin update if YouTube changes it.
- `yt-dlp` is not bundled, installed, or updated by Lingua Study. Its fallback works only when a compatible executable is already available on the computer.
- YouTube videos without retrievable English captions still require a local English SRT/VTT file. Other languages are not silently machine-translated into English.
- Lingua Study does not operate a transcription service. Local Whisper alignment runs on the user's device after the required model files have been downloaded.
- The interface and translation target are currently Simplified Chinese.
- IELTS study tips are profile-based guidance, not claims about an official fixed IELTS vocabulary list.

## Development

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run check:release
```

The production build creates `main.js`; release packaging remains a separate maintainer action.

Maintainer instructions are available in [RELEASING.md](./RELEASING.md).

## License

[MIT](./LICENSE) © 2026 xiaobai. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for bundled and optional third-party components.
