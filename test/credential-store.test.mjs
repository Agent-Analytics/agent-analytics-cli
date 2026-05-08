import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearCredentialStoreTestSeams,
  clearAgentSession,
  credentialAccountForBaseUrl,
  getCredentialStoreMode,
  readAgentSession,
  saveAgentSession,
  setCredentialStoreTestSeams,
} from '../lib/credential-store.mjs';
import {
  clearConfigDirOverride,
  getConfig,
  getStoredAuth,
  saveConfig,
  setAgentSession,
  setConfigDirOverride,
} from '../lib/config.mjs';

let tempDir;

const fullSession = {
  id: 'sess_native_test',
  access_token: 'aas_native_secret',
  refresh_token: 'aar_native_secret',
  access_expires_at: 1893456000000,
  refresh_expires_at: 1924992000000,
  scopes: ['account:read', 'projects:read'],
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'agent-analytics-credential-store-'));
  setConfigDirOverride(tempDir);
  clearCredentialStoreTestSeams();
  delete process.env.AGENT_ANALYTICS_CREDENTIAL_STORE;
  delete process.env.AGENT_ANALYTICS_URL;
});

afterEach(() => {
  clearCredentialStoreTestSeams();
  clearConfigDirOverride();
  delete process.env.AGENT_ANALYTICS_CREDENTIAL_STORE;
  delete process.env.AGENT_ANALYTICS_URL;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('credential-store', () => {
  it('defaults credential-store mode to auto', () => {
    assert.equal(getCredentialStoreMode(), 'auto');
  });

  it('in auto desktop mode stores the full agent session in native keyring and only non-secret metadata in config', async () => {
    const writes = [];
    const reads = [];
    const fakeKeyring = new Map();
    setCredentialStoreTestSeams({
      platform: 'darwin',
      nativeKeyring: {
        async setPassword(service, account, value) {
          writes.push({ service, account, value });
          fakeKeyring.set(`${service}\0${account}`, value);
        },
        async getPassword(service, account) {
          reads.push({ service, account });
          return fakeKeyring.get(`${service}\0${account}`) || null;
        },
        async deletePassword(service, account) {
          fakeKeyring.delete(`${service}\0${account}`);
        },
      },
    });

    await setAgentSession(fullSession);

    assert.equal(writes.length, 1);
    assert.equal(writes[0].service, 'agent-analytics');
    assert.equal(writes[0].account, 'https://api.agentanalytics.sh|default');
    const storedPayload = JSON.parse(writes[0].value);
    assert.deepEqual(storedPayload, fullSession);

    const config = getConfig();
    assert.equal(config.agent_session.access_token, undefined);
    assert.equal(config.agent_session.refresh_token, undefined);
    assert.deepEqual(config.agent_session, {
      storage: 'native',
      credential: writes[0].account,
      id: 'sess_native_test',
      access_expires_at: 1893456000000,
      refresh_expires_at: 1924992000000,
      scopes: ['account:read', 'projects:read'],
    });

    const loaded = await readAgentSession();
    assert.deepEqual(loaded, fullSession);
    assert.deepEqual(reads, [{ service: writes[0].service, account: writes[0].account }]);
  });

  it('keys native credentials by configured base URL with trailing slashes removed', async () => {
    const calls = [];
    const fakeKeyring = new Map();
    setCredentialStoreTestSeams({
      platform: 'darwin',
      nativeKeyring: {
        async setPassword(service, account, value) {
          calls.push({ op: 'set', service, account });
          fakeKeyring.set(`${service}\0${account}`, value);
        },
        async getPassword(service, account) {
          calls.push({ op: 'get', service, account });
          return fakeKeyring.get(`${service}\0${account}`) || null;
        },
        async deletePassword(service, account) {
          calls.push({ op: 'delete', service, account });
          fakeKeyring.delete(`${service}\0${account}`);
        },
      },
    });
    saveConfig({ base_url: 'https://staging.agentanalytics.test///' });

    await setAgentSession(fullSession);
    const expectedAccount = credentialAccountForBaseUrl('https://staging.agentanalytics.test/');
    assert.equal(expectedAccount, 'https://staging.agentanalytics.test|default');
    assert.deepEqual(calls[0], { op: 'set', service: 'agent-analytics', account: expectedAccount });

    const loaded = await getStoredAuth();
    assert.deepEqual(loaded, fullSession);
    assert.deepEqual(calls[1], { op: 'get', service: 'agent-analytics', account: expectedAccount });

    await clearAgentSession(getConfig(), 'https://staging.agentanalytics.test///');
    assert.deepEqual(calls[2], { op: 'delete', service: 'agent-analytics', account: expectedAccount });
    assert.equal(fakeKeyring.size, 0);
  });

  it('falls back to file storage in auto desktop mode when native credential storage is unavailable', async () => {
    setCredentialStoreTestSeams({
      platform: 'win32',
      nativeKeyring: {
        async setPassword() {
          throw new Error('native unavailable');
        },
        async getPassword() { return null; },
        async deletePassword() {},
      },
    });

    const saved = await saveAgentSession(fullSession);

    assert.equal(saved.storage, 'file');
    assert.equal(saved.fallback?.from, 'native');
    assert.match(saved.fallback?.message, /Native credential storage unavailable/i);
    const config = getConfig();
    assert.equal(config.agent_session.storage, 'file');
    assert.equal(config.agent_session.access_token, 'aas_native_secret');
    assert.equal(config.agent_session.refresh_token, 'aar_native_secret');
  });

  it('fails clearly in explicit native mode when native credential storage is unavailable', async () => {
    process.env.AGENT_ANALYTICS_CREDENTIAL_STORE = 'native';
    setCredentialStoreTestSeams({
      platform: 'win32',
      nativeKeyring: {
        async setPassword() {
          throw new Error('native unavailable');
        },
        async getPassword() { return null; },
        async deletePassword() {},
      },
    });

    await assert.rejects(
      () => saveAgentSession(fullSession),
      /Native credential storage unavailable.*AGENT_ANALYTICS_CREDENTIAL_STORE=file/s
    );
    assert.deepEqual(getConfig(), {});
  });

  it('keeps existing working auth when explicit native replacement fails', async () => {
    process.env.AGENT_ANALYTICS_CREDENTIAL_STORE = 'file';
    await saveAgentSession({ ...fullSession, id: 'sess_existing', access_token: 'aas_existing', refresh_token: 'aar_existing' });
    const before = getConfig();

    process.env.AGENT_ANALYTICS_CREDENTIAL_STORE = 'native';
    setCredentialStoreTestSeams({
      platform: 'darwin',
      nativeKeyring: {
        async setPassword() {
          throw new Error('keychain locked');
        },
        async getPassword() { return null; },
        async deletePassword() {},
      },
    });

    await assert.rejects(() => saveAgentSession(fullSession), /Native credential storage unavailable.*keychain locked/s);
    assert.deepEqual(getConfig(), before);
  });

  it('treats corrupt native keyring JSON as unavailable auth', async () => {
    setCredentialStoreTestSeams({
      platform: 'darwin',
      nativeKeyring: {
        async setPassword() {},
        async getPassword() { return '{not json'; },
        async deletePassword() {},
      },
    });

    await setAgentSession(fullSession);

    assert.equal(await getStoredAuth(), null);
  });

  it('treats native keyring payloads without tokens as unavailable auth', async () => {
    for (const payload of ['{}', JSON.stringify({ id: 'sess_no_tokens' })]) {
      setCredentialStoreTestSeams({
        platform: 'darwin',
        nativeKeyring: {
          async setPassword() {},
          async getPassword() { return payload; },
          async deletePassword() {},
        },
      });

      await setAgentSession(fullSession);

      assert.equal(await getStoredAuth(), null);
    }
  });

  it('treats non-string native keyring payloads as unavailable auth', async () => {
    setCredentialStoreTestSeams({
      platform: 'darwin',
      nativeKeyring: {
        async setPassword() {},
        async getPassword() { return { access_token: 'aas_not_a_string_payload' }; },
        async deletePassword() {},
      },
    });

    await setAgentSession(fullSession);

    assert.equal(await getStoredAuth(), null);
  });

  it('automatically migrates an existing plaintext agent session to native storage on desktop auto mode', async () => {
    const writes = [];
    const reads = [];
    const fakeKeyring = new Map();
    setCredentialStoreTestSeams({
      platform: 'darwin',
      nativeKeyring: {
        async setPassword(service, account, value) {
          writes.push({ service, account, value });
          fakeKeyring.set(`${service}\0${account}`, value);
        },
        async getPassword(service, account) {
          reads.push({ service, account });
          return fakeKeyring.get(`${service}\0${account}`) || null;
        },
        async deletePassword(service, account) {
          fakeKeyring.delete(`${service}\0${account}`);
        },
      },
    });
    saveConfig({ agent_session: { ...fullSession } });

    const loaded = await getStoredAuth();

    assert.deepEqual(loaded, fullSession);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].service, 'agent-analytics');
    assert.equal(writes[0].account, 'https://api.agentanalytics.sh|default');
    assert.deepEqual(JSON.parse(writes[0].value), fullSession);
    assert.deepEqual(reads, []);
    assert.deepEqual(getConfig().agent_session, {
      storage: 'native',
      credential: writes[0].account,
      id: 'sess_native_test',
      access_expires_at: 1893456000000,
      refresh_expires_at: 1924992000000,
      scopes: ['account:read', 'projects:read'],
    });

    const loadedAfterPlaintextRemoved = await getStoredAuth();
    assert.deepEqual(loadedAfterPlaintextRemoved, fullSession);
    assert.deepEqual(reads, [{ service: writes[0].service, account: writes[0].account }]);
  });

  it('does not point native metadata at stale auth if config changes during automatic migration', async () => {
    const refreshedSession = {
      ...fullSession,
      id: 'sess_refreshed_during_migration',
      access_token: 'aas_refreshed_secret',
      refresh_token: 'aar_refreshed_secret',
      access_expires_at: 1893457000000,
      refresh_expires_at: 1924993000000,
    };
    const writes = [];
    const deletes = [];
    const fakeKeyring = new Map();
    let refreshDuringWrite = true;
    setCredentialStoreTestSeams({
      platform: 'darwin',
      nativeKeyring: {
        async setPassword(service, account, value) {
          writes.push({ service, account, value });
          fakeKeyring.set(`${service}\\0${account}`, value);
          if (refreshDuringWrite) {
            refreshDuringWrite = false;
            saveConfig({ agent_session: { ...refreshedSession } });
          }
        },
        async getPassword(service, account) {
          return fakeKeyring.get(`${service}\\0${account}`) || null;
        },
        async deletePassword(service, account) {
          deletes.push({ service, account });
          fakeKeyring.delete(`${service}\\0${account}`);
        },
      },
    });
    saveConfig({ agent_session: { ...fullSession } });

    const loaded = await getStoredAuth();

    assert.deepEqual(loaded, fullSession);
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(writes[0].value), fullSession);
    assert.deepEqual(deletes, [{ service: writes[0].service, account: writes[0].account }]);
    assert.equal(fakeKeyring.size, 0);
    assert.deepEqual(getConfig().agent_session, refreshedSession);

    const loadedAfterRetry = await getStoredAuth();
    assert.deepEqual(loadedAfterRetry, refreshedSession);
    assert.equal(writes.length, 2);
    assert.deepEqual(JSON.parse(writes[1].value), refreshedSession);
    assert.deepEqual(getConfig().agent_session, {
      storage: 'native',
      credential: writes[1].account,
      id: 'sess_refreshed_during_migration',
      access_expires_at: 1893457000000,
      refresh_expires_at: 1924993000000,
      scopes: ['account:read', 'projects:read'],
    });

    const loadedAfterPlaintextRemoved = await getStoredAuth();
    assert.deepEqual(loadedAfterPlaintextRemoved, refreshedSession);
  });

  it('keeps plaintext auth readable when automatic native migration fails', async () => {
    process.env.AGENT_ANALYTICS_CREDENTIAL_STORE='***';
    setCredentialStoreTestSeams({
      platform: 'darwin',
      nativeKeyring: {
        async setPassword() {
          throw new Error('keychain locked');
        },
        async getPassword() { return null; },
        async deletePassword() {},
      },
    });
    saveConfig({ agent_session: { ...fullSession } });
    const before = getConfig();

    const loaded = await getStoredAuth();

    assert.deepEqual(loaded, fullSession);
    assert.deepEqual(getConfig(), before);
  });

  it('does not migrate existing plaintext auth in linux auto file mode', async () => {
    const writes = [];
    setCredentialStoreTestSeams({
      platform: 'linux',
      nativeKeyring: {
        async setPassword(service, account, value) { writes.push({ service, account, value }); },
        async getPassword() { return null; },
        async deletePassword() {},
      },
    });
    saveConfig({ agent_session: { ...fullSession } });

    assert.deepEqual(await getStoredAuth(), fullSession);
    assert.deepEqual(writes, []);
    assert.deepEqual(getConfig().agent_session, fullSession);
  });

  it('uses file storage by default on linux auto mode', async () => {
    setCredentialStoreTestSeams({ platform: 'linux' });

    await setAgentSession(fullSession);

    const config = getConfig();
    assert.equal(config.agent_session.access_token, 'aas_native_secret');
    assert.equal(config.agent_session.refresh_token, 'aar_native_secret');
    assert.equal(config.agent_session.storage, 'file');
    assert.deepEqual(await readAgentSession(), fullSession);
  });
});
