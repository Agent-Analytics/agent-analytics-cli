# Agent Analytics CLI

Stop juggling dashboards. Let your agent do it.

Analytics your AI agent can actually use — track, analyze, experiment, optimize.

## Quick Start

```bash
# 1. Get your API key from https://app.agentanalytics.sh (sign in with GitHub or Google)

# 2. Save your key
npx @agent-analytics/cli login --token aak_your_key

# 3. Create a project
npx @agent-analytics/cli create my-site --domain https://mysite.com

# 4. Watch it live
npx @agent-analytics/cli live

# Optional: clear your saved local auth later
npx @agent-analytics/cli logout
```

## Commands

```bash
# Setup
login --token <key>              Save your API key
logout                           Clear your saved API key
create <name> --domain <url>     Create a project and get your tracking snippet
projects                         List all your projects

# Analytics
all-sites                        Historical summary across all projects
bot-traffic <name>               Filtered automated traffic by project or --all
stats <name>                     Overview: events, users, daily trends
live [name]                      Real-time terminal dashboard across all projects
insights <name>                  Period-over-period comparison with trends
breakdown <name> --property path Top pages, referrers, UTM sources, countries
pages <name>                     Entry/exit page performance & bounce rates
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
logout                           Clear saved local auth (does not revoke your key)
revoke-key                       Revoke and regenerate API key
```

Bounce metrics (`insights`, `pages`, `sessions`) treat a session as a bounce when it has only non-interactive events:
`page_view`, `$impression`, `$scroll_depth`, `$error`, `$time_on_page`, `$performance`, `$web_vitals`.

`query` keeps `/events` raw and lossless, but `/query` now defaults `event_count` to activation-safe dedupe (`session_then_user`) when requested. Use `--count-mode raw` when you need the old ingested-row count for debugging or audit work:

```bash
npx @agent-analytics/cli query my-site --metrics event_count --count-mode raw
```

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

## Agent Skill

The installable Agent Skill lives in the canonical public repo:

```bash
npx skills add Agent-Analytics/agent-analytics-skill@agent-analytics
```

Do not install the skill from this CLI repo. This package is the runtime CLI; the public skill definition is maintained separately so install instructions stay consistent across Codex, Cursor, Claude Code, and other Agent Skills-compatible tools.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_ANALYTICS_API_KEY` | API key (overrides config file) |
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
