# Agent Analytics CLI

Stop juggling dashboards. Let your agent do it.

Analytics your AI agent can actually use — track, analyze, experiment, optimize.

## Quick Start

Try the seeded public demo without signing in:

```bash
npx --yes @agent-analytics/cli@0.5.26 demo
npx --yes @agent-analytics/cli@0.5.26 --demo projects
npx --yes @agent-analytics/cli@0.5.26 --demo funnel agentanalytics-demo --steps "page_view,signup_started,signup"
npx --yes @agent-analytics/cli@0.5.26 --demo experiments list agentanalytics-demo
```

Demo mode fetches a short-lived read-only `aas_*` session from the hosted API. It does not expose a raw `aak_*` API key, does not write local CLI config, and blocks mutating commands before making API requests.

Get the fastest path to useful analytics before installing events:

```bash
# 1. Preview what your agent should track first
npx --yes @agent-analytics/cli@0.5.26 scan https://mysite.com --json

# 2. Sign in when you want the full instrumentation plan
npx --yes @agent-analytics/cli@0.5.26 login

# 3. Create or identify the project domain
npx --yes @agent-analytics/cli@0.5.26 create my-site --domain https://mysite.com

# 4. Run the full signed-in analysis for that project domain
npx --yes @agent-analytics/cli@0.5.26 scan https://mysite.com --full --project my-site --json

# Or resume and upgrade the anonymous analysis after login
npx --yes @agent-analytics/cli@0.5.26 scan \
  --resume <analysis_id> \
  --resume-token <resume_token> \
  --full \
  --project my-site \
  --json
```

Anonymous `scan` returns a one-analysis `rst_*` resume token, not an `aas_*` agent session. Full analysis and project linking require login.

```bash
# 1. Start agent login or signup in the browser
npx --yes @agent-analytics/cli@0.5.26 login

# 2. Create a project
npx --yes @agent-analytics/cli@0.5.26 create my-site --domain https://mysite.com

# 3. Watch it live
npx --yes @agent-analytics/cli@0.5.26 live

# Optional detached login for remote or issue-based agent work
npx --yes @agent-analytics/cli@0.5.26 login --detached

# Optional: clear your saved local auth later
npx --yes @agent-analytics/cli@0.5.26 logout
```

## Commands

```bash
# Setup
login                            Browser approval flow for signup/login
login --detached                 Detached handoff: print approval URL and exit
login --detached --wait          Detached approval with polling for local shells
upgrade-link --detached          Print a human Pro payment handoff link
upgrade-link --wait              Print the handoff link and wait for Pro activation
logout                           Clear your saved local auth
auth status                      Show local auth path and expiry metadata
scan <url>                       Analyze what your agent should track first
scan <url> --json                Return anonymous preview JSON for agents
scan <url> --full --project <name> --json
                                  Run a full signed-in analysis for a project domain
scan --resume <id> --resume-token <token>
                                  Resume a preview by analysis id and token
scan --resume <id> --resume-token <token> --full --project <name>
                                  Upgrade a resumed analysis after login
create <name> --domain <url>     Create a project and get your tracking snippet
create <name> --domain <url> --source-scan <id>
                                  Link project activation to an analysis
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

# Account
whoami                           Show current account & tier
feedback --message "..."         Send product/process feedback
logout                           Clear saved local auth (does not revoke remote sessions)
```

The CLI is agent-session-first. It stores a renewable Agent Analytics session locally after browser approval and uses that bearer auth for API calls. Direct HTTP runtimes that cannot use agent sessions should manage raw `aak_*` API keys from the dashboard, not through the normal CLI onboarding path.

When a free account hits a Pro-only analytics task, run an explicit upgrade handoff:

```bash
npx --yes @agent-analytics/cli@0.5.26 upgrade-link --detached \
  --reason "Need funnel and retention reads for this analysis" \
  --command "npx --yes @agent-analytics/cli@0.5.26 funnel my-site --steps page_view,signup,purchase"
```

The CLI prints an `app.agentanalytics.sh` link. The human confirms the logged-in dashboard account, pays in Lemon Squeezy, and returns to the agent after Pro activates. Use `upgrade-link --wait` when the local shell should keep polling for activation.

Project management commands accept exact project names or project IDs. For local browser QA, update origins through the CLI while keeping the production origin:

```bash
npx --yes @agent-analytics/cli@0.5.26 update stylio --origins 'https://stylio.app,http://lvh.me:3101'
```

Use `scan` before tracker installation when you want judgment instead of generic event lists. The preview is intentionally small: prioritized minimum viable instrumentation, what each event unlocks, current blind spots, and what not to track yet. The stable JSON is designed for agent skills to install only the high-priority events first and verify the first useful recommended event.

Each recommendation includes an `implementation_hint` that should map to tracker.js capabilities. Do not add custom duplicates for automatic tracker signals such as `page_view`, path, referrer, UTMs, device/browser fields, country, session IDs, session count, days since first visit, or first-touch attribution. Prefer `data-aa-event`, `data-aa-impression`, `window.aa.track(...)`, server-side durable outcome tracking, or script opt-ins only when they unlock the stated decision.

