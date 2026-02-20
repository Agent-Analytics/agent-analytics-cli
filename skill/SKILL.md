---
name: agent-analytics
description: "Open-source, agent-first headless analytics with built-in A/B testing. Add tracking to any site, run experiments, read results, and optimize conversions — all via API. Includes a growth playbook so your agent knows HOW to grow, not just what to track."
version: 2.6.0
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

## Step 2b: Run A/B experiments (Pro)

Experiments let you test which variant of a page element converts better. The full lifecycle is API-driven — no dashboard UI needed.

### Creating an experiment

```bash
npx @agent-analytics/cli experiments create my-site \
  --name signup_cta --variants control,new_cta --goal signup
```

Or via API:

```bash
curl -X POST "https://api.agentanalytics.sh/experiments" \
  -H "X-API-Key: $AGENT_ANALYTICS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project":"my-site","name":"signup_cta","variants":["control","new_cta"],"goal_event":"signup"}'
```

### Implementing variants (declarative — recommended)

The easiest way: use HTML attributes. No custom JavaScript needed.

**1. Add the anti-flicker snippet** in `<head>` before tracker.js to prevent flash of control content:

```html
<style>.aa-loading [data-aa-experiment]{visibility:hidden!important}</style>
<script>document.documentElement.classList.add('aa-loading');
setTimeout(function(){document.documentElement.classList.remove('aa-loading')},3000)</script>
```

**2. Mark elements** with `data-aa-experiment` and provide variant content via `data-aa-variant-{key}`:

```html
<!-- Original content = control. Variant "new_cta" swaps the text. -->
<h1 data-aa-experiment="signup_cta" data-aa-variant-new_cta="Start Free Trial">
  Sign Up
</h1>

<!-- Multiple elements in the same experiment get the same variant -->
<h1 data-aa-experiment="hero_test" data-aa-variant-b="New Headline">Old Headline</h1>
<p data-aa-experiment="hero_test" data-aa-variant-b="New subtext">Old subtext</p>

<!-- Multi-variant -->
<h1 data-aa-experiment="cta_test"
    data-aa-variant-b="Try it free"
    data-aa-variant-c="Get started now">
  Sign up today
</h1>
```

Key points:
- Original element content is the control (no attribute needed)
- Variant keys are lowercased for attribute lookup (HTML attributes are case-insensitive)
- Anti-flicker hides only experiment elements (not the whole page), with a 3s timeout fallback
- tracker.js removes the `aa-loading` class after applying variants
- Exposure event (`$experiment_exposure`) is tracked automatically once per session
- Track the goal event normally: `window.aa?.track('signup', {method: 'github'})`

### Implementing variants (programmatic — for complex cases)

For dynamic content or logic that can't be expressed as a text swap, use the JS API:

```js
var variant = window.aa?.experiment('signup_cta', ['control', 'new_cta']);

if (variant === 'new_cta') {
  document.querySelector('.cta').textContent = 'Start Free Trial';
} else {
  document.querySelector('.cta').textContent = 'Sign Up';
}
```

Key points:
- `aa.experiment()` is deterministic — same user always gets same variant
- The inline `['control', 'new_cta']` fallback works even if config endpoint hasn't loaded yet

### Checking results

```bash
npx @agent-analytics/cli experiments get exp_abc123
```

Returns Bayesian `probability_best`, `lift`, and a `recommendation`. The system needs ~100 exposures per variant before results are significant.

### Managing experiments

```bash
# Pause (stops assigning new users)
npx @agent-analytics/cli experiments pause exp_abc123

# Resume
npx @agent-analytics/cli experiments resume exp_abc123

# Complete with a winner
npx @agent-analytics/cli experiments complete exp_abc123 --winner new_cta

# Delete
npx @agent-analytics/cli experiments delete exp_abc123
```

### Best practices
- Name experiments with snake_case: `signup_cta`, `pricing_layout`, `hero_copy`
- Use 2 variants (A/B) unless you have high traffic — more variants need more data
- Set a clear `goal_event` that maps to a business outcome (`signup`, `purchase`, not `page_view`)
- Let experiments run until `sufficient_data: true` before picking a winner
- Complete the experiment when done: `experiments complete <id> --winner new_cta`

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

# Period-over-period comparison (this week vs last week)
npx @agent-analytics/cli insights my-site --period 7d

# Top pages, referrers, UTM sources (any property key)
npx @agent-analytics/cli breakdown my-site --property path --event page_view --limit 10

# Landing page performance
npx @agent-analytics/cli pages my-site --type entry

# Session engagement histogram
npx @agent-analytics/cli sessions-dist my-site

# Traffic patterns by day & hour
npx @agent-analytics/cli heatmap my-site

