#!/usr/bin/env node

/**
 * agent-analytics CLI
 * 
 * Usage:
 *   npx @agent-analytics/cli login --token <key>  — Save your API key
 *   npx @agent-analytics/cli create <name>         — Create a project and get your snippet
 *   npx @agent-analytics/cli projects             — List your projects
 *   npx @agent-analytics/cli stats <name>         — Get stats for a project
 *   npx @agent-analytics/cli events <name>        — Get recent events
 *   npx @agent-analytics/cli query <name>         — Flexible analytics query
 *   npx @agent-analytics/cli properties <name>    — Discover event names & property keys
 *   npx @agent-analytics/cli properties-received <name> — Show property keys per event
 *   npx @agent-analytics/cli sessions <name>      — List individual sessions
 *   npx @agent-analytics/cli insights <name>      — Period-over-period comparison
 *   npx @agent-analytics/cli breakdown <name>     — Property value distribution
 *   npx @agent-analytics/cli pages <name>         — Entry/exit page stats
 *   npx @agent-analytics/cli sessions-dist <name> — Session duration distribution
 *   npx @agent-analytics/cli heatmap <name>       — Peak hours & busiest days
 *   npx @agent-analytics/cli funnel <name>        — Funnel analysis: where users drop off
 *   npx @agent-analytics/cli retention <name>     — Cohort retention: % of users who return
 *   npx @agent-analytics/cli init <name>          — Alias for create
 *   npx @agent-analytics/cli project <id>          — Get single project details
 *   npx @agent-analytics/cli update <id>           — Update a project
 *   npx @agent-analytics/cli delete <id>           — Delete a project
 *   npx @agent-analytics/cli revoke-key           — Revoke and regenerate API key
 *   npx @agent-analytics/cli live [name]          — Real-time live view
 *   npx @agent-analytics/cli experiments list <project>   — List experiments
 *   npx @agent-analytics/cli experiments create <p> ...  — Create experiment
 *   npx @agent-analytics/cli experiments get <id>        — Get experiment with results
 *   npx @agent-analytics/cli experiments pause <id>      — Pause experiment
 *   npx @agent-analytics/cli experiments resume <id>     — Resume experiment
 *   npx @agent-analytics/cli experiments complete <id>   — Complete experiment
 *   npx @agent-analytics/cli experiments delete <id>     — Delete experiment
 *   npx @agent-analytics/cli delete-account       — Delete your account (opens dashboard)
 *   npx @agent-analytics/cli whoami               — Show current account
 */

import { AgentAnalyticsAPI } from '../lib/api.mjs';
import { getApiKey, setApiKey, getBaseUrl, getConfig, saveConfig } from '../lib/config.mjs';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const WHITE = '\x1b[37m';
const RESET = '\x1b[0m';

function log(msg = '') { console.log(msg); }
function success(msg) { log(`${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { log(`${YELLOW}⚠${RESET} ${msg}`); }
function error(msg) { log(`${RED}✗${RESET} ${msg}`); process.exit(1); }
function heading(msg) { log(`\n${BOLD}${msg}${RESET}`); }

function requireKey() {
  const key = getApiKey();
  if (!key) {
    error('Not logged in. Run: npx @agent-analytics/cli login');
  }
  return new AgentAnalyticsAPI(key, getBaseUrl());
}

function withApi(fn) {
  return async (...args) => {
    const api = requireKey();
    try {
      return await fn(api, ...args);
    } catch (err) {
      error(err.message);
    }
  };
}

function ifEmpty(arr, label) {
  if (!arr || arr.length === 0) { log(`  No ${label} found.`); return true; }
  return false;
}

// ==================== COMMANDS ====================

async function cmdLogin(token) {
  if (!token) {
    heading('Agent Analytics — Login');
    log('');
    log('Pass your API key from the dashboard:');
    log(`  ${CYAN}npx @agent-analytics/cli login --token aak_your_key_here${RESET}`);
    log('');
    log('Or set it as an environment variable:');
    log(`  ${CYAN}export AGENT_ANALYTICS_API_KEY=aak_your_key_here${RESET}`);
    log('');
    log(`Get your API key at: ${CYAN}https://app.agentanalytics.sh${RESET}`);
    log(`${DIM}Sign in with GitHub or Google — your API key is on the settings page.${RESET}`);
    return;
  }

  // Validate the token works
  const api = new AgentAnalyticsAPI(token, getBaseUrl());
  try {
    const account = await api.getAccount();
    setApiKey(token);
    const config = getConfig();
    config.email = account.email;
    config.github_login = account.github_login;
    saveConfig(config);

    success(`Logged in as ${BOLD}${account.github_login || account.email}${RESET} (${account.tier})`);
    log(`${DIM}API key saved to ~/.config/agent-analytics/config.json${RESET}`);
    log('');
    log(`Next steps:`);
    log(`  ${CYAN}npx @agent-analytics/cli create my-site --domain https://mysite.com${RESET}`);
    log(`  ${CYAN}npx @agent-analytics/cli live${RESET}  ${DIM}— real-time view across all projects${RESET}`);
  } catch (err) {
    error(`Invalid API key: ${err.message}`);
  }
}

