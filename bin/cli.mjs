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
 *   npx @agent-analytics/cli properties-received <name> — Show property keys per event
 *   npx @agent-analytics/cli insights <name>      — Period-over-period comparison
 *   npx @agent-analytics/cli breakdown <name>     — Property value distribution
 *   npx @agent-analytics/cli pages <name>         — Entry/exit page stats
 *   npx @agent-analytics/cli sessions-dist <name> — Session duration distribution
 *   npx @agent-analytics/cli heatmap <name>       — Peak hours & busiest days
 *   npx @agent-analytics/cli init <name>          — Alias for create
 *   npx @agent-analytics/cli delete <id>          — Delete a project
 *   npx @agent-analytics/cli revoke-key           — Revoke and regenerate API key
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
    log(`${DIM}Sign in with GitHub → your API key is shown once on first signup.${RESET}`);
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

    success(`Logged in as ${BOLD}${account.github_login || account.email}${RESET}`);
    log(`${DIM}API key saved to ~/.config/agent-analytics/config.json${RESET}`);
    log(`\nNext: ${CYAN}npx @agent-analytics/cli create my-site${RESET}`);
  } catch (err) {
    error(`Invalid API key: ${err.message}`);
  }
}

async function cmdCreate(name, domain) {
  if (!name) error('Usage: npx @agent-analytics/cli create <project-name> --domain https://mysite.com');
  if (!domain) error('Usage: npx @agent-analytics/cli create <project-name> --domain https://mysite.com\n\nThe domain is required so we can restrict tracking to your site.');

  const api = requireKey();

  heading(`Creating project: ${name}`);

  try {
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

  } catch (err) {
    error(`Failed to create project: ${err.message}`);
  }
}

async function cmdProjects() {
  const api = requireKey();

  try {
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
  } catch (err) {
    error(`Failed to list projects: ${err.message}`);
  }
}

async function cmdStats(project, days = 7) {
  if (!project) error('Usage: npx @agent-analytics/cli stats <project-name> [--days N]');

  const api = requireKey();

  try {
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
  } catch (err) {
    error(`Failed to get stats: ${err.message}`);
  }
}

async function cmdEvents(project, opts = {}) {
  if (!project) error('Usage: npx @agent-analytics/cli events <project-name> [--days N] [--limit N]');

  const api = requireKey();

  try {
    const data = await api.getEvents(project, opts);

    heading(`Events: ${project}`);
    log('');

    if (!data.events || data.events.length === 0) {
      log('  No events yet.');
      return;
    }

    for (const e of data.events) {
      const time = new Date(e.timestamp).toLocaleString();
      log(`  ${DIM}${time}${RESET}  ${BOLD}${e.event}${RESET}  ${DIM}${e.user_id || ''}${RESET}`);
      if (e.properties) {
        log(`    ${DIM}${JSON.stringify(e.properties)}${RESET}`);
      }
    }
    log('');
  } catch (err) {
    error(`Failed to get events: ${err.message}`);
  }
}

async function cmdPropertiesReceived(project, opts = {}) {
  if (!project) error('Usage: npx @agent-analytics/cli properties-received <project-name> [--since DATE] [--sample N]');

  const api = requireKey();

  try {
    const data = await api.getPropertiesReceived(project, opts);

    heading(`Received Properties: ${project}`);
    log('');

    if (!data.properties || data.properties.length === 0) {
      log('  No properties found.');
      return;
    }

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
  } catch (err) {
    error(`Failed to get properties: ${err.message}`);
  }
}

async function cmdInsights(project, period = '7d') {
  if (!project) error('Usage: npx @agent-analytics/cli insights <project-name> [--period 7d]');

  const api = requireKey();

  try {
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
  } catch (err) {
    error(`Failed to get insights: ${err.message}`);
  }
}

async function cmdBreakdown(project, property, opts = {}) {
  if (!project || !property) error('Usage: npx @agent-analytics/cli breakdown <project-name> --property <key> [--event page_view] [--limit 20]');

  const api = requireKey();

  try {
    const data = await api.getBreakdown(project, { property, ...opts });

    heading(`Breakdown: ${project} — ${property}${data.event ? ` (${data.event})` : ''}`);
    log('');

    if (!data.values || data.values.length === 0) {
      log('  No data found.');
      return;
    }

    for (const v of data.values) {
      log(`  ${BOLD}${v.value}${RESET}  ${v.count} events  ${DIM}(${v.unique_users} users)${RESET}`);
    }
    log(`\n${DIM}${data.total_with_property} of ${data.total_events} events have this property${RESET}`);
    log('');
  } catch (err) {
    error(`Failed to get breakdown: ${err.message}`);
  }
}

async function cmdPages(project, type = 'entry', opts = {}) {
  if (!project) error('Usage: npx @agent-analytics/cli pages <project-name> [--type entry|exit|both] [--limit 20]');

  const api = requireKey();

  try {
    const data = await api.getPages(project, { type, ...opts });

    heading(`Pages: ${project} (${type})`);
    log('');

    const pages = data.entry_pages || data.exit_pages || [];
    if (pages.length === 0) {
      log('  No page data found.');
      return;
    }

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
  } catch (err) {
    error(`Failed to get pages: ${err.message}`);
  }
}