# A/B experiments (pro only)
npx @agent-analytics/cli experiments list my-site
npx @agent-analytics/cli experiments create my-site --name signup_cta --variants control,new_cta --goal signup
npx @agent-analytics/cli experiments get exp_abc123
npx @agent-analytics/cli experiments complete exp_abc123 --winner new_cta
```

**Key flags**:
- `--days <N>` — lookback window (default: 7; for `stats`, `events`)
- `--limit <N>` — max rows returned (default: 100)
- `--since <date>` — ISO date cutoff (`properties-received` only)
- `--period <P>` — comparison period: `1d`, `7d`, `14d`, `30d`, `90d` (`insights` only)
- `--property <key>` — property key to group by (`breakdown`, required)
- `--event <name>` — filter by event name (`breakdown` only)
- `--type <T>` — page type: `entry`, `exit`, `both` (`pages` only, default: entry)

### Analytics API endpoints

These endpoints return pre-computed aggregations — use them instead of downloading raw events and computing client-side. All require `X-API-Key` header or `?key=` param.

```bash
# Period-over-period comparison (replaces manual 2x /stats calls)
# period: 1d, 7d, 14d, 30d, or 90d
curl "https://api.agentanalytics.sh/insights?project=my-site&period=7d" \
  -H "X-API-Key: $AGENT_ANALYTICS_API_KEY"
# → { metrics: { total_events: { current, previous, change, change_pct }, ... }, trend }

# Property value breakdown (top pages, referrers, UTM sources, etc.)
curl "https://api.agentanalytics.sh/breakdown?project=my-site&property=path&event=page_view&limit=10" \
  -H "X-API-Key: $AGENT_ANALYTICS_API_KEY"
# → { values: [{ value: "/home", count: 523, unique_users: 312 }, ...] }

# Entry & exit page performance
# type: entry, exit, or both
curl "https://api.agentanalytics.sh/pages?project=my-site&type=entry" \
  -H "X-API-Key: $AGENT_ANALYTICS_API_KEY"
# → { entry_pages: [{ page, sessions, bounces, bounce_rate, avg_duration, avg_events }] }

# Session duration distribution (engagement histogram)
curl "https://api.agentanalytics.sh/sessions/distribution?project=my-site" \
  -H "X-API-Key: $AGENT_ANALYTICS_API_KEY"
# → { distribution: [{ bucket: "0s", sessions, pct }, ...], engaged_pct, median_bucket }

# Traffic heatmap (peak hours & busiest days)
curl "https://api.agentanalytics.sh/heatmap?project=my-site&since=2025-01-01" \
  -H "X-API-Key: $AGENT_ANALYTICS_API_KEY"
