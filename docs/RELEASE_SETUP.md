# Release Setup Guide

This guide explains how to release new versions of `@agent-analytics/cli` using GitHub Actions and npm trusted publishing.

## Quick release flow

Release from `main` only.

1. Update the version in `package.json`
2. Commit the release to `main`
3. Push `main`
4. Tag that exact commit with `v<version>`
5. Push the tag
6. GitHub Actions publishes to npm automatically

Example:

```bash
git fetch origin --prune
git switch main
git pull --ff-only origin main

test -z "$(git status --porcelain)"

VERSION=$(node -p "require('./package.json').version")

git add package.json README.md .github/workflows/npm-publish.yml docs/RELEASE_SETUP.md
git commit -m "ci: add npm trusted publishing workflow"
git push origin main

git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
```

The workflow verifies:
- the release/tag points at the current `origin/main` commit
- `package.json` version matches the requested/tagged version
- tests pass
- the package can be packed successfully

## One-time npm setup

On npmjs.com for `@agent-analytics/cli`:

1. Open package settings
2. Go to Trusted publishers
3. Add:
   - GitHub owner: `Agent-Analytics`
   - Repository: `agent-analytics-cli`
   - Workflow file: `npm-publish.yml`

After that, no OTP prompt or manual `npm publish` should be needed.

## Manual dispatch

You can also run the workflow manually from GitHub Actions with a `version` input.
That version must match `package.json`, and the workflow must run from the current `main` commit.

## Troubleshooting

- 403 from npm: trusted publisher is not configured correctly
- Version mismatch: tag/input must match `package.json`
- Release rejected: tag or dispatch was not run from current `origin/main`
