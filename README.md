# Agent Analytics CLI

Stop juggling dashboards. Let your agent do it.

Analytics your AI agent can actually use — track, analyze, experiment, optimize.

## Quick Start

Try the seeded public demo without signing in:

```bash
npx --yes @agent-analytics/cli@0.5.42 demo
npx --yes @agent-analytics/cli@0.5.42 --demo projects
npx --yes @agent-analytics/cli@0.5.42 --demo funnel agentanalytics-demo --steps "page_view,signup_started,signup"
npx --yes @agent-analytics/cli@0.5.42 --demo experiments list agentanalytics-demo
```

Demo mode fetches a short-lived read-only agent session from the hosted API. It does not write local CLI config and blocks mutating commands before making API requests.

Get the fastest path to useful analytics for a project you own:

```bash
# 1. First project: admin on All projects. Do not pass --project
npx --yes @agent-analytics/cli@0.5.42 login --level admin

# 2. Create a project; --domain is the primary surface URL/origin for setup
npx --yes @agent-analytics/cli@0.5.42 create my-site --domain https://mysite.com

# 3. Watch it live
npx --yes @agent-analytics/cli@0.5.42 live

# Optional detached login for remote or issue-based agent work
npx --yes @agent-analytics/cli@0.5.42 login --detached

# Optional: clear local auth and revoke the stored agent session when possible
npx --yes @agent-analytics/cli@0.5.42 logout
```

## Commands

```bash
# Setup
login                            Browser approval. Level defaults to read
login --level admin              First project. Admin on All projects. Do not pass --project
login --project <name> --level <level>
                                 Ask for one project at read, manage, or admin
login --detached                 Detached handoff: print approval URL and exit
login --detached --wait          Detached approval with polling for local shells
upgrade-link --detached          Print a human Pro payment handoff link
upgrade-link --wait              Print the handoff link and wait for Pro activation
logout                           Clear local auth and revoke the stored agent session when possible
auth status                      Show local auth path and expiry metadata
create <name> --domain <url>     Create a project with a primary surface URL/origin and get your tracking snippet
projects                         List all your projects with IDs
project <project>                Get project details by exact name or ID
update <project>                 Update project name or origins by exact name or ID
delete <project>                 Delete a project by exact name or ID

# Analytics
all-sites                        Historical summary across all projects
bot-traffic <name>               Filtered automated traffic by project or --all
stats <name>                     Overview: events, users, daily trends, countries
live [name]                      Real-time terminal dashboard across all projects
insights <name>                  Period-over-period comparison with trends
breakdown <name> --property path Top pages, referrers, UTM sources, countries
pages <name>                     Entry/exit page performance & bounce rates
paths <name> --goal <event>      Bounded entry-to-goal/drop-off session paths
heatmap <name>                   Peak hours & busiest days
funnel <name> --steps-json <arg> Structured funnel analysis with raw-vs-strict diagnostics
funnel <name> --steps a,b,c      Legacy comma-separated funnel steps
retention <name>                 Cohort retention: % of users who return
sessions-dist <name>             Session duration distribution
events <name>                    Raw event log, including each event's country
errors <name> --since 7d         Grouped $error events (Pro). Optional --until, --new-since, --limit
vitals <name>                    Pro Core Web Vitals on page_view: p75, rating, good/NI/poor share, CWV pass. --days, --from, --to, --by device|path, --limit, --json
sessions <name>                  Individual session records
query <name>                     Flexible analytics query (metrics, group_by, filters, numeric property aggs). group_by allows one properties.<key>
sql <name>                       Pro read-only SQL on events and sessions. --sql '<statement>' or -f file.sql, --days (default 7, max 90) or --from/--to, and --json
compare <name>                   Free before/after read of unique converters, or --metric 'p75(cwv_lcp)' --metric-event page_view --better lower. A 7-day read should run on ship day + 8
annotate <name> --title <text>   Append one project annotation without replacing context
properties <name>                Discover event names & property keys
properties-received <name>       Property keys grouped by received event name
context get <name>               Read stored goals, activation events, event glossary, and annotations
context set <name> --json '{...}' Store compact goals, activation events, glossary, and annotations
portfolio-context get            Read stored account portfolio context
portfolio-context set --json '{...}'
                                 Store shared goals, surface roles, milestones, and glossary
portfolios list                  List identity lookup portfolios
portfolios create <slug> --name "Portfolio" --projects app,docs [--move]
                                 Create a project portfolio; --move allows reassigning projects
portfolios get <slug-or-id>      Show a portfolio and its member projects
portfolios update <slug-or-id>   Update name and/or projects with optional --move
portfolios delete <slug-or-id>   Delete a portfolio

# Experiments — A/B testing your agent can actually use
experiments list <project>       List experiments
experiments create <project>     Create experiment
experiments get <id>             Get experiment with results & significance
experiments complete <id>        Ship the winner

# Session replay — explicit opt-in; Pro or complimentary projects
replays settings <project>       Show replay settings, privacy defaults, and limits
replays enable <project>         Enable server eligibility; separate replay.js installation is still required
replays disable <project>        Stop new starts and upload authorizations
replays list [project]           List bounded replay metadata; add --session <id> to find linked segments
replays get <id>                 Get one replay and its committed chunk boundaries
replays open <id>                Print a short-lived sandboxed viewer URL
replays open --session <id> --project <project>
                                 Find the newest linked segment and open it
replays delete <id>              Delete one replay immediately
replays delete --all --confirm delete_replay_data [--project <project>]
                                 Disable replay and delete all matching replay data
replays usage                    Show retained storage and rolling 30-day ingestion

# Account
whoami                           Show the account, granted project, and level. custom prints its scopes
erase <project>                  Delete one visitor. Needs manage or admin, --confirm erase, and one subject
erasures <project>               List the 100 newest erasure receipts
erasures get <id>                Show one erasure receipt
feedback --message "..."         Send product/process feedback
logout                           Clear local auth and revoke the stored agent session when possible
```

