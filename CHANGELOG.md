# Changelog

## Unreleased

- `login` accepts `--project <name>` and `--level read|manage|admin`. The default level is read. Start sends project, level, and the scopes for that level so older servers can still approve a session.
- `whoami` prints the granted project and level. A session with no level prints legacy.
- `erase` and `erasures` explain a level that is too low and a project outside the grant.
- Creating a project needs admin on All projects. The quickstart runs `login --level admin` with no project. `create` at read, manage, or a project-limited admin says to run `login --level admin`.
- Project keys use the `aapk_` prefix. `aap_` remains the poll token prefix.

## 0.5.42

- Document `query --group-by` with at most one `properties.<key>`, including examples. Rows use that column name, and a missing property groups as null.
- Add `sql <project> --sql '<statement>'` and `sql <project> -f file.sql` for the Pro `POST /sql` read. Human output is a table. `--json` prints the API response.
- `sql` accepts `--days` (default 7, max 90) or `--from` and `--to`, prints the returned window, and prints Retry-After seconds for `SQL_BUSY`, `SQL_COOLDOWN`, and `SQL_UPSTREAM_RATE_LIMITED`. Help states the window, one reference each to events and sessions (one join is allowed, no self-join), a plain integer LIMIT, and one query at a time. User SQL errors are HTTP 400 INVALID_SQL.
- Add `erase` and `erasures` for subject deletion. `erase` requires `--confirm erase` and exactly one of `--user-id`, `--session-id`, or `--email`. A missing idempotency key is generated and printed. `erasures` lists receipts and `erasures get` fetches one. `--json` prints the receipt.
- A missing `erasures:write` scope is HTTP 403 `FORBIDDEN` with message `agent session missing required scope: erasures:write`. The hourly cap is HTTP 429 `RATE_LIMITED` with `reason` `erasure_rate_limit`. Job status is `pending`, `running`, `completed`, or `failed`.

## 0.5.41

- Add `vitals` for the Pro `POST /vitals` read. Human output shows p75 with unit, rating, good/NI/poor share, n, skipped, CWV pass, and top poor targets. `--json` prints the API response.
- Hosted vitals examples now use `page_view` and `cwv_*`. Self-hosted core stores cwv_* on the `$web_vitals` event.
- Tracking snippets printed by `create` include `data-track-vitals="true"` unless the snippet already sets that flag.
