/**
 * Config management — stores agent sessions locally.
 * AGENT_ANALYTICS_CONFIG_DIR/config.json
 * $XDG_CONFIG_HOME/agent-analytics/config.json
 * Fallback: ~/.config/agent-analytics/config.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { clearAgentSession, readAgentSession, saveAgentSession } from './credential-store.mjs';

let explicitConfigDir = null;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export function setConfigDirOverride(dir) {
  explicitConfigDir = nonEmpty(dir) ? dir : null;
}

export function clearConfigDirOverride() {
  explicitConfigDir = null;
}

export function getConfigLocation() {
  if (explicitConfigDir) {
    return {
      dir: explicitConfigDir,
      file: join(explicitConfigDir, 'config.json'),
      source: 'flag',
      label: '--config-dir',
    };
  }

  if (nonEmpty(process.env.AGENT_ANALYTICS_CONFIG_DIR)) {
    const dir = process.env.AGENT_ANALYTICS_CONFIG_DIR;
    return {
      dir,
      file: join(dir, 'config.json'),
      source: 'env',
      label: 'AGENT_ANALYTICS_CONFIG_DIR',
    };
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (nonEmpty(xdgConfigHome)) {
    const dir = join(xdgConfigHome, 'agent-analytics');
    return {
      dir,
      file: join(dir, 'config.json'),
      source: 'xdg',
      label: 'XDG_CONFIG_HOME',
    };
  }

  const dir = join(homedir(), '.config', 'agent-analytics');
  return {
    dir,
    file: join(dir, 'config.json'),
    source: 'home',
    label: 'home fallback',
  };
}

export function getConfigDir() {
  return getConfigLocation().dir;
}

export function getConfigFile() {
  return getConfigLocation().file;
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
  return null;
}

export async function getStoredAuth() {
  const config = getConfig();
  return readAgentSession(config, getBaseUrl());
}

export function getAuthSource(config = getConfig()) {
  if (config.agent_session?.storage === 'native') {
    return 'stored agent session';
  }
  if (config.agent_session?.refresh_token || config.agent_session?.access_token) {
    return 'stored agent session';
  }

  return 'none';
}

export function setApiKey(key) {
  const config = getConfig();
  config.api_key = key;
  delete config.agent_session;
  saveConfig(config);
}

export async function setAgentSession(session) {
  return saveAgentSession(session, getBaseUrl());
}

export function updateStoredAccount(account = {}) {
  const config = getConfig();
  if (account.email) config.email = account.email;
  if (account.github_login) config.github_login = account.github_login;
  if (account.google_name) config.google_name = account.google_name;
  if (account.tier) config.tier = account.tier;
  saveConfig(config);
}

export async function clearStoredAuth() {
  const config = getConfig();
  const hadStoredAuth = ['api_key', 'agent_session', 'email', 'github_login', 'google_name', 'tier']
    .some((key) => Object.prototype.hasOwnProperty.call(config, key));

  if (!hadStoredAuth) {
    return false;
  }

  try {
    await clearAgentSession(config, getBaseUrl());
  } catch {
    // Native keyring cleanup is best-effort. Logout must still clear local
    // metadata so a broken/locked keyring cannot leave the CLI appearing logged in.
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