const cmdCreate = withApi(async (api, name, domain) => {
  if (!name) error('Usage: npx @agent-analytics/cli create <project-name> --domain https://mysite.com');
  if (!domain) error('Usage: npx @agent-analytics/cli create <project-name> --domain https://mysite.com\n\nThe domain is required so we can restrict tracking to your site.');

  heading(`Creating project: ${name}`);

  const data = await api.createProject(name, domain);

  success(data.existing
    ? `Found existing project for ${BOLD}${domain}${RESET}!\n`
    : `Project created for ${BOLD}${domain}${RESET}!\n`);

  heading('1. Add this snippet to your site:');
  log(`${CYAN}${data.snippet}${RESET}\n`);

  heading('2. Your agent queries stats with:');
  log(`${CYAN}${data.api_example}${RESET}\n`);

  heading('Project token (for the snippet):');
  log(`${YELLOW}${data.project_token}${RESET}\n`);

  log(`${DIM}Your AI agent can now track, analyze, and run experiments on ${name}.${RESET}`);
  log(`${DIM}Watch it live: ${CYAN}npx @agent-analytics/cli live ${name}${RESET}\n`);
});

const cmdProjects = withApi(async (api) => {
  const data = await api.listProjects();
  const projects = data.projects;

  if (!projects || projects.length === 0) {
    log('No projects yet. Create one:');
    log(`  ${CYAN}npx @agent-analytics/cli create my-site${RESET}`);
    return;
  }

  heading(`Your Projects (${projects.length})`);
  log('');

  for (const p of projects) {
    const created = new Date(p.created_at).toLocaleDateString();
    log(`  ${BOLD}${p.name}${RESET}  ${DIM}created ${created}${RESET}`);
    log(`  ${DIM}token:${RESET} ${p.project_token}`);
    log(`  ${DIM}origins:${RESET} ${p.allowed_origins || '*'}`);
    log('');
  }
});

const cmdStats = withApi(async (api, project, days = 7) => {
  if (!project) error('Usage: npx @agent-analytics/cli stats <project-name> [--days N]');

  const result = await api.getStats(project, days, { returnHeaders: true });
  const data = result.data;
  const headers = result.headers;

  heading(`Stats: ${project} (last ${days} days)`);
  log('');

  if (data.totals) {
    log(`  ${BOLD}Total events:${RESET}   ${data.totals.total_events || 0}`);
    log(`  ${BOLD}Unique users:${RESET}   ${data.totals.unique_users || 0}`);
  }

  if (data.events && data.events.length > 0) {
    log('');
    heading('Events:');
    for (const e of data.events) {
      log(`  ${e.event}  ${DIM}→${RESET}  ${BOLD}${e.count}${RESET}  ${DIM}(${e.unique_users} users)${RESET}`);
    }
  }

  if (data.daily && data.daily.length > 0) {
    log('');
    heading('Daily:');
    for (const d of data.daily) {
      const bar = '█'.repeat(Math.min(Math.ceil(d.total_events / 5), 40));
      log(`  ${d.date}  ${GREEN}${bar}${RESET}  ${d.total_events} events`);
    }
  }

  // Monthly usage summary from response headers
  const monthlyUsage = headers['x-monthly-usage'];
  if (monthlyUsage) {
    const events = parseInt(monthlyUsage, 10);
    const bill = (events / 1000) * 2;
    const monthlyLimit = headers['x-monthly-limit'];
    const pct = headers['x-monthly-usage-percent'];
    log('');
    if (monthlyLimit && pct) {
      const capDollars = (parseInt(monthlyLimit, 10) / 1000) * 2;
      log(`  ${DIM}Monthly usage:${RESET} ${events.toLocaleString()} events ($${bill.toFixed(2)}) — ${pct}% of $${capDollars.toFixed(2)} cap`);
    } else {
      log(`  ${DIM}Monthly usage:${RESET} ${events.toLocaleString()} events ($${bill.toFixed(2)})`);
    }
  }

  log('');
});

const cmdEvents = withApi(async (api, project, opts = {}) => {
  if (!project) error('Usage: npx @agent-analytics/cli events <project-name> [--days N] [--limit N]');

  const data = await api.getEvents(project, opts);

  heading(`Events: ${project}`);
  log('');

  if (ifEmpty(data.events, 'events')) return;

  for (const e of data.events) {
    const time = new Date(e.timestamp).toLocaleString();
    log(`  ${DIM}${time}${RESET}  ${BOLD}${e.event}${RESET}  ${DIM}${e.user_id || ''}${RESET}`);
    if (e.properties) {
      log(`    ${DIM}${JSON.stringify(e.properties)}${RESET}`);
    }
  }
  log('');
});

const cmdPropertiesReceived = withApi(async (api, project, opts = {}) => {
  if (!project) error('Usage: npx @agent-analytics/cli properties-received <project-name> [--since DATE] [--sample N]');

  const data = await api.getPropertiesReceived(project, opts);

  heading(`Received Properties: ${project}`);
  log('');

  if (ifEmpty(data.properties, 'properties')) return;

  // Group by event for display
  const byEvent = {};
  for (const p of data.properties) {
    if (!byEvent[p.event]) byEvent[p.event] = [];
    byEvent[p.event].push(p.key);
  }

  for (const [event, keys] of Object.entries(byEvent)) {
    log(`  ${BOLD}${event}${RESET}`);
    for (const key of keys) {
      log(`    ${CYAN}${key}${RESET}`);
    }
  }

  log(`\n${DIM}Sampled from last ${data.sample_size} events${RESET}`);
  log('');
});