The CLI is agent-session-first. It stores a renewable Agent Analytics session after browser approval and uses that bearer auth for CLI API calls. By default, macOS and Windows store the session secret in the OS keychain; Linux and headless environments use the CLI config file. Existing file-stored sessions migrate automatically to native storage on the next authenticated command when native storage is available. Runtime-specific HTTP integrations should stay tied to the approved agent session, project setup, and project context rather than treating the CLI as a manual key setup path.

Replay reads are included in read. Enabling or deleting replays needs manage or admin (`login --level manage`). If the saved session predates replay support, run `login` again. Replay remains disabled by default even for eligible accounts, and enabling it does not modify or activate the base tracker. A customer must separately install:

```html
<script src="https://api.agentanalytics.sh/replay.js" data-token="aat_PROJECT_TOKEN"></script>
```

Use `--recording-start after_consent` when recording must wait for site consent, then call `window.aaReplay.consent()` from the site's consent flow. All form/contenteditable values remain mandatorily masked. Use `--mask`, `--block`, and `--ignore` for comma-separated domain-specific selectors; automatic PII redaction is defense in depth, not a substitute for those selectors.

For sites with CSP, allow the Agent Analytics API in `script-src` and `connect-src`, the account R2 S3 endpoint (`https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com`) in `connect-src`, and `blob:` in `worker-src`. Replay fails closed when those permissions or required browser capabilities are unavailable.

Check local storage state without printing secrets:

```bash
npx --yes @agent-analytics/cli@0.5.42 auth status
```

Credential storage is automatic. Only use `AGENT_ANALYTICS_CREDENTIAL_STORE` for troubleshooting or managed runtimes:

- `file`: force config-file storage
- `native`: require OS keychain and fail if unavailable
- `auto`: default; usually not needed

When a free account hits a Pro-only analytics task, run an explicit upgrade handoff:

```bash
npx --yes @agent-analytics/cli@0.5.42 upgrade-link --detached
```

The CLI prints an `app.agentanalytics.sh` link. The human confirms the logged-in dashboard account, pays in Lemon Squeezy, and returns to the agent after Pro activates. Use `upgrade-link --wait` when the local shell should keep polling for activation.


For machine-readable pricing, current account status, and the human handoff, use:

```bash
agent-analytics upgrade-link --detached --json
agent-analytics account-usage --json
```

