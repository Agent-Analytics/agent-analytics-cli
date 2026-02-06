/**
 * Config management — stores API key locally.
 * ~/.config/agent-analytics/config.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.config', 'agent-analytics');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function getConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

export function getApiKey() {
  const config = getConfig();
  return process.env.AGENT_ANALYTICS_KEY || config.api_key || null;
}

export function setApiKey(key) {
  const config = getConfig();
  config.api_key = key;
  saveConfig(config);
}

export function getBaseUrl() {
  const config = getConfig();
  return process.env.AGENT_ANALYTICS_URL || config.base_url || 'https://app.agentanalytics.sh';
}
