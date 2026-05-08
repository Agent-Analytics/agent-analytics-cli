/**
 * Credential storage selection for agent-session auth.
 * Native storage uses @zowe/secrets-for-zowe-sdk on supported desktop OSes.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getConfig, saveConfig } from './config.mjs';

export const CREDENTIAL_SERVICE = 'agent-analytics';
export const DEFAULT_BASE_URL = 'https://api.agentanalytics.sh';
const DEFAULT_MODE = 'auto';

let testSeams = {};

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export function getCredentialStoreMode() {
  const raw = process.env.AGENT_ANALYTICS_CREDENTIAL_STORE;
  if (!nonEmpty(raw)) return DEFAULT_MODE;
  const mode = raw.trim().toLowerCase();
  return ['auto', 'native', 'file'].includes(mode) ? mode : DEFAULT_MODE;
}

function currentPlatform() {
  return testSeams.platform || process.env.AGENT_ANALYTICS_CREDENTIAL_PLATFORM || process.platform;
}

function isDesktopPlatform(platform = currentPlatform()) {
  return platform === 'darwin' || platform === 'win32';
}

export function selectedStorage(mode = getCredentialStoreMode(), platform = currentPlatform()) {
  if (mode === 'file') return 'file';
  if (mode === 'native') return 'native';
  return isDesktopPlatform(platform) ? 'native' : 'file';
}

export function normalizeCredentialBaseUrl(baseUrl = DEFAULT_BASE_URL) {
  const raw = nonEmpty(baseUrl) ? baseUrl.trim() : DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

export function credentialAccountForBaseUrl(baseUrl = DEFAULT_BASE_URL) {
  return `${normalizeCredentialBaseUrl(baseUrl)}|default`;
}

export function serializeAgentSession(session) {
  return JSON.stringify({
    id: session.id,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    scopes: Array.isArray(session.scopes) ? [...session.scopes] : session.scopes,
    access_expires_at: session.access_expires_at,
    refresh_expires_at: session.refresh_expires_at,
  });
}

export function parseAgentSession(payload) {
  if (!payload) return null;
  if (typeof payload !== 'string') return null;

  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (!nonEmpty(parsed.access_token) && !nonEmpty(parsed.refresh_token)) return null;
  return parsed;
}

export function agentSessionMetadata(session, storage, credential = undefined) {
  const metadata = {
    storage,
    id: session.id,
    access_expires_at: session.access_expires_at,
    refresh_expires_at: session.refresh_expires_at,
  };
  if (Array.isArray(session.scopes)) metadata.scopes = [...session.scopes];
  if (credential) metadata.credential = credential;
  return metadata;
}

function nativeCredentialUnavailableMessage(err) {
  const detail = err?.message ? ` (${err.message})` : '';
  return `Native credential storage unavailable${detail}. Set AGENT_ANALYTICS_CREDENTIAL_STORE=file to use file storage, or fix native keyring access and retry.`;
}

function saveFileAgentSession(config, session, fallback = undefined) {
  config.agent_session = { ...session, storage: 'file' };
  saveConfig(config);
  const result = { storage: 'file' };
  if (fallback) result.fallback = fallback;
  return result;
}

function fakeKeyringFromFile(file) {
  function load() {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  }
  function store(data) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  }
  return {
    async setPassword(service, account, value) {
      const data = load();
      data[`${service}\0${account}`] = value;
      store(data);
    },
    async getPassword(service, account) {
      const data = load();
      return data[`${service}\0${account}`] || null;
    },
    async deletePassword(service, account) {
      const data = load();
      delete data[`${service}\0${account}`];
      store(data);
    },
  };
}

async function getNativeKeyring() {
  if (testSeams.nativeKeyring) return testSeams.nativeKeyring;
  if (process.env.AGENT_ANALYTICS_FAKE_KEYRING_FILE) {
    return fakeKeyringFromFile(process.env.AGENT_ANALYTICS_FAKE_KEYRING_FILE);
  }
  const mod = await import('@zowe/secrets-for-zowe-sdk');
  return mod.keyring;
}

export function setCredentialStoreTestSeams(seams = {}) {
  testSeams = { ...seams };
}

export function clearCredentialStoreTestSeams() {
  testSeams = {};
}

export async function saveAgentSession(session, baseUrl = DEFAULT_BASE_URL) {
  const mode = getCredentialStoreMode();
  const storage = selectedStorage(mode);
  const config = getConfig();
  delete config.api_key;

  if (storage === 'native') {
    const credential = credentialAccountForBaseUrl(baseUrl);
    try {
      const keyring = await getNativeKeyring();
      await keyring.setPassword(CREDENTIAL_SERVICE, credential, serializeAgentSession(session));
    } catch (err) {
      const message = nativeCredentialUnavailableMessage(err);
      if (mode === 'auto') {
        return saveFileAgentSession(config, session, {
          from: 'native',
          to: 'file',
          message,
        });
      }
      throw new Error(message);
    }
    config.agent_session = agentSessionMetadata(session, 'native', credential);
    saveConfig(config);
    return { storage: 'native', credential };
  }

  return saveFileAgentSession(config, session);
}

async function migratePlaintextAgentSessionToNative(session, baseUrl = DEFAULT_BASE_URL) {
  if (selectedStorage() !== 'native') return false;

  if (!plaintextAgentSessionAuth(session)) return false;

  // Re-read immediately before writing native credentials. The caller may have
  // loaded a stale config object while another process refreshed auth tokens.
  const config = getConfig();
  const auth = plaintextAgentSessionAuth(config.agent_session);
  if (!auth) return false;

  const credential = credentialAccountForBaseUrl(baseUrl);
  const keyring = await getNativeKeyring();
  await keyring.setPassword(CREDENTIAL_SERVICE, credential, serializeAgentSession(auth));

  // Only save native metadata if the plaintext auth still matches the payload
  // actually written to keyring. If a concurrent refresh happened during the
  // keyring write, remove the now-stale native payload and leave plaintext auth
  // untouched so a later read can retry safely.
  const latestConfig = getConfig();
  const latestAuth = plaintextAgentSessionAuth(latestConfig.agent_session);
  if (!sameAgentSessionAuth(latestAuth, auth)) {
    try {
      await keyring.deletePassword(CREDENTIAL_SERVICE, credential);
    } catch {
      // Best-effort cleanup only; the config must not point at stale native auth.
    }
    return false;
  }

  latestConfig.agent_session = agentSessionMetadata(auth, 'native', credential);
  saveConfig(latestConfig);
  return true;
}

function sameAgentSessionAuth(a, b) {
  if (!a || !b) return false;
  return serializeAgentSession(a) === serializeAgentSession(b);
}

function plaintextAgentSessionAuth(session) {
  if (!session || session.storage === 'native') return null;
  if (!session.refresh_token && !session.access_token) return null;
  const { storage, credential, ...auth } = session;
  return { ...auth };
}

export async function readAgentSession(config = getConfig(), baseUrl = DEFAULT_BASE_URL) {
  const session = config.agent_session;
  if (!session) return null;
  if (session.storage === 'native') {
    const keyring = await getNativeKeyring();
    const credential = credentialAccountForBaseUrl(baseUrl);
    const payload = await keyring.getPassword(CREDENTIAL_SERVICE, credential);
    return parseAgentSession(payload);
  }

  const auth = plaintextAgentSessionAuth(session);
  if (auth) {
    try {
      await migratePlaintextAgentSessionToNative(session, baseUrl);
    } catch {
      // Migration is opportunistic and must never break existing plaintext auth.
    }
    return auth;
  }
  return null;
}

export async function clearAgentSession(config = getConfig(), baseUrl = DEFAULT_BASE_URL) {
  const session = config.agent_session;
  if (session?.storage === 'native') {
    const keyring = await getNativeKeyring();
    const credential = credentialAccountForBaseUrl(baseUrl);
    await keyring.deletePassword(CREDENTIAL_SERVICE, credential);
  }
}
