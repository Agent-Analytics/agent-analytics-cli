# Agent Analytics CLI

Stop juggling dashboards. Let your agent do it.

Analytics your AI agent can actually use — track, analyze, experiment, optimize.

## Quick Start

Try the seeded public demo without signing in:

```bash
npx --yes @agent-analytics/cli@0.5.40 demo
npx --yes @agent-analytics/cli@0.5.40 --demo projects
npx --yes @agent-analytics/cli@0.5.40 --demo funnel agentanalytics-demo --steps "page_view,signup_started,signup"
npx --yes @agent-analytics/cli@0.5.40 --demo experiments list agentanalytics-demo
```

Demo mode fetches a short-lived read-only agent session from the hosted API. It does not write local CLI config and blocks mutating commands before making API requests.

Get the fastest path to useful analytics for a project you own:

```bash
# 1. Start agent login or signup in the browser
npx --yes @agent-analytics/cli@0.5.40 login

# 2. Create a project; --domain is the primary surface URL/origin for setup
npx --yes @agent-analytics/cli@0.5.40 create my-site --domain https://mysite.com

# 3. Watch it live
npx --yes @agent-analytics/cli@0.5.40 live

# Optional detached login for remote or issue-based agent work
npx --yes @agent-analytics/cli@0.5.40 login --detached

# Optional: clear local auth and revoke the stored agent session when possible
npx --yes @agent-analytics/cli@0.5.40 logout
```

## Commands

```bash
# Setup
login                            Browser approval flow for signup/login
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
sessions <name>                  Individual session records
query <name>                     Flexible analytics query (metrics, group_by, filters, numeric property aggs)
compare <name>                   Free before/after read of unique converters, or --metric 'p75(cwv_lcp)' --metric-event '$web_vitals' --better lower. A 7-day read should run on ship day + 8
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
whoami                           Show current account & tier
feedback --message "..."         Send product/process feedback
logout                           Clear local auth and revoke the stored agent session when possible
```

The CLI is agent-session-first. It stores a renewable Agent Analytics session after browser approval and uses that bearer auth for CLI API calls. By default, macOS and Windows store the session secret in the OS keychain; Linux and headless environments use the CLI config file. Existing file-stored sessions migrate automatically to native storage on the next authenticated command when native storage is available. Runtime-specific HTTP integrations should stay tied to the approved agent session, project setup, and project context rather than treating the CLI as a manual key setup path.

Replay commands require agent-session scopes `replays:read` and `replays:write`. If the saved session predates replay support, run `login` again to approve the added scopes. Replay remains disabled by default even for eligible accounts, and enabling it does not modify or activate the base tracker. A customer must separately install:

```html
<script src="https://api.agentanalytics.sh/replay.js" data-token="aat_PROJECT_TOKEN"></script>
```

Use `--recording-start after_consent` when recording must wait for site consent, then call `window.aaReplay.consent()` from the site's consent flow. All form/contenteditable values remain mandatorily masked. Use `--mask`, `--block`, and `--ignore` for comma-separated domain-specific selectors; automatic PII redaction is defense in depth, not a substitute for those selectors.

For sites with CSP, allow the Agent Analytics API in `script-src` and `connect-src`, the account R2 S3 endpoint (`https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com`) in `connect-src`, and `blob:` in `worker-src`. Replay fails closed when those permissions or required browser capabilities are unavailable.

Check local storage state without printing secrets:

```bash
npx --yes @agent-analytics/cli@0.5.40 auth status
```

Credential storage is automatic. Only use `AGENT_ANALYTICS_CREDENTIAL_STORE` for troubleshooting or managed runtimes:

- `file`: force config-file storage
- `native`: require OS keychain and fail if unavailable
- `auto`: default; usually not needed

When a free account hits a Pro-only analytics task, run an explicit upgrade handoff:

```bash
npx --yes @agent-analytics/cli@0.5.40 upgrade-link --detached
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
npx --yes @agent-analytics/cli@0.5.40 update stylio --origins 'https://stylio.app,http://lvh.me:3101'
```

For tracker setup, start from the product action you want your agent to optimize. Do not add custom duplicates for automatic tracker signals such as `page_view`, path, referrer, UTMs, device/browser fields, country, session IDs, session count, days since first visit, or first-touch attribution. Prefer `data-aa-event`, `data-aa-impression`, `window.aa.track(...)`, server-side durable outcome tracking, or script opt-ins only when they unlock a concrete decision.

Bounce metrics (`insights`, `pages`, `sessions`) treat a session as a bounce when it has only non-interactive events:
`page_view`, `$impression`, `$scroll_depth`, `$error`, `$time_on_page`, `$performance`, `$web_vitals`.

`query` keeps `/events` raw and lossless, but `/query` uses activation-safe dedupe (`session_then_user`) as the default for `event_count`: session-backed rows count by session, no-session rows fall back to `user_id` only when that user has no session-backed row in the same filtered/grouped result set, and fully anonymous rows fall back to event `id`. For recent signup or ingestion debugging, check `events <project> --event <actual_event_name>` first, then use `query` after verifying the raw event names the project emits. `--count-mode` only affects `event_count`. Use `--count-mode raw` when you need the old ingested-row count for debugging or audit work:

```bash
npx --yes @agent-analytics/cli@0.5.40 query my-site --metrics event_count --count-mode raw
```

`sum`, `avg`, `p50`, `p75`, and `p95` are numeric property metrics on the same Pro `POST /query` read. They require `--property <key>`. The key is the event property itself (`cwv_lcp`, `revenue`): letters, numbers, and underscores, at most 128 characters, with no `properties.` prefix. Only JSON numbers are aggregated. Each row includes the requested metric plus `n` and `skipped`. Percentiles are nearest-rank: `percentile_method` is `nearest_rank` when a percentile is requested, and `null` for sum or avg only. Web Vitals LCP is `cwv_lcp` on `$web_vitals`, not a field on `page_view`.

```bash
npx --yes @agent-analytics/cli@0.5.40 query my-site --metrics p75 --property cwv_lcp --filter '[{"field":"event","op":"eq","value":"$web_vitals"}]'
npx --yes @agent-analytics/cli@0.5.40 query shop --metrics sum,avg --property revenue --filter '[{"field":"event","op":"eq","value":"purchase"}]'
```

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

npx --yes @agent-analytics/cli@0.5.40 funnel shop --steps-json ./funnel.json --json
```

Funnel filters use canonical `properties.<key>` fields and support `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `contains`, `prefix`, and `in`. The JSON output includes `steps_source`, `identity_basis`, `raw_activity`, `joinable_entities`, `strict_survivors`, `conversion_rates`, `warnings`, and `caveats` so your agent can separate “events exist” from “entities survived the strict ordered funnel.” `--steps a,b,c` remains supported for quick legacy checks. If no step source is passed, or if you pass `--from-context`, the API falls back to bare `project_context.activation_events`; treat that as a convenience starting point, not a precision source.

`paths` accepts bounded lookback windows `1d`, `7d`, `14d`, `30d`, and `90d`. Use `1d` for fresh local instrumentation checks, then move to a longer window once there is enough traffic.

Property filters must use canonical `properties.*` fields. Built-in filter fields are only `event`, `user_id`, `date`, `country`, `session_id`, and `timestamp`. Example:

```bash
npx --yes @agent-analytics/cli@0.5.40 query my-site --filter '[{"field":"properties.referrer","op":"contains","value":"clawflows.com"}]'
```

Invalid filter fields now fail loudly and return property discovery guidance instead of being silently ignored.

Identity lookup with `--email` sends the normalized email to Agent Analytics over HTTPS for server-side project-scoped HMAC matching. The CLI no longer computes or sends a local `email_hash`; raw email is not stored in event rows or profile traits.

Store compact project context when the product has custom goals, activation events, event meanings, or date annotations that should travel with analytics results. Keep this short because project-scoped analytics endpoints include it as `project_context`. `context set` accepts an encoded JSON body up to 512KB.

Use annotations for major product changes that could explain later graph movement: landing page, pricing, onboarding, feature, release, or experiment changes. Do not store git commit logs, noisy edits, temporary metric notes, PII, secrets, or long release notes. Direct `context get` returns all annotations; project-scoped analytics responses include annotations only for the requested analytics date range plus one day before and after.

Before setting or refreshing the glossary, inspect the project's current event names:

```bash
npx --yes @agent-analytics/cli@0.5.40 properties my-site
npx --yes @agent-analytics/cli@0.5.40 properties-received my-site
npx --yes @agent-analytics/cli@0.5.40 context set my-site --json '{
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
npx --yes @agent-analytics/cli@0.5.40 annotate my-site --title "Changed pricing page offer" --note "Moved annual plan discount above the fold." --at 2026-04-25T13:00:00.000Z
```

`compare` is a free read on `POST /compare`. A successful call counts as one metered read. The goal is counted as unique converters (`count_mode` `unique_users`): a user who fires the goal 3 times counts once. `rate` is `goal_converters / denominator_unique_users`. Pass `--ship-date` and optional `--days` (`window_days`, a multiple of 7 from 1 to 90, default 7), or pass both windows with `--baseline-from`, `--baseline-to`, `--compare-from`, and `--compare-to`. Ship day is excluded from both windows. If either window includes today UTC, the verdict is `extend` with reason `incomplete_current_day`. A 7-day read should run on ship day + 8. `--denominator` defaults to `page_view`. Thresholds are fractions (0.15 = +15%), and the absolute value must be 5 or less. `keep` requires lift at or above the keep threshold and a 90% interval entirely above zero. `revert` requires lift at or below the revert threshold and a 90% interval entirely below zero. Other results are `extend`, including `below_min_sample`, `zero_denominator`, `zero_baseline` (lift is null), `inconclusive`, `interval_includes_zero`, and `no_evidence_of_gain`. `--json` prints the API body, including `verdict`, `reason`, `reason_detail`, `lift`, the 90% interval, and `guardrails`.