Both read the same `GET /account/usage` contract. `payment.next_action` is a human browser action, not permission to charge. Poll `account-usage --json` after checkout, with the returned interval and bounded wait, and retry the original task when `payment.status.can_retry_pro_task` is true. Pending checkout does not prove payment. Complimentary Pro is active access without subscription charges. JSON handoffs require `--detached`; use the existing text `--wait` flow for interactive waiting. The browser link uses a fixed reason and never includes the original command. Keep the full retry command in the agent session; legacy `--reason` and `--command` arguments are accepted but omitted from the handoff.

MCP clients use the read-only `account_usage` tool with `account:read`. Paid tools check current Hosted entitlement on each call, so an upgraded account can retry without reconnecting MCP.

Project management commands accept exact project names or project IDs. The `--domain` value on `create` remains the required primary surface URL/origin for setup; it is not the project identity. For local browser QA, treat localhost and preview deployments as setup/testing surfaces and update allowed origins through the CLI while keeping the production origin:

```bash
npx --yes @agent-analytics/cli@0.5.42 update stylio --origins 'https://stylio.app,http://lvh.me:3101'
```

For tracker setup, start from the product action you want your agent to optimize. Do not add custom duplicates for automatic tracker signals such as `page_view`, path, referrer, UTMs, device/browser fields, country, session IDs, session count, days since first visit, or first-touch attribution. Prefer `data-aa-event`, `data-aa-impression`, `window.aa.track(...)`, server-side durable outcome tracking, or script opt-ins only when they unlock a concrete decision.

The tracking snippet printed by `create` includes `data-track-vitals="true"` unless that snippet already sets `data-track-vitals`. New installs then collect Core Web Vitals on `page_view`. A snippet that already sets `data-track-vitals="false"` stays off. Replay is a separate `replay.js` tag and does not use this flag.

Bounce metrics (`insights`, `pages`, `sessions`) treat a session as a bounce when it has only non-interactive events:
`page_view`, `$impression`, `$scroll_depth`, `$error`, `$time_on_page`, `$performance`, `$web_vitals`.

`query` keeps `/events` raw and lossless, but `/query` uses activation-safe dedupe (`session_then_user`) as the default for `event_count`: session-backed rows count by session, no-session rows fall back to `user_id` only when that user has no session-backed row in the same filtered/grouped result set, and fully anonymous rows fall back to event `id`. For recent signup or ingestion debugging, check `events <project> --event <actual_event_name>` first, then use `query` after verifying the raw event names the project emits. `--count-mode` only affects `event_count`. Use `--count-mode raw` when you need the old ingested-row count for debugging or audit work:

```bash
npx --yes @agent-analytics/cli@0.5.42 query my-site --metrics event_count --count-mode raw
```

`sum`, `avg`, `p50`, `p75`, and `p95` are numeric property metrics on the same Pro `POST /query` read. They require `--property <key>`. The key is the event property itself (`cwv_lcp`, `revenue`): letters, numbers, and underscores, at most 128 characters, with no `properties.` prefix. Only JSON numbers are aggregated. Each row includes the requested metric plus `n` and `skipped`. An empty aggregation row prints `n` 0 and `skipped` 0. Percentiles are nearest-rank: `percentile_method` is `nearest_rank` when a percentile is requested, and `null` for sum or avg only. Hosted stores `cwv_lcp`, `cwv_inp`, `cwv_cls`, `cwv_fcp`, and `cwv_ttfb` on `page_view`. Self-hosted core stores cwv_* on the `$web_vitals` event. The tracker sends vitals only when the install snippet sets `data-track-vitals="true"`. For rating, good/NI/poor share, and CWV pass, use `vitals`.

```bash
npx --yes @agent-analytics/cli@0.5.42 query my-site --metrics p75 --property cwv_lcp --filter '[{"field":"event","op":"eq","value":"page_view"}]'
npx --yes @agent-analytics/cli@0.5.42 vitals my-site --days 7
npx --yes @agent-analytics/cli@0.5.42 query shop --metrics sum,avg --property revenue --filter '[{"field":"event","op":"eq","value":"purchase"}]'
```

`query --group-by` accepts `event`, `date`, `user_id`, `session_id`, `country`, and at most one `properties.<key>`. The key uses the same rules as a `properties.<key>` filter: letters, numbers, underscores, dots, and hyphens, 1 to 128 characters. Rows include that value under the column name `properties.<key>`. A missing property groups as null. Two `properties.*` entries are HTTP 400 `INVALID_GROUP_BY`. The route stays Pro. Prefer `query` for grouping by a property. Use `sql` only when `query` cannot express the question.