const cmdInsights = withApi(async (api, project, period = '7d') => {
  if (!project) error('Usage: npx @agent-analytics/cli insights <project-name> [--period 7d]');

  const data = await api.getInsights(project, { period });

  heading(`Insights: ${project} (${period} vs previous)`);
  log('');

  const m = data.metrics;
  for (const [key, metric] of Object.entries(m)) {
    const label = key.replace(/_/g, ' ');
    const arrow = metric.change > 0 ? `${GREEN}↑` : metric.change < 0 ? `${RED}↓` : `${DIM}—`;
    const pct = metric.change_pct !== null ? ` (${metric.change_pct > 0 ? '+' : ''}${metric.change_pct}%)` : '';
    log(`  ${BOLD}${label}:${RESET}  ${metric.current} ${arrow}${pct}${RESET}  ${DIM}was ${metric.previous}${RESET}`);
  }

  log('');
  log(`  ${BOLD}Trend:${RESET} ${data.trend}`);
  log('');
});

const cmdBreakdown = withApi(async (api, project, property, opts = {}) => {
  if (!project || !property) error('Usage: npx @agent-analytics/cli breakdown <project-name> --property <key> [--event page_view] [--limit 20]');

  const data = await api.getBreakdown(project, { property, ...opts });

  heading(`Breakdown: ${project} — ${property}${data.event ? ` (${data.event})` : ''}`);
  log('');

  if (ifEmpty(data.values, 'data')) return;

  for (const v of data.values) {
    log(`  ${BOLD}${v.value}${RESET}  ${v.count} events  ${DIM}(${v.unique_users} users)${RESET}`);
  }
  log(`\n${DIM}${data.total_with_property} of ${data.total_events} events have this property${RESET}`);
  log('');
});

const cmdPages = withApi(async (api, project, type = 'entry', opts = {}) => {
  if (!project) error('Usage: npx @agent-analytics/cli pages <project-name> [--type entry|exit|both] [--limit 20]');

  const data = await api.getPages(project, { type, ...opts });

  heading(`Pages: ${project} (${type})`);
  log('');

  const pages = data.entry_pages || data.exit_pages || [];
  if (ifEmpty(pages, 'page data')) return;

  for (const p of pages) {
    const bounceStr = `${Math.round(p.bounce_rate * 100)}% bounce`;
    const durStr = `${Math.round(p.avg_duration / 1000)}s avg`;
    log(`  ${BOLD}${p.page}${RESET}  ${p.sessions} sessions  ${DIM}${bounceStr}  ${durStr}  ${p.avg_events} events/session${RESET}`);
  }

  if (data.exit_pages && data.entry_pages) {
    log('');
    heading('Exit pages:');
    for (const p of data.exit_pages) {
      log(`  ${BOLD}${p.page}${RESET}  ${p.sessions} sessions`);
    }
  }
  log('');
});

const cmdSessionsDist = withApi(async (api, project) => {
  if (!project) error('Usage: npx @agent-analytics/cli sessions-dist <project-name>');

  const data = await api.getSessionDistribution(project);

  heading(`Session Distribution: ${project}`);
  log('');

  if (ifEmpty(data.distribution, 'session data')) return;

  for (const b of data.distribution) {
    const bar = '█'.repeat(Math.min(Math.ceil(b.pct / 2), 40));
    log(`  ${b.bucket.padEnd(7)}  ${GREEN}${bar}${RESET}  ${b.sessions} (${b.pct}%)`);
  }

  log('');
  log(`  ${BOLD}Median:${RESET} ${data.median_bucket}  ${BOLD}Engaged:${RESET} ${data.engaged_pct}% (sessions ≥30s)`);
  log('');
});

const cmdHeatmap = withApi(async (api, project) => {
  if (!project) error('Usage: npx @agent-analytics/cli heatmap <project-name>');

  const data = await api.getHeatmap(project);

  heading(`Heatmap: ${project}`);
  log('');

  if (ifEmpty(data.heatmap, 'heatmap data')) return;

  if (data.peak) {
    log(`  ${BOLD}Peak:${RESET} ${data.peak.day_name} at ${data.peak.hour}:00 (${data.peak.events} events, ${data.peak.users} users)`);
  }
  log(`  ${BOLD}Busiest day:${RESET} ${data.busiest_day}`);
  log(`  ${BOLD}Busiest hour:${RESET} ${data.busiest_hour}:00`);
  log('');
});

const cmdFunnel = withApi(async (api, project, stepsStr, opts = {}) => {
  if (!project || !stepsStr) error('Usage: npx @agent-analytics/cli funnel <project-name> --steps "page_view,signup,purchase" [--window 168] [--since 30d] [--count-by user_id] [--breakdown country] [--breakdown-limit 10]');

  const steps = stepsStr.split(',').map(s => ({ event: s.trim() }));
  if (steps.length < 2) error('At least 2 steps required');

  const data = await api.getFunnel(project, {
    steps,
    conversion_window_hours: opts.window ? parseInt(opts.window, 10) : undefined,
    since: opts.since,
    count_by: opts.count_by,
    breakdown: opts.breakdown || undefined,
    breakdown_limit: opts.breakdown_limit ? parseInt(opts.breakdown_limit, 10) : undefined,
  });

  heading(`Funnel: ${project}`);
  log('');

  if (!data.steps || data.steps.length === 0) {
    log('  No funnel data.');
    return;
  }

  const maxUsers = Math.max(...data.steps.map(s => s.users));
  for (const step of data.steps) {
    const barLen = maxUsers > 0 ? Math.max(1, Math.round((step.users / maxUsers) * 30)) : 1;
    const bar = '█'.repeat(barLen);
    const rate = step.step === 1 ? '' : `  ${DIM}${Math.round(step.conversion_rate * 100)}% conversion${RESET}`;
    const time = step.avg_time_to_next_ms != null ? `  ${DIM}→ ${Math.round(step.avg_time_to_next_ms / 1000)}s to next${RESET}` : '';
    log(`  ${step.step}. ${BOLD}${step.event.padEnd(20)}${RESET}  ${GREEN}${bar}${RESET}  ${step.users} users${rate}${time}`);
  }

  log('');
  log(`  ${BOLD}Overall conversion:${RESET} ${Math.round(data.overall_conversion_rate * 100)}%`);

  // Breakdown groups
  if (data.breakdowns && data.breakdowns.length > 0) {
    log('');
    heading(`Breakdown by ${opts.breakdown} (${data.breakdowns.length} groups)`);
    log('');
    for (const bd of data.breakdowns) {
      const label = bd.value ?? '(none)';
      const bdMax = Math.max(...bd.steps.map(s => s.users));
      log(`  ${BOLD}${CYAN}${label}${RESET}  ${DIM}${Math.round(bd.overall_conversion_rate * 100)}% overall${RESET}`);
      for (const step of bd.steps) {
        const barLen = bdMax > 0 ? Math.max(1, Math.round((step.users / bdMax) * 25)) : 1;
        const bar = '█'.repeat(barLen);
        const rate = step.step === 1 ? '' : `  ${DIM}${Math.round(step.conversion_rate * 100)}%${RESET}`;
        log(`    ${step.step}. ${step.event.padEnd(18)}  ${GREEN}${bar}${RESET}  ${step.users}${rate}`);
      }
      log('');
    }
  }

  log('');
});

