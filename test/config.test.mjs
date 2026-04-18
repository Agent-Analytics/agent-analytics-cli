import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearStoredAuth,
  clearConfigDirOverride,
  getApiKey,
  getBaseUrl,
  getConfig,
  getConfigDir,
  saveConfig,
  getConfigFile,
  getConfigLocation,
  setApiKey,
  setConfigDirOverride,
} from '../lib/config.mjs';

const ORIGINAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
const ORIGINAL_CONFIG_DIR = process.env.AGENT_ANALYTICS_CONFIG_DIR;
const ORIGINAL_API_KEY = process.env.AGENT_ANALYTICS_API_KEY;
const ORIGINAL_API_URL = process.env.AGENT_ANALYTICS_URL;

let tempConfigHome;
let extraTempDirs = [];

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

beforeEach(() => {
  tempConfigHome = mkdtempSync(join(tmpdir(), 'agent-analytics-config-'));
  extraTempDirs = [];
  clearConfigDirOverride();
  process.env.XDG_CONFIG_HOME = tempConfigHome;
  delete process.env.AGENT_ANALYTICS_CONFIG_DIR;
  delete process.env.AGENT_ANALYTICS_API_KEY;
  delete process.env.AGENT_ANALYTICS_URL;
});

afterEach(() => {
  clearConfigDirOverride();
  restoreEnv('XDG_CONFIG_HOME', ORIGINAL_XDG_CONFIG_HOME);
  restoreEnv('AGENT_ANALYTICS_CONFIG_DIR', ORIGINAL_CONFIG_DIR);
  restoreEnv('AGENT_ANALYTICS_API_KEY', ORIGINAL_API_KEY);
  restoreEnv('AGENT_ANALYTICS_URL', ORIGINAL_API_URL);
  rmSync(tempConfigHome, { recursive: true, force: true });
  for (const dir of extraTempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('config', () => {
  describe('getConfig', () => {
    it('returns an object', () => {
      const config = getConfig();
      assert.equal(typeof config, 'object');
      assert.ok(config !== null);
    });
  });

  describe('saveConfig / getConfig roundtrip', () => {
    it('persists and reads back config', () => {
      const testKey = `test_roundtrip_${Date.now()}`;
      const config = getConfig();
      config._test = testKey;
      saveConfig(config);

      const loaded = getConfig();
      assert.equal(loaded._test, testKey);
    });
  });

  describe('config location', () => {
    it('uses XDG_CONFIG_HOME/agent-analytics by default when XDG is set', () => {
      assert.equal(getConfigDir(), join(tempConfigHome, 'agent-analytics'));
      assert.equal(getConfigFile(), join(tempConfigHome, 'agent-analytics', 'config.json'));
      assert.deepEqual(getConfigLocation(), {
        dir: join(tempConfigHome, 'agent-analytics'),
        file: join(tempConfigHome, 'agent-analytics', 'config.json'),
        source: 'xdg',
        label: 'XDG_CONFIG_HOME',
      });
    });

    it('uses AGENT_ANALYTICS_CONFIG_DIR before XDG_CONFIG_HOME', () => {
      const configDir = mkdtempSync(join(tmpdir(), 'agent-analytics-config-dir-'));
      extraTempDirs.push(configDir);
      process.env.AGENT_ANALYTICS_CONFIG_DIR = configDir;

      saveConfig({ api_key: 'aak_env_dir' });

      assert.equal(getConfigDir(), configDir);
      assert.equal(getConfigFile(), join(configDir, 'config.json'));
      assert.equal(getConfig().api_key, 'aak_env_dir');
      assert.equal(getConfigLocation().source, 'env');
    });

    it('uses an explicit override before AGENT_ANALYTICS_CONFIG_DIR', () => {
      const envDir = mkdtempSync(join(tmpdir(), 'agent-analytics-env-dir-'));
      const flagDir = mkdtempSync(join(tmpdir(), 'agent-analytics-flag-dir-'));
      extraTempDirs.push(envDir, flagDir);
      process.env.AGENT_ANALYTICS_CONFIG_DIR = envDir;
      setConfigDirOverride(flagDir);

      saveConfig({ api_key: 'aak_flag_dir' });

      assert.equal(getConfigDir(), flagDir);
      assert.equal(getConfigFile(), join(flagDir, 'config.json'));
      assert.equal(getConfig().api_key, 'aak_flag_dir');
      assert.equal(getConfigLocation().source, 'flag');
    });

    it('ignores empty AGENT_ANALYTICS_CONFIG_DIR and empty explicit override values', () => {
      process.env.AGENT_ANALYTICS_CONFIG_DIR = '';
      setConfigDirOverride('');

      assert.equal(getConfigDir(), join(tempConfigHome, 'agent-analytics'));
      assert.equal(getConfigLocation().source, 'xdg');
    });
  });

  describe('getApiKey', () => {
    it('returns env var when set', () => {
      process.env.AGENT_ANALYTICS_API_KEY = 'aak_from_env';
      assert.equal(getApiKey(), 'aak_from_env');
    });

    it('returns null when no env var and no config key', () => {
      assert.equal(getApiKey(), null);
    });
  });

  describe('setApiKey', () => {
    it('stores key in config file', () => {
      setApiKey('aak_test_set');
      const config = getConfig();
      assert.equal(config.api_key, 'aak_test_set');
    });
  });

  describe('getBaseUrl', () => {
    it('returns env var when set', () => {
      process.env.AGENT_ANALYTICS_URL = 'https://custom.example.com';
      assert.equal(getBaseUrl(), 'https://custom.example.com');
    });

    it('returns default URL when no env var or config', () => {
      delete process.env.AGENT_ANALYTICS_URL;
      assert.equal(getBaseUrl(), 'https://api.agentanalytics.sh');
    });
  });

  describe('clearStoredAuth', () => {
    it('removes saved auth fields and preserves base_url', () => {
      saveConfig({
        api_key: 'aak_saved',
        email: 'dev@example.com',
        github_login: 'devuser',
        base_url: 'https://custom.example.com',
      });

      assert.equal(clearStoredAuth(), true);
      assert.deepEqual(getConfig(), {
        base_url: 'https://custom.example.com',
      });
    });

    it('returns false when config file is missing', () => {
      assert.equal(clearStoredAuth(), false);
      assert.deepEqual(getConfig(), {});
    });

    it('returns false when auth keys are absent', () => {
      saveConfig({
        base_url: 'https://custom.example.com',
      });

      assert.equal(clearStoredAuth(), false);
      assert.deepEqual(getConfig(), {
        base_url: 'https://custom.example.com',
      });
    });
  });
});
