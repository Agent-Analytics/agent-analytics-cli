# Changelog

## Unreleased

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
