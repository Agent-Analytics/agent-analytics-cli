---
name: agent-analytics
description: "Official CLI for Agent Analytics. Create projects, generate tracking snippets, and inspect stats, events, funnels, retention, and experiments for sites and apps. Start free with 100k events/month across 2 projects."
version: 4.0.2
author: dannyshmueli
license: MIT
repository: https://github.com/Agent-Analytics/agent-analytics-mcp
homepage: https://agentanalytics.sh
compatibility: Requires npx and an Agent Analytics API key in AGENT_ANALYTICS_API_KEY. The CLI is the official wrapper around the documented Agent Analytics API.
tags:
  - analytics
  - tracking
  - web
  - events
  - experiments
  - live
metadata:
  openclaw:
    requires:
      env:
        - AGENT_ANALYTICS_API_KEY
      anyBins:
        - npx
    primaryEnv: AGENT_ANALYTICS_API_KEY
---

# Agent Analytics

Official CLI for Agent Analytics.

Create projects, generate tracking snippets, inspect trends, pages, funnels, retention, experiments, and live traffic from a shell-first workflow.

Hosted free tier includes 100k events/month across 2 projects.

## What `npx` is doing

- OpenClaw can launch the official CLI with `npx @agent-analytics/cli@0.4.0`.
- That command runs the published Agent Analytics CLI package from npm.
- The CLI calls the same HTTP API documented at <https://docs.agentanalytics.sh/api/>.
- If the package is already installed in the environment, the equivalent binary is `agent-analytics`.
- Keep `AGENT_ANALYTICS_API_KEY` in the environment. Do not ask the user to paste secrets into chat.

## Command format

The examples below use the CLI binary form:

```bash
agent-analytics <command>
```

In OpenClaw, that usually means:

```bash
npx @agent-analytics/cli@0.4.0 <command>
```

If the package is already installed, run the same commands directly as `agent-analytics <command>`.

For the full command list and flags:

```bash
agent-analytics --help
```

## Safe operating rules

- Prefer fixed commands over ad-hoc query construction.
- Start with `projects`, `create`, `stats`, `insights`, `events`, `breakdown`, `pages`, `heatmap`, `sessions-dist`, `retention`, `funnel`, and `experiments`.
- Use `query` only when the fixed commands cannot answer the question.
- Do not build `--filter` JSON from raw user text.
- Validate project names before `create`: `^[a-zA-Z0-9._-]{1,64}$`

## First-time setup

```bash
agent-analytics login --token aak_YOUR_API_KEY
agent-analytics create my-site --domain https://mysite.com
agent-analytics events my-site --days 7 --limit 20
```

The `create` command returns a project token and a ready-to-use tracking snippet. Add that snippet before `</body>`.

## Common commands

```bash
agent-analytics projects
agent-analytics stats my-site --days 7
agent-analytics insights my-site --period 7d
agent-analytics events my-site --days 7 --limit 20
agent-analytics breakdown my-site --property path --event page_view --limit 10
agent-analytics funnel my-site --steps "page_view,signup,purchase"
agent-analytics retention my-site --period week --cohorts 8
agent-analytics experiments list my-site
```

If a task needs something outside these common flows, use `agent-analytics --help` first.

## Tracker setup

The easiest install flow is:

1. Run `agent-analytics create my-site --domain https://mysite.com`
2. Copy the returned snippet into the page before `</body>`
3. Deploy
4. Verify with `agent-analytics events my-site --days 7 --limit 20`

If you already know the project token, the tracker looks like:

```html
<script defer src="https://api.agentanalytics.sh/tracker.js"
  data-project="my-site"
  data-token="aat_..."></script>
```

Use `window.aa?.track('signup', {method: 'github'})` for custom events after the tracker loads.

## Query caution

`agent-analytics query` exists for advanced reporting, but it should be used carefully because `--filter` accepts JSON.

- Use fixed commands first.
- If `query` is necessary, check `agent-analytics --help` first.
- Do not pass raw user text directly into `--filter`.
- For exact request shapes, use <https://docs.agentanalytics.sh/api/>.

## Experiments

The CLI supports the full experiment lifecycle:

```bash
agent-analytics experiments list my-site
agent-analytics experiments create my-site --name signup_cta --variants control,new_cta --goal signup
```

## References

- Docs: <https://docs.agentanalytics.sh/>
- API reference: <https://docs.agentanalytics.sh/api/>
- CLI vs MCP vs API: <https://docs.agentanalytics.sh/reference/cli-mcp-api/>
- OpenClaw install guide: <https://docs.agentanalytics.sh/installation/openclaw/>