`--metric` keeps that free read and switches the measured value to a numeric property: `sum(<key>)`, `avg(<key>)`, `p50(<key>)`, `p75(<key>)`, or `p95(<key>)`. `--metric-event` is the event whose property is measured. It defaults to the goal event and is omitted from the request unless you set it. `--better` is `higher` or `lower`. Omitted, it defaults to `higher`. Pass `--better lower` for `cwv_lcp` and the other vitals; the CLI does not infer the direction from the property name. `sum()` compares the sum per unique denominator user (`per_user: true`). `avg` and percentiles compare the aggregate itself (`per_user: false`). Percentiles are nearest-rank. `lift` is `(compare - baseline) / baseline`, negated when `better` is `lower`. `raw_lift` is that ratio before negation. Each window still includes the conversion rate and user counts, plus `value`, `n`, and `skipped`. v1 returns `interval: null` and `interval_method: "none"`. `min_goal_events` counts numeric values (`n`) on `metric_event` across both windows. When lift meets the keep or revert threshold, the verdict is `extend` with reason `no_interval_for_metric`, and lift is still reported. Lift between the thresholds is `extend` / `no_evidence_of_gain`. Omit `--metric` and the unique-converter response is unchanged.

Repeat `--exclude-denominator <field>=<value>` to exclude 404 or bot page views from the denominator. Each use is split on the first `=` and sent as `denominator_filters` `{field, op: "neq", value}`. Existing `--filter` values are unchanged. Omit the flag to keep today's denominator.

```bash
npx --yes @agent-analytics/cli@0.5.40 compare my-site --ship-date 2026-04-08 --days 7 --goal landing_signup_cta_clicked --denominator page_view --keep-threshold 0.15 --revert-threshold -0.10 --min-denominator 200 --min-goal-events 20
npx --yes @agent-analytics/cli@0.5.40 compare my-site --ship-date 2026-11-04 --days 7 --goal template_opened --exclude-denominator "properties.title=Page not found | grokbotpages.com"
npx --yes @agent-analytics/cli@0.5.40 compare my-site --ship-date 2026-11-05 --days 7 --goal signup --metric 'p75(cwv_lcp)' --metric-event '$web_vitals' --better lower
npx --yes @agent-analytics/cli@0.5.40 compare shop --ship-date 2026-11-04 --days 7 --goal purchase --metric 'sum(revenue)'
```

`errors` is a Pro read on `GET /errors`. A successful call counts as one metered read. A free account gets HTTP 403 `PRO_REQUIRED`, and that call is not metered. It groups `$error` events. The tracker sends `message`, `source`, `line`, and `col` and does not send a stack. Grouping uses the normalized message, the source filename, and `line`. `--since` defaults to `7d` and accepts `7d` or `YYYY-MM-DD`. `--until` is an optional `YYYY-MM-DD` end; omitted, the API uses today UTC. `--limit` defaults to 20 and the maximum is 100. `--new-since` is a `YYYY-MM-DD` date or an annotation title. Zero annotation matches is HTTP 400. More than one match is HTTP 400 with `matches` of `occurred_at` and `title`, which the CLI prints. Each group includes `fingerprint`, `message`, `source`, `line`, `count`, `users`, `sessions`, `first_seen`, `last_seen`, and `top_paths` (up to 3). When `--new-since` is set, `new_since` is true when `first_seen` is on or after that date. `first_seen` uses every stored `$error` for that fingerprint, not only the window. Every response includes boolean `approximate`. When `approximate` is true, `caps` is an array of the caps that were hit: `distinct_triples` and `window_rows`. The human output lists `caps`. `--json` prints the API body.

```bash
npx --yes @agent-analytics/cli@0.5.40 errors my-site --since 7d --new-since 2026-11-12
npx --yes @agent-analytics/cli@0.5.40 errors my-site --since 7d --until 2026-11-12 --new-since "Changed pricing page offer" --limit 20 --json
```

## Feedback

Use the CLI feedback command when Agent Analytics was confusing, a task took too long, or the agent had to do manual analysis that the product should have handled:

```bash
npx --yes @agent-analytics/cli@0.5.40 feedback \
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

For managed, issue-based, or remote runtimes that cannot receive a localhost callback or keep a long-running process alive, use `npx --yes @agent-analytics/cli@0.5.40 login --detached`. It prints the approval URL and exits. After browser approval, resume with the printed `login --auth-request <id> --exchange-code <code>` command.

For managed runtimes where the default home config path may not persist, point auth storage at a persistent runtime/workspace directory:

```bash
export AGENT_ANALYTICS_CONFIG_DIR="$PWD/.openclaw/agent-analytics"
npx --yes @agent-analytics/cli@0.5.40 login --detached
npx --yes @agent-analytics/cli@0.5.40 auth status
```

For one-off commands, use `--config-dir "$PWD/.openclaw/agent-analytics"` before or after the command. The CLI stores the same `config.json` file in that directory and does not migrate credentials from the default path.

For a local shell where it is useful to keep waiting, use `npx --yes @agent-analytics/cli@0.5.40 login --detached --wait`.

If your saved session predates CLI `0.5.9`, run a fresh login before calling `projects`. Older saved agent-session tokens were minted without `projects:read`, so they will keep failing until you re-authenticate. Verify with:

```bash
npx --yes @agent-analytics/cli@0.5.40 projects
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