const cmdRetention = withApi(async (api, project, opts = {}) => {
  if (!project) error('Usage: npx @agent-analytics/cli retention <project-name> [--period week] [--cohorts 8] [--event signup] [--returning-event purchase]\n\nBy default uses session-based retention (any return visit counts). Pass --event to switch to event-based retention.');

  const data = await api.getRetention(project, {
    period: opts.period,
    cohorts: opts.cohorts ? parseInt(opts.cohorts, 10) : undefined,
    event: opts.event,
    returning_event: opts.returning_event,
  });

  const periodLabel = data.period === 'day' ? 'daily' : data.period + 'ly';
  heading(`Retention: ${project} (${periodLabel} cohorts)`);
  log('');

  if (!data.cohorts || data.cohorts.length === 0) {
    log('  No retention data (no users with user_id in this period).');
    return;
  }

  // Header row
  const maxOffsets = data.cohorts[0].rates.length;
  const prefix = data.period === 'day' ? 'D' : data.period === 'month' ? 'M' : 'W';
  const header = '  ' + 'Cohort'.padEnd(14) + 'Users'.padStart(7) + '  ' + Array.from({ length: maxOffsets }, (_, i) => (prefix + i).padStart(6)).join('');
  log(`${DIM}${header}${RESET}`);

  for (const c of data.cohorts) {
    let row = '  ' + c.date.padEnd(14) + String(c.users).padStart(7) + '  ';
    for (let i = 0; i < maxOffsets; i++) {
      if (i < c.rates.length) {
        const pctVal = Math.round(c.rates[i] * 100);
        const color = pctVal >= 40 ? GREEN : pctVal >= 20 ? YELLOW : pctVal > 0 ? RED : DIM;
        row += `${color}${(pctVal + '%').padStart(6)}${RESET}`;
      } else {
        row += '      ';
      }
    }
    log(row);
  }

  if (data.average_rates && data.average_rates.length > 0) {
    let avgRow = '  ' + `${BOLD}Avg${RESET}`.padEnd(14 + 11) + '  '; // 11 accounts for BOLD+RESET escape codes
    // Recalculate padding since escape codes have length
    avgRow = '  ' + BOLD + 'Avg' + RESET + ' '.repeat(11) + '       ' + '  ';
    for (const r of data.average_rates) {
      avgRow += `${BOLD}${(Math.round(r * 100) + '%').padStart(6)}${RESET}`;
    }
    log(avgRow);
  }

  log('');
  log(`  ${DIM}${data.users_analyzed} users analyzed${RESET}`);
  log('');
});

const cmdProperties = withApi(async (api, project, days = 30) => {
  if (!project) error('Usage: npx @agent-analytics/cli properties <project-name> [--days N]');

  const data = await api.getProperties(project, days);

  heading(`Properties: ${project}`);
  log('');

  if (data.events && data.events.length > 0) {
    heading('Events:');
    for (const e of data.events) {
      log(`  ${BOLD}${e.event}${RESET}  ${e.count} events  ${DIM}(${e.unique_users} users)${RESET}  ${DIM}${e.first_seen} → ${e.last_seen}${RESET}`);
    }
    log('');
  }

  if (data.property_keys && data.property_keys.length > 0) {
    heading('Property keys:');
    log(`  ${data.property_keys.join(', ')}`);
  }
  log('');
});

const cmdSessions = withApi(async (api, project, opts = {}) => {
  if (!project) error('Usage: npx @agent-analytics/cli sessions <project-name> [--days N] [--limit N]');

  const data = await api.getSessions(project, opts);

  heading(`Sessions: ${project}`);
  log('');

  if (ifEmpty(data.sessions, 'sessions')) return;

  for (const s of data.sessions) {
    const start = new Date(s.start_time).toLocaleString();
    const dur = s.duration ? `${Math.round(s.duration / 1000)}s` : '0s';
    const bounce = s.is_bounce ? `${RED}bounce${RESET}` : `${GREEN}engaged${RESET}`;
    log(`  ${DIM}${start}${RESET}  ${dur}  ${bounce}  ${s.event_count} events  ${DIM}${s.entry_page} → ${s.exit_page}${RESET}`);
  }
  log('');
});

