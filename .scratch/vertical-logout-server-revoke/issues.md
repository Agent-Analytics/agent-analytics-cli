---
title: Vertical logout server-side session revoke issues
label: ready-for-human
source_prd: /Users/danny/dev/agent-analytics/agent-analytics-cli/.scratch/vertical-logout-server-revoke/prd.md
source_plan: /Users/danny/dev/agent-analytics/agent-analytics-cli/.hermes/plans/2026-05-09_133423-cli-logout-server-revoke.md
---

# Issues: Vertical logout server-side session revoke

These are tracer-bullet vertical slices. Each slice should be independently verifiable end-to-end. This is cross-repo, but scoped: fix/logout-doc surfaces only where they implement or mention logout/session behavior.

## 1. Cross-repo logout surface inventory

Type: AFK

Blocked by: None - can start immediately

User stories covered: 24, 27, 29, 40

Status: Done

### What to build

Inspect relevant Agent Analytics repos/surfaces for logout/session behavior before editing. Confirm what is already implemented for browser/dashboard logout, especially the GET-to-POST hardening, and identify exactly which CLI/docs/plugin/package surfaces still need changes.

### Acceptance criteria

- [x] Inventory identifies CLI logout implementation status.
- [x] Inventory confirms existing `POST /agent-sessions/revoke` is single-session and already implemented.
- [x] Inventory confirms browser/dashboard logout status and whether GET-to-POST hardening is already implemented.
- [x] Inventory identifies stale docs/help/package/plugin copy about logout/session behavior.
- [x] Inventory explicitly separates browser sessions, CLI agent sessions, and dashboard Settings disconnect.
- [x] Handoff lists surfaces that need code changes, docs-only changes, and no changes.

### Verification notes

- Subagent inventory found CLI logout was local-only, `POST /agent-sessions/revoke` was already implemented as a single account-scoped session revoke, and browser `/auth/logout` still allowed mutating GET.
- Inventory separated browser sessions, CLI agent sessions, and dashboard Settings Agent Sessions disconnect.
- No-op surfaces identified: existing revoke endpoint, Dashboard Settings disconnect, OpenAPI revoke docs, CLI package metadata, MCP, public skill, landing, Paperclip docs, and macOS docs.

## 2. CLI logout revokes its stored agent session before local clear

Type: AFK

Blocked by: 1. Cross-repo logout surface inventory

User stories covered: 1, 2, 3, 4, 5, 8, 10, 11, 13, 14, 15, 16, 22, 23, 31, 32, 33, 34, 35, 39

Status: Done

### What to build

Wire `agent-analytics logout` to call the existing single-session agent-session revoke endpoint when the stored CLI auth includes an agent-session id and usable token material. Revoke must happen before local auth is cleared. Local cleanup must happen regardless of revoke outcome.

### Acceptance criteria

- [x] Logout reads stored auth before clearing local state.
- [x] Stored agent session with id and token material triggers `POST /agent-sessions/revoke`.
- [x] Revoke request sends `{ session_id }` for the stored CLI agent session.
- [x] Revoke uses existing API-client auth behavior.
- [x] Local auth is cleared when revoke succeeds.
- [x] Local auth is cleared when revoke fails.
- [x] Revoke failure exits 0 when local cleanup succeeds.
- [x] Logout does not call revoke when there is no stored auth.
- [x] Logout does not call revoke when there is no session id.
- [x] Logout does not call revoke when there is no usable token material.
- [x] No access token, refresh token, API key, or full keyring payload appears in stdout/stderr.
- [x] Auth status, login, refresh, and other auth-required commands keep current behavior.

### Verification notes

- Implemented in `agent-analytics-cli/bin/cli.mjs` with focused tests in `test/cli.test.mjs`.
- Spec review: PASS.
- Code quality review: APPROVED.
- Tests: focused logout tests pass; full CLI `npm test` passes with 168 tests.

## 3. Native/file credential cleanup stays safe during logout

Type: AFK

Blocked by: 2. CLI logout revokes its stored agent session before local clear

User stories covered: 6, 7, 12, 15, 30, 36, 37

Status: Done

### What to build

Make sure logout works correctly for both file-backed and native-keyring-backed agent sessions. Use the existing credential-store abstraction and fake keyring seam. If native keyring read fails before the session id/token can be discovered, skip server revoke and still clear local metadata/keyring references where possible.

### Acceptance criteria

- [x] File-backed stored agent session can be revoked and cleared.
- [x] Native-backed stored agent session can be read, revoked, and cleared using fake keyring tests.
- [x] Native keyring read failure does not block local cleanup where cleanup is possible.
- [x] Logout does not touch real OS credentials in unit tests.
- [x] Explicit `--config-dir` logout still clears only the selected config dir.
- [x] No-auth/idempotent logout behavior remains unchanged.

### Verification notes

- Implemented best-effort native credential cleanup in `agent-analytics-cli/lib/config.mjs` and tests in `test/cli.test.mjs` plus `test/config.test.mjs`.
- Spec review: PASS.
- Code quality review: APPROVED.
- Tests: fake-keyring/native/file/logout tests pass; full CLI `npm test` passes with 168 tests.

## 4. Browser/dashboard logout alignment check

Type: AFK

Blocked by: 1. Cross-repo logout surface inventory

User stories covered: 17, 18, 19, 20, 21, 24, 38, 39

Status: Done

### What to build

Verify browser/dashboard logout hardening as part of the same vertical logout story. If code inspection shows a remaining gap, patch it. If it is already implemented, document that and avoid duplicate work. Browser logout must revoke only the current browser session and must not revoke CLI agent sessions or unrelated devices.

