#!/usr/bin/env node

/**
 * agent-analytics CLI
 * 
 * Usage:
 *   npx @agent-analytics/cli login                — Start browser-based agent session login
 *   npx @agent-analytics/cli login --detached     — Detached approval handoff
 *   npx @agent-analytics/cli logout               — Clear saved local auth
 *   npx @agent-analytics/cli upgrade-link --detached — Print a human payment handoff link
 *   npx @agent-analytics/cli scan <url>           — Preview what your agent should track first
 *   npx @agent-analytics/cli create <name>         — Create a project and get your snippet
 *   npx @agent-analytics/cli projects             — List your projects
 *   npx @agent-analytics/cli all-sites            — Historical summary across all projects
 *   npx @agent-analytics/cli bot-traffic <name>   — Automated traffic filtered from tracking
 *   npx @agent-analytics/cli stats <name>         — Get stats for a project
 *   npx @agent-analytics/cli events <name>        — Get recent events
 *   npx @agent-analytics/cli journey <name>       — Show one user's chronological journey
 *   npx @agent-analytics/cli query <name>         — Flexible analytics query
 *   npx @agent-analytics/cli properties <name>    — Discover event names & property keys
 *   npx @agent-analytics/cli properties-received <name> — Show property keys per event
 *   npx @agent-analytics/cli sessions <name>      — List individual sessions
 *   npx @agent-analytics/cli insights <name>      — Period-over-period comparison
 *   npx @agent-analytics/cli breakdown <name>     — Property value distribution
 *   npx @agent-analytics/cli pages <name>         — Entry/exit page stats
 *   npx @agent-analytics/cli paths <name>         — Session journey paths from entry to goal/drop-off
 *   npx @agent-analytics/cli sessions-dist <name> — Session duration distribution
 *   npx @agent-analytics/cli heatmap <name>       — Peak hours & busiest days
 *   npx @agent-analytics/cli funnel <name>        — Funnel analysis: where users drop off
 *   npx @agent-analytics/cli retention <name>     — Cohort retention: % of users who return
 *   npx @agent-analytics/cli init <name>          — Alias for create
 *   npx @agent-analytics/cli project <name-or-id>  — Get single project details
 *   npx @agent-analytics/cli context get <project> — Get stored project analytics context
 *   npx @agent-analytics/cli context set <project> --json '{...}' — Set goals, activation events, glossary
 *   npx @agent-analytics/cli portfolio-context get — Get stored account portfolio context
 *   npx @agent-analytics/cli portfolio-context set --json '{...}' — Set goals, surface roles, milestones, glossary
 *   npx @agent-analytics/cli update <name-or-id>   — Update a project
 *   npx @agent-analytics/cli delete <name-or-id>   — Delete a project
 *   npx @agent-analytics/cli live [name]          — Real-time live view
 *   npx @agent-analytics/cli experiments list <project>   — List experiments
 *   npx @agent-analytics/cli experiments create <p> ...  — Create experiment
 *   npx @agent-analytics/cli experiments get <id>        — Get experiment with results
 *   npx @agent-analytics/cli experiments pause <id>      — Pause experiment
 *   npx @agent-analytics/cli experiments resume <id>     — Resume experiment
 *   npx @agent-analytics/cli experiments complete <id>   — Complete experiment
 *   npx @agent-analytics/cli experiments delete <id>     — Delete experiment
 *   npx @agent-analytics/cli delete-account       — Delete your account (opens dashboard)
 *   npx @agent-analytics/cli feedback --message "..." — Send product/process feedback
 *   npx @agent-analytics/cli whoami               — Show current account
 *   npx @agent-analytics/cli auth status          — Show local auth path and expiry metadata
 */