const cmdQuery = withApi(async (api, project, opts = {}) => {
  if (!project) error('Usage: npx @agent-analytics/cli query --project <name> [--metrics event_count,unique_users] [--group-by date] [--days N] [--limit N]');

  const metrics = opts.metrics ? opts.metrics.split(',').map(m => m.trim()) : undefined;
  const group_by = opts.group_by ? opts.group_by.split(',').map(g => g.trim()) : undefined;

  const data = await api.query(project, {
    metrics,
    group_by,
    date_from: opts.date_from,
    date_to: opts.date_to,
    order_by: opts.order_by,
    order: opts.order,
    limit: opts.limit,
  });

  heading(`Query: ${project}`);
  log('');

  if (data.period) {
    log(`  ${DIM}Period: ${data.period.from} → ${data.period.to}${RESET}`);
  }

  if (!data.rows || data.rows.length === 0) {
    log('  No results.');
    return;
  }

  const keys = Object.keys(data.rows[0]);
  log(`  ${BOLD}${keys.join('\t')}${RESET}`);
  for (const row of data.rows) {
    log(`  ${keys.map(k => row[k]).join('\t')}`);
  }
  log(`\n${DIM}${data.count} rows${RESET}`);
  log('');
});

const cmdProject = withApi(async (api, id) => {
  if (!id) error('Usage: npx @agent-analytics/cli project <project-id>');
  const data = await api.getProject(id);

  heading(`Project: ${data.name}`);
  log('');
  log(`  ${BOLD}ID:${RESET}      ${data.id}`);
  log(`  ${BOLD}Token:${RESET}   ${data.project_token}`);
  log(`  ${BOLD}Origins:${RESET} ${data.allowed_origins || '*'}`);
  if (data.created_at) log(`  ${BOLD}Created:${RESET} ${new Date(data.created_at).toLocaleDateString()}`);
  if (data.total_events != null) log(`  ${BOLD}Events:${RESET}  ${data.total_events}`);
  log('');
});

const cmdUpdate = withApi(async (api, id, opts = {}) => {
  if (!id) error('Usage: npx @agent-analytics/cli update <project-id> [--name new-name] [--origins "https://example.com"]');
  if (!opts.name && !opts.allowed_origins) error('Provide --name and/or --origins to update');

  const data = await api.updateProject(id, opts);
  success(`Project ${data.name || id} updated`);
  if (opts.name) log(`  ${DIM}name:${RESET} ${data.name}`);
  if (opts.allowed_origins) log(`  ${DIM}origins:${RESET} ${data.allowed_origins}`);
});

const cmdDelete = withApi(async (api, id) => {
  if (!id) error('Usage: npx @agent-analytics/cli delete <project-id>');
  await api.deleteProject(id);
  success(`Project ${id} deleted`);
});

function cmdDeleteAccount() {
  heading('Delete Account');
  log('');
  log('For security, account deletion must be done from the dashboard.');
  log(`Visit: ${CYAN}https://app.agentanalytics.sh/settings${RESET}`);
  log('');
}

const cmdRevokeKey = withApi(async (api) => {
  const data = await api.revokeKey();
  setApiKey(data.api_key);

  warn('Old API key revoked');
  success('New API key generated and saved\n');
  heading('New API key:');
  log(`${YELLOW}${data.api_key}${RESET}`);
  log(`${DIM}Saved to ~/.config/agent-analytics/config.json${RESET}\n`);
  warn('Update your agent with this new key!');
});

const cmdWhoami = withApi(async (api) => {
  const data = await api.getAccount();
  heading('Account');
  log(`  ${BOLD}Email:${RESET}    ${data.email}`);
  log(`  ${BOLD}GitHub:${RESET}   ${data.github_login || 'N/A'}`);
  log(`  ${BOLD}Tier:${RESET}     ${data.tier}`);
  log(`  ${BOLD}Projects:${RESET} ${data.projects_count}/${data.projects_limit}`);
  if (data.tier === 'pro' && data.monthly_spend_cap_dollars != null) {
    log(`  ${BOLD}Spend cap:${RESET} $${data.monthly_spend_cap_dollars.toFixed(2)}/month`);
  }
  log('');
});

// ==================== LIVE ====================