### Acceptance criteria

- [x] Browser/dashboard logout uses POST semantics where the product hardening requires it.
- [x] Browser/dashboard logout invalidates only the current browser session.
- [x] Browser/dashboard logout does not revoke CLI agent sessions.
- [x] Browser/dashboard logout does not revoke unrelated browser sessions or other devices.
- [x] Dashboard Settings remains the explicit surface for disconnecting selected agent sessions.
- [x] Tests are added or confirmed for browser/dashboard logout behavior where executable code is touched.
- [x] No logout-all-devices behavior is introduced.

### Verification notes

- Implemented in `agent-analytics-hosted/hosted/entry.js`, `agent-analytics-hosted/hosted/__tests__/entry-routes.test.js`, `dashboard/src/api.js`, `dashboard/src/App.jsx`, and `dashboard/src/App.setup-status.test.js`.
- `GET /auth/logout` is now non-mutating 405 with `Allow: POST`; `POST /auth/logout` clears only current browser session cookie/session.
- Dashboard logout callers now send POST. Dashboard Settings remains the explicit Agent Sessions disconnect surface.
- Spec review: PASS. Code quality review: APPROVED.
- Tests: hosted entry route focused tests pass; dashboard focused and full tests pass; hosted full tests pass.

## 5. Docs/help/package copy reflects vertical logout truth

Type: AFK

Blocked by:

- 2. CLI logout revokes its stored agent session before local clear
- 4. Browser/dashboard logout alignment check

User stories covered: 25, 26, 27, 28, 38

Status: Done

### What to build

Update user-facing copy that describes logout/session semantics. Remove stale claims that CLI logout is local-only or does not revoke remote sessions once the implementation revokes server-side agent sessions. Keep copy precise; do not expand into broad marketing or unrelated landing/blog work.

### Acceptance criteria

- [x] CLI README no longer says logout “does not revoke remote sessions.”
- [x] CLI help text accurately describes logout as clearing local auth and revoking the stored agent session when possible.
- [x] Public/open-source docs or plugin/package docs with logout/session claims are updated if found in the inventory.
- [x] No docs imply browser logout disconnects CLI agents.
- [x] No docs imply normal logout is logout-all-devices.
- [x] Docs avoid exposing implementation secrets or token examples beyond safe placeholders.
- [x] Search confirms no stale local-only logout claims remain in touched repos.

### Verification notes

- Updated CLI README/help, hosted architecture, public docs authentication, English/Hebrew/Chinese CLI references, localized authentication docs, and generated `llms-full.txt`.
- Initial spec review found stale public docs claims; follow-up patched them.
- Final validation found no tracked stale logout copy in source/package files. Only ignored/generated `.astro/data-store.json` cache contained stale strings.
- Docs `npm run test:copy` and `npm run build` pass.

## 6. Release validation and handoff

Type: AFK

Blocked by:

- 2. CLI logout revokes its stored agent session before local clear
- 3. Native/file credential cleanup stays safe during logout
- 4. Browser/dashboard logout alignment check
- 5. Docs/help/package copy reflects vertical logout truth

User stories covered: 29, 30, 31

Status: Done

### What to build

Run focused and full validation for every touched repo/surface, then produce a concise handoff with changed surfaces, tests, and any confirmed no-op surfaces.

### Acceptance criteria

- [x] Focused CLI logout tests pass.
- [x] Full CLI `npm test` passes.
- [x] `git diff --check` passes in touched repos.
- [x] `npm pack --dry-run --json` passes for CLI if release prep follows.
- [x] Browser/dashboard tests pass if that repo is touched.
- [x] Docs/package search for stale logout/session copy passes.
- [x] Handoff lists changed files by repo.
- [x] Handoff lists tests run and results.
- [x] Handoff calls out any surfaces inspected and intentionally left unchanged.

### Verification notes

- CLI focused logout tests: `node --test --test-name-pattern logout test/*.test.mjs` passed, 22 tests.
- CLI full tests: `npm test` passed, 168 tests.
- CLI pack dry run: `npm pack --dry-run --json` passed for `@agent-analytics/cli@0.5.31`.
- Hosted full tests: `npm test` passed, 69 files / 1031 tests.
- Dashboard full tests: `npm test` passed, 12 files / 52 tests.
- Docs copy/build: `npm run test:copy` passed; `npm run build` passed.
- `git diff --check` passed in CLI, hosted, dashboard, and docs.
- Changed tracked files by repo:
  - CLI: `README.md`, `bin/cli.mjs`, `lib/config.mjs`, `test/cli.test.mjs`, `test/config.test.mjs`.
  - Hosted: `ARCHITECTURE.md`, `hosted/__tests__/entry-routes.test.js`, `hosted/entry.js`.
  - Dashboard: `src/App.jsx`, `src/App.setup-status.test.js`, `src/api.js`.
  - Docs: `llms-full.txt`, `plans/2026-04-20-portfolio-context.md`, `src/content/docs/reference/authentication.md`, `src/content/docs/reference/cli.md`, `src/content/docs/he/reference/authentication.md`, `src/content/docs/he/reference/cli.md`, `src/content/docs/zh/reference/authentication.md`, `src/content/docs/zh/reference/cli.md`.
- Inspected and intentionally unchanged: existing `/agent-sessions/revoke` endpoint, Dashboard Settings Agent Sessions disconnect, OpenAPI revoke docs, plugin docs/code, MCP, public skill, landing, macOS docs.