# → { heatmap: [{ day, day_name, hour, events, users }], peak, busiest_day, busiest_hour }
```

## Which endpoint for which question

Match the user's question to the right call(s):

| User asks | Call | Why |
|-----------|------|-----|
| "How's my site doing?" | `insights` + `breakdown` + `pages` (parallel) | Full weekly picture in one turn |
| "Is anyone visiting?" | `insights --period 7d` | Quick alive-or-dead check |
| "What are my top pages?" | `breakdown --property path --event page_view` | Ranked page list with unique users |
| "Where's my traffic coming from?" | `breakdown --property referrer --event page_view` | Referrer sources |
| "Which landing page is best?" | `pages --type entry` | Bounce rate + session depth per page |
| "Are people actually engaging?" | `sessions-dist` | Bounce vs engaged split |
| "When should I deploy/post?" | `heatmap` | Find low-traffic windows or peak hours |
| "Give me a summary of all projects" | Loop: `projects` then `insights` per project | Multi-project overview |
| "Which CTA converts better?" | `experiments create` + implement + `experiments get <id>` | Full A/B test lifecycle |

For any "how is X doing" question, **always call `insights` first** — it's the single most useful endpoint.

## Analyze, don't just query

Don't return raw numbers. Interpret them. Here's how to turn each endpoint's response into something useful.

### `/insights` → The headline

API returns metrics with `current`, `previous`, `change`, `change_pct`, and a `trend` field.

**How to interpret:**
- `change_pct > 10` → "Growing" — call it out positively
- `change_pct` between -10 and 10 → "Stable" — mention it's steady
- `change_pct < -10` → "Declining" — flag it, suggest investigating
- `bounce_rate` current vs previous → say "improved" (went down) or "worsened" (went up)
- `avg_duration` → convert ms to seconds: `Math.round(value / 1000)`
- Previous period is all zeros → say "new project, no prior data to compare"

**Example output:**
```
This week vs last: 173 events (+22%), 98 users (+18%).
Bounce rate: 87% (up from 82% — getting worse).
Average session: 24s. Trend: growing.
```

### `/breakdown` → The ranking

API returns `values: [{ value, count, unique_users }]` sorted by count DESC.

**How to interpret:**
- Top 3-5 values is enough — don't dump the full list
- Show the `unique_users` too — 100 events from 2 users is very different from 100 events from 80 users
- Use `total_with_property / total_events` to note coverage: "155 of 155 page views have a path"
- For referrers: group "(direct)" / empty as direct traffic

**Example output:**
```
Top pages: / (98 views, 75 users), /pricing (33 views, 25 users), /docs (19 views, 4 users).
The /docs page has high repeat visits (19 views, 4 users) — power users.
```

### `/pages` → Landing page quality

API returns `entry_pages: [{ page, sessions, bounces, bounce_rate, avg_duration, avg_events }]`.

**How to interpret:**
- `bounce_rate` > 0.7 → "high bounce, needs work above the fold"
- `bounce_rate` < 0.3 → "strong landing page"
- `avg_duration` → convert ms to seconds; < 10s is concerning, > 60s is great
- `avg_events` → pages/session; 1.0 means everyone bounces, 3+ means good engagement
- Compare pages: "Your /pricing page converts 3× better than your homepage"

**Example output:**
```
Best landing page: /pricing — 14% bounce, 62s avg session, 4.1 pages/visit.
Worst: /blog/launch — 52% bounce, 18s avg. Consider a stronger CTA above the fold.
```

### `/sessions/distribution` → Engagement shape

API returns `distribution: [{ bucket, sessions, pct }]`, `engaged_pct`, `median_bucket`.

**How to interpret:**
- `engaged_pct` is the key number — sessions ≥30s as a percentage of total
- `engaged_pct` < 10% → "Most visitors leave immediately — focus on first impressions"
- `engaged_pct` 10-30% → "Moderate engagement, room to improve"
- `engaged_pct` > 30% → "Good engagement"
- If 80%+ is in the "0s" bucket, the site has a bounce problem
- If there's a healthy spread across buckets, engagement is genuine

**Example output:**
```
88% of sessions bounce instantly (0s). Only 6% stay longer than 30s.
The few who do engage stay 3-10 minutes — the content works, but first impressions don't.
```

### `/heatmap` → Timing

API returns `heatmap: [{ day, day_name, hour, events, users }]`, `peak`, `busiest_day`, `busiest_hour`.

**How to interpret:**
- `peak` is the single busiest slot — mention day + hour + timezone caveat (times are UTC)
- `busiest_day` → "Schedule blog posts/launches on this day"
- `busiest_hour` → "This is when your audience is online"
- Low-traffic windows → "Deploy during Sunday 3 AM UTC to minimize user impact"
- Weekend vs weekday split → tells you if audience is B2B (weekdays) or B2C (weekends)

**Example output:**
```
Peak: Friday at 11 PM UTC (35 events, 33 users). Busiest day overall: Sunday.
Traffic is heaviest on weekends — your audience browses on personal time.
Deploy on weekday mornings for minimal disruption.
```

### Weekly summary recipe (3 parallel calls)

Call `insights`, `breakdown --property path --event page_view`, and `pages --type entry` in parallel, then synthesize into one response:

```
Weekly Report — my-site (Feb 8–15 vs Feb 1–8)
Events: 1,200 (+22% ↑)  Users: 450 (+18% ↑)  Bounce: 42% (improved from 48%)
Top pages: /home (523), /pricing (187), /docs (94)
Best landing: /pricing — 14% bounce, 62s avg. Worst: /blog — 52% bounce.
Trend: Growing.
```

### Multi-project overview

Call `projects` to list all projects, then call `insights --period 7d` for each. Present one line per project:

```
my-site         142 views (+23% ↑)  12 signups   healthy
side-project     38 views (-8% ↓)    0 signups   quiet
api-docs          0 views (—)        —            ⚠ inactive since Feb 1
```

Use arrows: `↑` up, `↓` down, `—` flat. Flag anything that needs attention.

### Anomaly detection

Proactively flag — don't wait to be asked:
- **Spike**: any metric >2× its previous period → "unusual surge, check referrers"
- **Drop**: any metric <50% of previous → "significant decline, worth investigating"
- **Dead project**: zero `page_view` events → "⚠ no traffic detected"
- **Errors**: any `error` events in the window → surface the `message` property

### Visualizing results

When reporting to messaging platforms (Slack, Discord, Telegram), raw text tables break. Use companion skills:

- **`table-image-generator`** — render stats as clean table images
- **`chart-image`** — generate line, bar, area, or pie charts from analytics data

## Growth Playbook — How to grow, not just track

Tracking is step one. Growth comes from a **repeatable system**: clear messaging → focused distribution → obsessive tracking → rapid experimentation → learning. Here's how to apply each principle using Agent Analytics.

### Principle 1: Promise clarity

The #1 conversion lever is messaging. If someone lands and has to think hard to understand the value, they're gone.

**What your agent should do:**
- Set up an A/B experiment on the hero headline immediately: `experiments create PROJECT --name hero_headline --variants control,b,c --goal cta_click`
- Test 2-3 headline variations that frame the same value differently
- Use declarative HTML: `data-aa-experiment="hero_headline" data-aa-variant-b="New headline"`
- Check results after ~500 visitors per variant: `experiments get EXP_ID`
- Ship the winner, start testing the subtitle or CTA next

**Rule:** Spend more time testing messaging than adding features. Even the best product won't convert if the value isn't obvious in seconds.

### Principle 2: Track what drives decisions, not everything

Don't be Mixpanel. Track only what answers: **"Is this project alive and growing, and what should I do next?"**

**The essential events (pick 3-5):**

| Event | What it tells you |
|-------|-------------------|
| `cta_click` (with `id`) | Which buttons drive action — your conversion signal |
| `signup` | Are people converting? At what rate? |
| `feature_used` (with `feature`) | Are they finding value after signup? |
| `checkout` | Revenue signal |

**Agent workflow for tracking setup:**
1. Look at the site — identify the 2-3 most important user actions
2. Add tracking on those specific actions (not everything)
3. Verify with `events PROJECT` that data flows
4. Set up a weekly check: `insights PROJECT --period 7d`

**Anti-pattern:** Don't track scroll depth, mouse hovers, every link click, or form field interactions. Noise kills signal.

### Principle 3: Find the activation moment

Conversion doesn't happen at checkout. It happens when the user realizes the product solves their problem — the "aha moment."

**How to find it:**
1. Track key feature interactions: `feature_used` with specific feature names
2. Use `breakdown --property feature --event feature_used` to see which features correlate with retention
3. Check `sessions-dist` — if most sessions are 0s bounces, the landing page is the problem. If sessions are long but signups are low, the activation path is the problem
4. Use `pages --type entry` — compare bounce rates across landing pages to find which first impression works

**What to optimize:**
- Time to first value — how fast does the user get a result?
- Onboarding friction — where do users drop off?
- Feature discovery — are users finding the thing that makes them stay?

### Principle 4: One channel, iterate relentlessly

Don't try to be everywhere. Pick one acquisition channel and go deep.

**How Agent Analytics supports this:**
- `breakdown --property referrer --event page_view` → see where traffic actually comes from
- `breakdown --property utm_source` → track campaign sources
- `insights --period 7d` → week-over-week: is the channel growing?
- Create landing page variants per channel (e.g., `/reddit/`, `/hn/`) and compare with `pages --type entry`

**Agent workflow for channel optimization:**
1. Check referrer breakdown weekly
2. Identify the top-performing channel (highest traffic + lowest bounce)
3. Double down: create content, run experiments on that channel's landing page
4. Ignore channels that aren't working — focus beats breadth

### Principle 5: The autonomous growth loop

This is what makes Agent Analytics different from traditional analytics. Your agent can run the full cycle:

```
Track → Analyze → Experiment → Ship winner → Repeat
```

**The loop in practice:**

1. **Track**: Agent sets up tracking on CTAs and key actions
2. **Analyze**: Weekly `insights` + `breakdown` + `pages` calls → synthesize into a report
3. **Hypothesize**: "Hero headline has 87% bounce — test a clearer value prop"
4. **Experiment**: `experiments create PROJECT --name hero_v2 --variants control,b --goal cta_click`
5. **Monitor**: Check `experiments get EXP_ID` after sufficient traffic
6. **Ship**: `experiments complete EXP_ID --winner b` → deploy the winner
7. **Repeat**: Start the next experiment on the next weakest element

**What to test (in order of impact):**
1. Hero headline — biggest impact on bounce rate
2. CTA button text — directly affects conversion
3. Social proof / trust signals — affects signup confidence
4. Pricing presentation — affects revenue
5. Onboarding flow — affects activation

**Cadence:** One experiment at a time. ~1-2 weeks per test depending on traffic. Don't stack experiments unless traffic is very high (>1000 visitors/day).

### Proactive growth monitoring

Don't wait for the user to ask. If your agent has scheduled checks, proactively flag:

- **Dead project**: 0 events in 7 days → "⚠ PROJECT has no traffic — is it still deployed?"
- **Conversion drop**: `cta_click` rate dropped >20% week-over-week → "Conversion declined — worth investigating"
- **Experiment ready**: An experiment has >100 exposures per variant → "Experiment X has enough data — check results"
- **Experiment winner**: Significance >95% → "Experiment X: Variant B wins with 3.8% vs 2.1%. Ship it?"
- **Traffic spike**: >2× normal → "Unusual traffic surge on PROJECT — check referrers for the source"

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
