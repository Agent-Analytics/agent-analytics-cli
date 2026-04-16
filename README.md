# Agent Analytics CLI

Stop juggling dashboards. Let your agent do it.

Analytics your AI agent can actually use — track, analyze, experiment, optimize.

## Quick Start

Try the seeded public demo without signing in:

```bash
npx @agent-analytics/cli@0.5.15 demo
npx @agent-analytics/cli@0.5.15 --demo projects
npx @agent-analytics/cli@0.5.15 --demo funnel agentanalytics-demo --steps "page_view,signup_started,signup"
npx @agent-analytics/cli@0.5.15 --demo experiments list agentanalytics-demo
```

Demo mode fetches a short-lived read-only `aas_*` session from the hosted API. It does not expose a raw `aak_*` API key, does not write local CLI config, and blocks mutating commands before making API requests.

```bash
# 1. Start agent login or signup in the browser
npx @agent-analytics/cli login

# 2. Create a project
npx @agent-analytics/cli create my-site --domain https://mysite.com

# 3. Watch it live
npx @agent-analytics/cli live

# Optional fallbacks
npx @agent-analytics/cli login --detached
npx @agent-analytics/cli login --token aak_your_key   # advanced/manual fallback

# Optional: clear your saved local auth later
npx @agent-analytics/cli logout
```

## Commands

```bash
# Setup
login                            Browser approval flow for signup/login
login --detached                 Detached handoff: print approval URL and exit
login --detached --wait          Detached approval with polling for local shells
login --token <key>              Advanced fallback: save a raw API key
logout                           Clear your saved local auth
create <name> --domain <url>     Create a project and get your tracking snippet
projects                         List all your projects with IDs
project <project>                Get project details by exact name or ID
update <project>                 Update project name or origins by exact name or ID
delete <project>                 Delete a project by exact name or ID

# Analytics
all-sites                        Historical summary across all projects
bot-traffic <name>               Filtered automated traffic by project or --all
stats <name>                     Overview: events, users, daily trends
live [name]                      Real-time terminal dashboard across all projects
insights <name>                  Period-over-period comparison with trends
breakdown <name> --property path Top pages, referrers, UTM sources, countries
pages <name>                     Entry/exit page performance & bounce rates
paths <name> --goal <event>      Bounded entry-to-goal/drop-off session paths
heatmap <name>                   Peak hours & busiest days
funnel <name>                    Funnel analysis: where users drop off
retention <name>                 Cohort retention: % of users who return
sessions-dist <name>             Session duration distribution
events <name>                    Raw event log
sessions <name>                  Individual session records
query <name>                     Flexible analytics query (metrics, group_by, filters)
properties <name>                Discover event names & property keys

# Experiments — A/B testing your agent can actually use
experiments list <project>       List experiments
experiments create <project>     Create experiment
experiments get <id>             Get experiment with results & significance
experiments complete <id>        Ship the winner

# Account
whoami                           Show current account & tier
feedback --message "..."         Send product/process feedback
logout                           Clear saved local auth (does not revoke remote sessions)
revoke-key                       Rotate a saved raw API key fallback
```

The CLI is agent-session-first. It stores a renewable Agent Analytics session locally after browser approval and uses that bearer auth for API calls. Raw `aak_*` API keys still work, but only as an advanced/manual fallback for direct HTTP-style usage.
Raw API-key rotation is not available to scoped agent sessions; manage keys from the dashboard or from a CLI login created with `login --token`.

Project management commands accept exact project names or project IDs. For local browser QA, update origins through the CLI while keeping the production origin:

```bash
npx @agent-analytics/cli update stylio --origins 'https://stylio.app,http://lvh.me:3101'
```

Bounce metrics (`insights`, `pages`, `sessions`) treat a session as a bounce when it has only non-interactive events:
`page_view`, `$impression`, `$scroll_depth`, `$error`, `$time_on_page`, `$performance`, `$web_vitals`.

`query` keeps `/events` raw and lossless, but `/query` uses activation-safe dedupe (`session_then_user`) as the default for `event_count`: session-backed rows count by session, no-session rows fall back to `user_id` only when that user has no session-backed row in the same filtered/grouped result set, and fully anonymous rows fall back to event `id`. For recent signup or ingestion debugging, check `events <project> --event <actual_event_name>` first, then use `query` after verifying the raw event names the project emits. `--count-mode` only affects `event_count`. Use `--count-mode raw` when you need the old ingested-row count for debugging or audit work:

```bash
npx @agent-analytics/cli query my-site --metrics event_count --count-mode raw
```

Property filters must use canonical `properties.*` fields. Built-in filter fields are only `event`, `user_id`, `date`, `country`, `session_id`, and `timestamp`. Example:

```bash
npx @agent-analytics/cli query my-site --filter '[{"field":"properties.referrer","op":"contains","value":"clawflows.com"}]'
```

Invalid filter fields now fail loudly and return property discovery guidance instead of being silently ignored.

## Feedback

Use the CLI feedback command when Agent Analytics was confusing, a task took too long, or the agent had to do manual analysis that the product should have handled:

```bash
npx @agent-analytics/cli feedback \
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

For managed, issue-based, or remote runtimes that cannot receive a localhost callback or keep a long-running process alive, use `npx @agent-analytics/cli login --detached`. It prints the approval URL and exits. After browser approval, resume with the printed `login --auth-request <id> --exchange-code <code>` command.

For a local shell where it is useful to keep waiting, use `npx @agent-analytics/cli login --detached --wait`.

If your saved session predates CLI `0.5.9`, run a fresh login before calling `projects`. Older saved agent-session tokens were minted without `projects:read`, so they will keep failing until you re-authenticate. Verify with:

```bash
npx @agent-analytics/cli@0.5.15 projects
```

## Agent Skill

The installable Agent Skill lives in the canonical public repo:

```bash
npx skills add Agent-Analytics/agent-analytics-skill
```

Do not install the skill from this CLI repo. This package is the runtime CLI; the public skill definition is maintained separately so install instructions stay consistent across Codex, Cursor, Claude Code, and other Agent Skills-compatible tools.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_ANALYTICS_API_KEY` | Advanced fallback API key (overrides config file) |
| `AGENT_ANALYTICS_URL` | Custom API URL (for self-hosted) |

## Links

- **Dashboard:** https://app.agentanalytics.sh
- **Docs:** https://docs.agentanalytics.sh
- **Website:** https://agentanalytics.sh
- **GitHub:** https://github.com/Agent-Analytics
- **Self-host:** https://github.com/Agent-Analytics/agent-analytics
- **Agent Skill:** https://github.com/Agent-Analytics/agent-analytics-skill

## License

MIT
