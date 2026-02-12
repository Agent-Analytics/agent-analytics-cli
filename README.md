# agent-analytics

Web analytics your AI agent can read. Drop a JS snippet on your site, query the data via API.

## Quick Start

```bash
# 1. Get your API key from https://app.agentanalytics.sh (sign in with GitHub)

# 2. Save your key
npx agent-analytics login --token aak_your_key

# 3. Create a project
npx agent-analytics create my-site --domain https://mysite.com

# 4. Check your stats
npx agent-analytics stats my-site
```

## Commands

```bash
# Auth
npx agent-analytics login --token <key>    # Save your API key
npx agent-analytics whoami                  # Show current account

# Projects
npx agent-analytics create <name> --domain <url>   # Create a project
npx agent-analytics projects                        # List your projects
npx agent-analytics delete <id>                     # Delete a project

# Analytics
npx agent-analytics stats <name>              # Stats (last 7 days)
npx agent-analytics stats <name> --days 30    # Stats (last 30 days)
npx agent-analytics events <name>             # Recent events
npx agent-analytics properties-received <name>  # Property keys per event

# Security
npx agent-analytics revoke-key     # Revoke and regenerate API key
```

## For AI Agents

Set the env var and call the API directly — no CLI needed:

```bash
export AGENT_ANALYTICS_API_KEY=aak_your_key

# Query stats
curl "https://app.agentanalytics.sh/stats?project=my-site&days=7" \
  -H "X-API-Key: $AGENT_ANALYTICS_API_KEY"

# Create a project
curl -X POST "https://app.agentanalytics.sh/projects" \
  -H "X-API-Key: $AGENT_ANALYTICS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "new-site", "allowed_origins": "https://mysite.com"}'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_ANALYTICS_API_KEY` | API key (overrides config file) |
| `AGENT_ANALYTICS_URL` | Custom API URL (for self-hosted) |

## Config

Stored at `~/.config/agent-analytics/config.json` (file permissions: 600).

## Links

- **Dashboard:** https://app.agentanalytics.sh
- **Website:** https://agentanalytics.sh
- **GitHub:** https://github.com/Agent-Analytics
- **Self-host:** https://github.com/Agent-Analytics/agent-analytics

## License

MIT
