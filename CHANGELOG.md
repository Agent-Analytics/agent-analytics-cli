# Changelog

## Unreleased

- Document `query --group-by` with at most one `properties.<key>`, including examples. Rows use that column name, and a missing property groups as null.
- Add `sql <project> --sql '<statement>'` and `sql <project> -f file.sql` for the Pro `POST /sql` read. Human output is a table. `--json` prints the API response. Version is unchanged.
- `sql` accepts `--days` (default 7, max 90) or `--from` and `--to`, prints the returned window, and prints Retry-After seconds for `SQL_BUSY` and `SQL_COOLDOWN`. Help states the window, the 2-reference join limit, and one query at a time.

## 0.5.41

- Add `vitals` for the Pro `POST /vitals` read. Human output shows p75 with unit, rating, good/NI/poor share, n, skipped, CWV pass, and top poor targets. `--json` prints the API response.
- Hosted vitals examples now use `page_view` and `cwv_*`. Self-hosted core stores cwv_* on the `$web_vitals` event.
- Tracking snippets printed by `create` include `data-track-vitals="true"` unless the snippet already sets that flag.
