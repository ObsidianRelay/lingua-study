# Changelog

All notable changes to Lingua Study are documented in this file.

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
