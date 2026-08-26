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

Lingua Study already has an existing Community directory entry. Do not create a
second entry with **Plugins → New plugin**.

1. Sign in at https://community.obsidian.md.
2. Connect the `ObsidianRelay` GitHub account to the Community profile.
3. Claim the existing **Lingua Study** entry under **Available to claim**. If it
   has already been claimed, open **Plugins → Your entries → Lingua Study**.
4. Confirm that the linked repository is still
   `https://github.com/ObsidianRelay/lingua-study`. Recreating the repository
   must keep this exact owner and repository name; changing either requires an
   Obsidian directory administrator to migrate the entry.
5. Before publishing a release, run **Review branch** against the default branch
   and correct every reported error.
6. Publish the GitHub release whose tag exactly matches `manifest.json`.
7. On the Lingua Study entry, select **Check for new releases** and verify that
   the new version and all three release assets are detected.
8. Correct every remaining automated-review error. If a published release needs
   different source or assets, increment the patch version and publish a new
   matching GitHub release instead of replacing the existing release files.
9. Select **Request review** to request manual review.

Only the initial submission is required. Later plugin updates are distributed through new GitHub releases whose tag matches the version in `manifest.json`.

## 5. Future releases

For every release:

1. Update `manifest.json`, `package.json`, and `package-lock.json` to the same version.
2. Add the version and minimum Obsidian version to `versions.json`.
3. Update `CHANGELOG.md`.
4. Run all checks from section 1.
5. Commit and push the changes.
6. Create and push a matching version tag.
