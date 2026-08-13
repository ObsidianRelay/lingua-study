# Releasing Lingua Study

This document is for the project maintainer.

## 1. Run local checks

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm test
npm run build
npm run check:release
git diff --check
```

Confirm that `data.json`, `main.js`, `node_modules`, `.test-dist`, transcripts, translation caches, and API keys are not tracked by Git.

## 2. Publish the source repository

Create an empty public repository named `lingua-study` under the `ObsidianRelay` GitHub account. Do not ask GitHub to add another README, license, or `.gitignore` because those files already exist locally.

Push the local `main` branch to:

```text
https://github.com/ObsidianRelay/lingua-study
```

## 3. Create a release version

The release tag must exactly match `manifest.json`. For example, use `1.0.1`, without a `v` prefix.

Pushing the tag starts `.github/workflows/release.yml`. The workflow runs the tests, builds the production bundle, and creates a GitHub release containing exactly:

- `main.js`
- `manifest.json`
- `styles.css`

Verify the GitHub Actions run and download the three release assets once to confirm they are present.

## 4. Submit to the Obsidian Community directory

1. Sign in at https://community.obsidian.md.
2. Link the `ObsidianRelay` GitHub account.
3. Open **Plugins → New plugin**.
4. Submit `https://github.com/ObsidianRelay/lingua-study`.
5. Review the automated checks and correct every reported error before publishing.

Only the initial submission is required. Later plugin updates are distributed through new GitHub releases whose tag matches the version in `manifest.json`.

## 5. Future releases

For every release:

1. Update `manifest.json`, `package.json`, and `package-lock.json` to the same version.
2. Add the version and minimum Obsidian version to `versions.json`.
3. Update `CHANGELOG.md`.
4. Run all checks from section 1.
5. Commit and push the changes.
6. Create and push a matching version tag.