Bounce metrics (`insights`, `pages`, `sessions`) treat a session as a bounce when it has only non-interactive events:
`page_view`, `$impression`, `$scroll_depth`, `$error`, `$time_on_page`, `$performance`, `$web_vitals`.

`query` keeps `/events` raw and lossless, but `/query` uses activation-safe dedupe (`session_then_user`) as the default for `event_count`: session-backed rows count by session, no-session rows fall back to `user_id` only when that user has no session-backed row in the same filtered/grouped result set, and fully anonymous rows fall back to event `id`. For recent signup or ingestion debugging, check `events <project> --event <actual_event_name>` first, then use `query` after verifying the raw event names the project emits. `--count-mode` only affects `event_count`. Use `--count-mode raw` when you need the old ingested-row count for debugging or audit work:

```bash
npx --yes @agent-analytics/cli@0.5.26 query my-site --metrics event_count --count-mode raw
```

Property filters must use canonical `properties.*` fields. Built-in filter fields are only `event`, `user_id`, `date`, `country`, `session_id`, and `timestamp`. Example:

```bash
npx --yes @agent-analytics/cli@0.5.26 query my-site --filter '[{"field":"properties.referrer","op":"contains","value":"clawflows.com"}]'
```

Invalid filter fields now fail loudly and return property discovery guidance instead of being silently ignored.

Identity lookup with `--email` sends the normalized email to Agent Analytics over HTTPS for server-side project-scoped HMAC matching. The CLI no longer computes or sends a local `email_hash`; raw email is not stored in event rows or profile traits.

Store compact project context when the product has custom goals, activation events, event meanings, or date annotations that should travel with analytics results. Keep this short because project-scoped analytics endpoints include it as `project_context`. `context set` accepts an encoded JSON body up to 512KB.

Use annotations for major product changes that could explain later graph movement: landing page, pricing, onboarding, feature, release, or experiment changes. Do not store git commit logs, noisy edits, temporary metric notes, PII, secrets, or long release notes. Direct `context get` returns all annotations; project-scoped analytics responses include annotations only for the requested analytics date range plus one day before and after.

Before setting or refreshing the glossary, inspect the project's current event names:

```bash
npx --yes @agent-analytics/cli@0.5.26 properties my-site
npx --yes @agent-analytics/cli@0.5.26 properties-received my-site
npx --yes @agent-analytics/cli@0.5.26 context set my-site --json '{
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

## Feedback

Use the CLI feedback command when Agent Analytics was confusing, a task took too long, or the agent had to do manual analysis that the product should have handled:

```bash
npx --yes @agent-analytics/cli@0.5.26 feedback \
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

For managed, issue-based, or remote runtimes that cannot receive a localhost callback or keep a long-running process alive, use `npx --yes @agent-analytics/cli@0.5.26 login --detached`. It prints the approval URL and exits. After browser approval, resume with the printed `login --auth-request <id> --exchange-code <code>` command.

For managed runtimes where the default home config path may not persist, point auth storage at a persistent runtime/workspace directory:

```bash
export AGENT_ANALYTICS_CONFIG_DIR="$PWD/.openclaw/agent-analytics"
npx --yes @agent-analytics/cli@0.5.26 login --detached
npx --yes @agent-analytics/cli@0.5.26 auth status
```

For one-off commands, use `--config-dir "$PWD/.openclaw/agent-analytics"` before or after the command. The CLI stores the same `config.json` file in that directory and does not migrate credentials from the default path.

For a local shell where it is useful to keep waiting, use `npx --yes @agent-analytics/cli@0.5.26 login --detached --wait`.

If your saved session predates CLI `0.5.9`, run a fresh login before calling `projects`. Older saved agent-session tokens were minted without `projects:read`, so they will keep failing until you re-authenticate. Verify with:

```bash
npx --yes @agent-analytics/cli@0.5.26 projects
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
| `AGENT_ANALYTICS_API_KEY` | Compatibility API key for direct HTTP-style runtimes; browser-approved CLI login is preferred |
| `AGENT_ANALYTICS_CONFIG_DIR` | Directory containing CLI `config.json`; use a persistent path in managed runtimes |
| `AGENT_ANALYTICS_URL` | Custom API URL (for self-hosted) |
| `AGENT_ANALYTICS_DASHBOARD_URL` | Custom dashboard URL for local upgrade-link testing |

## Links

- **Dashboard:** https://app.agentanalytics.sh
- **Docs:** https://docs.agentanalytics.sh
- **Website:** https://agentanalytics.sh
- **GitHub:** https://github.com/Agent-Analytics
- **Self-host:** https://github.com/Agent-Analytics/agent-analytics
- **Agent Skill:** https://github.com/Agent-Analytics/agent-analytics-skill

## License

MIT