```bash
npx --yes @agent-analytics/cli@0.5.42 query my-site --group-by date,properties.path --metrics event_count,unique_users
npx --yes @agent-analytics/cli@0.5.42 query my-site --group-by properties.plan --metrics event_count --filter '[{"field":"event","op":"eq","value":"signup"}]'
```

`sql` is a Pro read on `POST /sql`. A successful call counts as one metered read. A free account gets HTTP 403 `PRO_REQUIRED`, and that call is not metered. Pass one `SELECT` with `--sql`, or read it from a file with `-f` or `--file`. Pass the statement as the flag value. Do not concatenate untrusted shell input into the command. The statement must not start with `WITH`, and it must be at most 20 KB. The API allows only `events` and `sessions`. Each of `events` and `sessions` may be referenced at most once in a statement. One join of `events` to `sessions` is allowed. A self-join is rejected. A recursive CTE is rejected. A `LIMIT` clause must be a plain integer. User SQL errors return HTTP 400 `INVALID_SQL`. One `/sql` query runs at a time per account. A second call returns HTTP 429 `SQL_BUSY` with `Retry-After`, and the CLI prints those seconds. HTTP 429 `SQL_UPSTREAM_RATE_LIMITED` also includes `Retry-After`, and the CLI prints those seconds the same way.

`--days` defaults to 7 and must be an integer from 1 to 90. It is sent as `days`. `--from` and `--to` use the same names as `query`: `YYYY-MM-DD` dates, sent as `date_from` and `date_to`. The span is at most 90 days. Pass `--days` or both dates, not both forms. The server always applies this window to `events` by timestamp and `sessions` by start time. The human output prints the returned `window`.

`events` columns: `id`, `event`, `properties`, `user_id`, `session_id`, `timestamp`, `date`, `country`. `sessions` columns: `session_id`, `user_id`, `project_id`, `start_time`, `end_time`, `duration`, `entry_page`, `exit_page`, `event_count`, `is_bounce`, `date`. `resolved_user_id` is not exposed. `properties` is a JSON string. The server returns at most 1,000 rows. `truncated` is true when more rows existed. `statistics` includes `elapsed_ms`, `rows_read`, and `expensive` (`expensive` is true when `rows_read` is over 1,000,000). Timeout is 10 seconds (HTTP 504 `SQL_TIMEOUT`). The query can still finish inside D1 after that timeout. The account rate limit is 10 calls per minute (HTTP 429 `RATE_LIMITED`, reason `sql_rate_limit`). A query that reads more than 5,000,000 rows starts a 60 second `SQL_COOLDOWN` (HTTP 429, `Retry-After`). The monthly budget stays 100,000,000 rows read (HTTP 429 `SQL_BUDGET`). Errors also include `INVALID_WINDOW` (400) and `SQL_UNAVAILABLE` (503). Without `--json`, the CLI prints a table and shows SQL NULL as `null`. `--json` prints the API body.

```bash
npx --yes @agent-analytics/cli@0.5.42 sql my-site --sql 'SELECT event, COUNT(*) AS n FROM events GROUP BY event'
npx --yes @agent-analytics/cli@0.5.42 sql my-site --days 30 --sql 'SELECT event, COUNT(*) AS n FROM events GROUP BY event'
npx --yes @agent-analytics/cli@0.5.42 sql my-site --from 2026-11-01 --to 2026-11-12 --sql 'SELECT date, COUNT(*) AS n FROM events GROUP BY date'
npx --yes @agent-analytics/cli@0.5.42 sql my-site -f query.sql
npx --yes @agent-analytics/cli@0.5.42 sql my-site --sql 'SELECT date, COUNT(*) AS n FROM events GROUP BY date' --json
```

Hosted vitals queries use `page_view`. If `n` is 0, the project is not sending `cwv_*` yet.

`funnel` is for ordered conversion, `query` is for aggregate slicing/grouping, and `paths` is for bounded session-local journey exploration. For precise funnels, prefer structured JSON steps with per-step filters:

```bash
cat > funnel.json <<'JSON'
{
  "steps": [
    {
      "event": "page_view",
      "filters": [{ "field": "properties.path", "op": "prefix", "value": "/products" }]
    },
    { "event": "add_to_cart" },
    { "event": "purchase" }
  ]
}
JSON

npx --yes @agent-analytics/cli@0.5.42 funnel shop --steps-json ./funnel.json --json
```