import { AgentAnalyticsAPI } from '../lib/api.mjs';
import { finishManualExchange, loginDetached, loginInteractive, startDetachedLogin } from '../lib/auth-flow.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  clearStoredAuth,
  getAuthSource,
  getBaseUrl,
  getConfig,
  getConfigFile,
  getConfigLocation,
  getStoredAuth,
  setAgentSession,
  setApiKey,
  setConfigDirOverride,
  updateStoredAccount,
} from '../lib/config.mjs';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const WHITE = '\x1b[37m';
const RESET = '\x1b[0m';
const DEFAULT_BASE_URL = 'https://api.agentanalytics.sh';
const CLI_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function log(msg = '') { console.log(msg); }
function success(msg) { log(`${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { log(`${YELLOW}⚠${RESET} ${msg}`); }
function error(msg) { log(`${RED}✗${RESET} ${msg}`); process.exit(1); }
function heading(msg) { log(`\n${BOLD}${msg}${RESET}`); }

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex');
}

function identityOptions(opts = {}) {
  const out = {};
  if (opts.user_id) out.user_id = opts.user_id;
  if (opts.email) out.email_hash = hashEmail(opts.email);
  return out;
}

function startWaitingIndicator(message, { interruptMessage = 'Stopped waiting for browser approval.' } = {}) {
  if (!process.stdout.isTTY) {
    log(`${DIM}${message}${RESET}`);
    return () => {};
  }

  const frames = ['-', '\\', '|', '/'];
  let index = 0;
  let stopped = false;
  const HIDE_CURSOR = '\x1b[?25l';
  const SHOW_CURSOR = '\x1b[?25h';
  const clearLine = () => process.stdout.write(`\r\x1b[2K${SHOW_CURSOR}`);
  const render = () => {
    if (stopped) return;
    process.stdout.write(`\r${HIDE_CURSOR}${DIM}${frames[index]} ${message}${RESET}`);
  };
  const stop = (finalMessage = '') => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    process.removeListener('SIGINT', handleSigint);
    clearLine();
    if (finalMessage) {
      log(finalMessage);
    }
  };
  const handleSigint = () => {
    stop(`${DIM}${interruptMessage}${RESET}`);
    process.exit(130);
  };

  render();
  const timer = setInterval(() => {
    if (stopped) return;
    index = (index + 1) % frames.length;
    render();
  }, 120);
  process.once('SIGINT', handleSigint);

  return stop;
}

function createApiClient(auth = getStoredAuth()) {
  return new AgentAnalyticsAPI(auth, getBaseUrl(), {
    onAuthUpdate(nextAuth) {
      setAgentSession(nextAuth);
    },
  });
}

function getDemoBaseUrl() {
  return process.env.AGENT_ANALYTICS_URL || DEFAULT_BASE_URL;
}

function getDashboardBaseUrl() {
  return (process.env.AGENT_ANALYTICS_DASHBOARD_URL || 'https://app.agentanalytics.sh').replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createDemoApiClient() {
  const bootstrap = new AgentAnalyticsAPI(null, getDemoBaseUrl());
  const demo = await bootstrap.startDemoSession();
  const accessToken = demo?.agent_session?.access_token;
  if (!accessToken) {
    throw new Error('Demo session response did not include an access token');
  }
  return new AgentAnalyticsAPI({ access_token: accessToken }, getDemoBaseUrl());
}

function accountDisplayName(account = {}) {
  return account.github_login || account.google_name || account.email;
}

function shellQuote(value) {
  const str = String(value);
  if (/^[A-Za-z0-9_/:.,@%+=-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

function cliInvocationWithConfig() {
  const location = getConfigLocation();
  if (location.source === 'flag') {
    return `npx @agent-analytics/cli --config-dir ${shellQuote(location.dir)}`;
  }
  if (location.source === 'env') {
    return `AGENT_ANALYTICS_CONFIG_DIR=${shellQuote(location.dir)} npx @agent-analytics/cli`;
  }
  return 'npx @agent-analytics/cli';
}

function logConnected(account, savedMessage = `Agent session saved to ${getConfigFile()}`) {
  success(`Connected as ${BOLD}${accountDisplayName(account)}${RESET} (${account.tier})`);
  log(`${DIM}${savedMessage}${RESET}`);
}

function isDetachedAlreadyExchangedError(err) {
  const message = String(err?.message || '').toLowerCase();
  return (
    err?.code === 'AUTH_REQUEST_ALREADY_EXCHANGED' ||
    (
      err?.code === 'INVALID_STATE' &&
      (message === 'auth request is not ready' || message === 'auth request already exchanged')
    ) ||
    message === 'auth request already exchanged'
  );
}

async function verifyStoredAgentSession() {
  const auth = getStoredAuth();
  if (!auth?.access_token && !auth?.refresh_token) return null;
  try {
    const api = createApiClient(auth);
    return await api.getAccount();
  } catch {
    return null;
  }
}

function logDetachedApproval(started) {
  log(`Approval URL: ${CYAN}${started.authorize_url}${RESET}`);
  log(`Approval code: ${YELLOW}${started.approval_code}${RESET}`);
  log(`${DIM}Send the approval URL to the user, then complete login with the finish code.${RESET}`);
  log(`${DIM}Resume with:${RESET}`);
  log(`  ${CYAN}${cliInvocationWithConfig()} login --auth-request ${started.auth_request_id} --exchange-code <code>${RESET}`);
}

function currentCommandForHandoff() {
  return `${cliInvocationWithConfig()} ${args.map(shellQuote).join(' ')}`.trim();
}

function isUpgradeableError(err) {
  const code = err?.code || err?.body?.error || err?.body?.code;
  const message = String(err?.message || '');
  if (code === 'PRO_REQUIRED') return true;
  if (code === 'RATE_LIMITED' && /free plan|agent\/API read|Upgrade/i.test(message)) return true;
  return false;
}

function printUpgradeLinkHint(err) {
  if (!isUpgradeableError(err)) return;

  const reason = String(err?.message || 'This analytics task needs Pro.');
  const blockedCommand = currentCommandForHandoff();
  const auth = getStoredAuth();

  log('');
  warn('This needs Pro for the full agent analytics loop.');
  if (auth?.api_key) {
    log(`Upgrade links require browser-approved CLI login, not a raw API key.`);
    log(`  ${CYAN}${cliInvocationWithConfig()} login --detached${RESET}`);
    return;
  }
  log(`Ask the human to approve payment with one explicit command:`);
  log(`  ${CYAN}${cliInvocationWithConfig()} upgrade-link --detached --reason ${shellQuote(reason)} --command ${shellQuote(blockedCommand)}${RESET}`);
  log(`  ${CYAN}${cliInvocationWithConfig()} upgrade-link --wait --reason ${shellQuote(reason)} --command ${shellQuote(blockedCommand)}${RESET}`);
}

async function requireClient() {
  if (demoMode) {
    return createDemoApiClient();
  }
  const auth = getStoredAuth();
  if (!auth) {
    error('Not logged in. Run: npx @agent-analytics/cli login');
  }
  return createApiClient(auth);
}

function withApi(fn) {
  return async (...args) => {
    try {
      const api = await requireClient();
      return await fn(api, ...args);
    } catch (err) {
      printUpgradeLinkHint(err);
      error(err.message);
    }
  };
}

function ifEmpty(arr, label) {
  if (!arr || arr.length === 0) { log(`  No ${label} found.`); return true; }
  return false;
}

function websiteAnalysisWebPreviewUrl() {
  return 'https://agentanalytics.sh/analysis/';
}

function unauthenticatedWebsiteAnalysisCliMessage() {
  return [
    `Website analysis preview is only available anonymously on the web: ${websiteAnalysisWebPreviewUrl()}`,
    `In CLI, sign in first, then scan sites for projects you own or manage.`,
    `Next step: npx @agent-analytics/cli login --detached`,
  ].join('\n');
}

function authenticatedWebsiteAnalysisProjectMessage(url) {
  const website = url || 'https://mysite.com';
  return [
    'CLI website analysis requires --project for authenticated scans.',
    `Scan sites for projects you own or manage. If you need anonymous preview, use ${websiteAnalysisWebPreviewUrl()}`,
    'If this is a new site, create or identify the matching project first, then rerun scan:',
    `  npx @agent-analytics/cli create my-site --domain ${website}`,
    `  npx @agent-analytics/cli scan ${website} --project my-site --json`,
  ].join('\n');
}

async function resolveProject(api, target) {
  const { projects } = await api.listProjects();
  const match = projects?.find(p => p.id === target) || projects?.find(p => p.name === target);
  if (!match) error(`Project "${target}" not found. Run: npx @agent-analytics/cli projects`);
  return match;
}

// ==================== COMMANDS ====================

async function cmdLogin({ token, detached, exchangeCode, authRequestId, waitForDetached }) {
  if (!token) {
    const api = createApiClient(null);

    if (exchangeCode) {
      if (!authRequestId) {
        error('Manual exchange requires --auth-request <id> together with --exchange-code <code>');
      }
      try {
        const result = await finishManualExchange(api, authRequestId, exchangeCode);
        setAgentSession(result.agent_session);
        updateStoredAccount(result.account);
        logConnected(result.account);
      } catch (err) {
        if (!isDetachedAlreadyExchangedError(err)) {
          throw err;
        }
        const account = await verifyStoredAgentSession();
        if (!account) {
          throw err;
        }
        updateStoredAccount(account);
        logConnected(account);
      }
      return;
    }

    if (detached) {
      heading('Agent Analytics — Detached Login');
      let stopWaiting = () => {};
      try {
        if (!waitForDetached) {
          const started = await startDetachedLogin(api);
          logDetachedApproval(started);
          log('');
          success(`Detached approval request created: ${started.auth_request_id}`);
          return;
        }

        const { started, exchanged } = await loginDetached(api, {
          onPending(started) {
            logDetachedApproval(started);
            log(`${DIM}Polling is enabled because --wait/--poll was passed.${RESET}`);
            log('');
            stopWaiting = startWaitingIndicator('Waiting for browser approval...');
          },
        });
        stopWaiting(`${DIM}Browser approval received.${RESET}`);
        setAgentSession(exchanged.agent_session);
        updateStoredAccount(exchanged.account);
        logConnected(exchanged.account, `Detached request ${started.auth_request_id} approved and saved to ${getConfigFile()}`);
        return;
      } catch (err) {
        stopWaiting(`${DIM}Stopped waiting for browser approval.${RESET}`);
        if (isDetachedAlreadyExchangedError(err)) {
          const account = await verifyStoredAgentSession();
          if (account) {
            updateStoredAccount(account);
            logConnected(account);
            return;
          }
        }
        warn(err.message);
        log(`Resume detached approval later: ${CYAN}${cliInvocationWithConfig()} login --auth-request <id> --exchange-code <code>${RESET}`);
        throw err;
      }
    }

    heading('Agent Analytics — Login');
    log('');
    let stopWaiting = () => {};
    try {
      const result = await loginInteractive(api, {
        onPending(started) {
          log(`Approval URL: ${CYAN}${started.authorize_url}${RESET}`);
          log(`Approval code: ${YELLOW}${started.approval_code}${RESET}`);
          log(`${DIM}The browser should open automatically. If it does not, open the URL above.${RESET}`);
          log('');
          stopWaiting = startWaitingIndicator('Waiting for browser approval...');
        },
      });
      stopWaiting(`${DIM}Browser approval received.${RESET}`);
      setAgentSession(result.agent_session);
      updateStoredAccount(result.account);
      logConnected(result.account);
      log('');
      log(`Fallbacks:`);
      log(`  ${CYAN}npx @agent-analytics/cli login --detached${RESET}`);
      return;
    } catch (err) {
      stopWaiting(`${DIM}Stopped waiting for browser approval.${RESET}`);
      warn(`Interactive login failed: ${err.message}`);
      log(`Retry with detached approval: ${CYAN}npx @agent-analytics/cli login --detached${RESET}`);
      return;
    }
  }

  // Advanced/manual fallback: API key login
  const api = createApiClient({ api_key: token });
  try {
    const account = await api.getAccount();
    setApiKey(token);
    updateStoredAccount(account);

    success(`Logged in as ${BOLD}${account.github_login || account.email}${RESET} (${account.tier})`);
    log(`${DIM}API key saved to ${getConfigFile()}${RESET}`);
    log('');
    log(`Next steps:`);
    log(`  ${CYAN}npx @agent-analytics/cli create my-site --domain https://mysite.com${RESET}`);
    log(`  ${CYAN}npx @agent-analytics/cli live${RESET}  ${DIM}— real-time view across all projects${RESET}`);
  } catch (err) {
    error(`Invalid API key: ${err.message}`);
  }
}

function cmdLogout() {
  const cleared = clearStoredAuth();

  if (cleared) {
    success('Logged out locally');
  } else {
    success('Already logged out locally');
  }

  log(`${DIM}Cleared saved auth from ${getConfigFile()}${RESET}`);

  if (process.env.AGENT_ANALYTICS_API_KEY) {
    log('');
    warn('AGENT_ANALYTICS_API_KEY is still set in this shell, so the CLI will keep authenticating.');
    log(`  ${CYAN}unset AGENT_ANALYTICS_API_KEY${RESET}`);
  }
}

function cmdDemo() {
  heading('Try Agent Analytics with seeded demo data');
  log('');
  log('No signup needed. Your agent can run real read-only CLI commands against a hosted sample project.');
  log('');
  heading('Prompt examples:');
  log(`  ${CYAN}Audit the signup leak, question the data, and tell me the next fix to test.${RESET}`);
  log(`  ${CYAN}Check whether the CTA experiment winner actually fixes the biggest signup problem.${RESET}`);
  log(`  ${CYAN}Turn the demo analytics into a developer-ready growth task with metrics and guardrails.${RESET}`);
  log('');
  heading('Commands:');
  log(`  ${CYAN}npx @agent-analytics/cli@${CLI_VERSION} --demo projects${RESET}`);
  log(`  ${CYAN}npx @agent-analytics/cli@${CLI_VERSION} --demo stats agentanalytics-demo --days 30${RESET}`);
  log(`  ${CYAN}npx @agent-analytics/cli@${CLI_VERSION} --demo paths agentanalytics-demo --goal signup --since 30d${RESET}`);
  log(`  ${CYAN}npx @agent-analytics/cli@${CLI_VERSION} --demo funnel agentanalytics-demo --steps "page_view,signup_started,signup"${RESET}`);
  log(`  ${CYAN}npx @agent-analytics/cli@${CLI_VERSION} --demo breakdown agentanalytics-demo --property path --event signup_started --days 30${RESET}`);
  log(`  ${CYAN}npx @agent-analytics/cli@${CLI_VERSION} --demo breakdown agentanalytics-demo --property path --event signup --days 30${RESET}`);
  log(`  ${CYAN}npx @agent-analytics/cli@${CLI_VERSION} --demo experiments get exp_demo_signup_cta${RESET}`);
  log('');
  log(`${DIM}Demo mode uses a short-lived read-only session and does not touch your saved CLI login.${RESET}`);
}

async function cmdUpgradeLink({ detached, wait, reason, blockedCommand }) {
  if (demoMode) {
    error('Demo mode is read-only. Upgrade links require a real browser-approved account.');
  }
  if ((detached && wait) || (!detached && !wait)) {
    error('Usage: npx @agent-analytics/cli upgrade-link --detached|--wait [--reason <text>] [--command <command>]');
  }

  const auth = getStoredAuth();
  if (!auth) {
    error('Not logged in. Run: npx @agent-analytics/cli login --detached');
  }
  if (auth.api_key) {
    error('upgrade-link requires browser-approved CLI login, not a raw API key. Run: npx @agent-analytics/cli login --detached');
  }

  const api = createApiClient(auth);
  const account = await api.getAccount();
  updateStoredAccount(account);

  if (!account?.id) {
    error('Account response did not include an account id. Run: npx @agent-analytics/cli whoami and try again.');
  }
  if (account.tier === 'pro') {
    success('Pro is already active on this account.');
    return;
  }

  const mode = wait ? 'wait' : 'detached';
  const link = new URL('/account/billing/agent-upgrade', getDashboardBaseUrl());
  link.searchParams.set('account', account.id);
  link.searchParams.set('mode', mode);
  link.searchParams.set('reason', reason || 'The requested analytics task needs Pro.');
  if (blockedCommand) link.searchParams.set('command', blockedCommand);

  heading('Agent Analytics — Pro Upgrade Handoff');
  log(`Open this link in the human browser:`);
  log(`  ${CYAN}${link.toString()}${RESET}`);
  log('');
  log(`${DIM}The browser stays on app.agentanalytics.sh first, confirms the logged-in account, then opens Lemon Squeezy.${RESET}`);

  if (detached) {
    log(`${DIM}After payment, return to the agent and rerun the blocked command.${RESET}`);
    return;
  }

  const pollIntervalMs = Number(process.env.AGENT_ANALYTICS_UPGRADE_POLL_INTERVAL_MS || 5000);
  const timeoutMs = Number(process.env.AGENT_ANALYTICS_UPGRADE_TIMEOUT_MS || 15 * 60 * 1000);
  const interval = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 5000;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15 * 60 * 1000;
  const stopWaiting = startWaitingIndicator('Waiting for Pro activation...', {
    interruptMessage: 'Stopped waiting for Pro activation.',
  });
  const deadline = Date.now() + timeout;

  try {
    while (Date.now() < deadline) {
      await sleep(interval);
      const nextAccount = await api.getAccount().catch(() => null);
      if (!nextAccount) continue;
      updateStoredAccount(nextAccount);
      if (nextAccount.tier === 'pro') {
        stopWaiting(`${DIM}Pro activation received.${RESET}`);
        success('Pro is active. Rerun the blocked analytics command.');
        return;
      }
    }
  } finally {
    stopWaiting();
  }

  warn('Still waiting for Pro activation. The payment webhook may still be processing.');
  error(`Return to the agent after the browser says Pro is active, then rerun: ${blockedCommand || 'the blocked command'}`);
}

function printJson(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function printScanResult(data, { full = false } = {}) {
  const result = full ? (data.result || data.full_result || data.preview) : data.preview;
  heading(full ? 'Full Instrumentation Plan' : 'What your agent should track first');
  log('');
  log(`  ${BOLD}Analysis:${RESET} ${data.analysis_id}`);
  if (data.normalized_url) log(`  ${BOLD}Website:${RESET}  ${data.normalized_url}`);
  if (data.cached) log(`  ${DIM}Using a recent preview for this domain.${RESET}`);
  log('');

  const events = result?.minimum_viable_instrumentation || [];
  if (events.length) {
    heading('Minimum viable instrumentation');
    for (const event of events) {
      log(`  ${BOLD}${event.priority || '-'}${RESET}. ${CYAN}${event.event}${RESET}`);
      if (event.why_this_matters_now) log(`     ${event.why_this_matters_now}`);
      if (Array.isArray(event.unlocks_questions) && event.unlocks_questions.length) {
        log(`     ${DIM}Unlocks:${RESET} ${event.unlocks_questions.join(' | ')}`);
      }
    }
    log('');
  }

  const blindspots = result?.current_blindspots || [];
  if (blindspots.length) {
    heading('Current blind spots');
    for (const item of blindspots.slice(0, 3)) log(`  - ${item}`);
    log('');
  }

  const notNeeded = result?.not_needed_yet || [];
  if (notNeeded.length) {
    heading('Not needed yet');
    for (const item of notNeeded.slice(0, 3)) {
      log(`  - ${CYAN}${item.event}${RESET}: ${item.reason || 'Deprioritized for the first useful answer.'}`);
    }
    log('');
  }

  if (data.agent_handoff?.prompt) {
    heading(data.agent_handoff.label || 'Give your agent analytics judgment');
    log(data.agent_handoff.prompt);
    log('');
  }

  if (data.resume_token && !full) {
    log(`${DIM}To unlock the full plan after login:${RESET}`);
    log(`  ${CYAN}npx @agent-analytics/cli scan --resume ${data.analysis_id} --resume-token ${data.resume_token} --full --project <project> --json${RESET}`);
    log('');
  }
}

async function cmdScan({ url, resumeId, resumeToken, full = false, project, jsonOutput = false } = {}) {
  if (full) {
    try {
      const api = await requireClient();
      let data;
      if (resumeId) {
        if (!resumeToken || !project) {
          error('Usage: npx @agent-analytics/cli scan --resume <id> --resume-token <token> --full --project <name> [--json]');
        }
        data = await api.upgradeWebsiteScan(resumeId, { resumeToken, project });
      } else if (url) {
        if (!project) {
          error('Usage: npx @agent-analytics/cli scan <url> --full --project <name> [--json]');
        }
        data = await api.createWebsiteScan(url, { full: true, project });
      } else {
        error('Usage: npx @agent-analytics/cli scan <url> --full --project <name> [--json]\n   or: npx @agent-analytics/cli scan --resume <id> --resume-token <token> --full --project <name> [--json]');
      }
      if (jsonOutput) {
        printJson(data);
      } else {
        printScanResult(data, { full: true });
      }
      return;
    } catch (err) {
      error(err.message);
    }
  }

  try {
    if (resumeId && !resumeToken) {
      error('Usage: npx @agent-analytics/cli scan --resume <id> --resume-token <token> [--json]');
    }
    if (!resumeId && !url) {
      error('Usage: npx @agent-analytics/cli scan <url> [--json]');
    }

    if (resumeId) {
      const api = createApiClient(null);
      const data = await api.getWebsiteScan(resumeId, { resumeToken });
      if (jsonOutput) {
        printJson(data);
      } else {
        printScanResult(data);
      }
      return;
    }

    const auth = getStoredAuth();
    if (!auth) {
      error(unauthenticatedWebsiteAnalysisCliMessage());
    }
    if (!project) {
      error(authenticatedWebsiteAnalysisProjectMessage(url));
    }

    const api = createApiClient(auth);
    const data = await api.createWebsiteScan(url, { project });
    if (jsonOutput) {
      printJson(data);
    } else {
      printScanResult(data);
    }
  } catch (err) {
    if (err?.status === 429 && err?.code === 'SCAN_BUSY') {
      const retry = err.body?.retry_after_seconds || err.body?.retry_after || 'a few';
      error(`The free analyzer is busy. Try again in ${retry} seconds.`);
    }
    error(err.message);
  }
}

const cmdCreate = withApi(async (api, name, domain, opts = {}) => {
  if (!name) error('Usage: npx @agent-analytics/cli create <project-name> --domain https://mysite.com');
  if (!domain) error('Usage: npx @agent-analytics/cli create <project-name> --domain https://mysite.com\n\nThe domain is required so we can restrict tracking to your site.');

  heading(`Creating project: ${name}`);

  const data = await api.createProject(name, domain, { sourceScanId: opts.source_scan_id });

  success(data.existing
    ? `Found existing project for ${BOLD}${domain}${RESET}!\n`
    : `Project created for ${BOLD}${domain}${RESET}!\n`);

  heading('1. Add this snippet to your site:');
  log(`${CYAN}${data.snippet}${RESET}\n`);
  if (data.snippet_note) log(`  ${DIM}${data.snippet_note}${RESET}\n`);

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
    log(`  ${DIM}id:${RESET} ${p.id}`);
    log(`  ${DIM}token:${RESET} ${p.project_token}`);
    log(`  ${DIM}origins:${RESET} ${p.allowed_origins || '*'}`);
    log('');
  }
});

const cmdAllSites = withApi(async (api, opts = {}) => {
  const period = opts.period || '7d';
  const limit = parseInt(opts.limit || '10', 10);
  const data = await api.getAllSitesOverview({ period, limit });

  heading(`All Sites (${data.period?.label || period} vs previous)`);
  log('');

  const totalEvents = data.summary?.total_events || { current: 0, previous: 0, change: 0, change_pct: 0 };
  const changeLabel = totalEvents.change_pct === null
    ? `${GREEN}new${RESET}`
    : `${totalEvents.change_pct > 0 ? '+' : ''}${totalEvents.change_pct}%`;
  const changeArrow = totalEvents.change > 0 ? `${GREEN}↑${RESET}`
    : totalEvents.change < 0 ? `${RED}↓${RESET}`
    : `${DIM}—${RESET}`;

  log(`  ${BOLD}Total events:${RESET}   ${totalEvents.current} ${changeArrow} ${changeLabel}${RESET}  ${DIM}was ${totalEvents.previous}${RESET}`);
  log(`  ${BOLD}Active projects:${RESET} ${data.summary?.active_projects || 0} of ${data.summary?.total_projects || 0}`);
  if (data.period) {
    log(`  ${DIM}${data.period.from} → ${data.period.to}${RESET}`);
  }

  if (data.time_series && data.time_series.length > 0) {
    log('');
    heading('Daily:');
    const maxEvents = Math.max(...data.time_series.map((row) => row.events || 0), 0);
    for (const row of data.time_series) {
      const barLen = maxEvents > 0 ? Math.min(Math.max(Math.ceil((row.events / maxEvents) * 24), row.events > 0 ? 1 : 0), 24) : 0;
      const bar = '█'.repeat(barLen);
      log(`  ${row.date}  ${GREEN}${bar}${RESET}  ${row.events} events`);
    }
  }

  log('');
  heading('Top Projects:');
  if (!data.projects || data.projects.length === 0) {
    log('  No active projects in this period.');
  } else {
    for (const project of data.projects) {
      const share = Number.isFinite(project.share_pct) ? `${project.share_pct}%` : '0%';
      const lastActive = project.last_active_date ? `  ${DIM}last active ${project.last_active_date}${RESET}` : '';
      log(`  ${BOLD}${project.name}${RESET}  ${project.events} events  ${DIM}${share}${RESET}${lastActive}`);
    }
    if (data.remaining_projects > 0) {
      log(`  ${DIM}+${data.remaining_projects} more active project${data.remaining_projects === 1 ? '' : 's'}${RESET}`);
    }
  }

  log('');
});

const cmdBotTraffic = withApi(async (api, target, opts = {}) => {
  const period = opts.period || '7d';
  const limit = parseInt(opts.limit || '10', 10);

  if (!target) error('Usage: npx @agent-analytics/cli bot-traffic <project-name> [--period 7d] [--limit 10]\n       npx @agent-analytics/cli bot-traffic --all [--period 7d] [--limit 10]');

  const data = target === '--all'
    ? await api.getAllSitesBotTraffic({ period, limit })
    : await api.getBotTraffic(target, { period, limit });

  if (target === '--all') {
    heading(`All Sites Bot Traffic (${data.period?.label || period})`);
    log('');
    log(`  ${BOLD}Automated requests:${RESET} ${data.summary?.automated_requests?.current || 0}`);
    log(`  ${BOLD}Dropped events:${RESET}    ${data.summary?.dropped_events?.current || 0}`);
    log(`  ${BOLD}Projects:${RESET}          ${data.summary?.active_projects || 0} active / ${data.summary?.total_projects || 0} total`);

    if (data.projects?.length) {
      log('');
      heading('Top Projects:');
      for (const project of data.projects) {
        log(`  ${BOLD}${project.name}${RESET}  ${project.requests} requests  ${DIM}${project.share_pct}% share${RESET}`);
      }
    }

    log('');
    return;
  }

  heading(`Bot Traffic: ${target}`);
  log('');
  log(`  ${BOLD}Automated requests:${RESET} ${data.summary?.automated_requests?.current || 0}`);
  log(`  ${BOLD}Dropped events:${RESET}    ${data.summary?.dropped_events?.current || 0}`);

  if (data.categories?.length) {
    log('');
    heading('Categories:');
    for (const category of data.categories) {
      log(`  ${category.category}  ${category.requests} requests  ${DIM}${category.share_pct}% share${RESET}`);
    }
  }

  if (data.actors?.length) {
    log('');
    heading('Top Actors:');
    for (const actor of data.actors) {
      log(`  ${BOLD}${actor.actor}${RESET}  ${actor.requests} requests  ${DIM}${actor.category}${RESET}`);
    }
  }

  log('');
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

  if (data.timeSeries && data.timeSeries.length > 0) {
    log('');
    heading('Daily:');
    for (const d of data.timeSeries) {
      const bar = '█'.repeat(Math.min(Math.ceil(d.total_events / 5), 40));
      log(`  ${d.bucket || d.date}  ${GREEN}${bar}${RESET}  ${d.total_events} events`);
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
  if (!project) error('Usage: npx @agent-analytics/cli events <project-name> [--days N] [--limit N] [--user-id id] [--email email]');

  const data = await api.getEvents(project, { ...opts, ...identityOptions(opts) });

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

const cmdJourney = withApi(async (api, project, opts = {}) => {
  if (!project) error('Usage: npx @agent-analytics/cli journey <project-name> [--user-id id | --email email] [--since 30d] [--limit N]');
  if (!opts.user_id && !opts.email) error('journey requires --user-id or --email');

  const data = await api.getJourney(project, { ...opts, ...identityOptions(opts) });

  heading(`Journey: ${project}`);
  log('');

  const label = opts.email ? `email ${normalizeEmail(opts.email)}` : `user ${opts.user_id}`;
  log(`  ${DIM}${label}${RESET}`);
  if (data.profiles?.length) {
    const ids = data.profiles.map((profile) => profile.user_id).join(', ');
    log(`  ${DIM}matched user_id:${RESET} ${ids}`);
  }
  log('');

  if (ifEmpty(data.events, 'events')) return;

  for (const e of data.events) {
    const time = new Date(e.timestamp).toLocaleString();
    const props = e.properties || {};
    const path = props.path || props.page || props.url || '';
    const referrer = props.referrer ? `  ${DIM}ref ${props.referrer}${RESET}` : '';
    const session = e.session_id ? `  ${DIM}${e.session_id}${RESET}` : '';
    log(`  ${DIM}${time}${RESET}  ${BOLD}${e.event}${RESET}  ${DIM}${e.user_id || ''}${RESET}${session}`);
    if (path || referrer) log(`    ${DIM}${path}${RESET}${referrer}`);
    const compactProps = { ...props };
    delete compactProps.url;
    delete compactProps.path;
    delete compactProps.page;
    delete compactProps.referrer;
    delete compactProps.title;
    if (Object.keys(compactProps).length > 0) {
      log(`    ${DIM}${JSON.stringify(compactProps)}${RESET}`);
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
  if (!project || !property) error('Usage: npx @agent-analytics/cli breakdown <project-name> --property <key> [--event page_view] [--days N] [--since 7d|YYYY-MM-DD] [--limit 20]');

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

function formatPathNodeLabel(node) {
  if (node.type === 'goal') return `goal:${node.value}`;
  if (node.type === 'drop_off') return `drop_off:${node.exit_page || node.value || 'unknown'}`;
  if (node.type === 'truncated') return `truncated:${node.exit_page || node.value || 'unknown'}`;
  return node.value;
}

function printPathsTree(nodes, prefix = '    ') {
  for (const node of nodes || []) {
    const ratePct = Math.round((node.conversion_rate || 0) * 100);
    log(`${prefix}${formatPathNodeLabel(node)}  ${DIM}${node.sessions} sessions  ${node.conversions} conversions  ${ratePct}%${RESET}`);
    printPathsTree(node.children, `${prefix}  `);
  }
}

const cmdPaths = withApi(async (api, project, opts = {}) => {
  if (!project || !opts.goal_event) {
    error('Usage: npx @agent-analytics/cli paths <project-name> --goal <event> [--since 30d] [--max-steps 5] [--entry-limit 10] [--path-limit 5] [--candidate-session-cap 5000]');
  }

  const data = await api.getPaths(project, opts);

  heading(`Paths: ${project}`);
  log('');
  log(`  ${BOLD}Goal:${RESET} ${data.goal_event}  ${DIM}${data.period?.from} → ${data.period?.to}${RESET}`);
  log(`  ${BOLD}Bounds:${RESET} max_steps=${data.bounds?.max_steps} entry_limit=${data.bounds?.entry_limit} path_limit=${data.bounds?.path_limit} candidate_session_cap=${data.bounds?.candidate_session_cap}`);
  log('');

  if (ifEmpty(data.entry_paths, 'path data')) return;

  for (const entry of data.entry_paths) {
    const ratePct = Math.round((entry.conversion_rate || 0) * 100);
    log(`  ${BOLD}${entry.entry_page}${RESET}  ${entry.sessions} sessions  ${entry.conversions} conversions  ${DIM}${ratePct}%${RESET}`);
    if (entry.exit_pages?.length) {
      log(`    ${BOLD}Exits:${RESET}`);
      for (const exit of entry.exit_pages.slice(0, 5)) {
        const dropPct = Math.round((exit.drop_off_rate || 0) * 100);
        const convPct = Math.round((exit.conversion_rate || 0) * 100);
        log(`      ${exit.exit_page}  ${DIM}${exit.sessions} sessions  ${exit.drop_offs} drop-offs (${dropPct}%)  ${exit.conversions} conversions (${convPct}%)${RESET}`);
      }
    }
    log(`    ${BOLD}Path tree:${RESET}`);
    printPathsTree(entry.tree);
    log('');
  }
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
  if (!project) error(`Usage: npx @agent-analytics/cli query <name> [options]

  --metrics   event_count,unique_users,session_count,bounce_rate,avg_duration
  --group-by  event,date,user_id,session_id,country
  --filter    JSON array of filters (operators: eq, neq, gt, lt, gte, lte, contains)
  --from      Start date (ISO, e.g. 2026-01-01)
  --to        End date (ISO)
  --days      Shorthand for --from (e.g. --days 30)
  --count-mode raw or session_then_user (default: raw event rows)
  --order-by  event_count, unique_users, session_count, date, event
  --order     asc or desc
  --limit     Max rows (default 100, max 1000)
  --email     Filter by local-only normalized SHA-256 email hash lookup

Property filters must use the canonical properties.<key> form.
Example: properties.referrer, properties.utm_source, properties.first_utm_source
Email lookup uses normalized SHA-256, not a keyed HMAC. It keeps raw email out of API requests but hashes may be guessable for known emails.
Invalid filter fields now fail loudly instead of being ignored.

${BOLD}Examples:${RESET}
  ${CYAN}npx @agent-analytics/cli query my-site --group-by country --metrics event_count,unique_users${RESET}
  ${CYAN}npx @agent-analytics/cli query my-site --metrics event_count --count-mode session_then_user${RESET}
  ${CYAN}npx @agent-analytics/cli query my-site --filter '[{"field":"country","op":"eq","value":"US"}]'${RESET}
  ${CYAN}npx @agent-analytics/cli query my-site --filter '[{"field":"event","op":"contains","value":"click"}]' --group-by event${RESET}
  ${CYAN}npx @agent-analytics/cli query my-site --filter '[{"field":"properties.referrer","op":"contains","value":"clawflows.com"}]'${RESET}`);

  const metrics = opts.metrics ? opts.metrics.split(',').map(m => m.trim()) : undefined;
  const group_by = opts.group_by ? opts.group_by.split(',').map(g => g.trim()) : undefined;

  let filters;
  if (opts.filter) {
    try {
      filters = JSON.parse(opts.filter);
    } catch {
      error('Invalid --filter JSON. Example: --filter \'[{"field":"country","op":"eq","value":"US"}]\'');
    }
  }

  const data = await api.query(project, {
    metrics,
    group_by,
    filters,
    date_from: opts.date_from || undefined,
    date_to: opts.date_to || undefined,
    count_mode: opts.count_mode || undefined,
    order_by: opts.order_by || undefined,
    order: opts.order || undefined,
    limit: opts.limit,
    ...identityOptions(opts),
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

const cmdProject = withApi(async (api, target) => {
  if (!target) error('Usage: npx @agent-analytics/cli project <project-name-or-id>');
  const project = await resolveProject(api, target);
  const data = await api.getProject(project.id);

  heading(`Project: ${data.name}`);
  log('');
  log(`  ${BOLD}ID:${RESET}      ${data.id}`);
  log(`  ${BOLD}Token:${RESET}   ${data.project_token}`);
  log(`  ${BOLD}Origins:${RESET} ${data.allowed_origins || '*'}`);
  if (data.created_at) log(`  ${BOLD}Created:${RESET} ${new Date(data.created_at).toLocaleDateString()}`);
  if (data.total_events != null) log(`  ${BOLD}Events:${RESET}  ${data.total_events}`);
  log('');
});

function logProjectContext(data) {
  const context = data.project_context || {};
  heading(`Project Context: ${data.project || data.project_id || 'project'}`);
  log('');

  const goals = context.goals || [];
  const activationEvents = context.activation_events || [];
  const glossary = context.glossary || [];

  if (goals.length === 0 && activationEvents.length === 0 && glossary.length === 0) {
    log('  No project context stored.');
    log(`${DIM}Use context set after checking event names with: npx @agent-analytics/cli properties <project>${RESET}`);
    log('');
    return;
  }

  if (goals.length > 0) {
    heading('Goals:');
    for (const goal of goals) log(`  - ${goal}`);
  }

  if (activationEvents.length > 0) {
    log('');
    heading('Activation Events:');
    for (const eventName of activationEvents) log(`  - ${eventName}`);
  }

  if (glossary.length > 0) {
    log('');
    heading('Glossary:');
    for (const entry of glossary) {
      log(`  - ${entry.event_name}: ${entry.term}`);
      log(`    ${DIM}${entry.definition}${RESET}`);
    }
  }

  log('');
}

function logPortfolioContext(data) {
  const context = data.portfolio_context || {};
  heading('Portfolio Context');
  log('');

  const goals = context.goals || [];
  const surfaceRoles = context.surface_roles || [];
  const sharedMilestones = context.shared_milestones || [];
  const glossary = context.glossary || [];

  if (goals.length === 0 && surfaceRoles.length === 0 && sharedMilestones.length === 0 && glossary.length === 0) {
    log('  No portfolio context stored.');
    log(`${DIM}Use portfolio-context set --json '{...}' to define your shared growth system.${RESET}`);
    log('');
    return;
  }

  if (goals.length > 0) {
    heading('Goals:');
    for (const goal of goals) log(`  - ${goal}`);
  }

  if (surfaceRoles.length > 0) {
    log('');
    heading('Surface Roles:');
    for (const entry of surfaceRoles) log(`  - ${entry.project}: ${entry.role}`);
  }

  if (sharedMilestones.length > 0) {
    log('');
    heading('Shared Milestones:');
    for (const milestone of sharedMilestones) log(`  - ${milestone}`);
  }

  if (glossary.length > 0) {
    log('');
    heading('Glossary:');
    for (const entry of glossary) {
      log(`  - ${entry.term}`);
      log(`    ${DIM}${entry.definition}${RESET}`);
    }
  }

  log('');
}

const cmdContext = withApi(async (api, subcommand, project, opts = {}) => {
  if (!subcommand || !['get', 'set'].includes(subcommand)) {
    error('Usage: npx @agent-analytics/cli context <get|set> <project> [--json \'{...}\']');
  }
  if (!project) {
    error(`Usage: npx @agent-analytics/cli context ${subcommand} <project>`);
  }

  if (subcommand === 'get') {
    const data = await api.getProjectContext(project);
    logProjectContext(data);
    return;
  }

  if (!opts.json) {
    error('Usage: npx @agent-analytics/cli context set <project> --json \'{"goals":[],"activation_events":[],"glossary":[]}\'');
  }

  let context;
  try {
    context = JSON.parse(opts.json);
  } catch {
    error('--json must be valid JSON');
  }

  const data = await api.setProjectContext(project, context);
  success(`Project context updated for ${data.project || project}`);
  logProjectContext(data);
});

const cmdPortfolioContext = withApi(async (subcommandApi, subcommand, opts = {}) => {
  if (!subcommand || !['get', 'set'].includes(subcommand)) {
    error('Usage: npx @agent-analytics/cli portfolio-context <get|set> [--json \'{...}\']');
  }

  if (subcommand === 'get') {
    const data = await subcommandApi.getPortfolioContext();
    logPortfolioContext(data);
    return;
  }

  if (!opts.json) {
    error('Usage: npx @agent-analytics/cli portfolio-context set --json \'{"goals":[],"surface_roles":[],"shared_milestones":[],"glossary":[]}\'');
  }

  let context;
  try {
    context = JSON.parse(opts.json);
  } catch {
    error('--json must be valid JSON');
  }

  const data = await subcommandApi.setPortfolioContext(context);
  success('Portfolio context updated');
  logPortfolioContext(data);
});

const cmdUpdate = withApi(async (api, target, opts = {}) => {
  if (!target) error('Usage: npx @agent-analytics/cli update <project-name-or-id> [--name new-name] [--origins "https://example.com"]');
  if (!opts.name && !opts.allowed_origins) error('Provide --name and/or --origins to update');

  const project = await resolveProject(api, target);
  const data = await api.updateProject(project.id, opts);
  success(`Project ${data.name || project.name || target} updated`);
  if (opts.name) log(`  ${DIM}name:${RESET} ${data.name}`);
  if (opts.allowed_origins) log(`  ${DIM}origins:${RESET} ${data.allowed_origins}`);
});

const cmdDelete = withApi(async (api, nameOrId) => {
  if (!nameOrId) error('Usage: npx @agent-analytics/cli delete <project-name-or-id>');

  const project = await resolveProject(api, nameOrId);
  await api.deleteProject(project.id);
  success(`Project ${project.name} deleted`);
});

function cmdDeleteAccount() {
  heading('Delete Account');
  log('');
  log('For security, account deletion must be done from the dashboard.');
  log(`Visit: ${CYAN}https://app.agentanalytics.sh/settings${RESET}`);
  log('');
}

async function cmdRevokeKey() {
  const auth = getStoredAuth();
  if (!auth) {
    error('No raw API key is saved. Use browser-approved CLI login for normal agent work.');
  }
  if (auth.access_token || auth.refresh_token) {
    error('revoke-key only rotates a saved raw API key. Manage keys from https://app.agentanalytics.sh/settings.');
  }

  const api = createApiClient(auth);
  let data;
  try {
    data = await api.revokeKey();
  } catch (err) {
    error(err.message);
  }

  setApiKey(data.api_key);

  warn('Old API key revoked');
  success('New API key generated and saved\n');
  heading('New API key:');
  log(`${YELLOW}${data.api_key}${RESET}`);
  log(`${DIM}Saved to ${getConfigFile()}${RESET}\n`);
  warn('Update your agent with this new key!');
}

const cmdFeedback = withApi(async (api, opts = {}) => {
  if (!opts.message) {
    error('Usage: npx @agent-analytics/cli feedback --message "What was hard?" [--project my-site] [--command "agent-analytics ..."] [--context "sanitized context"]');
  }

  await api.sendFeedback({
    message: opts.message,
    project: opts.project,
    command: opts.command,
    context: opts.context,
  });

  success('Feedback sent');
  log(`${DIM}A real agent reads these Telegram messages, every request is seen and auto-approved, and useful fixes can land quickly — sometimes within hours.${RESET}`);
  log(`${DIM}Share the struggle or missing capability, not private owner details, secrets, or raw customer data.${RESET}`);
  log('');
});

function formatExpiry(value) {
  if (!value) return 'N/A';
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp)) return String(value);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function logAuthDiagnostics(config = getConfig()) {
  const location = getConfigLocation();
  const session = config.agent_session || {};
  log(`  ${BOLD}Config:${RESET}  ${location.file}`);
  log(`  ${BOLD}Storage:${RESET} ${location.label}`);
  log(`  ${BOLD}Auth:${RESET}    ${getAuthSource(config)}`);
  log(`  ${BOLD}Access expires:${RESET}  ${formatExpiry(session.access_expires_at)}`);
  log(`  ${BOLD}Refresh expires:${RESET} ${formatExpiry(session.refresh_expires_at)}`);
}

const cmdWhoami = withApi(async (api) => {
  const data = await api.getAccount();
  heading('Account');
  log(`  ${BOLD}Email:${RESET}    ${data.email}`);
  log(`  ${BOLD}GitHub:${RESET}   ${data.github_login || 'N/A'}`);
  log(`  ${BOLD}Tier:${RESET}     ${data.tier}`);
  log(`  ${BOLD}Projects:${RESET} ${data.projects_count}`);
  if (data.tier === 'pro' && data.monthly_spend_cap_dollars != null) {
    log(`  ${BOLD}Spend cap:${RESET} $${data.monthly_spend_cap_dollars.toFixed(2)}/month`);
  }
  log('');
  heading('Auth');
  logAuthDiagnostics(getConfig());
  log('');
});

function cmdAuth(sub) {
  if (sub !== 'status') {
    error('Usage: npx @agent-analytics/cli auth status');
  }

  const location = getConfigLocation();
  const config = getConfig();
  const session = config.agent_session || {};

  heading('Auth Status');
  log(`  ${BOLD}Config dir:${RESET}  ${location.dir}`);
  log(`  ${BOLD}Config file:${RESET} ${location.file}`);
  log(`  ${BOLD}Storage:${RESET}     ${location.label}`);
  log(`  ${BOLD}Auth:${RESET}        ${getAuthSource(config)}`);
  log('');

  heading('Cached Account');
  log(`  ${BOLD}Email:${RESET}  ${config.email || 'N/A'}`);
  log(`  ${BOLD}GitHub:${RESET} ${config.github_login || 'N/A'}`);
  log(`  ${BOLD}Google:${RESET} ${config.google_name || 'N/A'}`);
  log(`  ${BOLD}Tier:${RESET}   ${config.tier || 'N/A'}`);
  log('');

  heading('Agent Session');
  log(`  ${BOLD}ID:${RESET}              ${session.id || 'N/A'}`);
  log(`  ${BOLD}Scopes:${RESET}          ${Array.isArray(session.scopes) ? session.scopes.join(', ') : 'N/A'}`);
  log(`  ${BOLD}Access expires:${RESET}  ${formatExpiry(session.access_expires_at)}`);
  log(`  ${BOLD}Refresh expires:${RESET} ${formatExpiry(session.refresh_expires_at)}`);
  log('');
}

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
  ${CYAN}login${RESET}                  Browser-based agent session login
  ${CYAN}login${RESET} --detached       Detached approval handoff; prints URL and exits
  ${CYAN}login${RESET} --detached --wait  Detached approval with polling
  ${CYAN}upgrade-link${RESET} --detached  Print a human Pro payment handoff link
  ${CYAN}upgrade-link${RESET} --wait      Print the handoff link and wait for Pro activation
  ${CYAN}demo${RESET}                   Print no-sign-in public demo prompts and commands
  ${CYAN}--demo${RESET} <command>        Run a read-only command against seeded demo data
  ${CYAN}logout${RESET}                 Clear saved local auth
  ${CYAN}scan${RESET} <url>              Preview what your agent should track first
  ${CYAN}create${RESET} <name>          Create a project and get your tracking snippet
  ${CYAN}projects${RESET}               List all your projects

${BOLD}ANALYTICS${RESET}
  ${CYAN}all-sites${RESET}              Historical summary across all projects
  ${CYAN}bot-traffic${RESET} <name>     Filtered automated traffic by project or --all
  ${CYAN}stats${RESET} <name>           Overview: events, users, daily trends
  ${CYAN}live${RESET} [name]            Real-time terminal dashboard across all projects
  ${CYAN}insights${RESET} <name>        Period-over-period comparison with trends
  ${CYAN}breakdown${RESET} <name>       Top pages, referrers, UTM sources, countries
  ${CYAN}pages${RESET} <name>           Entry/exit page performance & bounce rates
  ${CYAN}paths${RESET} <name>           Bounded entry-to-goal/drop-off session paths
  ${CYAN}heatmap${RESET} <name>         Peak hours & busiest days
  ${CYAN}funnel${RESET} <name>            Funnel analysis: where users drop off
  ${CYAN}retention${RESET} <name>         Cohort retention: % of users who return
  ${CYAN}sessions-dist${RESET} <name>   Session duration distribution
  ${CYAN}events${RESET} <name>          Raw event log
  ${CYAN}journey${RESET} <name>         Chronological journey by --user-id or --email
  ${CYAN}sessions${RESET} <name>        Individual session records
  ${CYAN}query${RESET} <name>           Flexible analytics query (metrics, group_by, filters, country)
  ${CYAN}properties${RESET} <name>      Discover event names & property keys
  ${CYAN}context get${RESET} <name>     Read stored goals, activation events, and event glossary
  ${CYAN}context set${RESET} <name>     Set compact project context with --json
  ${CYAN}portfolio-context get${RESET}  Read stored account portfolio context
  ${CYAN}portfolio-context set${RESET}  Set compact portfolio context with --json

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
  ${CYAN}auth status${RESET}            Show local auth path and token expiry metadata
  ${CYAN}feedback${RESET}               Send product/process feedback
  ${CYAN}project${RESET} <project>      Get single project details by name or id
  ${CYAN}update${RESET} <project>       Update a project by name or id (--name, --origins)
  ${CYAN}delete${RESET} <project>       Delete a project by name or id

${BOLD}KEY OPTIONS${RESET}
  --days <N>         Lookback window in days (default: 7)
  --limit <N>        Max results (default: 100)
  --domain <url>     Site domain (required for create)
  --source-scan <id> Link project creation to a prior website analysis
  --resume <id>      Resume a website analysis by id
  --resume-token <t> Resume token for one analysis
  --full             Upgrade a resumed analysis after login
  --period <P>       Comparison period: 1d, 7d, 14d, 30d, 90d
  --since <VALUE>    Lookback start for commands that support explicit ranges
  --property <key>   Property to break down (path, referrer, utm_source, country)
  --event <name>     Filter by event name
  --user-id <id>     Filter events or journeys to one known user id
  --email <email>    Filter events, journeys, or query by local-only email hash lookup
                     Uses normalized SHA-256, not a keyed HMAC; hashes may be guessable for known emails
  --message <text>   Feedback message for the product team
  --filter <json>    Filters for query (e.g. '[{"field":"country","op":"eq","value":"US"}]')
  --interval <N>     Live view refresh in seconds (default: 5)
  --window <N>       Live view time window in seconds (default: 60)
  --goal <event>     Goal event for paths and experiments
  --max-steps <N>    Max path steps before truncation (1-5)
  --entry-limit <N>  Max entry pages to include (1-20)
  --path-limit <N>   Max children kept at each path branch (1-10)
  --candidate-session-cap <N>  Max sessions scanned for /paths (100-10000)
  --config-dir <dir> Read/write auth config from an explicit directory

${BOLD}QUICK START${RESET}
  ${DIM}# 1. Start agent login${RESET}
  npx @agent-analytics/cli login

  ${DIM}# 2. Create a project${RESET}
  npx @agent-analytics/cli create my-site --domain https://mysite.com

  ${DIM}# 3. Check how all your projects are doing — live${RESET}
  npx @agent-analytics/cli live

  ${DIM}# 4. Run an A/B test${RESET}
  npx @agent-analytics/cli experiments create my-site --name hero_test \\
    --variants control,new_headline --goal signup

  ${DIM}# 5. Send product feedback if a workflow was confusing or too manual${RESET}
  npx @agent-analytics/cli feedback --message "The agent had to calculate funnel drop-off manually"

${DIM}Works with Claude Code, OpenClaw, Cursor, Codex — any agent that can run npx.${RESET}
${DIM}https://agentanalytics.sh${RESET}
`);
}

// ==================== MAIN ====================

function parseGlobalOptions(argv) {
  const nextArgs = [];
  let configDir = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== '--config-dir') {
      nextArgs.push(arg);
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      error('Missing value for --config-dir. Usage: npx @agent-analytics/cli --config-dir <dir> <command>');
    }
    configDir = value;
    i += 1;
  }

  return { args: nextArgs, configDir };
}

const rawArgs = process.argv.slice(2);
const parsedGlobal = parseGlobalOptions(rawArgs);
if (parsedGlobal.configDir) {
  setConfigDirOverride(parsedGlobal.configDir);
}
const demoMode = parsedGlobal.args.includes('--demo');
const args = parsedGlobal.args.filter((arg) => arg !== '--demo');
const command = demoMode && !args[0] ? 'demo' : args[0];

const DEMO_MUTATING_COMMANDS = new Set([
  'login',
  'logout',
  'create',
  'init',
  'update',
  'delete',
  'upgrade-link',
  'revoke-key',
  'feedback',
  'delete-account',
]);

function isDemoMutation(commandName, commandArgs) {
  if (!demoMode) return false;
  if (DEMO_MUTATING_COMMANDS.has(commandName)) return true;
  if (commandName === 'context') {
    return commandArgs[1] === 'set';
  }
  if (commandName === 'experiments') {
    return ['create', 'pause', 'resume', 'complete', 'delete'].includes(commandArgs[1]);
  }
  return false;
}

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx > -1 && args[idx + 1] ? args[idx + 1] : null;
}

try {
  if (isDemoMutation(command, args)) {
    error('Demo mode is read-only. Use read commands like --demo projects, --demo stats, --demo paths, --demo funnel, or --demo experiments list.');
  }

  switch (command) {
    case 'demo':
      cmdDemo();
      break;
    case 'login':
      await cmdLogin({
        token: getArg('--token'),
        detached: args.includes('--detached'),
        exchangeCode: getArg('--exchange-code'),
        authRequestId: getArg('--auth-request'),
        waitForDetached: args.includes('--wait') || args.includes('--poll'),
      });
      break;
    case 'logout':
      cmdLogout();
      break;
    case 'scan': {
      const scanUrl = args[1] && !args[1].startsWith('--') ? args[1] : null;
      await cmdScan({
        url: scanUrl,
        resumeId: getArg('--resume'),
        resumeToken: getArg('--resume-token'),
        full: args.includes('--full'),
        project: getArg('--project'),
        jsonOutput: args.includes('--json'),
      });
      break;
    }
    case 'create':
    case 'init':
      await cmdCreate(args[1], getArg('--domain'), {
        source_scan_id: getArg('--source-scan'),
      });
      break;
    case 'projects':
    case 'list':
      await cmdProjects();
      break;
    case 'upgrade-link':
      await cmdUpgradeLink({
        detached: args.includes('--detached'),
        wait: args.includes('--wait'),
        reason: getArg('--reason'),
        blockedCommand: getArg('--command'),
      });
      break;
    case 'all-sites':
      await cmdAllSites({
        period: getArg('--period') || '7d',
        limit: getArg('--limit') || '10',
      });
      break;
    case 'bot-traffic': {
      const botTrafficTarget = args[1] || (args.includes('--all') ? '--all' : null);
      await cmdBotTraffic(botTrafficTarget, {
        period: getArg('--period') || '7d',
        limit: getArg('--limit') || '10',
      });
      break;
    }
    case 'stats':
      await cmdStats(args[1], parseInt(getArg('--days') || '7', 10));
      break;
    case 'events':
      await cmdEvents(args[1], {
        days: parseInt(getArg('--days') || '7', 10),
        since: getArg('--since'),
        limit: parseInt(getArg('--limit') || '100', 10),
        event: getArg('--event'),
        user_id: getArg('--user-id'),
        email: getArg('--email'),
      });
      break;
    case 'journey':
      await cmdJourney(args[1], {
        since: getArg('--since') || (getArg('--days') ? `${getArg('--days')}d` : undefined),
        limit: getArg('--limit') ? parseInt(getArg('--limit'), 10) : undefined,
        user_id: getArg('--user-id'),
        email: getArg('--email'),
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
        filter: getArg('--filter'),
        date_from: getArg('--from') || (getArg('--days') ? `${getArg('--days')}d` : undefined),
        date_to: getArg('--to'),
        count_mode: getArg('--count-mode'),
        order_by: getArg('--order-by'),
        order: getArg('--order'),
        limit: getArg('--limit') ? parseInt(getArg('--limit'), 10) : undefined,
        email: getArg('--email'),
      });
      break;
    case 'project':
      await cmdProject(args[1]);
      break;
    case 'context':
      await cmdContext(args[1], args[2], {
        json: getArg('--json'),
      });
      break;
    case 'portfolio-context':
      await cmdPortfolioContext(args[1], {
        json: getArg('--json'),
      });
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
        since: getArg('--since') || (getArg('--days') ? `${getArg('--days')}d` : undefined),
        limit: getArg('--limit') ? parseInt(getArg('--limit'), 10) : undefined,
      });
      break;
    case 'pages':
      await cmdPages(args[1], getArg('--type') || 'entry', {
        limit: getArg('--limit') ? parseInt(getArg('--limit'), 10) : undefined,
      });
      break;
    case 'paths':
      await cmdPaths(args[1], {
        goal_event: getArg('--goal'),
        since: getArg('--since'),
        max_steps: getArg('--max-steps') ? parseInt(getArg('--max-steps'), 10) : undefined,
        entry_limit: getArg('--entry-limit') ? parseInt(getArg('--entry-limit'), 10) : undefined,
        path_limit: getArg('--path-limit') ? parseInt(getArg('--path-limit'), 10) : undefined,
        candidate_session_cap: getArg('--candidate-session-cap') ? parseInt(getArg('--candidate-session-cap'), 10) : undefined,
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
    case 'feedback':
      await cmdFeedback({
        message: getArg('--message'),
        project: getArg('--project'),
        command: getArg('--command'),
        context: getArg('--context'),
      });
      break;
    case 'delete-account':
      cmdDeleteAccount();
      break;
    case 'whoami':
      await cmdWhoami();
      break;
    case 'auth':
      cmdAuth(args[1]);
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
