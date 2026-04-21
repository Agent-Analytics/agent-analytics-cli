# Release Setup Guide

Trusted publishing via GitHub Actions is currently disabled for `@agent-analytics/cli`.

npm trusted publishing for this package is failing with `E404 Not Found - PUT https://registry.npmjs.org/@agent-analytics%2fcli` even after confirming:
- the package exists on npm
- package ownership/collaborators are correct
- the trusted publisher entry is saved for `Agent-Analytics/agent-analytics-cli`
- the workflow uses `id-token: write`
- GitHub Actions can sign provenance successfully

An npm support ticket has been submitted. Until npm resolves the package-side trusted-publishing issue, do not use `.github/workflows/npm-publish.yml` for releases.

## Current release flow: manual publish only

Release from `main` only.

1. Update the version in `package.json`
2. Commit the release to `main`
3. Push `main`
4. Run `npm publish --access public`
5. Complete npm 2FA / OTP when prompted
6. Tag the published commit with `v<version>`
7. Push the tag
8. Optionally create a GitHub release manually

Example:

```bash
git fetch origin --prune
git switch main
git pull --ff-only origin main

test -z "$(git status --porcelain)"

VERSION=$(node -p "require('./package.json').version")

git add package.json README.md
git commit -m "chore: release v$VERSION"
git push origin main

npm publish --access public
# complete OTP / 2FA when prompted

git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
```

## Disabled workflow

`.github/workflows/npm-publish.yml` is intentionally disabled and kept only as a reminder of the blocked trusted-publishing path.

Do not re-enable it unless npm support confirms the package-side issue is fixed and a fresh trusted-publishing test succeeds.

## Troubleshooting

- `EOTP`: complete npm 2FA and rerun `npm publish`
- `E409`: that version already exists on npm; bump `package.json` and try again
- `E404` from GitHub trusted publishing: expected for now on this package; use manual publish instead
