# Changelog

## 0.5.41

- Add `vitals` for the Pro `POST /vitals` read. Human output shows p75 with unit, rating, good/NI/poor share, n, skipped, CWV pass, and top poor targets. `--json` prints the API response.
- Hosted vitals examples now use `page_view` and `cwv_*`. Self-hosted core stores cwv_* on the `$web_vitals` event.
- Tracking snippets printed by `create` include `data-track-vitals="true"` unless the snippet already sets that flag.