Funnel filters use canonical `properties.<key>` fields and support `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `contains`, `prefix`, and `in`. The JSON output includes `steps_source`, `identity_basis`, `raw_activity`, `joinable_entities`, `strict_survivors`, `conversion_rates`, `warnings`, and `caveats` so your agent can separate “events exist” from “entities survived the strict ordered funnel.” `--steps a,b,c` remains supported for quick legacy checks. If no step source is passed, or if you pass `--from-context`, the API falls back to bare `project_context.activation_events`; treat that as a convenience starting point, not a precision source.

`paths` accepts bounded lookback windows `1d`, `7d`, `14d`, `30d`, and `90d`. Use `1d` for fresh local instrumentation checks, then move to a longer window once there is enough traffic.

Property filters must use canonical `properties.*` fields. Built-in filter fields are only `event`, `user_id`, `date`, `country`, `session_id`, and `timestamp`. Example:

```bash
npx --yes @agent-analytics/cli@0.5.42 query my-site --filter '[{"field":"properties.referrer","op":"contains","value":"clawflows.com"}]'
```

Invalid filter fields now fail loudly and return property discovery guidance instead of being silently ignored.

Identity lookup with `--email` sends the normalized email to Agent Analytics over HTTPS for server-side project-scoped HMAC matching. The CLI no longer computes or sends a local `email_hash`; raw email is not stored in event rows or profile traits.

Store compact project context when the product has custom goals, activation events, event meanings, or date annotations that should travel with analytics results. Keep this short because project-scoped analytics endpoints include it as `project_context`. `context set` accepts an encoded JSON body up to 512KB.

Use annotations for major product changes that could explain later graph movement: landing page, pricing, onboarding, feature, release, or experiment changes. Do not store git commit logs, noisy edits, temporary metric notes, PII, secrets, or long release notes. Direct `context get` returns all annotations; project-scoped analytics responses include annotations only for the requested analytics date range plus one day before and after.

Before setting or refreshing the glossary, inspect the project's current event names:

```bash
npx --yes @agent-analytics/cli@0.5.42 properties my-site
npx --yes @agent-analytics/cli@0.5.42 properties-received my-site
npx --yes @agent-analytics/cli@0.5.42 context set my-site --json '{
  "goals": ["Increase activated Agent Analytics accounts"],
  "activation_events": ["signup_completed", "project_created", "first_event_received"],
  "glossary": [
    {
      "event_name": "first_event_received",
      "term": "AA Activation",
      "definition": "Signup, project created, and first event received."
    }
  ],
  "annotations": [
    {
      "occurred_at": "2026-04-25T13:00:00.000Z",
      "title": "Changed pricing page offer",
      "note": "Moved annual plan discount above the fold."
    }
  ]
}'
```

`annotate` appends one annotation on `POST /project-context/annotations`. It does not replace goals, glossary, activation events, or earlier annotations. The same `occurred_at` and title returns HTTP 200 with `appended: false` and the stored annotation. A project can hold 100 annotations; the next append returns HTTP 409. `context set` still replaces the whole document.

```bash
npx --yes @agent-analytics/cli@0.5.42 annotate my-site --title "Changed pricing page offer" --note "Moved annual plan discount above the fold." --at 2026-04-25T13:00:00.000Z
```

`compare` is a free read on `POST /compare`. A successful call counts as one metered read. The goal is counted as unique converters (`count_mode` `unique_users`): a user who fires the goal 3 times counts once. `rate` is `goal_converters / denominator_unique_users`. Pass `--ship-date` and optional `--days` (`window_days`, a multiple of 7 from 1 to 90, default 7), or pass both windows with `--baseline-from`, `--baseline-to`, `--compare-from`, and `--compare-to`. Ship day is excluded from both windows. If either window includes today UTC, the verdict is `extend` with reason `incomplete_current_day`. A 7-day read should run on ship day + 8. `--denominator` defaults to `page_view`. Thresholds are fractions (0.15 = +15%), and the absolute value must be 5 or less. `keep` requires lift at or above the keep threshold and a 90% interval entirely above zero. `revert` requires lift at or below the revert threshold and a 90% interval entirely below zero. Other results are `extend`, including `below_min_sample`, `zero_denominator`, `zero_baseline` (lift is null), `inconclusive`, `interval_includes_zero`, and `no_evidence_of_gain`. `--json` prints the API body, including `verdict`, `reason`, `reason_detail`, `lift`, the 90% interval, and `guardrails`.

`--metric` keeps that free read and switches the measured value to a numeric property: `sum(<key>)`, `avg(<key>)`, `p50(<key>)`, `p75(<key>)`, or `p95(<key>)`. `--metric-event` is the event whose property is measured. It defaults to the goal event and is omitted from the request unless you set it. `--better` is `higher` or `lower`. Omitted, it defaults to `higher`. Pass `--better lower` for `cwv_lcp` and the other vitals; the CLI does not infer the direction from the property name. `sum()` compares the sum per unique denominator user (`per_user: true`). `avg` and percentiles compare the aggregate itself (`per_user: false`). Percentiles are nearest-rank. `lift` is `(compare - baseline) / baseline`, negated when `better` is `lower`. `raw_lift` is that ratio before negation. Each window still includes the conversion rate and user counts, plus `value`, `n`, and `skipped`. v1 returns `interval: null` and `interval_method: "none"`. `min_goal_events` counts numeric values (`n`) on `metric_event` across both windows. When lift meets the keep or revert threshold, the verdict is `extend` with reason `no_interval_for_metric`, and lift is still reported. Lift between the thresholds is `extend` / `no_evidence_of_gain`. Omit `--metric` and the unique-converter response is unchanged.

Repeat `--exclude-denominator <field>=<value>` to exclude 404 or bot page views from the denominator. Each use is split on the first `=` and sent as `denominator_filters` `{field, op: "neq", value}`. Existing `--filter` values are unchanged. Omit the flag to keep today's denominator.

```bash
npx --yes @agent-analytics/cli@0.5.42 compare my-site --ship-date 2026-04-08 --days 7 --goal landing_signup_cta_clicked --denominator page_view --keep-threshold 0.15 --revert-threshold -0.10 --min-denominator 200 --min-goal-events 20
npx --yes @agent-analytics/cli@0.5.42 compare my-site --ship-date 2026-11-04 --days 7 --goal template_opened --exclude-denominator "properties.title=Page not found | grokbotpages.com"
npx --yes @agent-analytics/cli@0.5.42 compare my-site --ship-date 2026-11-05 --days 7 --goal signup --metric 'p75(cwv_lcp)' --metric-event page_view --better lower
npx --yes @agent-analytics/cli@0.5.42 compare shop --ship-date 2026-11-04 --days 7 --goal purchase --metric 'sum(revenue)'
```

On hosted, `--metric-event` for vitals is `page_view`. Self-hosted core stores cwv_* on the `$web_vitals` event. The tracker sends vitals only when the install snippet sets `data-track-vitals="true"`.

`vitals` is a Pro read on `POST /vitals`. A successful call counts as one metered read. A free account gets HTTP 403 `PRO_REQUIRED`, and that call is not metered. The event is fixed to `page_view`. `--days` is a positive integer lookback. `--from` and `--to` are `YYYY-MM-DD` dates sent as `date_from` and `date_to`. Omit a flag to leave that field unset. `--by` is `device` or `path`. Omitted, the response is one overall row. `--limit` defaults to 10 on the server and must be an integer from 1 to 20. It applies to `path` groups (top paths by sample size, sorted by worst LCP p75). `device` groups are mobile, tablet, and desktop.

The headline is p75, nearest-rank. Each metric row prints p75 with its unit, rating (`good`, `needs-improvement`, or `poor`), the good / NI / poor share (fractions from 0 to 1), `n`, and `skipped`. `skipped` counts page views in the group that did not include that vital. CLS is omitted by the tracker where `layout-shift` is unsupported, which is outside Chromium, so those views are skipped rather than stored as 0. Ratings use the web.dev and PSI cutoffs: LCP 2500/4000 ms, INP 200/500 ms, CLS 0.1/0.25, FCP 1800/3000 ms, TTFB 800/1800 ms. A value at or below `good_max` is good. A value above `poor_min` is poor. Anything between is needs-improvement. CWV pass is true when LCP, INP, and CLS p75 are all good. If INP `n` is 0, pass uses LCP and CLS only. If LCP or CLS `n` is 0, CWV pass is null. FCP and TTFB do not affect CWV pass. Poor targets are the top selectors among poor loads (at most 5). FCP and TTFB have none. `--json` prints the API body. `approximate` is true when the 200,000 event cap is hit.

```bash
npx --yes @agent-analytics/cli@0.5.42 vitals my-site --days 7
npx --yes @agent-analytics/cli@0.5.42 vitals my-site --from 2026-11-01 --to 2026-11-12 --by path --limit 10 --json
npx --yes @agent-analytics/cli@0.5.42 vitals my-site --by device
```

`errors` is a Pro read on `GET /errors`. A successful call counts as one metered read. A free account gets HTTP 403 `PRO_REQUIRED`, and that call is not metered. It groups `$error` events. The tracker sends `message`, `source`, `line`, and `col` and does not send a stack. Grouping uses the normalized message, the source filename, and `line`. `--since` defaults to `7d` and accepts `7d` or `YYYY-MM-DD`. `--until` is an optional `YYYY-MM-DD` end; omitted, the API uses today UTC. `--limit` defaults to 20 and the maximum is 100. `--new-since` is a `YYYY-MM-DD` date or an annotation title. Zero annotation matches is HTTP 400. More than one match is HTTP 400 with `matches` of `occurred_at` and `title`, which the CLI prints. Each group includes `fingerprint`, `message`, `source`, `line`, `count`, `users`, `sessions`, `first_seen`, `last_seen`, and `top_paths` (up to 3). When `--new-since` is set, `new_since` is true when `first_seen` is on or after that date. `first_seen` uses every stored `$error` for that fingerprint, not only the window. Every response includes boolean `approximate`. When `approximate` is true, `caps` is an array of the caps that were hit: `distinct_triples` and `window_rows`. The human output lists `caps`. `--json` prints the API body.

```bash
npx --yes @agent-analytics/cli@0.5.42 errors my-site --since 7d --new-since 2026-11-12
npx --yes @agent-analytics/cli@0.5.42 errors my-site --since 7d --until 2026-11-12 --new-since "Changed pricing page offer" --limit 20 --json
```

## Erasure

`erase` deletes one visitor from a project on `POST /erasures`. Pass exactly one of `--user-id`, `--session-id`, or `--email`, and pass `--confirm erase`. The command refuses locally when confirm is missing or when more than one subject is set. It does not print the subject.

`--user-id` deletes that id, walks the project identity graph once, and deletes matching events, sessions, identity rows, profiles, email lookup rows, and replays. `--session-id` deletes that session and its replay and does not walk the graph. `--email` is normalized, matched with the project email HMAC, and then follows the user id path. `--portfolio` is email only and defaults to false, so the erasure stays in the named project.

`--include-replays` defaults to true. Pass `--include-replays=false` or `--include-replays false` to keep replay data. `--confirm-large` is required when the subject matches more than 100,000 events.

The API requires an idempotency key, unique per account. When `--idempotency-key` is omitted, the CLI generates a UUID, prints `idempotency_key`, and sends that key. The same key and the same body returns the original job. A failed job continues. The same key with a different body is HTTP 409 `IDEMPOTENCY_CONFLICT`.

A finished job returns HTTP 200. A job that is still running returns HTTP 202. `status` is `pending`, `running`, `completed`, or `failed`. Poll with `erasures get <id>`. `erasures <project>` lists the 100 newest receipts. Receipts contain no raw subject, no deleted payloads, and no raw email. `--json` prints those receipt fields. A generated idempotency key is included as `idempotency_key`.

Erasure needs an agent session at manage or admin. `login` requests read unless you pass `--level manage` or `--level admin`. read gets HTTP 403 `FORBIDDEN_SCOPE` on `erase` and `erasures`. A project-limited session can erase only its granted project. Another project is HTTP 404 `PROJECT_NOT_FOUND`. `whoami` prints the granted project and level. A session saved before levels is legacy: it keeps its old scopes and all-projects access. A legacy session without `erasures:write` still gets HTTP 403 `FORBIDDEN` and the message `agent session missing required scope: erasures:write`. An account API key (`aak_`) cannot erase. A project key (`aapk_`) at manage or admin can. This CLI uses an agent session, not a key. Dashboard login can still erase. Demo mode is read-only.

Erasure accepts are limited to 20 per account per hour on every plan, including free. That limit is HTTP 429 `RATE_LIMITED` with `reason` `erasure_rate_limit`. It is separate from the per-minute request limit and is not metered as a read.

A database restore can bring erased rows back for up to 30 days. Ask support to re-apply erasures after any restore. New events for an erased id are dropped for 7 days, then accepted again. Erasure is not a permanent suppress list. Stored hashes are still identifiers.

```bash
npx --yes @agent-analytics/cli@0.5.42 erase my-site --user-id user_123 --confirm erase
npx --yes @agent-analytics/cli@0.5.42 erase my-site --session-id sess_123 --confirm erase --include-replays=false
npx --yes @agent-analytics/cli@0.5.42 erase my-site --email person@example.com --confirm erase --confirm-large
npx --yes @agent-analytics/cli@0.5.42 erasures my-site
npx --yes @agent-analytics/cli@0.5.42 erasures get era_123 --json
```

## Feedback

Use the CLI feedback command when Agent Analytics was confusing, a task took too long, or the agent had to do manual analysis that the product should have handled:

```bash
npx --yes @agent-analytics/cli@0.5.42 feedback \
  --message "The agent had to calculate the funnel drop-off manually" \
  --project my-site \
  --command "agent-analytics funnel my-site --steps page_view,signup,purchase" \
  --context "Share the use case and friction, but avoid private owner details, secrets, or raw customer data."