const cmdLive = withApi(async (api, project, opts = {}) => {
  const interval = parseInt(opts.interval || '5', 10);
  const windowSec = parseInt(opts.window || '60', 10);

  // Get project list
  const { projects } = await api.listProjects();
  if (!projects || projects.length === 0) {
    error('No projects found. Create one first.');
  }

  // If a specific project given, filter to it
  const targetProjects = project
    ? projects.filter(p => p.name === project)
    : projects;

  if (project && targetProjects.length === 0) {
    error(`Project "${project}" not found.`);
  }

  const projectNames = targetProjects.map(p => p.name);

  // Hide cursor
  process.stdout.write('\x1b[?25l');

  // Restore cursor on exit
  const cleanup = () => {
    process.stdout.write('\x1b[?25h\n');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  while (true) {
    const snapshots = await Promise.all(
      projectNames.map(async (name) => {
        try {
          const snap = await api.getLive(name, { window: windowSec });
          return { name, ...snap };
        } catch {
          return { name, active_visitors: 0, active_sessions: 0, events_per_minute: 0, top_pages: [], top_events: [], recent_events: [] };
        }
      })
    );

    // Aggregate totals
    let totalVisitors = 0, totalSessions = 0, totalEpm = 0;
    const allPages = [];
    const allRecent = [];

    for (const snap of snapshots) {
      totalVisitors += snap.active_visitors || 0;
      totalSessions += snap.active_sessions || 0;
      totalEpm += snap.events_per_minute || 0;

      for (const p of (snap.top_pages || []).slice(0, 3)) {
        allPages.push({ ...p, project: snap.name });
      }
      for (const e of (snap.recent_events || []).slice(0, 3)) {
        allRecent.push({ ...e, project: snap.name });
      }
    }

    // Sort recent by timestamp descending
    allRecent.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    // Sort pages by visitors descending
    allPages.sort((a, b) => (b.visitors || 0) - (a.visitors || 0));

    // Render
    const now = new Date().toLocaleTimeString();
    const lines = [];

    lines.push('');
    lines.push(`  ${BOLD}Agent Analytics${RESET} ${DIM}— Live${RESET}  ${DIM}${now}  (${interval}s refresh, ${windowSec}s window)${RESET}`);
    lines.push(`  ${DIM}${'─'.repeat(56)}${RESET}`);
    lines.push('');
    lines.push(`  ${BOLD}${CYAN}${totalVisitors}${RESET} visitors  ${BOLD}${YELLOW}${totalSessions}${RESET} sessions  ${BOLD}${MAGENTA}${totalEpm}${RESET} events/min  ${DIM}${projectNames.length} project${projectNames.length !== 1 ? 's' : ''}${RESET}`);
    lines.push('');

    // Per-project
    lines.push(`  ${BOLD}Projects${RESET}`);
    for (const snap of snapshots) {
      if (snap.active_visitors > 0 || snap.events_per_minute > 0) {
        lines.push(`  ${GREEN}●${RESET} ${BOLD}${snap.name}${RESET}  ${CYAN}${snap.active_visitors}${RESET} visitors  ${YELLOW}${snap.active_sessions}${RESET} sessions  ${MAGENTA}${snap.events_per_minute}${RESET} evt/min`);
      } else {
        lines.push(`  ${DIM}○ ${snap.name}  —${RESET}`);
      }
    }
    lines.push('');

    // Top pages
    if (allPages.length > 0) {
      lines.push(`  ${BOLD}Top Pages${RESET}`);
      for (const p of allPages.slice(0, 8)) {
        const proj = p.project.padEnd(22);
        const path = (p.path || '/').padEnd(20);
        lines.push(`    ${WHITE}${proj}${RESET} ${DIM}${path}${RESET} ${CYAN}${p.visitors}${RESET}`);
      }
      lines.push('');
    }

    // Recent events
    if (allRecent.length > 0) {
      lines.push(`  ${BOLD}Recent Events${RESET}`);
      for (const e of allRecent.slice(0, 10)) {
        const ts = new Date(e.timestamp).toLocaleTimeString();
        const proj = (e.project || '').padEnd(20);
        const evt = (e.event || '').padEnd(16);
        const path = (e.properties?.path || '').padEnd(20);
        const uid = e.user_id ? e.user_id.slice(0, 12) : '';
        lines.push(`    ${DIM}${ts}${RESET}  ${WHITE}${proj}${RESET} ${GREEN}${evt}${RESET} ${DIM}${path}${RESET} ${DIM}${uid}${RESET}`);
      }
      lines.push('');
    }

    lines.push(`  ${DIM}Press Ctrl+C to exit${RESET}`);

    // Clear and write
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write(lines.join('\n') + '\n');

    await new Promise(r => setTimeout(r, interval * 1000));
  }
});

// ==================== EXPERIMENTS ====================

const cmdExperiments = withApi(async (api, sub, ...rest) => {
  if (!sub) error('Usage: npx @agent-analytics/cli experiments <list|create|get|pause|resume|complete|delete> ...');

  switch (sub) {
    case 'list': {
      const project = rest[0];
      if (!project) error('Usage: npx @agent-analytics/cli experiments list <project>');
      const data = await api.listExperiments(project);
      heading(`Experiments: ${project}`);
      log('');
      if (ifEmpty(data.experiments, 'experiments')) return;
      for (const e of data.experiments) {
        const status = e.status === 'active' ? `${GREEN}active${RESET}` : e.status === 'paused' ? `${YELLOW}paused${RESET}` : `${DIM}completed${RESET}`;
        log(`  ${BOLD}${e.name}${RESET}  ${DIM}${e.id}${RESET}  ${status}  ${DIM}goal: ${e.goal_event}${RESET}`);
        const variants = e.variants.map(v => `${v.key}(${v.weight}%)`).join(', ');
        log(`    variants: ${variants}`);
        if (e.winner) log(`    ${GREEN}winner: ${e.winner}${RESET}`);
      }
      log('');
      break;
    }
    case 'create': {
      const project = rest[0];
      if (!project) error('Usage: npx @agent-analytics/cli experiments create <project> --name <name> --variants control,new_cta --goal <event> [--weights 60,40]');
      const name = getArg('--name');
      const variantsStr = getArg('--variants');
      const goal = getArg('--goal');
      if (!name || !variantsStr || !goal) error('Required: --name, --variants, --goal');
      const variants = variantsStr.split(',').map(v => v.trim());
      const weightsStr = getArg('--weights');
      const weights = weightsStr ? weightsStr.split(',').map(w => parseInt(w.trim(), 10)) : undefined;
      const data = await api.createExperiment(project, { name, variants, goal_event: goal, weights });
      success(`Experiment created: ${BOLD}${data.name}${RESET} (${data.id})`);
      log(`  ${DIM}variants:${RESET} ${data.variants.map(v => `${v.key}(${v.weight}%)`).join(', ')}`);
      log(`  ${DIM}goal:${RESET} ${data.goal_event}`);
      log('');
      break;
    }
    case 'get': {
      const id = rest[0];
      if (!id) error('Usage: npx @agent-analytics/cli experiments get <id>');
      const data = await api.getExperiment(id);
      const status = data.status === 'active' ? `${GREEN}active${RESET}` : data.status === 'paused' ? `${YELLOW}paused${RESET}` : `${DIM}completed${RESET}`;
      heading(`Experiment: ${data.name}`);
      log(`  ${DIM}id:${RESET} ${data.id}  status: ${status}  ${DIM}goal: ${data.goal_event}${RESET}`);
      if (data.winner) log(`  ${GREEN}winner: ${data.winner}${RESET}`);
      log('');
      if (data.results) {
        heading('Results:');
        for (const v of data.results.variants) {
          const rate = (v.conversion_rate * 100).toFixed(1);
          log(`  ${BOLD}${v.key}${RESET}  ${v.unique_users} users  ${v.conversions} conversions  ${CYAN}${rate}%${RESET}`);
        }
        log('');
        if (data.results.probability_best) {
          heading('Probability best:');
          for (const [k, v] of Object.entries(data.results.probability_best)) {
            const pct = (v * 100).toFixed(1);
            log(`  ${BOLD}${k}:${RESET} ${pct}%`);
          }
        }
        if (data.results.lift) {
          heading('Lift:');
          for (const [k, v] of Object.entries(data.results.lift)) {
            const pct = (v * 100).toFixed(1);
            const arrow = v > 0 ? `${GREEN}+${pct}%` : v < 0 ? `${RED}${pct}%` : `${DIM}0%`;
            log(`  ${BOLD}${k}:${RESET} ${arrow}${RESET}`);
          }
        }
        log('');
        log(`  ${BOLD}Sufficient data:${RESET} ${data.results.sufficient_data ? `${GREEN}yes` : `${YELLOW}no`}${RESET}`);
        if (data.results.recommendation) {
          log(`  ${BOLD}Recommendation:${RESET} ${data.results.recommendation}`);
        }
      } else {
        log(`  ${DIM}No results available yet (need exposure + conversion events)${RESET}`);
      }
      log('');
      break;
    }
    case 'pause': {
      const id = rest[0];
      if (!id) error('Usage: npx @agent-analytics/cli experiments pause <id>');
      await api.updateExperiment(id, { status: 'paused' });
      success(`Experiment ${id} paused`);
      break;
    }
    case 'resume': {
      const id = rest[0];
      if (!id) error('Usage: npx @agent-analytics/cli experiments resume <id>');
      await api.updateExperiment(id, { status: 'active' });
      success(`Experiment ${id} resumed`);
      break;
    }
    case 'complete': {
      const id = rest[0];
      if (!id) error('Usage: npx @agent-analytics/cli experiments complete <id> [--winner <variant>]');
      const winner = getArg('--winner');
      await api.updateExperiment(id, { status: 'completed', winner });
      success(`Experiment ${id} completed${winner ? ` — winner: ${winner}` : ''}`);
      break;
    }
    case 'delete': {
      const id = rest[0];
      if (!id) error('Usage: npx @agent-analytics/cli experiments delete <id>');
      await api.deleteExperiment(id);
      success(`Experiment ${id} deleted`);
      break;
    }
    default:
      error(`Unknown experiments subcommand: ${sub}. Use: list, create, get, pause, resume, complete, delete`);
  }
});

function showHelp() {
  log(`
${BOLD}Agent Analytics${RESET} — Stop juggling dashboards. Let your agent do it.
${DIM}Analytics your AI agent can actually use. Track, analyze, experiment, optimize.${RESET}

${BOLD}USAGE${RESET}
  npx @agent-analytics/cli <command> [options]

${BOLD}SETUP${RESET}
  ${CYAN}login${RESET} --token <key>   Save your API key
  ${CYAN}create${RESET} <name>          Create a project and get your tracking snippet
  ${CYAN}projects${RESET}               List all your projects

${BOLD}ANALYTICS${RESET}
  ${CYAN}stats${RESET} <name>           Overview: events, users, daily trends
  ${CYAN}live${RESET} [name]            Real-time terminal dashboard across all projects
  ${CYAN}insights${RESET} <name>        Period-over-period comparison with trends
  ${CYAN}breakdown${RESET} <name>       Top pages, referrers, UTM sources, countries
  ${CYAN}pages${RESET} <name>           Entry/exit page performance & bounce rates
  ${CYAN}heatmap${RESET} <name>         Peak hours & busiest days
  ${CYAN}funnel${RESET} <name>            Funnel analysis: where users drop off
  ${CYAN}retention${RESET} <name>         Cohort retention: % of users who return
  ${CYAN}sessions-dist${RESET} <name>   Session duration distribution
  ${CYAN}events${RESET} <name>          Raw event log
  ${CYAN}sessions${RESET} <name>        Individual session records
  ${CYAN}query${RESET} <name>           Flexible analytics query (metrics, group_by, filters)
  ${CYAN}properties${RESET} <name>      Discover event names & property keys

${BOLD}EXPERIMENTS${RESET} ${DIM}— A/B testing your agent can actually use${RESET}
  ${CYAN}experiments list${RESET} <project>     List experiments
  ${CYAN}experiments create${RESET} <project>   Create experiment
  ${CYAN}experiments get${RESET} <id>           Get experiment with results & significance
  ${CYAN}experiments pause${RESET} <id>         Pause experiment
  ${CYAN}experiments resume${RESET} <id>        Resume experiment
  ${CYAN}experiments complete${RESET} <id>      Ship the winner
  ${CYAN}experiments delete${RESET} <id>        Delete experiment

${BOLD}ACCOUNT${RESET}
  ${CYAN}whoami${RESET}                 Show current account & tier
  ${CYAN}revoke-key${RESET}             Revoke and regenerate API key
  ${CYAN}project${RESET} <id>           Get single project details
  ${CYAN}update${RESET} <id>            Update a project (--name, --origins)
  ${CYAN}delete${RESET} <id>            Delete a project

${BOLD}KEY OPTIONS${RESET}
  --days <N>         Lookback window in days (default: 7)
  --limit <N>        Max results (default: 100)
  --domain <url>     Site domain (required for create)
  --period <P>       Comparison period: 1d, 7d, 14d, 30d, 90d
  --property <key>   Property to break down (path, referrer, utm_source, country)
  --event <name>     Filter by event name
  --interval <N>     Live view refresh in seconds (default: 5)
  --window <N>       Live view time window in seconds (default: 60)

${BOLD}QUICK START${RESET}
  ${DIM}# 1. Save your API key${RESET}
  npx @agent-analytics/cli login --token aak_your_key

  ${DIM}# 2. Create a project${RESET}
  npx @agent-analytics/cli create my-site --domain https://mysite.com

  ${DIM}# 3. Check how all your projects are doing — live${RESET}
  npx @agent-analytics/cli live

  ${DIM}# 4. Run an A/B test${RESET}
  npx @agent-analytics/cli experiments create my-site --name hero_test \\
    --variants control,new_headline --goal signup

${DIM}Works with Claude Code, OpenClaw, Cursor, Codex — any agent that can run npx.${RESET}
${DIM}https://agentanalytics.sh${RESET}
`);
}

// ==================== MAIN ====================

const args = process.argv.slice(2);
const command = args[0];

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx > -1 && args[idx + 1] ? args[idx + 1] : null;
}

