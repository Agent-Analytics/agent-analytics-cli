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
```

## Commands

```bash
# Setup
login --token <key>              Save your API key
create <name> --domain <url>     Create a project and get your tracking snippet
projects                         List all your projects

# Analytics
stats <name>                     Overview: events, users, daily trends
live [name]                      Real-time terminal dashboard across all projects
insights <name>                  Period-over-period comparison with trends
breakdown <name> --property path Top pages, referrers, UTM sources, countries
pages <name>                     Entry/exit page performance & bounce rates
heatmap <name>                   Peak hours & busiest days
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
revoke-key                       Revoke and regenerate API key
```

## For AI Agents

Set the env var and call the API directly — no CLI needed:

```bash
export AGENT_ANALYTICS_API_KEY=aak_your_key

# Query stats
curl "https://api.agentanalytics.sh/stats?project=my-site&days=7" \
  -H "X-API-Key: $AGENT_ANALYTICS_API_KEY"

# Or use the MCP server with Claude Code
claude mcp add agent-analytics --transport http https://mcp.agentanalytics.sh/mcp
```

Works with Claude Code, OpenClaw, Cursor, Codex — any agent that speaks HTTP or MCP.

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

## License

MIT
