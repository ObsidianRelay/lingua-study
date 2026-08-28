# Changelog

All notable changes to Lingua Study are documented in this file.

## Unreleased

## 1.2.2 - 2026-08-28

### Changed

- The full ECDICT installer now prefers a prebuilt 24.4 MB ZIP package and automatically falls back to the official CSV source when the package is unavailable
- Added resumable downloads, up to three attempts, and live progress with download speed and estimated remaining time
- Added SHA-256 verification for the downloaded package and kept the previously installed dictionary available until the replacement is fully verified

### Fixed

- Hid the full-dictionary download button correctly after installation, including when Obsidian styles override the browser's default `hidden` behavior

## 1.2.0 - 2026-08-25

### Added

- Added optional automatic import when one standalone YouTube or Bilibili video link is pasted into a Markdown note
- Added a disabled-by-default setting to turn paste-to-import on or off
- Added compact **打开原视频** actions to YouTube, cached Bilibili, and online Bilibili players
- Added smooth transcript-only scrolling that keeps the playing segment centered
- Added the command **Lingua Study: 从哔哩哔哩链接创建学习内容**
- Added strict Bilibili BV, av, multi-part, and official b23.tv share-link recognition
- Added in-note fallback playback through Bilibili's official external player when no valid cache exists
- Added duplicate-player protection while preserving the original pasted link
- Added download and reuse of anonymous public Bilibili combined MP4 files in the operating system cache directory
- Added a controllable local Bilibili player with play, five-second seek, playback speed, and multi-segment continuation
- Added a random loopback-only playback channel with byte-range support so Obsidian can safely read system cache files outside the vault
- Added a settings button that opens the complete Bilibili cache folder for manual inspection and cleanup
- Added automatic fallback to Bilibili's official external player after cached files are removed
- Added a 2 GB per-video safety limit and strict Bilibili API/CDN allowlisting
- Added local SRT/VTT fallback and safe version 1 transcript storage for Bilibili videos
- Added Bilibili transcript timestamps, active-segment highlighting, and per-segment translation using the existing study interface
- Added per-segment transcript editing, original-text preservation, and one-click restoration
- Added CET-4, CET-6, TEM-4, TEM-8, IELTS, and TOEFL study profiles

### Changed

- Removed the bundled public InnerTube client key while retaining the independent keyless mobile-client caption fallback
- Replaced the fixed Live Preview recovery delay with focus, selection, mutation, and frame-driven editor-state monitoring that stops as soon as the study interface mounts
- New YouTube and Bilibili study blocks now always include a safe editor line after the closing code fence
- Added an immediate loading shell and reused cached transcript fingerprints when switching back to previously opened study notes
- Successful transcript imports now remove the matching long source link while preserving other text on the same line
- Replaced the former fixed-height transcript panel with a page-level transcript that has no internal scrolling window
- Existing Bilibili player-only blocks are upgraded in place with a transcript path instead of inserting a duplicate player
- Local Bilibili seeking now follows timestamps across progressive video segment boundaries
- Bilibili notes keep their transcript visible if the user removes the video cache and the player falls back to Bilibili's official iframe
- Removed the retired Distil Large V3 prototype and its obsolete settings while retaining optional local Whisper Base English alignment
- Removed the retired cloud speech-alignment prototype and its obsolete credentials
- Replaced the retired Chrome-helper prototype with direct subtitle requests and an isolated in-Obsidian Bilibili login session
- Added one-time cleanup limited to Lingua Study's former Distil Large V3, Base, Small, and Whisper runtime caches
- Keeps SRT/VTT, player-only, transcript editing, translation, video cache, and version 1 note compatibility

### Fixed

- Made the automated test runner use the operating system's temporary directory on macOS, Linux, and Windows
- Prevented CodeMirror from restoring `contain: paint` and clipping full-width transcript timestamps or text in Live Preview
- Restored the video player and transcript on the first return to YouTube and Bilibili study notes instead of leaving the `lingua-study` block in source-editing state
- Automatically repaired older standalone study notes whose closing code fence was the final character, without changing their block contents

## 1.1.0 - 2026-08-13

YouTube one-command import update.

### Added

- Added the command **Lingua Study: 从 YouTube 链接创建学习内容** for Markdown notes
- Added strict YouTube URL recognition for watch, youtu.be, Shorts, embed, live, and YouTube Music links
- Added direct import of public manual or automatic English captions without cookies, login, user API keys, telemetry, or a developer server
- Added local SRT/VTT fallback import with a 10 MB limit when public captions are unavailable
- Added a configurable transcript folder with `Lingua Study/Transcripts` as the default
- Added an independent YTranscript-compatible iPhone player fallback with MIT attribution
- Added optional automatic discovery and execution of a separately installed local `yt-dlp`
- Added an optional `yt-dlp` executable path setting for desktop environments where automatic discovery fails

### Changed

- Reuses valid version 1 transcript files and prevents duplicate study blocks
- Protects damaged or mismatched same-name files by creating a numbered filename instead of overwriting
- Cleans caption markup, entities, duplicate text, empty rows, and overlapping timelines before saving
- Keeps existing version 1 transcript files and legacy study blocks fully compatible
- Tries manual English subtitles before automatic English subtitles in both direct and yt-dlp routes
- Runs yt-dlp without a shell or user-wide configuration, reads subtitles from an isolated temporary folder, and removes temporary files after parsing

## 1.0.1 - 2026-08-12

Obsidian community review compatibility update.

### Changed

- Migrated the settings tab to Obsidian 1.13's declarative settings API
- Replaced the `builtin-modules` package with Node.js built-in module metadata
- Improved type safety when parsing player messages and translation responses
- Improved pop-out window compatibility for transcript fingerprints
- Added GitHub build provenance attestations for release assets
- Raised the minimum Obsidian version to 1.13.0

## 1.0.0 - 2026-08-12

First public release candidate.

### Added

- Timestamped local transcript rendering for YouTube videos
- Play, pause, five-second seek, playback speed, and timestamp navigation controls
- Automatic highlighting of the active transcript segment
- On-demand Simplified Chinese translation through DeepSeek or an OpenAI-compatible provider
- API key selection through Obsidian SecretStorage
- Independent translation cache with source-text fingerprints
- Chinese error messages for player, transcript, network, configuration, and cache failures
