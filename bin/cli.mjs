#!/usr/bin/env node

/**
 * agent-analytics CLI
 * 
 * Usage:
 *   npx agent-analytics login --token <key>  — Save your API key
 *   npx agent-analytics init <name>          — Create a project and get your snippet
 *   npx agent-analytics projects             — List your projects
 *   npx agent-analytics stats <name>         — Get stats for a project
 *   npx agent-analytics events <name>        — Get recent events
 *   npx agent-analytics create <name>        — Create a new project
 *   npx agent-analytics delete <id>          — Delete a project
 *   npx agent-analytics revoke-key           — Revoke and regenerate API key
 *   npx agent-analytics whoami               — Show current account
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
    error('Not logged in. Run: npx agent-analytics login');
  }
  return new AgentAnalyticsAPI(key, getBaseUrl());
}

// ==================== COMMANDS ====================

async function cmdLogin(token) {
  if (!token) {
    heading('Agent Analytics — Login');
    log('');
    log('Pass your API key from the dashboard:');
    log(`  ${CYAN}npx agent-analytics login --token aak_your_key_here${RESET}`);
    log('');
    log('Or set it as an environment variable:');
    log(`  ${CYAN}export AGENT_ANALYTICS_KEY=aak_your_key_here${RESET}`);
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
    log(`\nNext: ${CYAN}npx agent-analytics init my-site${RESET}`);
  } catch (err) {
    error(`Invalid API key: ${err.message}`);
  }
}

async function cmdInit(name) {
  if (!name) error('Usage: npx agent-analytics init <project-name>');

  let key = getApiKey();

  if (!key) {
    error('Not logged in. Run: npx agent-analytics login --token <your-key>\nGet your key at: https://app.agentanalytics.sh');
  }

  const api = new AgentAnalyticsAPI(key, getBaseUrl());

  heading(`Creating project: ${name}`);

  try {
    const data = await api.createProject(name);

    success('Project created!\n');

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
      log(`  ${CYAN}npx agent-analytics init my-site${RESET}`);
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
  if (!project) error('Usage: npx agent-analytics stats <project-name> [--days N]');

  const api = requireKey();

  try {
    const data = await api.getStats(project, days);

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

    log('');
  } catch (err) {
    error(`Failed to get stats: ${err.message}`);
  }
}

async function cmdEvents(project, opts = {}) {
  if (!project) error('Usage: npx agent-analytics events <project-name> [--days N] [--limit N]');

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

async function cmdCreate(name, origins) {
  if (!name) error('Usage: npx agent-analytics create <project-name> [--origins https://mysite.com]');

  const api = requireKey();

  try {
    const data = await api.createProject(name, origins || '*');

    success(`Project "${name}" created\n`);
    heading('Snippet:');
    log(`${CYAN}${data.snippet}${RESET}\n`);
    heading('Token:');
    log(`${YELLOW}${data.project_token}${RESET}\n`);
  } catch (err) {
    error(`Failed to create project: ${err.message}`);
  }
}

async function cmdDelete(id) {
  if (!id) error('Usage: npx agent-analytics delete <project-id>');

  const api = requireKey();

  try {
    await api.deleteProject(id);
    success(`Project ${id} deleted`);
  } catch (err) {
    error(`Failed to delete project: ${err.message}`);
  }
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
    log('');
  } catch (err) {
    error(`Failed to get account: ${err.message}`);
  }
}

function showHelp() {
  log(`
${BOLD}agent-analytics${RESET} — Web analytics your AI agent can read

${BOLD}USAGE${RESET}
  npx agent-analytics <command> [options]

${BOLD}COMMANDS${RESET}
  ${CYAN}login${RESET} --token <key> Save your API key
  ${CYAN}init${RESET} <name>        Create a project and get your snippet
  ${CYAN}projects${RESET}           List your projects
  ${CYAN}create${RESET} <name>      Create a new project
  ${CYAN}delete${RESET} <id>        Delete a project
  ${CYAN}stats${RESET} <name>       Get stats for a project
  ${CYAN}events${RESET} <name>      Get recent events
  ${CYAN}whoami${RESET}             Show current account
  ${CYAN}revoke-key${RESET}         Revoke and regenerate API key

${BOLD}OPTIONS${RESET}
  --days <N>         Days of data (default: 7)
  --limit <N>        Max events to return (default: 100)
  --origins <url>    Allowed origins for project

${BOLD}ENVIRONMENT${RESET}
  AGENT_ANALYTICS_KEY    API key (overrides config file)
  AGENT_ANALYTICS_URL    Custom API URL

${BOLD}EXAMPLES${RESET}
  ${DIM}# First time: save your API key (from app.agentanalytics.sh)${RESET}
  npx agent-analytics login --token aak_your_key

  ${DIM}# Create a project${RESET}
  npx agent-analytics init my-site

  ${DIM}# Check how your site is doing${RESET}
  npx agent-analytics stats my-site --days 30

  ${DIM}# Your agent can also use the API directly${RESET}
  curl "https://app.agentanalytics.sh/stats?project=my-site&days=7" \\
    -H "X-API-Key: \$AGENT_ANALYTICS_KEY"

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
    case 'init':
      await cmdInit(args[1]);
      break;
    case 'projects':
    case 'list':
      await cmdProjects();
      break;
    case 'stats':
      await cmdStats(args[1], parseInt(getArg('--days') || '7'));
      break;
    case 'events':
      await cmdEvents(args[1], {
        days: parseInt(getArg('--days') || '7'),
        limit: parseInt(getArg('--limit') || '100'),
      });
      break;
    case 'create':
      await cmdCreate(args[1], getArg('--origins'));
      break;
    case 'delete':
      await cmdDelete(args[1]);
      break;
    case 'revoke-key':
      await cmdRevokeKey();
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
      error(`Unknown command: ${command}. Run: npx agent-analytics help`);
  }
} catch (err) {
  error(err.message);
}