try {
  switch (command) {
    case 'login':
      await cmdLogin(getArg('--token'));
      break;
    case 'create':
    case 'init':
      await cmdCreate(args[1], getArg('--domain'));
      break;
    case 'projects':
    case 'list':
      await cmdProjects();
      break;
    case 'stats':
      await cmdStats(args[1], parseInt(getArg('--days') || '7', 10));
      break;
    case 'events':
      await cmdEvents(args[1], {
        days: parseInt(getArg('--days') || '7', 10),
        limit: parseInt(getArg('--limit') || '100', 10),
      });
      break;
    case 'properties':
      await cmdProperties(args[1], parseInt(getArg('--days') || '30', 10));
      break;
    case 'properties-received':
      await cmdPropertiesReceived(args[1], {
        since: getArg('--since'),
        sample: getArg('--sample') ? parseInt(getArg('--sample'), 10) : undefined,
      });
      break;
    case 'sessions':
      await cmdSessions(args[1], {
        since: getArg('--since'),
        limit: getArg('--limit') ? parseInt(getArg('--limit'), 10) : undefined,
      });
      break;
    case 'query':
      await cmdQuery(getArg('--project') || args[1], {
        metrics: getArg('--metrics'),
        group_by: getArg('--group-by'),
        date_from: getArg('--from') || getArg('--days') ? `${getArg('--days')}d` : undefined,
        date_to: getArg('--to'),
        order_by: getArg('--order-by'),
        order: getArg('--order'),
        limit: getArg('--limit') ? parseInt(getArg('--limit'), 10) : undefined,
      });
      break;
    case 'project':
      await cmdProject(args[1]);
      break;
    case 'update':
      await cmdUpdate(args[1], {
        name: getArg('--name'),
        allowed_origins: getArg('--origins'),
      });
      break;
    case 'insights':
      await cmdInsights(args[1], getArg('--period') || '7d');
      break;
    case 'breakdown':
      await cmdBreakdown(args[1], getArg('--property'), {
        event: getArg('--event'),
        limit: getArg('--limit') ? parseInt(getArg('--limit'), 10) : undefined,
      });
      break;
    case 'pages':
      await cmdPages(args[1], getArg('--type') || 'entry', {
        limit: getArg('--limit') ? parseInt(getArg('--limit'), 10) : undefined,
      });
      break;
    case 'sessions-dist':
      await cmdSessionsDist(args[1]);
      break;
    case 'heatmap':
      await cmdHeatmap(args[1]);
      break;
    case 'funnel':
      await cmdFunnel(args[1], getArg('--steps'), {
        window: getArg('--window'),
        since: getArg('--since'),
        count_by: getArg('--count-by'),
        breakdown: getArg('--breakdown'),
        breakdown_limit: getArg('--breakdown-limit'),
      });
      break;
    case 'retention':
      await cmdRetention(args[1], {
        period: getArg('--period'),
        cohorts: getArg('--cohorts'),
        event: getArg('--event'),
        returning_event: getArg('--returning-event'),
      });
      break;
    case 'live': {
      const liveProject = args[1] && !args[1].startsWith('--') ? args[1] : null;
      await cmdLive(liveProject, {
        interval: getArg('--interval'),
        window: getArg('--window'),
      });
      break;
    }
    case 'experiments':
      await cmdExperiments(args[1], args[2]);
      break;
    case 'delete':
      await cmdDelete(args[1]);
      break;
    case 'revoke-key':
      await cmdRevokeKey();
      break;
    case 'delete-account':
      cmdDeleteAccount();
      break;
    case 'whoami':
      await cmdWhoami();
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      showHelp();
      break;
    default:
      error(`Unknown command: ${command}. Run: npx @agent-analytics/cli help`);
  }
} catch (err) {
  error(err.message);
}
