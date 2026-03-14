/**
 * Config management — stores API key locally.
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

export function setApiKey(key) {
  const config = getConfig();
  config.api_key = key;
  saveConfig(config);
}

export function clearStoredAuth() {
  const config = getConfig();
  const hadStoredAuth = ['api_key', 'email', 'github_login']
    .some((key) => Object.prototype.hasOwnProperty.call(config, key));

  if (!hadStoredAuth) {
    return false;
  }

  delete config.api_key;
  delete config.email;
  delete config.github_login;
  saveConfig(config);
  return true;
}

export function getBaseUrl() {
  const config = getConfig();
  return process.env.AGENT_ANALYTICS_URL || config.base_url || 'https://api.agentanalytics.sh';
}
