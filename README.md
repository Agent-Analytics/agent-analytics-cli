# agent-analytics

Web analytics your AI agent can read. CLI for managing projects and querying stats.

## Quick Start

```bash
# Create your first project (authenticates via GitHub)
npx agent-analytics init my-site
```

This will:
1. Open GitHub for authentication
2. Create your account + API key
3. Create the project
4. Give you a snippet to paste on your site

## Commands

```bash
# Auth
npx agent-analytics login          # Authenticate via GitHub
npx agent-analytics whoami         # Show current account

# Projects
npx agent-analytics projects       # List your projects
npx agent-analytics create <name>  # Create a new project
npx agent-analytics delete <id>    # Delete a project

# Analytics
npx agent-analytics stats <name>              # Stats (last 7 days)
npx agent-analytics stats <name> --days 30    # Stats (last 30 days)
npx agent-analytics events <name>             # Recent events

# Security
npx agent-analytics revoke-key     # Revoke and regenerate API key
```

## For AI Agents

Your agent doesn't need the CLI — it can use the API directly:

```bash
# Query stats
curl "https://app.agentanalytics.sh/stats?project=my-site&days=7" \
  -H "X-API-Key: $AGENT_ANALYTICS_KEY"

# Create a project
curl -X POST "https://app.agentanalytics.sh/projects" \
  -H "X-API-Key: $AGENT_ANALYTICS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "new-site"}'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_ANALYTICS_KEY` | API key (overrides config file) |
| `AGENT_ANALYTICS_URL` | Custom API URL (for self-hosted) |

## Config

Stored at `~/.config/agent-analytics/config.json`. Contains your API key (file permissions: 600).

## Links

- **Dashboard:** https://app.agentanalytics.sh
- **Landing:** https://agentanalytics.sh
- **GitHub:** https://github.com/Agent-Analytics

## License

MIT