async function cmdSessionsDist(project) {
  if (!project) error('Usage: npx @agent-analytics/cli sessions-dist <project-name>');

  const api = requireKey();

  try {
    const data = await api.getSessionDistribution(project);

    heading(`Session Distribution: ${project}`);
    log('');

    if (!data.distribution || data.distribution.length === 0) {
      log('  No session data found.');
      return;
    }

    for (const b of data.distribution) {
      const bar = '█'.repeat(Math.min(Math.ceil(b.pct / 2), 40));
      log(`  ${b.bucket.padEnd(7)}  ${GREEN}${bar}${RESET}  ${b.sessions} (${b.pct}%)`);
    }

    log('');
    log(`  ${BOLD}Median:${RESET} ${data.median_bucket}  ${BOLD}Engaged:${RESET} ${data.engaged_pct}% (sessions ≥30s)`);
    log('');
  } catch (err) {
    error(`Failed to get session distribution: ${err.message}`);
  }
}

async function cmdHeatmap(project) {
  if (!project) error('Usage: npx @agent-analytics/cli heatmap <project-name>');

  const api = requireKey();

  try {
    const data = await api.getHeatmap(project);

    heading(`Heatmap: ${project}`);
    log('');

    if (!data.heatmap || data.heatmap.length === 0) {
      log('  No heatmap data found.');
      return;
    }

    if (data.peak) {
      log(`  ${BOLD}Peak:${RESET} ${data.peak.day_name} at ${data.peak.hour}:00 (${data.peak.events} events, ${data.peak.users} users)`);
    }
    log(`  ${BOLD}Busiest day:${RESET} ${data.busiest_day}`);
    log(`  ${BOLD}Busiest hour:${RESET} ${data.busiest_hour}:00`);
    log('');
  } catch (err) {
    error(`Failed to get heatmap: ${err.message}`);
  }
}

async function cmdDelete(id) {
  if (!id) error('Usage: npx @agent-analytics/cli delete <project-id>');

  const api = requireKey();

  try {
    await api.deleteProject(id);
    success(`Project ${id} deleted`);
  } catch (err) {
    error(`Failed to delete project: ${err.message}`);
  }
}

function cmdDeleteAccount() {
  heading('Delete Account');
  log('');
  log('For security, account deletion must be done from the dashboard.');
  log(`Visit: ${CYAN}https://app.agentanalytics.sh/settings${RESET}`);
  log('');
}

async function cmdRevokeKey() {
  const api = requireKey();

  try {
    const data = await api.revokeKey();
    setApiKey(data.api_key);

    warn('Old API key revoked');
    success('New API key generated and saved\n');
    heading('New API key:');
    log(`${YELLOW}${data.api_key}${RESET}`);
    log(`${DIM}Saved to ~/.config/agent-analytics/config.json${RESET}\n`);
    warn('Update your agent with this new key!');
  } catch (err) {
    error(`Failed to revoke key: ${err.message}`);
  }
}

async function cmdWhoami() {
  const api = requireKey();

  try {
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
  } catch (err) {
    error(`Failed to get account: ${err.message}`);
  }
}

function showHelp() {
  log(`
${BOLD}agent-analytics${RESET} — Web analytics your AI agent can read

${BOLD}USAGE${RESET}
  npx @agent-analytics/cli <command> [options]

${BOLD}COMMANDS${RESET}
  ${CYAN}login${RESET} --token <key> Save your API key
  ${CYAN}create${RESET} <name>      Create a project and get your snippet
  ${CYAN}projects${RESET}           List your projects
  ${CYAN}init${RESET} <name>        Alias for create
  ${CYAN}delete${RESET} <id>        Delete a project
  ${CYAN}stats${RESET} <name>       Get stats for a project
  ${CYAN}events${RESET} <name>      Get recent events
  ${CYAN}properties-received${RESET} <name>  Show property keys per event
  ${CYAN}insights${RESET} <name>    Period-over-period comparison
  ${CYAN}breakdown${RESET} <name>   Property value distribution
  ${CYAN}pages${RESET} <name>       Entry/exit page performance
  ${CYAN}sessions-dist${RESET} <name>  Session duration distribution
  ${CYAN}heatmap${RESET} <name>     Peak hours & busiest days
  ${CYAN}whoami${RESET}             Show current account
  ${CYAN}revoke-key${RESET}         Revoke and regenerate API key
  ${CYAN}delete-account${RESET}     Delete your account (opens dashboard)

${BOLD}OPTIONS${RESET}
  --days <N>         Days of data (default: 7)
  --limit <N>        Max events/rows to return (default: 100)
  --domain <url>     Your site domain (required for create)
  --since <date>     ISO date for properties-received (default: 7 days)
  --sample <N>       Max events to sample (default: 5000)
  --period <P>       Period for insights: 1d, 7d, 14d, 30d, 90d (default: 7d)
  --property <key>   Property key for breakdown (required)
  --event <name>     Filter by event name (breakdown only)
  --type <T>         Page type: entry, exit, both (default: entry)

${BOLD}ENVIRONMENT${RESET}
  AGENT_ANALYTICS_API_KEY    API key (overrides config file)
  AGENT_ANALYTICS_URL    Custom API URL

${BOLD}EXAMPLES${RESET}
  ${DIM}# First time: save your API key (from app.agentanalytics.sh)${RESET}
  npx @agent-analytics/cli login --token aak_your_key

  ${DIM}# Create a project${RESET}
  npx @agent-analytics/cli create my-site --domain https://mysite.com

  ${DIM}# Check how your site is doing${RESET}
  npx @agent-analytics/cli stats my-site --days 30

  ${DIM}# Your agent can also use the API directly${RESET}
  curl "https://api.agentanalytics.sh/stats?project=my-site&days=7" \\
    -H "X-API-Key: \$AGENT_ANALYTICS_API_KEY"

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
    case 'properties-received':
      await cmdPropertiesReceived(args[1], {
        since: getArg('--since'),
        sample: getArg('--sample') ? parseInt(getArg('--sample'), 10) : undefined,
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