```

Feedback goes to a real agent via Telegram, every request is seen and auto-approved, and useful fixes can land quickly, sometimes within hours.

## Works With

Claude Code, OpenClaw, Cursor, Codex — any AI agent that can run `npx`. Or add the MCP server for rich charts in Claude Desktop:

```bash
claude mcp add agent-analytics --transport http https://mcp.agentanalytics.sh/mcp
```

For managed, issue-based, or remote runtimes that cannot receive a localhost callback or keep a long-running process alive, use `npx --yes @agent-analytics/cli@0.5.42 login --detached`. It prints the approval URL and exits. After browser approval, resume with the printed `login --auth-request <id> --exchange-code <code>` command.

For managed runtimes where the default home config path may not persist, point auth storage at a persistent runtime/workspace directory:

```bash
export AGENT_ANALYTICS_CONFIG_DIR="$PWD/.openclaw/agent-analytics"
npx --yes @agent-analytics/cli@0.5.42 login --detached
npx --yes @agent-analytics/cli@0.5.42 auth status
```

For one-off commands, use `--config-dir "$PWD/.openclaw/agent-analytics"` before or after the command. The CLI stores the same `config.json` file in that directory and does not migrate credentials from the default path.

For a local shell where it is useful to keep waiting, use `npx --yes @agent-analytics/cli@0.5.42 login --detached --wait`.

If your saved session predates CLI `0.5.9`, run a fresh login before calling `projects`. Older saved agent-session tokens were minted without `projects:read`, so they will keep failing until you re-authenticate. Verify with:

```bash
npx --yes @agent-analytics/cli@0.5.42 projects
```

## Agent Skill

The installable Agent Skill lives in the canonical public repo:

```bash
npx skills add agent-analytics/skills
```

Do not install the skill from this CLI repo. This package is the runtime CLI; the public skill definition is maintained separately so install instructions stay consistent across Codex, Cursor, Claude Code, and other Agent Skills-compatible tools.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_ANALYTICS_CONFIG_DIR` | Directory containing CLI `config.json`; use a persistent path in managed runtimes |
| `AGENT_ANALYTICS_URL` | Custom API URL (for self-hosted) |
| `AGENT_ANALYTICS_DASHBOARD_URL` | Custom dashboard URL for local upgrade-link testing |
| `AGENT_ANALYTICS_CREDENTIAL_STORE` | Optional credential storage override: `auto` (default), `native`, or `file` |

## Links

- **Dashboard:** https://app.agentanalytics.sh
- **Docs:** https://docs.agentanalytics.sh
- **Website:** https://agentanalytics.sh
- **GitHub:** https://github.com/Agent-Analytics
- **Self-host:** https://github.com/Agent-Analytics/agent-analytics
- **Agent Skill:** https://github.com/Agent-Analytics/skills

## License

MIT
