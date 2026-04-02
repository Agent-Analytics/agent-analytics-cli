/**
 * Config management — stores agent sessions locally.
 * $XDG_CONFIG_HOME/agent-analytics/config.json
 * Fallback: ~/.config/agent-analytics/config.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function getConfigDir() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return join(xdgConfigHome, 'agent-analytics');
  }

  return join(homedir(), '.config', 'agent-analytics');
}

export function getConfigFile() {
  return join(getConfigDir(), 'config.json');
}

export function getConfig() {
  try {
    return JSON.parse(readFileSync(getConfigFile(), 'utf8'));
  } catch {
    return {};
  }
}

export function saveConfig(config) {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(getConfigFile(), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

export function getApiKey() {
  const config = getConfig();
  return process.env.AGENT_ANALYTICS_API_KEY || config.api_key || null;
}

export function getStoredAuth() {
  const config = getConfig();

  if (process.env.AGENT_ANALYTICS_API_KEY) {
    return { api_key: process.env.AGENT_ANALYTICS_API_KEY };
  }

  if (config.agent_session?.refresh_token || config.agent_session?.access_token) {
    return { ...config.agent_session };
  }

  if (config.api_key) {
    return { api_key: config.api_key };
  }

  return null;
}

export function setApiKey(key) {
  const config = getConfig();
  config.api_key = key;
  delete config.agent_session;
  saveConfig(config);
}

export function setAgentSession(session) {
  const config = getConfig();
  config.agent_session = { ...session };
  delete config.api_key;
  saveConfig(config);
}

export function updateStoredAccount(account = {}) {
  const config = getConfig();
  if (account.email) config.email = account.email;
  if (account.github_login) config.github_login = account.github_login;
  if (account.google_name) config.google_name = account.google_name;
  if (account.tier) config.tier = account.tier;
  saveConfig(config);
}

export function clearStoredAuth() {
  const config = getConfig();
  const hadStoredAuth = ['api_key', 'agent_session', 'email', 'github_login', 'google_name', 'tier']
    .some((key) => Object.prototype.hasOwnProperty.call(config, key));

  if (!hadStoredAuth) {
    return false;
  }

  delete config.api_key;
  delete config.agent_session;
  delete config.email;
  delete config.github_login;
  delete config.google_name;
  delete config.tier;
  saveConfig(config);
  return true;
}

export function getBaseUrl() {
  const config = getConfig();
  return process.env.AGENT_ANALYTICS_URL || config.base_url || 'https://api.agentanalytics.sh';
}
