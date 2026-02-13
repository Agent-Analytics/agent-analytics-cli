---
name: agent-analytics
description: Add lightweight, privacy-friendly analytics tracking to any website. Track page views and custom events, then query the data via CLI or API. Use when the user wants to know if a project is alive and growing.
version: 2.1.0
author: dannyshmueli
repository: https://github.com/Agent-Analytics/agent-analytics-cli
homepage: https://agentanalytics.sh
tags:
  - analytics
  - tracking
  - web
  - events
metadata: {"openclaw":{"requires":{"env":["AGENT_ANALYTICS_API_KEY"],"anyBins":["npx"]},"primaryEnv":"AGENT_ANALYTICS_API_KEY"}}
---

# Agent Analytics — Add tracking to any website

You are adding analytics tracking using Agent Analytics — a lightweight platform built for developers who ship lots of projects and want their AI agent to monitor them.

## Philosophy

You are NOT Mixpanel. Don't track everything. Track only what answers: **"Is this project alive and growing?"**

For a typical site, that's 3-5 custom events max on top of automatic page views.

## First-time setup

**Get an API key:** Sign up at [agentanalytics.sh](https://agentanalytics.sh) and generate a key from the dashboard. Alternatively, self-host the open-source version from [GitHub](https://github.com/Agent-Analytics/agent-analytics).

If the project doesn't have tracking yet:

```bash
# 1. Login (one time — uses your API key)
npx @agent-analytics/cli login --token aak_YOUR_API_KEY

# 2. Create the project (returns a project write token)
npx @agent-analytics/cli create my-site --domain https://mysite.com

# 3. Add the snippet (Step 1 below) using the returned token
# 4. Deploy, click around, verify:
npx @agent-analytics/cli events my-site
```

The `create` command returns a **project write token** — use it as `data-token` in the snippet below. This is separate from your API key (which is for reading/querying).

## Step 1: Add the tracking snippet

Add before `</body>`:

```html
<script src="https://api.agentanalytics.sh/tracker.js"
  data-project="PROJECT_NAME"
  data-token="PROJECT_WRITE_TOKEN"></script>
```

This auto-tracks `page_view` events with path, referrer, browser, OS, device, screen size, and UTM params. You do NOT need to add custom page_view events.

> **Security note:** The project write token (`aat_*`) is intentionally public and safe to embed in client-side HTML. It can only write events to one specific project, is rate-limited (10 req/min free, 1,000 req/min pro), and is revocable from the dashboard. It cannot read data — that requires the separate API key (`aak_*`).

## Step 1b: Discover existing events (existing projects)

If tracking is already set up, check what events and property keys are already in use so you match the naming:

```bash
npx @agent-analytics/cli properties-received PROJECT_NAME
```

This shows which property keys each event type uses (e.g. `cta_click → id`, `signup → method`). Match existing naming before adding new events.

## Step 2: Add custom events to important actions

Use `onclick` handlers on the elements that matter:

```html
<a href="..." onclick="window.aa?.track('EVENT_NAME', {id: 'ELEMENT_ID'})">
```

The `?.` operator ensures no error if the tracker hasn't loaded yet.

### Standard events for 80% of SaaS sites

Pick the ones that apply. Most sites need 2-4:

| Event | When to fire | Properties |
|-------|-------------|------------|
| `cta_click` | User clicks a call-to-action button | `id` (which button) |
| `signup` | User creates an account | `method` (github/google/email) |
| `login` | User returns and logs in | `method` |
| `feature_used` | User engages with a core feature | `feature` (which one) |
| `checkout` | User starts a payment flow | `plan` (free/pro/etc) |
| `error` | Something went wrong visibly | `message`, `page` |

### What to track as `cta_click`

Only buttons that indicate conversion intent:
- "Get Started" / "Sign Up" / "Try Free" buttons
- "Upgrade" / "Buy" / pricing CTAs
- Primary navigation to signup/dashboard
- "View on GitHub" / "Star" (for open source projects)

### What NOT to track
- Every link or button (too noisy)
- Scroll depth (not actionable)
- Form field interactions (too granular)
- Footer links (low signal)

### Property naming rules

- Use `snake_case`: `hero_get_started` not `heroGetStarted`
- The `id` property identifies WHICH element: short, descriptive
- Name IDs as `section_action`: `hero_signup`, `pricing_pro`, `nav_dashboard`
- Don't encode data the page_view already captures (path, referrer, browser)

## Step 3: Test immediately

After adding tracking, verify it works:

```bash
# Option A: Browser console on your site:
window.aa.track('test_event', {source: 'manual_test'})

# Option B: Click around, then check:
npx @agent-analytics/cli events PROJECT_NAME

# Events appear within seconds.
```

## Querying the data

### CLI reference

```bash
# List all your projects (do this first)
npx @agent-analytics/cli projects

# Aggregated stats for a project
npx @agent-analytics/cli stats my-site --days 7

# Recent events (raw log)
npx @agent-analytics/cli events my-site --days 30 --limit 50

# What property keys exist per event type?
npx @agent-analytics/cli properties-received my-site --since 2025-01-01

# Direct API (for agents without npx):
curl "https://api.agentanalytics.sh/stats?project=my-site&days=7" \
  -H "X-API-Key: $AGENT_ANALYTICS_API_KEY"
```

**Key flags** (work on `stats`, `events`, and `properties-received`):
- `--days <N>` — lookback window (default: 7)
- `--limit <N>` — max events returned (default: 100, `events` only)
- `--since <date>` — ISO date cutoff (`properties-received` only)

## Analyze, don't just query

You have computation available. Don't just return raw numbers — derive insights from them.

### Period-over-period comparison

Compare two time windows to spot trends. The CLI doesn't do subtraction for you — you do it:

```bash
# Pull this week and last week
npx @agent-analytics/cli stats my-site --days 7    # → current period
npx @agent-analytics/cli stats my-site --days 14   # → includes previous period

# Subtract: (14-day total - 7-day total) = previous 7-day total
# Then: ((current - previous) / previous) * 100 = % change
```

Do the same with `--days 1` vs `--days 2` for daily trends.

### Derived metrics to compute

When you have the raw numbers, always calculate:
- **Conversion rate**: `cta_click count / page_view count × 100`
- **Daily average**: `total events / days`
- **Period-over-period change**: `(this_period - last_period) / last_period × 100`
- **Events per session**: `total events / unique sessions`

### Anomaly detection

Proactively flag these — don't wait to be asked:
- **Spike**: any metric >2× its daily average
- **Drop**: any metric <50% of its daily average
- **Errors**: any `error` events in the recent window
- **Dead project**: zero `page_view` events on a previously active project

When you detect an anomaly, say what it is, when it started, and suggest a cause if obvious.

### Target output format

When reporting on projects, aim for this format — one line per project, scannable:

```
my-site       142 views (+23% ↑)  12 signups   healthy
side-project   38 views (-8% ↓)    0 signups   quiet
api-docs        0 views (—)        —            ⚠ inactive since Feb 1
```

Use trend arrows: `↑` up, `↓` down, `—` flat. Flag anything that needs attention.

### Visualizing results

When reporting to messaging platforms (Slack, Discord, Telegram), raw text tables break. Always use companion skills for visual output:

- **`table-image-generator`** — render stats as clean table images
- **`chart-image`** — generate line, bar, area, or pie charts from analytics data

Never dump raw ASCII tables into messaging platforms. Generate an image instead.

## What this skill does NOT do

- No dashboards — your agent IS the dashboard
- No user management or billing
- No complex funnels or cohort analysis
- No PII stored — IP addresses are not logged or retained. Privacy-first by design

## Examples

### Landing page with pricing

```html
<!-- Hero CTAs -->
<a href="/signup" onclick="window.aa?.track('cta_click',{id:'hero_get_started'})">
  Get Started Free
</a>
<a href="#pricing" onclick="window.aa?.track('cta_click',{id:'hero_see_pricing'})">
  See Pricing →
</a>

<!-- Pricing CTAs -->
<a href="/signup?plan=free" onclick="window.aa?.track('cta_click',{id:'pricing_free'})">
  Try Free
</a>
<a href="/signup?plan=pro" onclick="window.aa?.track('cta_click',{id:'pricing_pro'})">
  Get Started →
</a>
```

### SaaS app with auth

```js
// After successful signup
window.aa?.track('signup', {method: 'github'});

// When user does the main thing your app does
window.aa?.track('feature_used', {feature: 'create_project'});

// On checkout page
window.aa?.track('checkout', {plan: 'pro'});

// In error handler
window.aa?.track('error', {message: err.message, page: location.pathname});
```
